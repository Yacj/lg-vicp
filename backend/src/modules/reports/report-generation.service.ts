/**
 * 统一报告生成入口：AI 对话 / B 端手动 / C 端按钮 / 产品对比都走同一套
 * createReport → Snapshot → queueReportGeneration。
 * 禁止 Agent 自行 insert DRAFT 后立刻 report_completed。
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { asyncTasks, reports, projects } from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { canManageReport } from "./report-access.js";
import { generateTemplateReport } from "./report-snapshot.service.js";
import { isTemplateBackedReportType, resolveReportType } from "./report-types.js";
import { assertReportProjectRequirement } from "./report-access.js";

export type CreateReportInput = {
  reportType: string;
  projectId?: string | null;
  conversationId?: string | null;
  contentJson?: Record<string, unknown>;
  selectionId?: string;
  templateId?: string;
  contextOverlay?: Record<string, unknown>;
};

export type QueuedReportResult = {
  reportId: string;
  taskId: string;
  status: typeof reports.$inferSelect.status;
  reportType: string;
  snapshotId?: string | null;
  reused?: boolean;
};

export async function queueReportGeneration(
  app: FastifyInstance,
  input: { taskId: string; reportId: string }
) {
  try {
    const job = await app.queues.reportGeneration.add(
      "generate_report",
      { taskId: input.taskId, reportId: input.reportId },
      { jobId: input.taskId }
    );
    await app.db.update(asyncTasks).set({ bullJobId: String(job.id), updatedAt: new Date() })
      .where(eq(asyncTasks.id, input.taskId)).catch(() => app.log?.warn({ taskId: input.taskId, errorCode: "REPORT_QUEUE_TRACKING_FAILED" }, "报告已入队，队列标识回写失败"));
  } catch (error) {
    await app.db.update(reports).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
      .where(and(eq(reports.id, input.reportId), eq(reports.status, "QUEUED")));
    await app.db.update(asyncTasks).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
      .where(and(eq(asyncTasks.id, input.taskId), eq(asyncTasks.status, "QUEUED")));
    throw error;
  }
}

export async function createReport(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: CreateReportInput
): Promise<QueuedReportResult> {
  const typeDef = resolveReportType(input.reportType);
  const projectId = input.projectId ?? null;
  assertReportProjectRequirement({ requiresProject: typeDef.requiresProject, projectId });

  if (isTemplateBackedReportType(typeDef.code)) {
    const result = await generateTemplateReport(app, request, actor, {
      reportType: typeDef.code,
      projectId,
      conversationId: input.conversationId ?? null,
      selectionId: input.selectionId,
      templateId: input.templateId,
      contextOverlay: input.contextOverlay
    });
    return {
      reportId: result.report.id,
      taskId: result.taskId,
      status: "QUEUED",
      reportType: typeDef.code
    };
  }

  const queued = await app.db.transaction(async (tx) => {
    const [report] = await tx.insert(reports).values({
      projectId,
      conversationId: input.conversationId ?? null,
      reportType: typeDef.code,
      contentJson: input.contentJson ?? {},
      status: "QUEUED",
      createdById: actor.id
    }).returning();
    const [task] = await tx.insert(asyncTasks).values({
      queueName: QUEUE_NAMES.REPORT_GENERATION,
      jobType: "generate_report",
      businessType: "report",
      businessId: report!.id,
      payload: { reportId: report!.id }
    }).returning();
    await writeAuditLog({
      db: tx, request, actor, projectId: projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_QUEUED, targetType: "report", targetId: report!.id,
      afterJson: { reportId: report!.id, taskId: task!.id, reportType: typeDef.code, source: "create_report" }
    });
    return { report: report!, task: task! };
  });
  await queueReportGeneration(app, { taskId: queued.task.id, reportId: queued.report.id });
  return {
    reportId: queued.report.id,
    taskId: queued.task.id,
    status: "QUEUED",
    reportType: typeDef.code
  };
}

export async function retryReport(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  reportId: string
): Promise<QueuedReportResult> {
  const result = await app.db.transaction(async (tx) => {
    const [report] = await tx.select().from(reports).where(eq(reports.id, reportId)).for("update");
    if (!report || report.deletedAt) throw new NotFoundError("报告不存在或无权重新生成");
    const [project] = report.projectId ? await tx.select().from(projects).where(and(eq(projects.id, report.projectId), isNull(projects.deletedAt))).limit(1) : [];
    if (report.projectId && !project || !canManageReport(actor, report, project ?? null)) throw new NotFoundError("报告不存在或无权重新生成");
    if (report.status === "QUEUED" || report.status === "GENERATING") {
      const [task] = await tx.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"), eq(asyncTasks.businessId, report.id)))
        .orderBy(desc(asyncTasks.createdAt)).limit(1);
      if (!task) throw new NotFoundError("报告任务不存在");
      return { report, task, reused: true };
    }
    if (report.status !== "FAILED" && report.status !== "DRAFT") throw new ForbiddenError("只有草稿或生成失败的报告可以重新生成");
    const [created] = await tx.insert(asyncTasks).values({
      queueName: QUEUE_NAMES.REPORT_GENERATION,
      jobType: "generate_report",
      businessType: "report",
      businessId: report.id,
      payload: { reportId: report.id, retryOfStatus: report.status }
    }).returning();
    await tx.update(reports).set({ status: "QUEUED", errorMessage: null, updatedAt: new Date() })
      .where(eq(reports.id, report.id));
    await writeAuditLog({
      db: tx, request, actor, projectId: report.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_QUEUED, targetType: "report", targetId: report.id,
      afterJson: { taskId: created!.id, retry: true }
    });
    return { report, task: created!, reused: false };
  });
  if (!result.reused || result.report.status === "QUEUED" && !result.task.bullJobId)
    await queueReportGeneration(app, { taskId: result.task.id, reportId: result.report.id });
  return {
    reportId: result.report.id,
    taskId: result.task.id,
    status: result.reused ? result.report.status : "QUEUED",
    reportType: result.report.reportType,
    reused: result.reused
  };
}
