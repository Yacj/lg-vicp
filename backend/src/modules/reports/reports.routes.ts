import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { env } from "../../config/env.js";
import { aiConversations, aiMessages, asyncTasks, files, projects, reportArtifacts, reports, reportSources, reportSnapshots } from "../../db/schema.js";
import { QUEUE_NAMES } from "../../queues/queues.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject } from "../../shared/permissions.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { assertPublishable } from "./report-review.service.js";
import {
  canManageReport,
  canViewReport,
  resolveReportProjectId,
  toMyReportItem,
  assertReportProjectRequirement
} from "./report-access.js";
import { generateTemplateReport } from "./report-snapshot.service.js";
import { retryReport } from "./report-generation.service.js";
import {
  generatableReportTypeSchema,
  isTemplateBackedReportType,
  listPublicReportTypes,
  resolveReportType
} from "./report-types.js";
import { publicReportTypeDto } from "./report-settings.schemas.js";

const createReportBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确").nullable().optional(),
  conversationId: z.uuid("AI 会话 ID 格式不正确").nullable().optional(),
  solutionSnapshotId: z.uuid("方案快照 ID 格式不正确").optional(),
  reportType: generatableReportTypeSchema,
  contentJson: z.record(z.string(), z.unknown()).default({}),
  sourceMessageIds: z.array(z.uuid("AI 回答 ID 格式不正确")).max(20, "一次最多选择 20 条 AI 回答").optional()
});
const reportParamsSchema = z.object({ id: z.uuid("报告 ID 格式不正确") });
const myReportsQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确").optional()
});
const linkProjectBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确")
});
const artifactParamsSchema = z.object({
  id: z.uuid("报告 ID 格式不正确"),
  type: z.enum(["HTML", "IMAGE", "WORD", "PDF"])
});

async function getReportWithProject(app: FastifyInstance, id: string) {
  const [row] = await app.db.select({ report: reports, project: projects })
    .from(reports).leftJoin(projects, and(eq(projects.id, reports.projectId), isNull(projects.deletedAt)))
    .where(and(eq(reports.id, id), isNull(reports.deletedAt))).limit(1);
  return row?.report.projectId && !row.project ? undefined : row;
}

function uniqueIds(ids: string[] | undefined) {
  return [...new Set(ids ?? [])];
}

