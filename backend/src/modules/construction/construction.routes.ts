import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { CONSTRUCTION_PERMISSIONS } from "../../shared/construction-permissions.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import {
  createConstructionLayer,
  createConstructionScheme,
  createInsulationSystem,
  createSchemeDocument,
  createSchemeProductOption,
  deleteConstructionLayer,
  deleteConstructionScheme,
  deleteInsulationSystem,
  deleteSchemeDocument,
  deleteSchemeProductOption,
  getConstructionScheme,
  getInsulationSystem,
  listConstructionLayers,
  listConstructionSchemes,
  listInsulationSystems,
  listSchemeDocuments,
  listSchemeProductOptions,
  updateConstructionLayer,
  updateConstructionScheme,
  updateInsulationSystem,
  updateSchemeDocument,
  updateSchemeProductOption
} from "./construction.service.js";
import {
  listPublishedConstructionSchemes,
  listPublishedInsulationSystems,
  getPublishedConstructionSchemeDetail
} from "./construction-read.service.js";
import {
  collectSchemeStructureViolations,
  validateSchemeStructure
} from "./construction-structure.service.js";
import {
  approveBodySchema,
  CONSTRUCTION_RESPONSES,
  constructionDocumentListQuerySchema,
  constructionLayerCreateSchema,
  constructionLayerDto,
  constructionLayerListQuerySchema,
  constructionLayerUpdateSchema,
  constructionOptionListQuerySchema,
  constructionSchemeCreateSchema,
  constructionSchemeDto,
  constructionSchemeListQuerySchema,
  constructionSchemeUpdateSchema,
  constructionSystemListQuerySchema,
  insulationSystemCreateSchema,
  insulationSystemDto,
  insulationSystemUpdateSchema,
  newVersionBodySchema,
  publishedSchemeQuerySchema,
  publishedSystemQuerySchema,
  rejectBodySchema,
  schemeDocumentCreateSchema,
  schemeDocumentDto,
  schemeDocumentUpdateSchema,
  schemeDetailDto,
  schemeProductOptionCreateSchema,
  schemeProductOptionDto,
  schemeProductOptionUpdateSchema,
  uuidParams
} from "./construction.schemas.js";
import {
  registerVersionedWorkflow,
  type WorkflowPerms
} from "../masterdata/workflow-routes.js";

const CONSTRUCTION_TAG = "B端 / 平台 / 构造方案";

/** 构造模块权限校验：SUPER_ADMIN 直通，否则校验具体权限码（本地函数模式，与 masterdata 一致） */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有构造方案管理权限");
  }
  return user;
}

const P = CONSTRUCTION_PERMISSIONS;
const SYSTEM_PERMS: WorkflowPerms = {
  list: P.LIST, create: P.CREATE, update: P.UPDATE,
  remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
};
const SCHEME_PERMS = SYSTEM_PERMS;

/** 子表路径参数：schemeId */
const schemeIdParams = z.object({ schemeId: z.uuid("构造方案 ID 格式不正确") });

/** 显式结构校验响应：valid + 违规明细（不抛错，前端可逐条展示） */
const validateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    violations: z.array(z.object({ field: z.string(), message: z.string() }))
  }),
  requestId: z.string()
});

