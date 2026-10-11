import { buildAllowedAnswerFacts, setThermalAnswerFacts } from "../thermal-answer-validation.js";
import { saveConversationTaskState } from "../ai-conversation-state.service.js";
import { traceQueryState, validateCandidateAgainstQueryState } from "../../thermal/thermal-query-state.js";
import { toolError, toolOk } from "./tool-output.js";
import { tool } from "ai";
import { z } from "zod";
import { compareSolutions, toCompareToolOutput } from "../compare-solution.service.js";
import { compareProducts, toProductCompareToolOutput } from "../compare-product.service.js";
import { buildChoiceWaitState, buildComparisonSelectionWaitState } from "../agent-choice.js";
import { loadProjectProfile } from "../ai-project-profile.js";
import { parseConversationTaskState } from "../conversation-task.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { normalizeComparisonForModel } from "./tool-result-normalizer.js";
import { selectFrozenReferenceCandidateIds } from "../reference-candidate-selection.js";

export const compareSolutionsInput = z.object({
  candidateIds: z.array(z.string().min(1)).min(2).max(12).optional().describe("已选正式热工候选 ID；只比较这些冻结记录，不重新查询全库"),
  productIds: z.array(z.string().trim().min(1)).min(1).max(12).optional()
    .describe("已明确的产品 ID；产品对比至少 2 个，不强制热工或 targetK"),
  solutionIds: z.array(z.string().trim().min(1)).min(2).max(12).optional()
    .describe("兼容旧方案对比的构造方案 ID"),
  focus: z.array(z.string().trim().min(1).max(80)).max(12).optional()
    .describe("用户明确关注点"),
  targetK: z.number().positive().max(10).optional()
    .describe("兼容旧逻辑的目标传热系数，产品对比不需要")
}).refine((value) => (value.productIds?.length ?? 0) >= 2 || (value.solutionIds?.length ?? 0) >= 2 || (value.candidateIds?.length ?? 0) >= 2, {
  message: "请提供至少 2 个产品 ID 或 2 个方案 ID"
});

export function createCompareSolutionsTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      兼容旧 compare_solutions。优先对产品做结构化对比（不打分、不强制热工）。
      仅当传入 solutionIds 时走旧方案对比读取路径。不要把热工当作产品对比前置步骤。
    `,
    inputSchema: compareSolutionsInput,
    execute: async (args, options) => runRegisteredTool(ctx, "compare_solutions", args, options, async () => {
      const last = ctx.taskState?.lastReferenceLookup;
      const selectedIds = selectFrozenReferenceCandidateIds(last, ctx.userMessage ?? "") ?? args.candidateIds
        ?? (last && args.solutionIds?.length ? last.candidates.filter(candidate => args.solutionIds!.includes(candidate.schemeId ?? "")).map(candidate => candidate.id) : undefined);
      if (selectedIds) {
        const selected = (last?.candidates ?? []).filter(candidate => selectedIds.includes(candidate.id));
        if (!last || selected.length < 2 || selected.length !== selectedIds.length || selected.some(candidate => !validateCandidateAgainstQueryState(candidate, last.query).passed)) {
          ctx.thermalCanonicalAnswers = ["所选方案不在当前已核验候选中，请确认要比较的正式方案。"];
          return toolError({ code: "REFERENCE_SELECTION_INVALID", message: "所选方案不在当前已核验候选中，请确认要比较的正式方案。" });
        }
        last.selectedCandidateIds = [...selectedIds];
        last.query = traceQueryState({ ...last.query, intent: "COMPARISON" }, last.query);
        if (ctx.taskState) await saveConversationTaskState(ctx.app, ctx.conversation.id, ctx.taskState);
        const facts = buildAllowedAnswerFacts(last.query, selected, "详细参数对比");
        setThermalAnswerFacts(ctx, facts);
        return toolOk({ candidates: selected, scope: "SELECTED_CANDIDATES", canonicalAnswers: facts.canonicalAnswers,
          instruction: `只比较已选记录。数值、厚度、页码必须与后端核验事实完全一致，允许自然表达：\n${facts.canonicalAnswers[0]}` });
      }
      if ((args.productIds?.length ?? 0) >= 2) {
        const taskState = ctx.taskState ?? parseConversationTaskState(null);
        const { result } = await compareProducts(ctx.app, {
          productIds: ctx.taskState?.selectedProductIds?.length ? ctx.taskState.selectedProductIds : args.productIds!,
          focus: args.focus,
          userGoal: taskState.userGoal,
          conversationId: ctx.conversation.id,
          projectId: ctx.conversation.projectId
        });
        const output = toProductCompareToolOutput(result);
        const comparison = normalizeComparisonForModel(result);
        ctx.onEvent?.("comparison_ready", {
          conversationId: ctx.conversation.id,
          productIds: ctx.taskState?.selectedProductIds?.length ? ctx.taskState.selectedProductIds : args.productIds,
          dimensionCount: result.dimensions.length,
          thermalStatus: result.thermal.status,
          missingNotes: result.missingNotes,
          comparisonResult: result
        });
        if (output.requiresUserSelection) {
          const waiting = buildComparisonSelectionWaitState({
            products: result.products.map((item) => ({ id: item.id, name: item.name, summary: item.summary })),
            comparisonResult: result,
            sourceToolCallId: options.toolCallId
          });
          return {
            ok: true as const,
            comparison,
            requiresUserSelection: true,
            multiple: true,
            minSelections: 1,
            __agentSignal: "WAITING_USER_INPUT" as const,
            type: waiting.type,
            title: waiting.title,
            prompt: waiting.prompt,
            options: waiting.options,
            confirmAction: waiting.confirmAction,
            request: waiting.request,
            comparisonResult: result,
            sourceToolCallId: options.toolCallId
          };
        }
        return { ok: true as const, comparison };
      }

      const profile = ctx.conversation.projectId
        ? await loadProjectProfile(ctx.app, ctx.conversation.projectId)
        : null;
      const result = await compareSolutions(
        ctx.app,
        ctx.request,
        ctx.user,
        {
          projectId: ctx.conversation.projectId ?? undefined,
          targetK: args.targetK,
          solutionIds: args.solutionIds,
          productIds: args.productIds
        },
        {
          conversationProjectId: ctx.conversation.projectId,
          insulationSystemId: ctx.conversation.insulationSystemId,
          regionCode: profile?.region,
          buildingType: profile?.buildingType
        }
      );
      const output = toCompareToolOutput(result);
      ctx.onEvent?.("comparison_ready", {
        conversationId: ctx.conversation.id,
        solutionIds: args.solutionIds,
        candidateCount: result.candidates.length
      });
      if (output.requiresUserChoice) {
        const waiting = buildChoiceWaitState({
          comparison: result,
          sourceToolCallId: options.toolCallId
        });
        return {
          ...output,
          __agentSignal: "WAITING_USER_INPUT" as const,
          type: waiting.type,
          title: waiting.title,
          prompt: waiting.prompt,
          options: waiting.options,
          comparisonResult: result,
          sourceToolCallId: options.toolCallId
        };
      }
      return output;
    })
  });
}
