import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import type { DbExecutor } from "../../db/client.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ok } from "../../shared/response.js";
import {
  approveEntity,
  createNextVersion,
  disableEntity,
  publishEntity,
  rejectEntity,
  submitForReview,
  type MdEntityName
} from "./md-workflow.service.js";

/**
 * 主数据审核工作流路由工厂（masterdata 与 construction 模块共用）。
 * 工厂只负责把状态机服务暴露为标准六个工作流端点（submit/approve/reject/publish/disable/new-version），
 * 不关心具体实体；标签、权限校验、请求/响应 Schema 全部由调用方传入，避免为每个模块复制实现。
 */

/** 工作流权限码映射：与 md-permissions.ts / construction-permissions.ts 的六动作一致 */
export interface WorkflowPerms {
  list: string;
  create: string;
  update: string;
  remove: string;
  approve: string;
  publish: string;
}

/** 权限校验函数：SUPER_ADMIN 直通，否则校验具体权限码，返回操作人（写入审计 actor） */
export type PermissionCheck = (
  request: Parameters<typeof getCurrentUser>[0],
  code: string
) => ReturnType<typeof getCurrentUser>;

/** 工作流路由公共上下文 */
export interface WorkflowRouteContext {
  app: FastifyInstance;
  /** Swagger 标签（如 "B端 / 平台 / 构造方案"） */
  tag: string;
  require: PermissionCheck;
  uuidParams: z.ZodType;
  approveBody: z.ZodType;
  rejectBody: z.ZodType;
  newVersionBody: z.ZodType;
}

/** 工作流端点统一响应包装：{ success, data: { item: 实体DTO }, requestId } */
export const workflowItemResponse = (dto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({ item: dto }),
  requestId: z.string()
});

export interface VersionedWorkflowOptions extends WorkflowRouteContext {
  base: string;
  label: string;
  entity: MdEntityName;
  perms: Pick<WorkflowPerms, "create" | "approve" | "publish">;
  dto: z.ZodType;
  /** 派生新版本时在同一事务内复制子表（如构造方案的层/产品选项/文档），历史版本快照不漂移 */
  copyChildren?: (tx: DbExecutor, oldRow: Record<string, unknown>, newRow: Record<string, unknown>) => Promise<void>;
  /** 提交审核/发布前的业务校验钩子（如构造方案结构校验），校验失败抛错终止本次操作 */
  validate?: (app: FastifyInstance, id: string) => Promise<void>;
}

/** 版本化实体工作流：为 {entity} 注册 submit/approve/reject/publish/disable/new-version 六个端点 */
export function registerVersionedWorkflow(options: VersionedWorkflowOptions) {
  const { app, base, label, entity, perms, dto } = options;
  const route = app.withTypeProvider<ZodTypeProvider>();
  const response = { 200: workflowItemResponse(dto) };
  const summary = (action: string) => `${action}${label}`;

  route.post(`${base}/:id/submit`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("提交审核"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.create);
    const { id } = request.params as { id: string };
    if (options.validate) await options.validate(app, id);
    return ok(request, { item: await submitForReview(app, request, actor, entity, id) });
  });

  route.post(`${base}/:id/approve`, {
    preHandler: [app.authenticate],
    schema: {
      tags: [options.tag], summary: summary("审核通过"), params: options.uuidParams,
      body: options.approveBody, response
    }
  }, async (request) => {
    const actor = options.require(request, perms.approve);
    const { id } = request.params as { id: string };
    const body = request.body as { approvalNote?: string };
    return ok(request, { item: await approveEntity(app, request, actor, entity, id, body.approvalNote) });
  });

  route.post(`${base}/:id/reject`, {
    preHandler: [app.authenticate],
    schema: {
      tags: [options.tag], summary: summary("驳回"), params: options.uuidParams,
      body: options.rejectBody, response
    }
  }, async (request) => {
    const actor = options.require(request, perms.approve);
    const { id } = request.params as { id: string };
    const body = request.body as { rejectReason: string };
    return ok(request, { item: await rejectEntity(app, request, actor, entity, id, body.rejectReason) });
  });

  route.post(`${base}/:id/publish`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("发布"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.publish);
    const { id } = request.params as { id: string };
    if (options.validate) await options.validate(app, id);
    return ok(request, { item: await publishEntity(app, request, actor, entity, id) });
  });

  route.post(`${base}/:id/disable`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("停用"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.publish);
    const { id } = request.params as { id: string };
    return ok(request, { item: await disableEntity(app, request, actor, entity, id) });
  });

  route.post(`${base}/:id/new-version`, {
    preHandler: [app.authenticate],
    schema: {
      tags: [options.tag], summary: summary("派生新版本"), params: options.uuidParams,
      body: options.newVersionBody, response
    }
  }, async (request) => {
    const actor = options.require(request, perms.publish);
    const { id } = request.params as { id: string };
    const body = request.body as { changeNote?: string };
    return ok(request, { item: await createNextVersion(app, request, actor, entity, id, body.changeNote, options.copyChildren) });
  });
}

