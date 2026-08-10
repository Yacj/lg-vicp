import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { NODE_PERMISSIONS } from "../../shared/node-permissions.js";
import { ok } from "../../shared/response.js";
import { registerVersionedWorkflow, type WorkflowPerms } from "../masterdata/workflow-routes.js";
import {
  listPublishedNodesWithLinks,
  createNodeDrawing,
  createNodeSchemeLink,
  deleteNodeDrawing,
  deleteNodeSchemeLink,
  getNodeDrawing,
  listNodeDrawings,
  listNodeSchemeLinks,
  updateNodeDrawing,
  updateNodeSchemeLink,
  collectNodeStructureViolations,
  copyNodeChildren,
  validateNodeStructure
} from "./node.service.js";
import {
  approveBodySchema,
  NODE_RESPONSES,
  nodeDrawingCreateSchema,
  nodeDrawingDto,
  nodeDrawingListQuerySchema,
  nodeDrawingUpdateSchema,
  newVersionBodySchema,
  nodeLinkListQuerySchema,
  nodeSchemeLinkCreateSchema,
  nodeSchemeLinkDto,
  nodeSchemeLinkUpdateSchema,
  publishedNodeDetailDto,
  publishedNodeQuerySchema,
  rejectBodySchema,
  uuidParams
} from "./node.schemas.js";

const NODE_TAG = "B端 / 平台 / 节点图库";

/** 节点模块权限校验：SUPER_ADMIN 直通，否则校验具体权限码（本地函数模式，与 construction 一致） */
function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有节点图库管理权限");
  }
  return user;
}

const P = NODE_PERMISSIONS;
const NODE_PERMS: WorkflowPerms = {
  list: P.LIST, create: P.CREATE, update: P.UPDATE,
  remove: P.DELETE, approve: P.APPROVE, publish: P.PUBLISH
};

/** 节点子表路径参数：nodeId */
const nodeIdParams = z.object({ nodeId: z.uuid("节点 ID 格式不正确") });

/** 显式结构校验响应：valid + 违规明细（不抛错，前端可逐条展示） */
const validateResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    valid: z.boolean(),
    violations: z.array(z.object({ field: z.string(), message: z.string() }))
  }),
  requestId: z.string()
});

export async function nodeRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  /** 工作流工厂公共上下文（节点模块统一标签/权限/Schema） */
  const workflowCtx = {
    tag: NODE_TAG,
    require: requirePermission,
    uuidParams,
    approveBody: approveBodySchema,
    rejectBody: rejectBodySchema,
    newVersionBody: newVersionBodySchema
  } as const;

  // ================================================================ 节点图（版本化）
  route.get("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "查询节点图列表（支持系统 + 部位精确匹配）",
      querystring: nodeDrawingListQuerySchema, response: { 200: NODE_RESPONSES.nodeList }
    }
  }, async (request) => {
    requirePermission(request, NODE_PERMS.list);
    return ok(request, await listNodeDrawings(app, request.query));
  });

  route.post("/", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "新增节点图",
      body: nodeDrawingCreateSchema, response: { 200: NODE_RESPONSES.nodeSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.create);
    return ok(request, await createNodeDrawing(app, request, actor, request.body));
  });

  route.get("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "查询节点图详情",
      params: uuidParams, response: { 200: NODE_RESPONSES.nodeSingle }
    }
  }, async (request) => {
    requirePermission(request, NODE_PERMS.list);
    return ok(request, await getNodeDrawing(app, request.params.id));
  });

  route.patch("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "修改节点图",
      params: uuidParams, body: nodeDrawingUpdateSchema,
      response: { 200: NODE_RESPONSES.nodeSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.update);
    return ok(request, await updateNodeDrawing(app, request, actor, request.params.id, request.body));
  });

  route.delete("/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "删除节点图草稿",
      params: uuidParams, response: { 200: NODE_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.remove);
    return ok(request, await deleteNodeDrawing(app, request, actor, request.params.id));
  });

  // 显式结构校验：返回违规明细不抛错（submit/publish 时工厂会在状态机前强制执行同样校验）
  route.post("/:id/validate", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "校验节点图结构",
      params: uuidParams, response: { 200: validateResponseSchema }
    }
  }, async (request) => {
    requirePermission(request, NODE_PERMS.list);
    const violations = await collectNodeStructureViolations(app, request.params.id);
    return ok(request, { valid: violations.length === 0, violations });
  });

  registerVersionedWorkflow({
    ...workflowCtx, app, base: "", label: "节点图", entity: "nodeDrawing",
    perms: NODE_PERMS, dto: nodeDrawingDto,
    copyChildren: copyNodeChildren,
    validate: (instance, id) => validateNodeStructure(instance, id)
  });

  // ================================================================ 节点-方案关联（子表，随父节点状态守卫）
  route.get("/:nodeId/links", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "查询节点方案关联列表",
      params: nodeIdParams, querystring: nodeLinkListQuerySchema,
      response: { 200: NODE_RESPONSES.linkList }
    }
  }, async (request) => {
    requirePermission(request, NODE_PERMS.list);
    return ok(request, await listNodeSchemeLinks(app, request.params.nodeId, request.query));
  });

  route.post("/:nodeId/links", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "新增节点方案关联",
      params: nodeIdParams, body: nodeSchemeLinkCreateSchema,
      response: { 200: NODE_RESPONSES.linkSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.create);
    return ok(request, await createNodeSchemeLink(app, request, actor, request.params.nodeId, request.body));
  });

  route.patch("/node-links/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "修改节点方案关联",
      params: uuidParams, body: nodeSchemeLinkUpdateSchema,
      response: { 200: NODE_RESPONSES.linkSingle }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.update);
    return ok(request, await updateNodeSchemeLink(app, request, actor, request.params.id, request.body));
  });

  route.delete("/node-links/:id", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "删除节点方案关联",
      params: uuidParams, response: { 200: NODE_RESPONSES.message }
    }
  }, async (request) => {
    const actor = requirePermission(request, NODE_PERMS.remove);
    return ok(request, await deleteNodeSchemeLink(app, request, actor, request.params.id));
  });

  // ================================================================ 已发布读取（只读 PUBLISHED + 生效中）
  route.get("/published", {
    preHandler: [app.authenticate],
    schema: {
      tags: [NODE_TAG], summary: "查询已发布且生效中的节点图（按系统 + 部位精确匹配）",
      querystring: publishedNodeQuerySchema,
      response: { 200: NODE_RESPONSES.publishedList(publishedNodeDetailDto) }
    }
  }, async (request) => {
    requirePermission(request, NODE_PERMS.list);
    return ok(request, { items: await listPublishedNodesWithLinks(app.db, request.query) });
  });
}