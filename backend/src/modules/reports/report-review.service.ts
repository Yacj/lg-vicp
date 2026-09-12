import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { reports } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { NotFoundError } from "../../shared/errors.js";
import { ReportError } from "../../shared/report-errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { upsertProfessionalReview } from "../review-center/professional-review.js";

/**
 * 模板报告审核：READY -> PENDING_REVIEW -> APPROVED（可发布）/ REJECTED（可重新提交）。
 * 仅 reportType=TEMPLATE 的报告强制审核（AI 会话报告发布保持现状）。
 * 状态变更、统一审核记录、审计日志在同一事务内完成。
 */

async function requireReport(app: FastifyInstance, id: string) {
  const [report] = await app.db.select().from(reports)
    .where(and(eq(reports.id, id), isNull(reports.deletedAt))).limit(1);
  if (!report) throw new NotFoundError("报告不存在");
  if (report.reportType !== "TEMPLATE") {
    throw new ReportError("REPORT_NOT_REVIEWABLE", "只有模板报告需要审核");
  }
  return report;
}

/** 发布门控（共用发布端点调用）：模板报告必须先审核通过（APPROVED），AI 会话报告 READY 即可发布 */
export function assertPublishable(report: { reportType: string; status: string }) {
  if (report.reportType === "TEMPLATE") {
    if (report.status !== "APPROVED") {
      throw new ReportError("REPORT_NOT_REVIEWABLE", "模板报告需经审核通过后才能发布");
    }
  } else if (report.status !== "READY") {
    throw new ReportError("REPORT_NOT_REVIEWABLE", "报告尚未生成完成，不能发布");
  }
}

/** 提交审核：READY -> PENDING_REVIEW */
export async function submitTemplateReportForReview(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string
) {
  const report = await requireReport(app, id);
  if (report.status !== "READY") {
    throw new ReportError("REPORT_REVIEW_STATUS_CONFLICT", "只有已生成完成的模板报告可以提交审核");
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(reports).set({
      status: "PENDING_REVIEW",
      submittedById: actor.id,
      submittedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(reports.id, id)).returning();
    await upsertProfessionalReview({
      db: tx,
      entityType: "report",
      entityId: id,
      status: "PENDING_REVIEW",
      actorUserId: actor.id,
      projectId: report.projectId ?? undefined,
      requestId: request.id
    });
    await writeAuditLog({
      db: tx, request, actor, projectId: report.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_SUBMITTED, targetType: "report", targetId: id,
      beforeJson: { status: report.status }, afterJson: { status: updated!.status }
    });
    return updated!;
  });
}

/** 审核通过：PENDING_REVIEW -> APPROVED，记录审核意见 */
export async function approveTemplateReport(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string
) {
  const report = await requireReport(app, id);
  if (report.status !== "PENDING_REVIEW") {
    throw new ReportError("REPORT_REVIEW_STATUS_CONFLICT", "只有待审核的模板报告可以审核通过");
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(reports).set({
      status: "APPROVED",
      approvedById: actor.id,
      approvedAt: new Date(),
      approvalNote: approvalNote ?? null,
      updatedAt: new Date()
    }).where(eq(reports.id, id)).returning();
    await upsertProfessionalReview({
      db: tx,
      entityType: "report",
      entityId: id,
      status: "APPROVED",
      comment: approvalNote ?? null,
      actorUserId: actor.id,
      projectId: report.projectId ?? undefined,
      requestId: request.id
    });
    await writeAuditLog({
      db: tx, request, actor, projectId: report.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_APPROVED, targetType: "report", targetId: id,
      beforeJson: { status: report.status }, afterJson: { status: updated!.status, approvalNote: approvalNote ?? null }
    });
    return updated!;
  });
}

/** 驳回：PENDING_REVIEW -> REJECTED，必须填写驳回原因（可修改后重新提交审核） */
export async function rejectTemplateReport(
  app: FastifyInstance, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string
) {
  const report = await requireReport(app, id);
  if (report.status !== "PENDING_REVIEW") {
    throw new ReportError("REPORT_REVIEW_STATUS_CONFLICT", "只有待审核的模板报告可以驳回");
  }
  return app.db.transaction(async (tx) => {
    const [updated] = await tx.update(reports).set({
      status: "REJECTED",
      rejectedById: actor.id,
      rejectedAt: new Date(),
      rejectReason,
      updatedAt: new Date()
    }).where(eq(reports.id, id)).returning();
    await upsertProfessionalReview({
      db: tx,
      entityType: "report",
      entityId: id,
      status: "REJECTED",
      comment: rejectReason,
      actorUserId: actor.id,
      projectId: report.projectId ?? undefined,
      requestId: request.id
    });
    await writeAuditLog({
      db: tx, request, actor, projectId: report.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_REJECTED, targetType: "report", targetId: id,
      beforeJson: { status: report.status }, afterJson: { status: updated!.status, rejectReason }
    });
    return updated!;
  });
}