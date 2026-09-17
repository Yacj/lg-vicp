import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { requireClient } from "../../shared/client-guard.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError } from "../../shared/errors.js";
import { ok } from "../../shared/response.js";
import { COLLECTION_PERMISSIONS } from "../../shared/collection-permissions.js";
import {
  collectionSourceParamsSchema,
  collectionTaskListQuerySchema,
  collectionTaskParamsSchema,
  createCollectionSourceBodySchema,
  createManualCollectionBodySchema,
  updateCollectionSourceBodySchema
} from "./collection.schemas.js";
import {
  createCollectionSource,
  createManualCollectionTask,
  getCollectionTask,
  importCollectionTaskToKnowledge,
  listCollectionSources,
  listCollectionTasks,
  toggleCollectionSource,
  updateCollectionSource,
  type CollectionDeps
} from "./collection.service.js";

function collectionDeps(app: FastifyInstance): CollectionDeps {
  return { db: app.db, storage: app.storage, queues: app.queues };
}

function requirePermission(request: Parameters<typeof getCurrentUser>[0], permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role !== "SUPER_ADMIN" && !(user.permissionCodes ?? []).includes(permissionCode)) {
    throw new ForbiddenError("当前账号没有采集管理权限");
  }
  return user;
}

const TAG = "B端 / 平台 / 采集管理";

/** 独立采集管理：获取外部候选资料，确认后导入 Knowledge；自动采集禁止直接发布 */
export async function collectionRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const preAdmin = [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)];

  route.post("/manual", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "创建手动采集任务（采集完成后进入待确认，不会自动发布）",
      body: createManualCollectionBodySchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.MANUAL_CREATE);
    return ok(request, await createManualCollectionTask(collectionDeps(app), request, actor, request.body));
  });

  route.get("/sources", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "查询自动采集源列表（仅名称/地址/启用状态）"
    }
  }, async (request) => {
    requirePermission(request, COLLECTION_PERMISSIONS.AUTO_LIST);
    return ok(request, { items: await listCollectionSources(collectionDeps(app)) });
  });

  route.post("/sources", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "新增自动采集源（启用后按 Backend 固定间隔采集，不开放 Cron）",
      body: createCollectionSourceBodySchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.AUTO_CREATE);
    return ok(request, await createCollectionSource(collectionDeps(app), request, actor, request.body));
  });

  route.put("/sources/:id", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "修改自动采集源名称或来源地址",
      params: collectionSourceParamsSchema,
      body: updateCollectionSourceBodySchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.AUTO_UPDATE);
    return ok(request, await updateCollectionSource(collectionDeps(app), request, actor, request.params.id, request.body));
  });

  route.post("/sources/:id/enable", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "启用自动采集源",
      params: collectionSourceParamsSchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.AUTO_TOGGLE);
    return ok(request, await toggleCollectionSource(collectionDeps(app), request, actor, request.params.id, true));
  });

  route.post("/sources/:id/disable", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "停用自动采集源",
      params: collectionSourceParamsSchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.AUTO_TOGGLE);
    return ok(request, await toggleCollectionSource(collectionDeps(app), request, actor, request.params.id, false));
  });

  route.get("/tasks", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "查询采集任务列表（可按 mode/status/keyword 筛选）",
      querystring: collectionTaskListQuerySchema
    }
  }, async (request) => {
    requirePermission(request, COLLECTION_PERMISSIONS.LIST);
    return ok(request, await listCollectionTasks(collectionDeps(app), request.query));
  });

  route.get("/tasks/:id", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "查询采集任务详情",
      params: collectionTaskParamsSchema
    }
  }, async (request) => {
    requirePermission(request, COLLECTION_PERMISSIONS.TASK_VIEW);
    return ok(request, await getCollectionTask(collectionDeps(app), request.params.id));
  });

  route.post("/tasks/:id/import-to-knowledge", {
    preHandler: preAdmin,
    schema: {
      tags: [TAG],
      summary: "确认采集结果导入知识库（始终创建 DRAFT，不会直接发布）",
      params: collectionTaskParamsSchema
    }
  }, async (request) => {
    const actor = requirePermission(request, COLLECTION_PERMISSIONS.TASK_IMPORT);
    return ok(request, await importCollectionTaskToKnowledge(app, request, actor, request.params.id));
  });
}
