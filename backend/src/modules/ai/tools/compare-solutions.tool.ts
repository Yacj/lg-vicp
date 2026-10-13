import { decideDomainTurn } from "../ai-domain-turn-decision.js";
import { resolveReferenceRead } from "../reference-candidate-resolver.service.js";
import { buildAllowedAnswerFacts, setThermalAnswerFacts } from "../thermal-answer-validation.js";
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
import { loadActiveSolution, actOnSolution } from "../solution-state.service.js";
import { parseSolutionAction } from "../solution-action-semantic.service.js";
import { searchProductCatalog } from "../product-read.service.js";

export const compareSolutionsInput = z.object({
  operation: z.enum(["COMPARE", "ADD", "REMOVE", "REMOVE_CONFLICT", "KEEP_FOR_COMPARISON", "SET_FINAL", "CONFIRM", "START_NEW"]).optional()
    .describe("智配方案操作；必须来自用户本轮明确动作，CONFIRM 仅限明确确认最终方案"),
  positions: z.array(z.number().int().positive()).max(100).optional().describe("用户明确的当前候选序号，由后端映射正式身份；模型不得编造候选 ID"),
  candidateIds: z.array(z.string().min(1)).min(2).max(12).optional().describe("已选正式热工候选 ID；只比较这些冻结记录，不重新查询全库"),
  productIds: z.array(z.string().trim().min(1)).min(1).max(12).optional()
    .describe("已明确的产品 ID；产品对比至少 2 个，不强制热工或 targetK"),
  solutionIds: z.array(z.string().trim().min(1)).min(2).max(12).optional()
    .describe("兼容旧方案对比的构造方案 ID"),
  focus: z.array(z.string().trim().min(1).max(80)).max(12).optional()
    .describe("用户明确关注点"),
  targetK: z.number().positive().max(10).optional()
    .describe("兼容旧逻辑的目标传热系数，产品对比不需要")
}).refine(value => Boolean(value.operation) || (value.productIds?.length ?? 0) >= 2 || (value.solutionIds?.length ?? 0) >= 2 || (value.candidateIds?.length ?? 0) >= 2,
  { message: "请指定智配操作或至少两个产品/方案" });

export function createCompareSolutionsTool(ctx: ToolRuntimeContext) {
  return tool({
    description: `
      兼容旧 compare_solutions。优先对产品做结构化对比（不打分、不强制热工）。
      仅当传入 solutionIds 时走旧方案对比读取路径。不要把热工当作产品对比前置步骤。
    `,
    inputSchema: compareSolutionsInput,
    execute: async (args, options) => runRegisteredTool(ctx, "compare_solutions", args, options, async () => {
      const decision = ctx.domainDecision ?? decideDomainTurn(ctx.userMessage ?? "", ctx.taskState?.lastReferenceLookup);
      if (args.operation && args.operation !== "COMPARE") {
        if (decision.intent !== "SOLUTION_ACTION") return toolError({ code: "SOLUTION_USER_ACTION_REQUIRED", message: "该操作需要用户本轮明确选择或确认。" });
        const state = await loadActiveSolution(ctx);
        if (!state) return toolError({ code: "SOLUTION_USER_ACTION_REQUIRED", message: "请先通过明确选择激活方案。" });
        const intent = await parseSolutionAction({ ...ctx, domainDecision: decision }, ctx.userMessage ?? "", state.payload);
        if (!intent || intent.action !== args.operation || intent.clarification) return toolError({ code: "SOLUTION_USER_ACTION_REQUIRED", message: intent?.clarification ?? "该操作需要用户明确选择或确认" });
        const result = await actOnSolution(ctx, state.id, { action: intent.action, expectedVersion: state.version,
          candidateSetRevision: state.candidateSetRevision, candidateIds: intent.candidateIds });
        ctx.onEvent?.("solution_state", result);
        return toolOk(result);
      }
      if (decision.intent === "COMPARE_CANDIDATES") {
        const read = await resolveReferenceRead({ ...ctx, domainDecision: decision });
        setThermalAnswerFacts(ctx, read.facts);
        return toolOk({ candidates: read.candidates, needsClarification: read.needsClarification,
          canonicalAnswers: read.facts.canonicalAnswers }, { sources: read.sources });
      }
      if (args.candidateIds?.length || !args.productIds?.length && !args.solutionIds?.length)
        return toolError({ code: "REFERENCE_SELECTION_REQUIRED", message: "请明确本轮要比较的候选。" });
      if ((args.productIds?.length ?? 0) >= 2) {
        if(decision.intent!=="MATERIAL_COMPARE") return toolError({code:"DOMAIN_COMPARE_NOT_AUTHORIZED",message:"本轮不是产品或材料比较请求。"});
        const allowed=new Set([...(ctx.productReadIds??[]),...(ctx.taskState?.selectedProductIds??[])]);
        if(args.productIds!.some(id=>!allowed.has(id))) return toolError({code:"PRODUCT_REFERENCE_REQUIRED",message:"请先搜索并明确要比较的正式产品，不能猜测产品ID。"});
        const current=await searchProductCatalog(ctx,{productIds:args.productIds});
        if(current.products.length!==new Set(args.productIds).size) return toolError({code:"PRODUCT_REFERENCE_INVALID",message:"部分产品已停用或不存在，请重新搜索。"});
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
