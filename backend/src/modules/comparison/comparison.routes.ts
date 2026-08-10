import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { COMPARISON_PERMISSIONS } from "../../shared/comparison-permissions.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import {
  approveBodySchema,
  newVersionBodySchema,
  rejectBodySchema
} from "../construction/construction.schemas.js";
import {
  registerVersionedWorkflow,
  type WorkflowPerms
} from "../masterdata/workflow-routes.js";
import {
  batchCreateComparisonRules,
  collectComparisonViolations,
  copyComparisonChildren,
  createComparisonDimension,
  createComparisonEvidence,
  createComparisonMaterial,
  createComparisonRule,
  createComparisonVersion,
  deleteComparisonDimension,
  deleteComparisonEvidence,
  deleteComparisonMaterial,
  deleteComparisonRule,
  deleteComparisonVersion,
  getComparisonVersion,
  listComparisonDimensions,
  listComparisonEvidence,
  listComparisonMaterials,
  listComparisonRules,
  listComparisonVersions,
  updateComparisonDimension,
  updateComparisonEvidence,
  updateComparisonMaterial,
  updateComparisonRule,
  updateComparisonVersion,
  validateComparison
} from "./comparison.service.js";
import { listPublishedComparisonRules } from "./comparison-read.service.js";
import {
  comparisonDimensionCreateSchema,
  comparisonDimensionDto,
  comparisonDimensionUpdateSchema,
  comparisonEvidenceCreateSchema,
  comparisonEvidenceDto,
  comparisonEvidenceUpdateSchema,
  comparisonMaterialCreateSchema,
  comparisonMaterialDto,
  comparisonMaterialListQuerySchema,
  comparisonMaterialUpdateSchema,
  comparisonPublishedRuleDto,
  comparisonPublishedRuleQuerySchema,
  comparisonRuleBatchCreateSchema,
  comparisonRuleBatchResultDto,
  comparisonRuleCreateSchema,
  comparisonRuleDto,
  comparisonRuleListQuerySchema,
  comparisonRuleUpdateSchema,
  comparisonVersionCreateSchema,
  comparisonVersionDto,
  comparisonVersionListQuerySchema,
  comparisonVersionUpdateSchema,
  uuidParams,
  versionIdParams
} from "./comparison.schemas.js";

const COMPARISON_TAG = "B端 / 平台 / 材料对比";

/** 材料对比模块权限校验：SUPER_ADMIN 直通，否则校验具体权限码（本地函数模式，与 construction/thermal 一致） */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有材料对比规则管理权限");
  }
  return user;
}

const P = COMPARISON_PERMISSIONS;
const VERSION_PERMS: WorkflowPerms = {
  list: P.LIST, create: P.CREATE, update: P.UPDATE,
  remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
};

/** 显式结构校验响应：valid + 违规明细（不抛错，前端可逐条展示） */
const validateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    violations: z.array(z.object({ field: z.string(), message: z.string() }))
  }),
  requestId: z.string()
});

const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({ items: z.array(itemDto), total: z.number(), page: z.number(), pageSize: z.number() }),
  requestId: z.string()
});
const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

