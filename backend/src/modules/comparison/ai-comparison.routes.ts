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
import { listPublishedComparisonRules } from "./comparison-read.service.js";
import { comparisonPublishedRuleDto, comparisonPublishedRuleQuerySchema } from "./comparison.schemas.js";

const AI_COMPARISON_TAG = "PC AI端 / 材料对比";

/**
 * PC AI 端材料对比规则查询：
 * - projectId 必填，先校验项目可见性（本人/公开/超级管理员）再执行；
 * - 客户端守卫：仅 C_APP / PC_AI 客户端可调用（AI 端查询入口，不开放后台令牌）；
 * - 只返回已发布且生效中的规则（状态门禁在 read service 内强制），调用方不可传 status 绕过；
 * - 数值与文案全部由服务从已发布数据加载，调用方只能传筛选条件。
 */

const aiComparisonQueryBodySchema = comparisonPublishedRuleQuerySchema.extend({
  projectId: z.uuid("项目 ID 格式不正确")
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

export async function aiComparisonRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [AI_COMPARISON_TAG], summary: "查询已审核材料对比规则（仅已发布且生效中，供 AI 工具/前端调用）",
      body: aiComparisonQueryBodySchema,
      response: {
        200: z.object({
          success: z.boolean(),
          data: z.object({ items: z.array(comparisonPublishedRuleDto), total: z.number() }),
          requestId: z.string()
        })
      }
    }
  }, async (request) => {
    const actor = getCurrentUser(request);
    if (actor.clientType !== AUTH_CLIENTS.C_APP && actor.clientType !== AUTH_CLIENTS.PC_AI) {
      throw new ForbiddenError("材料对比规则查询仅对 C 端与 PC AI 端开放");
    }
    await assertProjectAccess(app, actor, request.body.projectId);
    const { projectId: _projectId, ...query } = request.body;
    const items = await listPublishedComparisonRules(app, query);
    return ok(request, { items, total: items.length });
  });
}