export async function constructionRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /** 工作流工厂公共上下文（构造模块统一标签/权限/Schema） */
  const workflowCtx = {
    tag: CONSTRUCTION_TAG,
    require: requirePermission,
    uuidParams,
    approveBody: approveBodySchema,
    rejectBody: rejectBodySchema,
    newVersionBody: newVersionBodySchema
  } as const;

  // ================================================================ 保温系统（版本化）
  route.get("/insulation-systems", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询保温系统列表",
      querystring: constructionSystemListQuerySchema, response: { 200: CONSTRUCTION_RESPONSES.systemList }
    }
  }, async (request) => {
    requirePermission(request, SYSTEM_PERMS.list);
    return ok(request, await listInsulationSystems(app, request.query));
  });

  route.post("/insulation-systems", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "新增保温系统",
      body: insulationSystemCreateSchema, response: { 200: CONSTRUCTION_RESPONSES.systemSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SYSTEM_PERMS.create);
    return ok(request, await createInsulationSystem(app, request, actor, request.body));
  });

  route.get("/insulation-systems/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询保温系统详情",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.systemSingle }
    }
  }, async (request) => {
    requirePermission(request, SYSTEM_PERMS.list);
    return ok(request, await getInsulationSystem(app, request.params.id));
  });

  route.patch("/insulation-systems/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "修改保温系统",
      params: uuidParams, body: insulationSystemUpdateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.systemSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SYSTEM_PERMS.update);
    return ok(request, await updateInsulationSystem(app, request, actor, request.params.id, request.body));
  });

  route.delete("/insulation-systems/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "删除保温系统草稿",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, SYSTEM_PERMS.remove);
    return ok(request, await deleteInsulationSystem(app, request, actor, request.params.id));
  });

  registerVersionedWorkflow({ ...workflowCtx, app, base: "/insulation-systems", label: "保温系统", entity: "insulationSystem", perms: SYSTEM_PERMS, dto: insulationSystemDto });

  // ================================================================ 构造方案（版本化 + 结构校验）
  route.get("/construction-schemes", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询构造方案列表",
      querystring: constructionSchemeListQuerySchema, response: { 200: CONSTRUCTION_RESPONSES.schemeList }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await listConstructionSchemes(app, request.query));
  });

  route.post("/construction-schemes", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "新增构造方案",
      body: constructionSchemeCreateSchema, response: { 200: CONSTRUCTION_RESPONSES.schemeSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.create);
    return ok(request, await createConstructionScheme(app, request, actor, request.body));
  });

  route.get("/construction-schemes/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询构造方案详情",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.schemeSingle }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await getConstructionScheme(app, request.params.id));
  });

  route.patch("/construction-schemes/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "修改构造方案",
      params: uuidParams, body: constructionSchemeUpdateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.schemeSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.update);
    return ok(request, await updateConstructionScheme(app, request, actor, request.params.id, request.body));
  });

  route.delete("/construction-schemes/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "删除构造方案草稿",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.remove);
    return ok(request, await deleteConstructionScheme(app, request, actor, request.params.id));
  });

  // 显式结构校验：返回违规明细不抛错（submit/publish 时工厂会在状态机前强制执行同样校验）
  route.post("/construction-schemes/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "校验构造方案结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    const violations = await collectSchemeStructureViolations(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "/construction-schemes", label: "构造方案", entity: "constructionScheme",
    perms: SCHEME_PERMS, dto: constructionSchemeDto,
    validate: (instance, id) => validateSchemeStructure(instance, id)
  });

  // ================================================================ 构造层（子表，随父方案状态守卫）
  route.get("/construction-schemes/:schemeId/layers", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询构造方案层列表",
      params: schemeIdParams, querystring: constructionLayerListQuerySchema,
      response: { 200: CONSTRUCTION_RESPONSES.layerList }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await listConstructionLayers(app, request.params.schemeId, request.query));
  });

  route.post("/construction-schemes/:schemeId/layers", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "新增构造层",
      params: schemeIdParams, body: constructionLayerCreateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.layerSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.create);
    return ok(request, await createConstructionLayer(app, request, actor, request.params.schemeId, request.body));
  });

  route.patch("/construction-layers/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "修改构造层",
      params: uuidParams, body: constructionLayerUpdateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.layerSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.update);
    return ok(request, await updateConstructionLayer(app, request, actor, request.params.id, request.body));
  });

  route.delete("/construction-layers/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "删除构造层",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.remove);
    return ok(request, await deleteConstructionLayer(app, request, actor, request.params.id));
  });

  // ================================================================ 产品选项（子表，随父方案状态守卫）
  route.get("/construction-schemes/:schemeId/product-options", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询构造方案产品选项列表",
      params: schemeIdParams, querystring: constructionOptionListQuerySchema,
      response: { 200: CONSTRUCTION_RESPONSES.optionList }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await listSchemeProductOptions(app, request.params.schemeId, request.query));
  });

  route.post("/construction-schemes/:schemeId/product-options", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "新增产品选项",
      params: schemeIdParams, body: schemeProductOptionCreateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.optionSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.create);
    return ok(request, await createSchemeProductOption(app, request, actor, request.params.schemeId, request.body));
  });

  route.patch("/scheme-product-options/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "修改产品选项",
      params: uuidParams, body: schemeProductOptionUpdateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.optionSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.update);
    return ok(request, await updateSchemeProductOption(app, request, actor, request.params.id, request.body));
  });

  route.delete("/scheme-product-options/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "删除产品选项",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.remove);
    return ok(request, await deleteSchemeProductOption(app, request, actor, request.params.id));
  });

  // ================================================================ 方案文档（子表，多态挂保温系统/构造方案）
  route.get("/construction-schemes/:schemeId/documents", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询方案文档列表",
      params: schemeIdParams, querystring: constructionDocumentListQuerySchema,
      response: { 200: CONSTRUCTION_RESPONSES.documentList }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await listSchemeDocuments(app, {
      ...request.query,
      targetType: "SCHEME", targetId: request.params.schemeId
    }));
  });

  route.post("/construction-schemes/:schemeId/documents", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "新增方案文档",
      params: schemeIdParams, body: schemeDocumentCreateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.documentSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.create);
    return ok(request, await createSchemeDocument(app, request, actor, {
      ...request.body, targetType: "SCHEME", targetId: request.params.schemeId
    }));
  });

  route.patch("/scheme-documents/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "修改方案文档",
      params: uuidParams, body: schemeDocumentUpdateSchema,
      response: { 200: CONSTRUCTION_RESPONSES.documentSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.update);
    return ok(request, await updateSchemeDocument(app, request, actor, request.params.id, request.body));
  });

  route.delete("/scheme-documents/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "删除方案文档",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, SCHEME_PERMS.remove);
    return ok(request, await deleteSchemeDocument(app, request, actor, request.params.id));
  });

  // ================================================================ 已发布读取（只读 PUBLISHED + 生效中）
  route.get("/published/insulation-systems", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询已发布且生效中的保温系统",
      querystring: publishedSystemQuerySchema,
      response: { 200: CONSTRUCTION_RESPONSES.publishedList(insulationSystemDto) }
    }
  }, async (request) => {
    requirePermission(request, SYSTEM_PERMS.list);
    return ok(request, { items: await listPublishedInsulationSystems(app.db, request.query) });
  });

  route.get("/published/construction-schemes", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询已发布且生效中的构造方案",
      querystring: publishedSchemeQuerySchema,
      response: { 200: CONSTRUCTION_RESPONSES.publishedList(constructionSchemeDto) }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, { items: await listPublishedConstructionSchemes(app.db, request.query) });
  });

  route.get("/published/construction-schemes/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [CONSTRUCTION_TAG], summary: "查询已发布构造方案详情（含层/产品选项/文档）",
      params: uuidParams, response: { 200: CONSTRUCTION_RESPONSES.schemeDetail }
    }
  }, async (request) => {
    requirePermission(request, SCHEME_PERMS.list);
    return ok(request, await getPublishedConstructionSchemeDetail(app.db, request.params.id));
  });
}