export async function comparisonRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /** 工作流工厂公共上下文（材料对比统一标签/权限/Schema） */
  const workflowCtx = {
    tag: COMPARISON_TAG,
    require: requirePermission,
    uuidParams,
    approveBody: approveBodySchema,
    rejectBody: rejectBodySchema,
    newVersionBody: newVersionBodySchema
  } as const;

  // ================================================================ 版本（版本化 + 结构校验）
  route.get("/versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询材料对比版本列表",
      querystring: comparisonVersionListQuerySchema,
      response: { 200: paginated(comparisonVersionDto) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, await listComparisonVersions(app, request.query));
  });

  route.post("/versions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "新增材料对比版本",
      body: comparisonVersionCreateSchema,
      response: { 200: single(comparisonVersionDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.create);
    return ok(request, await createComparisonVersion(app, request, actor, request.body));
  });

  route.get("/versions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询材料对比版本详情",
      params: uuidParams,
      response: { 200: single(comparisonVersionDto) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, await getComparisonVersion(app, request.params.id));
  });

  route.patch("/versions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "修改材料对比版本",
      params: uuidParams, body: comparisonVersionUpdateSchema,
      response: { 200: single(comparisonVersionDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await updateComparisonVersion(app, request, actor, request.params.id, request.body));
  });

  route.delete("/versions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "删除材料对比版本草稿",
      params: uuidParams,
      response: { 200: single(z.object({ message: z.string() })) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.remove);
    return ok(request, await deleteComparisonVersion(app, request, actor, request.params.id));
  });

  // 显式结构校验：返回违规明细不抛错（submit/publish 时工厂会在状态机前强制执行同样校验）
  route.post("/versions/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "校验材料对比版本结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    const violations = await collectComparisonViolations(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "/versions", label: "材料对比版本", entity: "comparisonVersion",
    perms: VERSION_PERMS, dto: comparisonVersionDto,
    copyChildren: copyComparisonChildren,
    validate: (instance, id) => validateComparison(instance, id)
  });

  // ================================================================ 材料（子表，随版本状态守卫）
  route.get("/versions/:versionId/materials", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询版本内材料列表",
      params: versionIdParams, querystring: comparisonMaterialListQuerySchema,
      response: { 200: paginated(comparisonMaterialDto) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, await listComparisonMaterials(app, request.params.versionId, request.query));
  });

  route.post("/versions/:versionId/materials", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "新增材料（型号/密度/测试条件，防止混比）",
      params: versionIdParams, body: comparisonMaterialCreateSchema,
      response: { 200: single(comparisonMaterialDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await createComparisonMaterial(app, request, actor, request.params.versionId, request.body));
  });

  route.patch("/materials/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "修改材料",
      params: uuidParams, body: comparisonMaterialUpdateSchema,
      response: { 200: single(comparisonMaterialDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await updateComparisonMaterial(app, request, actor, request.params.id, request.body));
  });

  route.delete("/materials/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "删除材料（被规则引用时禁止）",
      params: uuidParams,
      response: { 200: single(z.object({ message: z.string() })) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await deleteComparisonMaterial(app, request, actor, request.params.id));
  });

  // ================================================================ 维度（五维固定 + 子指标）
  route.get("/dimensions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询材料对比维度（五维 + 子指标）",
      response: { 200: single(z.object({ items: z.array(comparisonDimensionDto) })) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, { items: await listComparisonDimensions(app) });
  });

  route.post("/dimensions", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "新增子指标维度（五维固定不可增）",
      body: comparisonDimensionCreateSchema,
      response: { 200: single(comparisonDimensionDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await createComparisonDimension(app, request, actor, request.body));
  });

  route.patch("/dimensions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "修改维度（五维禁止禁用）",
      params: uuidParams, body: comparisonDimensionUpdateSchema,
      response: { 200: single(comparisonDimensionDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await updateComparisonDimension(app, request, actor, request.params.id, request.body));
  });

  route.delete("/dimensions/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "删除子指标维度（五维禁止删除）",
      params: uuidParams,
      response: { 200: single(z.object({ message: z.string() })) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await deleteComparisonDimension(app, request, actor, request.params.id));
  });

  // ================================================================ 规则（子表）
  route.get("/versions/:versionId/rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询版本内对比规则列表",
      params: versionIdParams, querystring: comparisonRuleListQuerySchema,
      response: { 200: paginated(comparisonRuleDto) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, await listComparisonRules(app, request.params.versionId, request.query));
  });

  route.post("/versions/:versionId/rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "新增对比规则（双方数值/基准/文案/适用条件/必要披露）",
      params: versionIdParams, body: comparisonRuleCreateSchema,
      response: { 200: single(comparisonRuleDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await createComparisonRule(app, request, actor, request.params.versionId, request.body));
  });

  route.post("/versions/:versionId/rules/batch", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "批量导入材料与对比规则（单事务，任一校验失败整体回滚）",
      params: versionIdParams, body: comparisonRuleBatchCreateSchema,
      response: { 200: single(comparisonRuleBatchResultDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await batchCreateComparisonRules(app, request, actor, request.params.versionId, request.body));
  });

  route.patch("/rules/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "修改对比规则",
      params: uuidParams, body: comparisonRuleUpdateSchema,
      response: { 200: single(comparisonRuleDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await updateComparisonRule(app, request, actor, request.params.id, request.body));
  });

  route.delete("/rules/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "删除对比规则",
      params: uuidParams,
      response: { 200: single(z.object({ message: z.string() })) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await deleteComparisonRule(app, request, actor, request.params.id));
  });

  // ================================================================ 证据（子表）
  route.get("/versions/:versionId/evidence", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询版本内证据列表",
      params: versionIdParams,
      response: { 200: single(z.object({ items: z.array(comparisonEvidenceDto) })) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, { items: await listComparisonEvidence(app, request.params.versionId) });
  });

  route.post("/rules/:id/evidence", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "新增规则证据（来源/页码/条款/证据等级）",
      params: uuidParams, body: comparisonEvidenceCreateSchema,
      response: { 200: single(comparisonEvidenceDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await createComparisonEvidence(app, request, actor, request.params.id, request.body));
  });

  route.patch("/evidence/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "修改证据",
      params: uuidParams, body: comparisonEvidenceUpdateSchema,
      response: { 200: single(comparisonEvidenceDto) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await updateComparisonEvidence(app, request, actor, request.params.id, request.body));
  });

  route.delete("/evidence/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "删除证据",
      params: uuidParams,
      response: { 200: single(z.object({ message: z.string() })) }
    }
  }, async (request) => {
    const actor = requirePermission(request, VERSION_PERMS.update);
    return ok(request, await deleteComparisonEvidence(app, request, actor, request.params.id));
  });

  // ================================================================ 已发布读取（只 PUBLISHED + 生效）
  route.get("/published/rules", {
    preHandler: [app.authenticate],
    schema: {
      tags: [COMPARISON_TAG], summary: "查询已发布且生效中的对比规则（供前端与 AI 复用）",
      querystring: comparisonPublishedRuleQuerySchema,
      response: { 200: single(z.object({ items: z.array(comparisonPublishedRuleDto) })) }
    }
  }, async (request) => {
    requirePermission(request, VERSION_PERMS.list);
    return ok(request, { items: await listPublishedComparisonRules(app, request.query) });
  });
}