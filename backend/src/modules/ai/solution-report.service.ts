import { generateTemplateReport } from "../reports/report-snapshot.service.js";
import { toolError, toolOk } from "./tools/tool-output.js";
import type { ToolRuntimeContext } from "./tools/tool-runtime.js";
import { hasReportAuthorization, currentAuthorizedReportType } from "./report-authorization.js";
import { AppError } from "../../shared/errors.js";

export async function generateConfirmedSolutionReport(ctx: Pick<ToolRuntimeContext,"app"|"request"|"user"|"conversation"|"onEvent"|"domainDecision"|"userMessage"|"reportAuthorization">, reportType?: string) {
  if (!hasReportAuthorization(ctx)) return toolError({ code: "REPORT_AUTHORIZATION_REQUIRED", message: "本轮没有明确的报告生成授权。" });
  if (["material_compare", "ai_conversation"].includes(currentAuthorizedReportType(ctx) ?? ""))
    return toolError({ code: "REPORT_TYPE_NOT_AUTHORIZED", message: "本轮授权的是普通报告，不能据此创建正式方案报告。" });
  try {
    const result = await generateTemplateReport(ctx.app, ctx.request, ctx.user, {
      reportType: (currentAuthorizedReportType(ctx) ?? reportType) === "project_brief" ? "project_brief" : "technical_scheme",
      projectId: ctx.conversation.projectId, conversationId: ctx.conversation.id, solutionAuthorization: ctx
    });
    const pending = result.report.status === "QUEUED" || result.report.status === "GENERATING";
    const data = { queued: pending, reportId: result.report.id, taskId: result.taskId,
      solutionSnapshotId: result.solutionSnapshotId, status: result.report.status, reused: result.reused };
    if (pending) ctx.onEvent?.("report_queued", data);
    return toolOk(data, { summary: result.reused ? `已找到该确认方案的报告，当前状态：${result.report.status}。可在报告列表查看。`
      : "已按确认的方案快照排队生成报告。" });
  } catch (error) {
    if (error instanceof AppError) return toolError({ code: error.code, message: error.message });
    throw error;
  }
}
