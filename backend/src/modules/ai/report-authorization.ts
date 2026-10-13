import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
/** 仅本轮分类/已校验UI动作授权；旧选择和模型Tool参数没有授权能力。 */
export function hasReportAuthorization(ctx: Pick<ToolRuntimeContext, "domainDecision" | "userMessage" | "reportAuthorization" | "user" | "conversation">) {
  if (ctx.reportAuthorization?.userId === ctx.user.id && ctx.reportAuthorization.conversationId === ctx.conversation.id) return true;
  const decision = ctx.domainDecision;
  return decision?.intent === "REPORT_REQUEST" && decision.mutation === "REPORT"
    && decision.evidenceSpans.some(span => span.trim().length > 0 && (ctx.userMessage ?? "").includes(span));
}
export function isSolutionReportRequest(ctx: Pick<ToolRuntimeContext, "userMessage" | "taskState">, reportType?: string) {
  if (reportType && ["technical_scheme", "project_brief", "energy_design", "design_note", "TEMPLATE"].includes(reportType)) return true;
  if (/方案|保温|工程|节能设计/.test(ctx.userMessage ?? "") && /报告|PDF|文档/i.test(ctx.userMessage ?? "")) return true;
  if(reportType === "material_compare" || reportType === "ai_conversation") return false;
  if(ctx.taskState?.selectedProductIds?.length && ctx.taskState.comparisonContext) return false;
  return !/产品对比|材料对比|竞品对比|对话整理|会话整理|聊天整理/.test(ctx.userMessage ?? "")
    && Boolean(ctx.taskState?.lastReferenceLookup?.candidates.length);
}
