import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";
import { aiConversations, files, projects, reportArtifacts, reportSources, reports, shareLinks } from "../../db/schema.js";
import { assertPermission } from "../../shared/permission-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { NotFoundError } from "../../shared/errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { REPORT_PERMISSIONS } from "../../shared/report-permissions.js";
import { ok } from "../../shared/response.js";
import {
  generateTemplateReport,
  getReportSnapshot,
  listTemplateReports
} from "./report-snapshot.service.js";
import {
  approveTemplateReport,
  rejectTemplateReport,
  submitTemplateReportForReview
} from "./report-review.service.js";

const REPORT_CENTER_TAG = "B端 / 平台 / 报告中心";

/** 报告中心权限校验：SUPER_ADMIN 直通，否则校验具体权限码 */
async function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  return assertPermission(request, permissionCode);
}

const P = REPORT_PERMISSIONS;

// ---------------------------------------------------------------- Zod schema

const reportParamsSchema = z.object({ id: z.uuid("报告 ID 格式不正确") });

const generateReportBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确"),
  /** 已确认候选记录（thermal_candidate_selections） */
  selectionId: z.uuid("候选确认记录 ID 格式不正确"),
  /** 已发布且生效中的报告模板 */
  templateId: z.uuid("报告模板 ID 格式不正确"),
  /** 数据生效时点（默认当前时间） */
  asOfDate: z.coerce.date().optional()
});

const templateReportListQuerySchema = paginationQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确"),
  status: z.enum(["DRAFT", "QUEUED", "GENERATING", "READY", "FAILED", "PENDING_REVIEW", "APPROVED", "REJECTED"]).optional()
});
const reportCenterQuerySchema = z.object({ projectId: z.uuid("项目 ID 格式不正确") });

const submitReviewBodySchema = z.object({
  note: z.string().trim().max(2000).optional()
});

const approveReviewBodySchema = z.object({
  approvalNote: z.string().trim().max(2000).optional()
});

const rejectReviewBodySchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(2000)
});

const singleData = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

const reportItemSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  status: z.string(),
  reportType: z.string(),
  templateVersion: z.string().nullable(),
  publishedAt: z.date().nullable(),
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.date().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.date().nullable(),
  approvalNote: z.string().nullable(),
  rejectedById: z.string().uuid().nullable(),
  rejectedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdById: z.string().uuid(),
  createdAt: z.date(),
  updatedAt: z.date()
});

const snapshotResponseSchema = singleData(z.object({
  id: z.uuid(),
  reportId: z.uuid(),
  templateId: z.string().uuid().nullable(),
  templateVersion: z.number().nullable(),
  asOfDate: z.date().nullable(),
  dataJson: z.record(z.string(), z.unknown()),
  generatedById: z.string().uuid().nullable(),
  generatedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date()
}));

/** 报告 + 项目（未删除） */
async function getReportWithProject(app: FastifyInstance, id: string) {
  const [row] = await app.db.select({ report: reports, project: projects })
    .from(reports).innerJoin(projects, eq(projects.id, reports.projectId))
    .where(and(eq(reports.id, id), isNull(reports.deletedAt), isNull(projects.deletedAt))).limit(1);
  return row;
}

