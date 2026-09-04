import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq, isNull } from "drizzle-orm";
import { projects, professionalReviews } from "../../db/schema.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canManageProject, canViewProject } from "../../shared/permissions.js";
import { ok } from "../../shared/response.js";
import { REVIEW_PERMISSIONS } from "../../shared/review-permissions.js";
import {
  approveReview,
  getReviewDetail,
  listReviewQueue,
  rejectReview
} from "./review-center.service.js";
import {
  entityTypeParamsSchema,
  reviewApproveBodySchema,
  reviewQueueQuerySchema,
  reviewRejectBodySchema,
  REVIEW_RESPONSES
} from "./review-center.schemas.js";

const REVIEW_CENTER_TAG = "B端 / 平台 / 审核中心";

/** 审核中心权限校验：SUPER_ADMIN 直通，否则校验具体权限码 */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有审核中心权限");
  }
  return user;
}

/** 报告审核记录必须遵守项目级可见性；审核决议额外要求创建者或超级管理员。 */
async function assertReportProjectAccess(
  app: FastifyInstance,
  entityType: string,
  entityId: string,
  request: Parameters<typeof getCurrentUser>[0],
  requireManage = false
) {
  if (entityType !== "report") return;
  const [record] = await app.db.select({ projectId: professionalReviews.projectId }).from(professionalReviews)
    .where(eq(professionalReviews.entityId, entityId)).limit(1);
  if (!record?.projectId) throw new NotFoundError("报告审核记录缺少项目上下文");
  const [project] = await app.db.select().from(projects).where(and(
    eq(projects.id, record.projectId),
    isNull(projects.deletedAt)
  )).limit(1);
  const user = getCurrentUser(request);
  if (!project || !canViewProject(user, project)) {
    throw new NotFoundError("项目不存在或无权查看该审核记录");
  }
  if (requireManage && !canManageProject(user, project)) {
    throw new NotFoundError("项目不存在或无权审核该项目报告");
  }
}

export async function reviewCenterRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  // ================================================================ 统一审核队列
  route.get("/queue", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REVIEW_CENTER_TAG], summary: "查询统一审核队列（产品/构造/热工/标准/比较/报告）",
      querystring: reviewQueueQuerySchema, response: { 200: REVIEW_RESPONSES.queue }
    }
  }, async (request) => {
    const actor = requirePermission(request, REVIEW_PERMISSIONS.LIST);
    return ok(request, await listReviewQueue(app, request.query, actor));
  });

  route.get("/queue/:entityType/:entityId", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REVIEW_CENTER_TAG], summary: "查询审核记录详情（含实体数据预览）",
      params: entityTypeParamsSchema, response: { 200: REVIEW_RESPONSES.detail }
    }
  }, async (request) => {
    requirePermission(request, REVIEW_PERMISSIONS.LIST);
    await assertReportProjectAccess(app, request.params.entityType, request.params.entityId, request);
    return ok(request, await getReviewDetail(app, request.params.entityType, request.params.entityId));
  });

  // ================================================================ 审核决议（委托各域审核服务）
  route.post("/queue/:entityType/:entityId/approve", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REVIEW_CENTER_TAG], summary: "审核通过（PENDING_REVIEW -> APPROVED）",
      params: entityTypeParamsSchema, body: reviewApproveBodySchema,
      response: { 200: REVIEW_RESPONSES.item }
    }
  }, async (request) => {
    const actor = requirePermission(request, REVIEW_PERMISSIONS.APPROVE);
    await assertReportProjectAccess(app, request.params.entityType, request.params.entityId, request, true);
    return ok(request, await approveReview(
      app, request, actor, request.params.entityType, request.params.entityId, request.body.approvalNote
    ));
  });

  route.post("/queue/:entityType/:entityId/reject", {
    preHandler: [app.authenticate],
    schema: {
      tags: [REVIEW_CENTER_TAG], summary: "驳回（PENDING_REVIEW -> REJECTED）",
      params: entityTypeParamsSchema, body: reviewRejectBodySchema,
      response: { 200: REVIEW_RESPONSES.item }
    }
  }, async (request) => {
    const actor = requirePermission(request, REVIEW_PERMISSIONS.APPROVE);
    await assertReportProjectAccess(app, request.params.entityType, request.params.entityId, request, true);
    return ok(request, await rejectReview(
      app, request, actor, request.params.entityType, request.params.entityId, request.body.rejectReason
    ));
  });
}