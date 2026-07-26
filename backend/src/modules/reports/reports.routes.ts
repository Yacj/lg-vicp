import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { aiConversations, aiMessages, asyncTasks, files, projects, reportArtifacts, reports, reportSources } from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const createReportBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确"),
  conversationId: z.uuid("AI 会话 ID 格式不正确").optional(),
  reportType: z.enum(["energy_design", "design_note", "marketing_copy"]),
  contentJson: z.record(z.string(), z.unknown()).default({}),
  sourceMessageIds: z.array(z.uuid("AI 回答 ID 格式不正确")).max(20, "一次最多选择 20 条 AI 回答").optional()
});
const reportParamsSchema = z.object({ id: z.uuid("报告 ID 格式不正确") });
const artifactParamsSchema = z.object({
  id: z.uuid("报告 ID 格式不正确"),
  type: z.enum(["HTML", "IMAGE", "WORD", "PDF"])
});

async function getReportWithProject(app: FastifyInstance, id: string) {
  const [row] = await app.db.select({ report: reports, project: projects })
    .from(reports).innerJoin(projects, eq(projects.id, reports.projectId))
    .where(and(eq(reports.id, id), isNull(reports.deletedAt), isNull(projects.deletedAt))).limit(1);
  return row;
}

function uniqueIds(ids: string[] | undefined) {
  return [...new Set(ids ?? [])];
}

