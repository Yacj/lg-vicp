import { tool } from "ai";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { aiAgentRuns } from "../../../db/schema.js";
import { USER_LANGUAGE_NOTES } from "../../../shared/ai-response-policy.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { toolOk } from "./tool-output.js";
import { normalizeReportForModel } from "./tool-result-normalizer.js";
import { parseSelectedChoice, type SelectedChoice, buildUserSelectionWaitState } from "../agent-choice.js";
import {
  createReportContextSnapshot,
  generateReportFromSnapshot,
  getReportContextSnapshot
} from "../report-context-snapshot.service.js";
import { compareProducts } from "../compare-product.service.js";
import type { ComparisonContext, ProductComparisonResult } from "../compare-product.js";
import { parseConversationTaskState } from "../conversation-task.js";
import { inferReportType } from "../report-type-inference.js";
import { createReport } from "../../reports/report-generation.service.js";

export const generateReportInput = z.object({
  snapshotId: z.string().trim().min(1).max(80).optional()
    .describe("已固化的 Report Context Snapshot ID。用户确认多选后应优先传这个，不要再猜产品"),
  reportType: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("仅在没有产品对比快照且无法从会话上下文推断时使用。产品对比确认后不要再让用户选择报告类型"),
  requirements: z
    .string()
    .trim()
    .max(4000)
    .optional()
    .describe("用户补充的报告要求")
});

async function loadLatestSelectedChoice(app: ToolRuntimeContext["app"], conversationId: string): Promise<SelectedChoice | null> {
  const rows = await app.db.select({ stateJson: aiAgentRuns.stateJson })
    .from(aiAgentRuns)
    .where(eq(aiAgentRuns.conversationId, conversationId))
    .orderBy(desc(aiAgentRuns.startedAt))
    .limit(8);
  for (const row of rows) {
    const selected = parseSelectedChoice(row.stateJson);
    if (selected?.optionId) return selected;
  }
  return null;
}

function isProductComparisonResult(value: unknown): value is ProductComparisonResult {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ProductComparisonResult).products)
    && Array.isArray((value as ProductComparisonResult).dimensions));
}

function selectedNamesFromProducts(ids: string[], products?: Array<{ id: string; name: string }>) {
  const byId = new Map((products ?? []).map((item) => [item.id, item.name]));
  return ids.map((id) => byId.get(id) ?? id);
}

function reportQueuedOutput(names: string[]) {
  const data = normalizeReportForModel({ created: false, queued: true, selectedNames: names });
  const summary = names.length > 0
    ? `已按你选中的 ${names.join("、")} 开始生成对比报告，生成完成后可在报告列表查看。`
    : USER_LANGUAGE_NOTES.reportQueued;
  return toolOk(data, { summary });
}