/** 非版本化实体工作流实现（服务层提供，如证书/附件的审核函数集合） */
export interface SimpleWorkflow {
  submit: (app: FastifyInstance, request: FastifyRequest, actor: ReturnType<typeof getCurrentUser>, id: string) => Promise<unknown>;
  approve: (app: FastifyInstance, request: FastifyRequest, actor: ReturnType<typeof getCurrentUser>, id: string, note?: string) => Promise<unknown>;
  reject: (app: FastifyInstance, request: FastifyRequest, actor: ReturnType<typeof getCurrentUser>, id: string, reason: string) => Promise<unknown>;
  publish: (app: FastifyInstance, request: FastifyRequest, actor: ReturnType<typeof getCurrentUser>, id: string) => Promise<unknown>;
  disable: (app: FastifyInstance, request: FastifyRequest, actor: ReturnType<typeof getCurrentUser>, id: string) => Promise<unknown>;
}

export interface SimpleWorkflowOptions extends WorkflowRouteContext {
  base: string;
  label: string;
  workflow: SimpleWorkflow;
  perms: Pick<WorkflowPerms, "create" | "approve" | "publish">;
  dto: z.ZodType;
}

/** 非版本化实体工作流（证书/附件）：submit/approve/reject/publish/disable，无 new-version */
export function registerSimpleWorkflow(options: SimpleWorkflowOptions) {
  const { app, base, label, workflow, perms, dto } = options;
  const route = app.withTypeProvider<ZodTypeProvider>();
  const response = { 200: workflowItemResponse(dto) };
  const summary = (action: string) => `${action}${label}`;

  route.post(`${base}/:id/submit`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("提交审核"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.create);
    const { id } = request.params as { id: string };
    return ok(request, { item: await workflow.submit(app, request, actor, id) });
  });

  route.post(`${base}/:id/approve`, {
    preHandler: [app.authenticate],
    schema: {
      tags: [options.tag], summary: summary("审核通过"), params: options.uuidParams,
      body: options.approveBody, response
    }
  }, async (request) => {
    const actor = options.require(request, perms.approve);
    const { id } = request.params as { id: string };
    const body = request.body as { approvalNote?: string };
    return ok(request, { item: await workflow.approve(app, request, actor, id, body.approvalNote) });
  });

  route.post(`${base}/:id/reject`, {
    preHandler: [app.authenticate],
    schema: {
      tags: [options.tag], summary: summary("驳回"), params: options.uuidParams,
      body: options.rejectBody, response
    }
  }, async (request) => {
    const actor = options.require(request, perms.approve);
    const { id } = request.params as { id: string };
    const body = request.body as { rejectReason: string };
    return ok(request, { item: await workflow.reject(app, request, actor, id, body.rejectReason) });
  });

  route.post(`${base}/:id/publish`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("发布"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.publish);
    const { id } = request.params as { id: string };
    return ok(request, { item: await workflow.publish(app, request, actor, id) });
  });

  route.post(`${base}/:id/disable`, {
    preHandler: [app.authenticate],
    schema: { tags: [options.tag], summary: summary("停用"), params: options.uuidParams, response }
  }, async (request) => {
    const actor = options.require(request, perms.publish);
    const { id } = request.params as { id: string };
    return ok(request, { item: await workflow.disable(app, request, actor, id) });
  });
}