export async function reportRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/reports", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "创建并排队生成报告", body: createReportBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const [project] = await app.db.select().from(projects).where(and(
      eq(projects.id, request.body.projectId), isNull(projects.deletedAt)
    )).limit(1);
    if (!project || !canManageProject(user, project)) throw new NotFoundError("项目不存在或无权生成报告");
    if (request.body.conversationId) {
      const [conversation] = await app.db.select().from(aiConversations)
        .where(eq(aiConversations.id, request.body.conversationId)).limit(1);
      if (!conversation || conversation.projectId !== project.id || (conversation.userId !== user.id && user.role !== "SUPER_ADMIN")) {
        throw new NotFoundError("AI 会话不存在或与当前项目不匹配");
      }
    }

    const sourceMessageIds = uniqueIds(request.body.sourceMessageIds);
    const sourceRows = sourceMessageIds.length > 0
      ? await app.db.select({ message: aiMessages, conversation: aiConversations })
        .from(aiMessages)
        .innerJoin(aiConversations, eq(aiConversations.id, aiMessages.conversationId))
        .where(inArray(aiMessages.id, sourceMessageIds))
      : [];
    if (sourceRows.length !== sourceMessageIds.length) {
      throw new NotFoundError("选择的 AI 回答不存在或无权使用");
    }
    for (const source of sourceRows) {
      if (
        source.message.role !== "ASSISTANT" ||
        source.message.status !== "COMPLETED" ||
        source.conversation.projectId !== project.id ||
        (source.conversation.userId !== user.id && user.role !== "SUPER_ADMIN") ||
        (request.body.conversationId && source.conversation.id !== request.body.conversationId)
      ) {
        throw new NotFoundError("选择的 AI 回答不存在或无权使用");
      }
    }
    const orderedSources = sourceMessageIds
      .map((id) => sourceRows.find((source) => source.message.id === id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    const contentJson = Object.keys(request.body.contentJson).length > 0 || orderedSources.length === 0
      ? request.body.contentJson
      : {
        selectedAnswers: orderedSources.map((source, index) => ({
          index: index + 1,
          messageId: source.message.id,
          content: source.message.content,
          model: source.message.model,
          createdAt: source.message.createdAt
        }))
      };

    const result = await app.db.transaction(async (tx) => {
      const [report] = await tx.insert(reports).values({
        projectId: project.id,
        conversationId: request.body.conversationId ?? orderedSources[0]?.conversation.id,
        reportType: request.body.reportType,
        contentJson,
        status: "QUEUED",
        createdById: user.id
      }).returning();
      if (orderedSources.length > 0) {
        await tx.insert(reportSources).values(orderedSources.map((source, index) => ({
          reportId: report!.id,
          messageId: source.message.id,
          sortOrder: index,
          snapshotContent: source.message.content,
          snapshotMetadata: {
            provider: source.message.provider,
            model: source.message.model,
            promptTemplateVersion: source.message.promptTemplateVersion,
            createdAt: source.message.createdAt
          }
        })));
      }
      const [task] = await tx.insert(asyncTasks).values({
        queueName: QUEUE_NAMES.REPORT_GENERATION,
        jobType: "generate_report",
        businessType: "report",
        businessId: report!.id,
        payload: { reportId: report!.id }
      }).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.REPORT_QUEUED, targetType: "report", targetId: report!.id,
        afterJson: {
          reportId: report!.id,
          taskId: task!.id,
          reportType: report!.reportType,
          sourceMessageIds
        }
      });
      return { report: report!, task: task! };
    });

    try {
      const job = await app.queues.reportGeneration.add(
        "generate_report",
        { taskId: result.task.id, reportId: result.report.id },
        { jobId: result.task.id }
      );
      await app.db.update(asyncTasks).set({ bullJobId: String(job.id), updatedAt: new Date() })
        .where(eq(asyncTasks.id, result.task.id));
    } catch (error) {
      await app.db.update(reports).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
        .where(eq(reports.id, result.report.id));
      await app.db.update(asyncTasks).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
        .where(eq(asyncTasks.id, result.task.id));
      throw error;
    }

    return ok(request, {
      message: "报告已进入生成队列",
      report: result.report,
      taskId: result.task.id
    });
  });

  route.get("/reports/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "获取报告详情", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canViewProject(user, row.project)) throw new NotFoundError("报告不存在或无权查看");
    const isManager = canManageProject(user, row.project);
    if (!isManager && !row.report.publishedAt) throw new NotFoundError("报告尚未发布");
    const artifacts = await app.db.select({ type: reportArtifacts.type }).from(reportArtifacts)
      .where(eq(reportArtifacts.reportId, row.report.id));
    const sources = await app.db.select().from(reportSources)
      .where(eq(reportSources.reportId, row.report.id))
      .orderBy(asc(reportSources.sortOrder));
    return ok(request, { report: row.report, sources, availableFormats: artifacts.map((item) => item.type) });
  });

  route.post("/reports/:id/generate", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "将报告草稿加入导出队列", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(user, row.project)) throw new NotFoundError("报告不存在或无权生成");
    if (row.report.status !== "DRAFT" && row.report.status !== "FAILED") {
      throw new ForbiddenError("只有草稿或生成失败的报告可以重新生成");
    }
    const task = await app.db.transaction(async (tx) => {
      const [created] = await tx.insert(asyncTasks).values({
        queueName: QUEUE_NAMES.REPORT_GENERATION,
        jobType: "generate_report",
        businessType: "report",
        businessId: row.report.id,
        payload: { reportId: row.report.id }
      }).returning();
      await tx.update(reports).set({ status: "QUEUED", errorMessage: null, updatedAt: new Date() })
        .where(eq(reports.id, row.report.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.project.id,
        action: AUDIT_ACTIONS.REPORT_QUEUED, targetType: "report", targetId: row.report.id,
        afterJson: { taskId: created!.id }
      });
      return created!;
    });
    try {
      const job = await app.queues.reportGeneration.add(
        "generate_report",
        { taskId: task.id, reportId: row.report.id },
        { jobId: task.id }
      );
      await app.db.update(asyncTasks).set({ bullJobId: String(job.id), updatedAt: new Date() }).where(eq(asyncTasks.id, task.id));
    } catch (error) {
      await app.db.update(reports).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
        .where(eq(reports.id, row.report.id));
      await app.db.update(asyncTasks).set({ status: "FAILED", errorMessage: "报告任务投递失败", updatedAt: new Date() })
        .where(eq(asyncTasks.id, task.id));
      throw error;
    }
    return ok(request, { message: "报告已进入生成队列", reportId: row.report.id, taskId: task.id });
  });

  route.post("/reports/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "发布报告", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(user, row.project)) throw new NotFoundError("报告不存在或无权发布");
    if (row.report.status !== "READY") throw new ForbiddenError("报告尚未生成完成，不能发布");
    const report = await app.db.transaction(async (tx) => {
      const [updated] = await tx.update(reports).set({ publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(reports.id, row.report.id)).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.project.id,
        action: AUDIT_ACTIONS.REPORT_PUBLISHED, targetType: "report", targetId: row.report.id,
        beforeJson: { publishedAt: row.report.publishedAt }, afterJson: { publishedAt: updated!.publishedAt }
      });
      return updated!;
    });
    return ok(request, { message: "报告发布成功", report });
  });

  route.get("/reports/:id/artifacts/:type/download-url", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "获取报告文件下载地址", params: artifactParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canViewProject(user, row.project)) throw new NotFoundError("报告不存在或无权下载");
    if (!canManageProject(user, row.project) && !row.report.publishedAt) throw new NotFoundError("报告尚未发布");
    const [artifact] = await app.db.select({ file: files }).from(reportArtifacts)
      .innerJoin(files, eq(files.id, reportArtifacts.fileId))
      .where(and(eq(reportArtifacts.reportId, row.report.id), eq(reportArtifacts.type, request.params.type))).limit(1);
    if (!artifact) throw new NotFoundError("请求的报告格式尚未生成");
    const url = await app.storage.createDownloadUrl(
      artifact.file.objectKey,
      artifact.file.originalName,
      env.STORAGE_PRESIGN_EXPIRES_SECONDS
    );
    await writeAuditLog({
      db: app.db, request, actor: user, projectId: row.project.id,
      action: AUDIT_ACTIONS.REPORT_DOWNLOADED, targetType: "report", targetId: row.report.id,
      afterJson: { type: request.params.type }
    });
    return ok(request, { url, expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS });
  });

  route.delete("/reports/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["报告"], summary: "删除报告", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(user, row.project)) throw new NotFoundError("报告不存在或无权删除");
    await app.db.transaction(async (tx) => {
      await tx.update(reports).set({ deletedAt: new Date(), publishedAt: null, updatedAt: new Date() })
        .where(eq(reports.id, row.report.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.project.id,
        action: AUDIT_ACTIONS.REPORT_DELETED, targetType: "report", targetId: row.report.id,
        beforeJson: row.report
      });
    });
    return ok(request, { message: "报告已删除" });
  });
}
