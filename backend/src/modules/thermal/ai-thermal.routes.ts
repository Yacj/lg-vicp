import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { projects } from "../../db/schema.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { ok } from "../../shared/response.js";
import { executeThermalCalc } from "./thermal-calc.service.js";
import { thermalCalcRecordDto, thermalCalcRequestSchema } from "./thermal-calc.schemas.js";
import { createCandidateSelection, queryThermalCandidates } from "./thermal-candidate.service.js";
import {
  thermalCandidateQueryFields,
  thermalCandidateQueryResponseSchema,
  thermalCandidateSelectionCreateSchema,
  thermalCandidateSelectionDto,
  withCandidateQueryRefines
} from "./thermal-candidate.schemas.js";

const AI_THERMAL_TAG = "PC AI端 / 热工计算";

/**
 * PC AI 端热工计算路由：
 * - 计算入参必填 projectId，先校验项目可见性（本人/公开/超级管理员）再执行；
 * - 客户端守卫：仅 C_APP / PC_AI 客户端可调用（AI 端计算入口，不开放后台令牌）；
 * - 数值参数（λ/修正系数/限值）全部由服务层从已发布数据加载，调用方不可直接传入。
 */

const aiThermalCalcBodySchema = thermalCalcRequestSchema.extend({
  projectId: z.uuid("项目 ID 格式不正确")
});

/** AI 端候选查询：项目必填，先校验项目可见性再查表匹配（复用共享字段与约束，避免对带 refine 的 schema extend） */
const aiCandidateQueryBodySchema = withCandidateQueryRefines(
  z.object({ ...thermalCandidateQueryFields, projectId: z.uuid("项目 ID 格式不正确") })
);

/** AI 端候选确认：项目必填（归属校验），查询与候选全快照保存 */
const aiCandidateSelectionBodySchema = thermalCandidateSelectionCreateSchema.extend({
  projectId: z.uuid("项目 ID 格式不正确")
});

const aiThermalCalcExecutionSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() })),
  notes: z.array(z.string()),
  record: thermalCalcRecordDto.nullable()
});

/** AI 端统一入口守卫：仅 C_APP / PC_AI 客户端 + 项目可见性校验 */
async function assertProjectAccess(app: FastifyInstance, actor: AuthUser, projectId: string) {
  const [project] = await app.db.select({
    id: projects.id, createdById: projects.createdById, visibility: projects.visibility
  }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project || !canViewProject(actor, project)) {
    throw new NotFoundError("项目不存在或无权查看");
  }
}

export async function aiThermalRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/calc", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "执行确定性热工计算（三模式，结果与全过程快照落库）",
      body: aiThermalCalcBodySchema,
      response: { 200: z.object({ success: z.boolean(), data: aiThermalCalcExecutionSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    if (actor.clientType !== AUTH_CLIENTS.C_APP && actor.clientType !== AUTH_CLIENTS.PC_AI) {
      throw new ForbiddenError("热工计算仅对 C 端与 PC AI 端开放");
    }
    await assertProjectAccess(app, actor, request.body.projectId);
    return ok(request, await executeThermalCalc(app, request, actor, request.body));
  });

  route.post("/candidates", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "候选方案查询（条件匹配图集参考行，返回候选列表供用户选择）",
      body: aiCandidateQueryBodySchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCandidateQueryResponseSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    if (actor.clientType !== AUTH_CLIENTS.C_APP && actor.clientType !== AUTH_CLIENTS.PC_AI) {
      throw new ForbiddenError("候选方案查询仅对 C 端与 PC AI 端开放");
    }
    await assertProjectAccess(app, actor, request.body.projectId);
    return ok(request, await queryThermalCandidates(app, request, actor, request.body));
  });

  route.post("/candidate-selections", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "保存用户确认的最终候选与选择理由（查询与候选全快照）",
      body: aiCandidateSelectionBodySchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCandidateSelectionDto, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    if (actor.clientType !== AUTH_CLIENTS.C_APP && actor.clientType !== AUTH_CLIENTS.PC_AI) {
      throw new ForbiddenError("候选方案确认仅对 C 端与 PC AI 端开放");
    }
    await assertProjectAccess(app, actor, request.body.projectId);
    return ok(request, await createCandidateSelection(app, request, actor, request.body));
  });
}