export async function reportPlatformRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // 平台报告聚合：管理员查看全部项目时，不能复用仅返回当前用户会话的客户端接口。
  route.get("/center", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "查询平台报告成果",
      querystring: reportCenterQuerySchema
    }
  }, async (request) => {
    await assertPermission(request, "system:project:list");
    const user = getCurrentUser(request);
    const [project] = await app.db.select().from(projects)
      .where(and(eq(projects.id, request.query.projectId), isNull(projects.deletedAt))).limit(1);
    if (!project || !canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");
    const rows = await app.db.select({
      report: reports,
      conversation: { id: aiConversations.id, title: aiConversations.title, userId: aiConversations.userId }
    }).from(reports)
      .leftJoin(aiConversations, eq(aiConversations.id, reports.conversationId))
      .where(and(eq(reports.projectId, project.id), isNull(reports.deletedAt)))
      .orderBy(reports.createdAt);
    const reportIds = rows.map(({ report }) => report.id);
    const artifactRows = reportIds.length === 0 ? [] : await app.db.select({ artifact: reportArtifacts, file: files })
      .from(reportArtifacts).innerJoin(files, eq(files.id, reportArtifacts.fileId))
      .where(inArray(reportArtifacts.reportId, reportIds));
    const sources = reportIds.length === 0 ? [] : await app.db.select().from(reportSources)
      .where(inArray(reportSources.reportId, reportIds));
    const artifactIds = artifactRows.map(({ artifact }) => artifact.id);
    const shareTargetIds = [...reportIds, ...artifactIds];
    const shares = shareTargetIds.length === 0 ? [] : await app.db.select().from(shareLinks)
      .where(and(
        inArray(shareLinks.targetId, shareTargetIds),
        inArray(shareLinks.targetType, ["REPORT", "REPORT_ARTIFACT"])
      ));
    return ok(request, {
      conversationCount: new Set(rows.map(({ conversation }) => conversation?.id).filter(Boolean)).size,
      items: rows.map(({ report, conversation }) => ({
        ...report,
        artifacts: artifactRows.filter(({ artifact }) => artifact.reportId === report.id).map(({ artifact, file }) => ({
          ...artifact,
          file: { id: file.id, originalName: file.originalName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, status: file.status }
        })),
        sources: sources.filter((source) => source.reportId === report.id),
        conversationTitle: conversation?.title ?? null,
        conversationUserId: conversation?.userId ?? null,
        projectName: project.name,
        shareLinks: shares.filter((share) => share.targetId === report.id || artifactIds.includes(share.targetId ?? "") && artifactRows.some(({ artifact }) => artifact.reportId === report.id && artifact.id === share.targetId))
      }))
    });
  });

  // ================================================================ 模板报告列表
  route.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "查询模板报告列表（按项目）",
      querystring: templateReportListQuerySchema,
      response: { 200: singleData(z.object({
        items: z.array(reportItemSchema),
        total: z.number(),
        page: z.number(),
        pageSize: z.number()
      })) }
    }
  }, async (request) => {
    await requirePermission(request, P.GENERATE);
    const [project] = await app.db.select().from(projects)
      .where(and(eq(projects.id, request.query.projectId), isNull(projects.deletedAt))).limit(1);
    if (!project) throw new NotFoundError("项目不存在");
    const user = getCurrentUser(request);
    if (!canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");
    return ok(request, await listTemplateReports(app, request.query));
  });

  // ================================================================ 生成模板报告（已确认候选 + 快照，不向 AI 索要数值）
  route.post("/generate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "基于已确认候选与已发布模板生成报告（冻结数据快照）",
      body: generateReportBodySchema,
      response: { 200: singleData(z.object({
        message: z.string(),
        report: reportItemSchema,
        taskId: z.string().uuid()
      })) }
    }
  }, async (request) => {
    const actor = await requirePermission(request, P.GENERATE);
    const [project] = await app.db.select().from(projects)
      .where(and(eq(projects.id, request.body.projectId), isNull(projects.deletedAt))).limit(1);
    if (!project || !canManageProject(actor, project)) throw new NotFoundError("项目不存在或无权生成报告");
    const result = await generateTemplateReport(app, request, actor, {
      projectId: request.body.projectId,
      selectionId: request.body.selectionId,
      templateId: request.body.templateId,
      asOfDate: request.body.asOfDate
    });
    return ok(request, {
      message: "模板报告已生成数据快照并进入生成队列",
      report: result.report,
      taskId: result.taskId
    });
  });

  // ================================================================ 报告数据快照（历史还原）
  route.get("/:id/snapshot", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "查询模板报告数据快照（历史参数完整还原）",
      params: reportParamsSchema, response: { 200: snapshotResponseSchema }
    }
  }, async (request) => {
    await requirePermission(request, P.GENERATE);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canViewProject(getCurrentUser(request), row.project)) throw new NotFoundError("报告不存在或无权查看");
    return ok(request, await getReportSnapshot(app, request.params.id));
  });

  // ================================================================ 模板报告审核：READY -> PENDING_REVIEW -> APPROVED / REJECTED
  route.post("/:id/submit-review", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "提交模板报告审核（READY -> 待审核）",
      params: reportParamsSchema, body: submitReviewBodySchema,
      response: { 200: singleData(reportItemSchema) }
    }
  }, async (request) => {
    const actor = await requirePermission(request, P.GENERATE);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(actor, row.project)) throw new NotFoundError("报告不存在或无权操作");
    return ok(request, await submitTemplateReportForReview(app, request, actor, request.params.id));
  });

  route.post("/:id/approve", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "审核通过模板报告（PENDING_REVIEW -> APPROVED）",
      params: reportParamsSchema, body: approveReviewBodySchema,
      response: { 200: singleData(reportItemSchema) }
    }
  }, async (request) => {
    const actor = await requirePermission(request, P.REVIEW);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(actor, row.project)) throw new NotFoundError("报告不存在或无权操作");
    return ok(request, await approveTemplateReport(app, request, actor, request.params.id, request.body.approvalNote));
  });

  route.post("/:id/reject", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REPORT_CENTER_TAG], summary: "驳回模板报告（PENDING_REVIEW -> REJECTED）",
      params: reportParamsSchema, body: rejectReviewBodySchema,
      response: { 200: singleData(reportItemSchema) }
    }
  }, async (request) => {
    const actor = await requirePermission(request, P.REVIEW);
    const row = await getReportWithProject(app, request.params.id);
    if (!row || !canManageProject(actor, row.project)) throw new NotFoundError("报告不存在或无权操作");
    return ok(request, await rejectTemplateReport(app, request, actor, request.params.id, request.body.rejectReason));
  });
}