export function createGenerateReportTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      仅在用户明确要求生成报告，或用户已多选并确认生成报告时调用。
      有 Report Context Snapshot 或已确认 selectedProductIds 时，直接按快照排队生成，不要再询问是否确认，也不要让用户选择报告类型。
      报告类型不明确时不要把类型列表写成 Markdown 编号，系统会弹出结构化选择。
      覆盖已发布报告、删除或正式发布才需要 APPROVAL。
    `,
    inputSchema: generateReportInput,
    execute: async ({ snapshotId, reportType, requirements }, options) => runRegisteredTool(ctx, "generate_report", { snapshotId, reportType, requirements }, options, async () => {
      const taskState = ctx.taskState ?? parseConversationTaskState(null);
      ctx.onEvent?.("report_started", { conversationId: ctx.conversation.id, snapshotId: snapshotId ?? taskState.reportContextSnapshotId ?? null });

      const existingSnapshotId = snapshotId ?? taskState.reportContextSnapshotId ?? null;
      if (existingSnapshotId) {
        const snapshot = await getReportContextSnapshot(ctx.app, existingSnapshotId);
        if (snapshot) {
          const generated = await generateReportFromSnapshot(ctx.app, {
            snapshot,
            user: ctx.user,
            request: ctx.request
          });
          ctx.onEvent?.("report_queued", {
            reportId: generated.reportId,
            taskId: generated.taskId,
            snapshotId: generated.snapshotId,
            status: generated.status,
            selectedProductIds: snapshot.selectedProductIds
          });
          return reportQueuedOutput(selectedNamesFromProducts(
            snapshot.selectedProductIds,
            (snapshot.comparisonResult as ProductComparisonResult | undefined)?.products
          ));
        }
      }

      const selectedComparison = ctx.selectedComparison;
      const selectedProductIds = selectedComparison?.optionIds?.length
        ? selectedComparison.optionIds
        : taskState.selectedProductIds ?? [];
      const storedResult = isProductComparisonResult(selectedComparison?.comparisonResult)
        ? selectedComparison!.comparisonResult as ProductComparisonResult
        : isProductComparisonResult(taskState.comparisonContext)
          ? taskState.comparisonContext as unknown as ProductComparisonResult
          : null;
      if (selectedProductIds.length >= 1 && storedResult) {
        const context = (taskState.comparisonContext && "productIds" in taskState.comparisonContext
          ? taskState.comparisonContext as unknown as ComparisonContext
          : {
            conversationId: ctx.conversation.id,
            projectId: ctx.conversation.projectId,
            userGoal: taskState.userGoal,
            confirmedRequirements: [],
            productIds: storedResult.products.map((item) => item.id),
            dimensions: storedResult.dimensions,
            evidenceRefs: storedResult.evidenceRefs,
            thermal: storedResult.thermal
          });
        const snapshot = await createReportContextSnapshot(ctx.app, {
          conversationId: ctx.conversation.id,
          projectId: ctx.conversation.projectId,
          reportType: "material_compare",
          selectedProductIds,
          selectedKnowledgeSourceIds: taskState.confirmedKnowledgeSourceIds,
          userGoal: taskState.userGoal,
          confirmedRequirements: context.confirmedRequirements.map((item) => item.text),
          comparisonContext: context,
          comparisonResult: storedResult,
          createdById: ctx.user.id
        });
        const generated = await generateReportFromSnapshot(ctx.app, {
          snapshot,
          user: ctx.user,
          request: ctx.request
        });
        ctx.onEvent?.("report_queued", {
          reportId: generated.reportId,
          taskId: generated.taskId,
          snapshotId: generated.snapshotId,
          status: generated.status,
          selectedProductIds
        });
        return reportQueuedOutput(selectedNamesFromProducts(selectedProductIds, storedResult.products));
      }
      if (selectedProductIds.length >= 2) {
        const compared = await compareProducts(ctx.app, {
          productIds: selectedProductIds,
          conversationId: ctx.conversation.id,
          projectId: ctx.conversation.projectId,
          userGoal: taskState.userGoal
        });
        const snapshot = await createReportContextSnapshot(ctx.app, {
          conversationId: ctx.conversation.id,
          projectId: ctx.conversation.projectId,
          reportType: "material_compare",
          selectedProductIds,
          selectedKnowledgeSourceIds: taskState.confirmedKnowledgeSourceIds,
          userGoal: taskState.userGoal,
          confirmedRequirements: compared.context.confirmedRequirements.map((item) => item.text),
          comparisonContext: compared.context,
          comparisonResult: compared.result,
          createdById: ctx.user.id
        });
        const generated = await generateReportFromSnapshot(ctx.app, {
          snapshot,
          user: ctx.user,
          request: ctx.request
        });
        ctx.onEvent?.("report_queued", {
          reportId: generated.reportId,
          taskId: generated.taskId,
          snapshotId: generated.snapshotId,
          status: generated.status,
          selectedProductIds
        });
        return reportQueuedOutput(selectedNamesFromProducts(selectedProductIds, compared.result.products));
      }

      const inferred = inferReportType({
        explicitReportType: reportType,
        selectedReportType: taskState.selectedReportType,
        currentState: taskState,
        confirmAction: ctx.selectedUserSelection?.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" : null,
        message: requirements
      });
      if (inferred.status === "NEEDS_SELECTION") {
        const waiting = buildUserSelectionWaitState({
          request: inferred.request,
          sourceToolCallId: options.toolCallId
        });
        return {
          ok: true as const,
          waiting: true,
          __agentSignal: "WAITING_USER_INPUT" as const,
          type: waiting.type,
          selectionKind: waiting.selectionKind,
          title: waiting.title,
          prompt: waiting.prompt,
          options: waiting.options,
          multiple: waiting.multiple,
          minSelections: waiting.minSelections,
          maxSelections: waiting.maxSelections,
          autoSelectWhenSingle: waiting.autoSelectWhenSingle,
          confirmAction: waiting.confirmAction,
          request: waiting.request,
          sourceToolCallId: options.toolCallId
        };
      }

      const selectedChoice = ctx.selectedChoice
        ?? await loadLatestSelectedChoice(ctx.app, ctx.conversation.id);
      const snapshot = await createReportContextSnapshot(ctx.app, {
        conversationId: ctx.conversation.id,
        projectId: ctx.conversation.projectId,
        reportType: inferred.reportType,
        selectedProductIds,
        selectedKnowledgeSourceIds: taskState.confirmedKnowledgeSourceIds,
        userGoal: taskState.userGoal ?? requirements,
        confirmedRequirements: requirements ? [requirements] : [],
        createdById: ctx.user.id
      });
      const generated = await createReport(ctx.app, ctx.request, ctx.user, {
        reportType: inferred.reportType,
        projectId: ctx.conversation.projectId,
        conversationId: ctx.conversation.id,
        contentJson: {
          snapshotId: snapshot.id,
          selectedScheme: selectedChoice
            ? {
              optionId: selectedChoice.optionId,
              label: selectedChoice.option.label,
              summary: selectedChoice.option.summary,
              data: selectedChoice.option.data ?? null
            }
            : null,
          selectedProductIds,
          selectedKnowledgeSourceIds: taskState.confirmedKnowledgeSourceIds ?? [],
          requirements: requirements ?? null
        },
        contextOverlay: {
          snapshotId: snapshot.id,
          selectedProductIds,
          selectedKnowledgeSourceIds: taskState.confirmedKnowledgeSourceIds ?? [],
          userGoal: taskState.userGoal ?? requirements ?? null,
          referencePages: snapshot.referencePages ?? []
        }
      });
      ctx.onEvent?.("report_queued", {
        reportId: generated.reportId,
        taskId: generated.taskId,
        snapshotId: snapshot.id,
        status: generated.status,
        selectedProductIds
      });
      return reportQueuedOutput(selectedChoice ? [selectedChoice.option.label] : selectedProductIds);
    })
  });
}
