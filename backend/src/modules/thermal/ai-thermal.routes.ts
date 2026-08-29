import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { aiConversations, projects, thermalCalcRecords } from "../../db/schema.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { ok } from "../../shared/response.js";
import { executeThermalCalc, toRecordDto } from "./thermal-calc.service.js";
import { thermalCalcRecordDto, thermalCalcRequestSchema } from "./thermal-calc.schemas.js";
import { buildThermalCalcPresentation } from "./thermal-calc-presentation.js";
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
 * - 数值参数（λ/修正系数/限值）全部由服务层从已发布数据加载，调用方不可直接传入；
 * - 计算过程以人读 presentation 返回（从冻结快照派生，不含内部 ID），支持查看历史计算记录。
 */

const aiThermalCalcBodySchema = thermalCalcRequestSchema.extend({
  projectId: z.uuid("项目 ID 格式不正确")
});

/** AI 端候选查询：项目必填，可传 conversationId 自动携带会话保温体系（请求未指定 systemId 时） */
const aiCandidateQueryBodySchema = withCandidateQueryRefines(
  z.object({
    ...thermalCandidateQueryFields,
    projectId: z.uuid("项目 ID 格式不正确"),
    conversationId: z.uuid("会话 ID 格式不正确").optional()
  })
);

/** AI 端候选确认：项目必填（归属校验），查询与候选全快照保存 */
const aiCandidateSelectionBodySchema = thermalCandidateSelectionCreateSchema.extend({
  projectId: z.uuid("项目 ID 格式不正确")
});

const presentationStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  formula: z.string().nullable().optional(),
  value: z.union([z.number(), z.string()]).nullable().optional(),
  unit: z.string().nullable().optional()
});

const presentationSchema = z.object({
  mode: z.enum(["REFERENCE_TABLE", "EQUIVALENT", "LAYERED"]),
  resultK: z.number().nullable(),
  compliant: z.boolean().nullable(),
  totalResistance: z.number().nullable().optional(),
  limitKValue: z.number().nullable().optional(),
  steps: z.array(presentationStepSchema),
  layers: z.array(z.object({
    order: z.number(),
    materialName: z.string(),
    thicknessMm: z.number(),
    lambda: z.number().nullable().optional(),
    correctionFactor: z.number().nullable().optional()
  })),
  evidence: z.object({
    title: z.string().optional(),
    ref: z.string().optional(),
    level: z.string().nullable().optional()
  }).nullable().optional()
});

const aiThermalCalcExecutionSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ field: z.string(), code: z.string(), message: z.string() })),
  notes: z.array(z.string()),
  record: thermalCalcRecordDto.nullable(),
  /** 人读计算步骤（从冻结快照派生；C 端直接展示，不暴露内部 ID/调试 JSON） */
  presentation: presentationSchema.nullable()
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

/** 会话保温体系解析：会话存在且归属当前用户时返回其体系（历史会话可为空） */
async function resolveConversationSystemId(app: FastifyInstance, actor: AuthUser, conversationId: string): Promise<string | null> {
  const [conversation] = await app.db.select({
    userId: aiConversations.userId,
    insulationSystemId: aiConversations.insulationSystemId,
    status: aiConversations.status
  }).from(aiConversations).where(eq(aiConversations.id, conversationId)).limit(1);
  if (!conversation || conversation.status !== "active") throw new NotFoundError("AI 会话不存在");
  if (actor.role !== "SUPER_ADMIN" && conversation.userId !== actor.id) throw new NotFoundError("AI 会话不存在");
  return conversation.insulationSystemId ?? null;
}

async function assertThermalClient(actor: AuthUser, action: string) {
  if (actor.clientType !== AUTH_CLIENTS.C_APP && actor.clientType !== AUTH_CLIENTS.PC_AI) {
    throw new ForbiddenError(`${action}仅对 C 端与 PC AI 端开放`);
  }
}

export async function aiThermalRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/calc", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "执行确定性热工计算（三模式，快照落库，返回人读计算步骤）",
      body: aiThermalCalcBodySchema,
      response: { 200: z.object({ success: z.boolean(), data: aiThermalCalcExecutionSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    await assertThermalClient(actor, "热工计算");
    await assertProjectAccess(app, actor, request.body.projectId);
    const execution = await executeThermalCalc(app, request, actor, request.body);
    return ok(request, {
      ...execution,
      presentation: execution.record ? buildThermalCalcPresentation(execution.record) : null
    });
  });

  // 历史计算记录详情（含人读步骤；快照冻结，不随后台参数漂移）
  route.get("/calc-records/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "查看历史热工计算记录（完整快照 + 人读计算步骤）",
      params: z.object({ id: z.uuid("计算记录 ID 格式不正确") }),
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ record: thermalCalcRecordDto, presentation: presentationSchema }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    await assertThermalClient(actor, "热工计算记录查询");
    const [record] = await app.db.select().from(thermalCalcRecords)
      .where(and(eq(thermalCalcRecords.id, request.params.id))).limit(1);
    if (!record) throw new NotFoundError("计算记录不存在");
    // 项目内计算记录按项目可见性校验；平台级记录（无项目）对 C 端/PC AI 端开放只读
    if (record.projectId) await assertProjectAccess(app, actor, record.projectId);
    const dto = toRecordDto(record)!;
    return ok(request, { record: dto, presentation: buildThermalCalcPresentation(dto) });
  });

  route.post("/candidates", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_THERMAL_TAG], summary: "候选方案查询（K≤目标且最接近目标优先排序，返回多个候选供用户选择）",
      body: aiCandidateQueryBodySchema,
      response: { 200: z.object({ success: z.boolean(), data: thermalCandidateQueryResponseSchema, requestId: z.string() }) }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    await assertThermalClient(actor, "候选方案查询");
    await assertProjectAccess(app, actor, request.body.projectId);
    // 会话体系自动注入：请求未指定 systemId 时，使用会话级保温体系上下文
    const systemIdFromConversation = request.body.conversationId
      ? await resolveConversationSystemId(app, actor, request.body.conversationId)
      : null;
    const result = await queryThermalCandidates(app, request, actor, {
      ...request.body,
      systemId: request.body.systemId ?? systemIdFromConversation ?? undefined
    });
    return ok(request, result);
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
    await assertThermalClient(actor, "候选方案确认");
    await assertProjectAccess(app, actor, request.body.projectId);
    return ok(request, await createCandidateSelection(app, request, actor, request.body));
  });
}