export async function reportRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.get("/reports/types", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 报告"],
      summary: "系统预置报告类型（不含内部模板版本与渲染细节）",
      response: { 200: z.object({
        success: z.boolean(),
        data: z.object({ items: z.array(publicReportTypeDto) }),
        requestId: z.string()
      }) }
    }
  }, async (request) => {
    return ok(request, { items: listPublicReportTypes() });
  });

  route.get("/reports/my", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 报告"],
      summary: "当前用户的报告列表（可按项目筛选，无项目时 project 为 null）",
      querystring: myReportsQuerySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(
      eq(reports.createdById, user.id),
      isNull(reports.deletedAt),
      request.query.projectId ? eq(reports.projectId, request.query.projectId) : undefined
    );
    const [rows, [totalRow]] = await Promise.all([
      app.db.select({ report: reports, project: projects })
        .from(reports)
        .leftJoin(projects, and(eq(projects.id, reports.projectId), isNull(projects.deletedAt)))
        .where(where)
        .orderBy(desc(reports.createdAt))
        .offset(skip)
        .limit(take),
      app.db.select({ value: count() }).from(reports).where(where)
    ]);
    return ok(request, {
      items: rows.map((row) => toMyReportItem(row.report, row.project ? { id: row.project.id, name: row.project.name } : null)),
      total: totalRow?.value ?? 0,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
  });

  route.post("/reports", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "创建并排队生成报告", body: createReportBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    let conversation: typeof aiConversations.$inferSelect | null = null;
    if (request.body.conversationId) {
      const [found] = await app.db.select().from(aiConversations)
        .where(eq(aiConversations.id, request.body.conversationId)).limit(1);
      if (!found || (found.userId !== user.id && user.role !== "SUPER_ADMIN")) {
        throw new NotFoundError("AI 会话不存在或无权使用");
      }
      conversation = found;
    }
    const projectId = conversation
      ? resolveReportProjectId(conversation.projectId)
      : request.body.projectId ?? null;
    const project = projectId
      ? (await app.db.select().from(projects).where(and(
        eq(projects.id, projectId), isNull(projects.deletedAt)
      )).limit(1))[0] ?? null
      : null;
    if (projectId && (!project || !canManageProject(user, project))) {
      throw new NotFoundError("项目不存在或无权生成报告");
    }
    const typeDef = resolveReportType(request.body.reportType);
    if ((typeDef.code === "technical_scheme" || typeDef.code === "project_brief")
      && conversation && request.body.projectId !== undefined && request.body.projectId !== conversation.projectId)
      throw new NotFoundError("方案会话与请求项目不一致");
    assertReportProjectRequirement({ requiresProject: typeDef.requiresProject, projectId });

    if (isTemplateBackedReportType(typeDef.code)) {
      const result = await generateTemplateReport(app, request, user, {
        reportType: typeDef.code,
        projectId,
        conversationId: request.body.conversationId ?? null,
        solutionSnapshotId: request.body.solutionSnapshotId,
        solutionAuthorization: conversation ? { reportAuthorization: { userId: user.id, conversationId: conversation.id } } : undefined
      });
      return ok(request, {
        message: "报告已进入生成队列",
        report: result.report,
        taskId: result.taskId,
        solutionSnapshotId: result.solutionSnapshotId,
        status: result.report.status,
        reused: result.reused
      });
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
        (source.conversation.userId !== user.id && user.role !== "SUPER_ADMIN") ||
        (request.body.conversationId && source.conversation.id !== request.body.conversationId) ||
        (projectId && source.conversation.projectId !== projectId)
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
        projectId,
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
        db: tx, request, actor: user, projectId: projectId ?? undefined,
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
    schema: { tags: ["共用 / 报告"], summary: "获取报告详情", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canViewReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权查看");
    const isManager = canManageReport(user, row.report, row.project);
    if (!isManager && !row.report.publishedAt) throw new NotFoundError("报告尚未发布");
    const artifacts = await app.db.select({ type: reportArtifacts.type }).from(reportArtifacts)
      .innerJoin(files, eq(files.id, reportArtifacts.fileId))
      .where(and(eq(reportArtifacts.reportId, row.report.id), eq(files.status, "READY"), isNull(files.deletedAt)));
    const sources = await app.db.select().from(reportSources)
      .where(eq(reportSources.reportId, row.report.id))
      .orderBy(asc(reportSources.sortOrder));
    const [snapshot] = await app.db.select().from(reportSnapshots).where(eq(reportSnapshots.reportId, row.report.id)).limit(1);
    const [task] = await app.db.select().from(asyncTasks).where(and(eq(asyncTasks.businessType, "report"),
      eq(asyncTasks.businessId, row.report.id))).orderBy(desc(asyncTasks.createdAt)).limit(1);
    return ok(request, {
      report: row.report,
      project: row.project ? { id: row.project.id, name: row.project.name } : null,
      sources,
      solutionSnapshotId: snapshot?.dataJson.solutionSnapshotId ?? null,
      task: task ? { id: task.id, status: task.status, progress: task.progress, errorMessage: task.errorMessage } : null,
      availableFormats: artifacts.map((item) => item.type)
    });
  });

  route.patch("/reports/:id/project", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["共用 / 报告"],
      summary: "将独立报告关联到项目（只改 projectId，不重新生成内容）",
      params: reportParamsSchema,
      body: linkProjectBodySchema
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageReport(user, row.report, row.project)) {
      throw new NotFoundError("报告不存在或无权关联项目");
    }
    const [project] = await app.db.select().from(projects).where(and(
      eq(projects.id, request.body.projectId), isNull(projects.deletedAt)
    )).limit(1);
    if (!project || !canManageProject(user, project)) {
      throw new NotFoundError("项目不存在或无权关联");
    }
    const updated = await app.db.transaction(async (tx) => {
      const [report] = await tx.update(reports)
        .set({ projectId: project.id, updatedAt: new Date() })
        .where(eq(reports.id, row.report.id))
        .returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.REPORT_PROJECT_LINKED, targetType: "report", targetId: row.report.id,
        beforeJson: { projectId: row.report.projectId },
        afterJson: { projectId: project.id }
      });
      return report!;
    });
    return ok(request, {
      message: "报告已关联项目",
      report: updated,
      project: { id: project.id, name: project.name }
    });
  });

  route.post("/reports/:id/generate", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "将报告草稿加入导出队列", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权生成");
    const result = await retryReport(app, request, user, row.report.id);
    return ok(request, { message: "报告已进入生成队列", reportId: result.reportId, taskId: result.taskId, status: result.status, reused: result.reused });
  });

  route.post("/reports/:id/retry", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "失败报告按原快照重新入队生成", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权重新生成");
    const result = await retryReport(app, request, user, row.report.id);
    return ok(request, { message: "报告已重新进入生成队列", reportId: result.reportId, taskId: result.taskId, status: result.status });
  });

  route.post("/reports/:id/publish", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "发布报告", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权发布");
    // 模板报告必须先审核通过（APPROVED）才能发布；AI 会话报告保持现状（READY 即可发布）
    assertPublishable(row.report);
    const report = await app.db.transaction(async (tx) => {
      const [updated] = await tx.update(reports).set({ publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(reports.id, row.report.id)).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.report.projectId ?? undefined,
        action: AUDIT_ACTIONS.REPORT_PUBLISHED, targetType: "report", targetId: row.report.id,
        beforeJson: { publishedAt: row.report.publishedAt }, afterJson: { publishedAt: updated!.publishedAt }
      });
      return updated!;
    });
    return ok(request, { message: "报告发布成功", report });
  });

  const artifactUrl = async (request: import("fastify").FastifyRequest<{ Params: z.infer<typeof artifactParamsSchema> }>, preview = false) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canViewReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权下载");
    if (!canManageReport(user, row.report, row.project) && !row.report.publishedAt) throw new NotFoundError("报告尚未发布");
    const [artifact] = await app.db.select({ file: files }).from(reportArtifacts)
      .innerJoin(files, eq(files.id, reportArtifacts.fileId))
      .where(and(eq(reportArtifacts.reportId, row.report.id), eq(reportArtifacts.type, request.params.type),
        eq(files.status, "READY"), isNull(files.deletedAt))).limit(1);
    if (!artifact) throw new NotFoundError("请求的报告格式尚未生成或已失效");
    const url = preview ? await app.storage.createPreviewUrl(artifact.file.objectKey, env.STORAGE_PRESIGN_EXPIRES_SECONDS)
      : await app.storage.createDownloadUrl(artifact.file.objectKey, artifact.file.originalName, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
    await writeAuditLog({ db: app.db, request, actor: user, projectId: row.report.projectId ?? undefined,
      action: AUDIT_ACTIONS.REPORT_DOWNLOADED, targetType: "report", targetId: row.report.id,
      afterJson: { type: request.params.type, mode: preview ? "PREVIEW" : "DOWNLOAD" } });
    return ok(request, { url, expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS });
  };
  route.get("/reports/:id/artifacts/:type/download-url", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "获取报告文件下载地址", params: artifactParamsSchema }
  }, request => artifactUrl(request));
  route.get("/reports/:id/artifacts/:type/preview-url", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "获取受控报告预览地址（PDF/图片）",
      params: artifactParamsSchema.extend({ type: z.enum(["PDF", "IMAGE"]) }) }
  }, request => artifactUrl(request, true));

  route.delete("/reports/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 报告"], summary: "删除报告", params: reportParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageReport(user, row.report, row.project)) throw new NotFoundError("报告不存在或无权删除");
    await app.db.transaction(async (tx) => {
      await tx.update(reports).set({ deletedAt: new Date(), publishedAt: null, updatedAt: new Date() })
        .where(eq(reports.id, row.report.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: row.report.projectId ?? undefined,
        action: AUDIT_ACTIONS.REPORT_DELETED, targetType: "report", targetId: row.report.id,
        beforeJson: row.report
      });
    });
    return ok(request, { message: "报告已删除" });
  });
}
