import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { AppError } from "../../shared/errors.js";
export function solutionReportError(code: string, message: string): never {
  throw new AppError(code, message, 400, { errorCode: code });
}
export type ReportAuthorizationInput = Pick<ToolRuntimeContext, "domainDecision" | "userMessage" | "reportAuthorization">;
/** 当前HTTP/UI枚举才是确认动作；仅恢复旧pending状态不能签发报告授权。 */
export function isCurrentReportUiAction(action: unknown, confirmAction: unknown, validatedResume?: { generateReportNow?: boolean } | null) {
  return action === "GENERATE_REPORT" || confirmAction === "GENERATE_REPORT" && validatedResume?.generateReportNow === true;
}
/** 仅本轮分类/已校验UI动作授权；旧选择和模型Tool参数没有授权能力。 */
export function hasReportAuthorization(ctx: ReportAuthorizationInput & { user: { id: string }; conversation: { id: string } }) {
  if (ctx.reportAuthorization?.userId === ctx.user.id && ctx.reportAuthorization.conversationId === ctx.conversation.id) return true;
  const decision = ctx.domainDecision;
  const semantic = decision?.semantic;
  const effect = semantic?.effectRequest;
  return decision?.intent === "REPORT_REQUEST" && decision.mutation === "REPORT"
    && decision.policyReason === "EXPLICIT_EFFECT_PROPOSAL" && !decision.unresolved?.length
    && semantic?.intent === "REPORT_REQUEST" && semantic.requestedEffect === "REPORT_GENERATION"
    && semantic.confidence >= .9 && !semantic.unresolved && !semantic.ambiguity.length
    && effect?.direct === true && effect.polarity === "AFFIRMATIVE" && effect.speechAct === "REQUEST"
    && effect.evidence === ctx.userMessage && effect.evidence.trim().length > 0;
}
export function currentAuthorizedReportType(ctx: Pick<ToolRuntimeContext, "domainDecision" | "reportAuthorization">) {
  return ctx.reportAuthorization?.reportType ?? ctx.domainDecision?.semantic?.reportType ?? undefined;
}
export function isSolutionReportRequest(ctx: Pick<ToolRuntimeContext, "domainDecision" | "reportAuthorization">, _reportType?: string) {
  const reportType = currentAuthorizedReportType(ctx);
  if (reportType === "material_compare" || reportType === "ai_conversation") return false;
  // 未指定类型的报告请求优先要求正式方案门槛；旧产品上下文不能代替方案快照。
  return true;
}
