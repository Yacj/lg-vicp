import { tool } from "ai";
import { z } from "zod";
import { compareProducts, toProductCompareToolOutput } from "../compare-product.service.js";
import { buildComparisonSelectionWaitState } from "../agent-choice.js";
import { parseConversationTaskState } from "../conversation-task.js";
import type { ThermalCapabilityState } from "../compare-product.js";
import { runRegisteredTool, type ToolRuntimeContext } from "./tool-runtime.js";
import { normalizeComparisonForModel } from "./tool-result-normalizer.js";

export const compareProductsInput = z.object({
  productIds: z.array(z.string().trim().min(1)).min(2).max(12)
    .describe("已明确的产品 ID，至少 2 个。不要传 targetK、评分权重或热工结果作为必填项"),
  focus: z.array(z.string().trim().min(1).max(80)).max(12).optional()
    .describe("用户明确关注点，例如性能、适用场景")
});

export function createCompareProductsTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      对已明确的产品做结构化对比。返回动态维度与证据，不打分、不排名、不宣称唯一最优。
      热工结果不是前置条件；没有热工也可以完成对比。
      对比完成后等待用户多选并确认生成报告，不要替用户做最终选择。
    `,
    inputSchema: compareProductsInput,
    execute: async (args, options) => runRegisteredTool(ctx, "compare_products", args, options, async () => {
      const taskState = ctx.taskState ?? parseConversationTaskState(null);
      const productIds = taskState.selectedProductIds?.length ? taskState.selectedProductIds : args.productIds;
      const { result } = await compareProducts(ctx.app, {
        productIds,
        focus: args.focus,
        userGoal: taskState.userGoal,
        conversationId: ctx.conversation.id,
        projectId: ctx.conversation.projectId,
        thermal: contextThermal(taskState)
      });
      const output = toProductCompareToolOutput(result);
      const comparison = normalizeComparisonForModel(result);
      ctx.onEvent?.("comparison_ready", {
        conversationId: ctx.conversation.id,
        productIds,
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
    })
  });
}

function contextThermal(taskState: { comparisonContext?: Record<string, unknown> }): ThermalCapabilityState | undefined {
  const thermal = taskState.comparisonContext?.thermal;
  if (!thermal || typeof thermal !== "object") return undefined;
  const record = thermal as { status?: string; results?: unknown[] };
  if (record.status === "AVAILABLE" || record.status === "PENDING" || record.status === "NOT_AVAILABLE") {
    return { status: record.status, results: record.results ?? [] };
  }
  return undefined;
}
