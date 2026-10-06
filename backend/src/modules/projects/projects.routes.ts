import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { projects } from "../../db/schema.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError, BusinessError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import {
  canCreateProjectFromClient,
  canDeleteProject,
  canEditProject,
  canManageProject,
  canViewProject
} from "../../shared/permissions.js";
import { assertPermission } from "../../shared/permission-guard.js";
import { requireClient } from "../../shared/client-guard.js";
import { ok } from "../../shared/response.js";
import {
  assertVisibleDepartmentAssignable,
  clientVisibleProjectWhere,
  createProjectInTransaction,
  deleteProjectInTransaction,
  getPlatformProject,
  getVisibleProjectStatistics,
  listCreatedProjects,
  listPlatformProjects,
  updateProjectInTransaction,
  updateProjectVisibilityInTransaction
} from "./project.service.js";
import {
  clientProjectListQuerySchema,
  createProjectBodySchema,
  platformProjectListQuerySchema,
  projectParamsSchema,
  updateProjectBodySchema,
  updateVisibilityBodySchema
} from "./project.schemas.js";

async function findActiveProject(app: FastifyInstance, id: string) {
  const [project] = await app.db.select().from(projects).where(and(
    eq(projects.id, id),
    isNull(projects.deletedAt)
  )).limit(1);
  return project;
}

function projectResponse(user: ReturnType<typeof getCurrentUser>, project: typeof projects.$inferSelect) {
  return {
    ...project,
    canManage: canManageProject(user, project),
    canEdit: canEditProject(user, project),
    canDelete: canDeleteProject(user, project)
  };
}

export async function workspaceProjectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/projects", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "创建项目（P0 工作台不开放新增）", body: createProjectBodySchema }
  }, async () => {
    throw new BusinessError("管理端不能新增项目");
  });

  route.get("/projects/my", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "获取我创建的项目", querystring: paginationQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const data = await listCreatedProjects({
      db: app.db,
      ownerUserId: user.id,
      page: request.query.page,
      pageSize: request.query.pageSize
    });
    return ok(request, { ...data, items: data.items.map((project) => projectResponse(user, project)) });
  });
}

export async function projectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/projects", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "创建项目（C 端普通用户）", body: createProjectBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (user.clientType === AUTH_CLIENTS.B_ADMIN) {
      throw new BusinessError("管理端不能新增项目");
    }
    if (!canCreateProjectFromClient(user)) {
      throw new BusinessError("当前登录端或账号不能创建项目");
    }

    const project = await app.db.transaction((tx) => createProjectInTransaction({
      db: tx,
      request,
      actor: user,
      project: request.body
    }));
    return ok(request, { message: "项目创建成功", project: projectResponse(user, project) });
  });

  route.get("/client/projects", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "获取我创建的项目（C 端）", querystring: clientProjectListQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const data = await listCreatedProjects({
      db: app.db,
      ownerUserId: user.id,
      page: request.query.page,
      pageSize: request.query.pageSize,
      visibility: request.query.visibility,
      keyword: request.query.keyword
    });
    return ok(request, { ...data, items: data.items.map((project) => projectResponse(user, project)) });
  });

  route.patch("/client/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "修改项目信息（C 端）", params: projectParamsSchema, body: updateProjectBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canEditProject(user, project)) throw new ForbiddenError("只有项目创建者可以修改项目");

    const updated = await app.db.transaction((tx) => updateProjectInTransaction({
      db: tx,
      request,
      actor: user,
      project,
      patch: request.body
    }));
    return ok(request, { message: "项目修改成功", project: projectResponse(user, updated) });
  });

  route.patch("/client/projects/:id/visibility", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "切换项目可见范围（C 端）", params: projectParamsSchema, body: updateVisibilityBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canEditProject(user, project)) throw new ForbiddenError("只有项目创建者可以修改项目可见性");
    await assertVisibleDepartmentAssignable(app.db, user, request.body.visibleDepartmentId);

    const updated = await app.db.transaction((tx) => updateProjectVisibilityInTransaction({
      db: tx,
      request,
      actor: user,
      project,
      visibility: request.body.visibility,
      visibleDepartmentId: request.body.visibleDepartmentId,
      includeChildDepartments: request.body.includeChildDepartments
    }));
    return ok(request, { message: "项目可见性修改成功", project: projectResponse(user, updated) });
  });

  route.delete("/client/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "删除项目（C 端）", params: projectParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canDeleteProject(user, project)) throw new ForbiddenError("只有项目创建者可以删除项目");

    await app.db.transaction((tx) => deleteProjectInTransaction({
      db: tx, request, actor: user, project
    }));
    return ok(request, { message: "项目已删除" });
  });

  route.get("/projects/public", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "获取当前账号有权查看的项目（部门/子部门可见 + 历史公开 + 本人）", querystring: paginationQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = clientVisibleProjectWhere(user);
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(projects).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(projects).where(where)
    ]);
    return ok(request, { items: items.map((project) => projectResponse(user, project)), total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.get("/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "获取项目详情", params: projectParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project || !canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");
    return ok(request, { project: projectResponse(user, project) });
  });
}

export async function platformProjectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  const preAdmin = [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)];

  route.get("/projects/statistics", {
    preHandler: preAdmin,
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "查询全平台项目统计",
      description: "超级管理员查看全平台计数，不校验 system:project:list。"
    }
  }, async (request) => {
    const user = getCurrentUser(request);
    return ok(request, await getVisibleProjectStatistics({ db: app.db, user }));
  });

  route.get("/projects", {
    preHandler: preAdmin,
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "平台项目全量列表（含创建用户与所属部门）",
      querystring: platformProjectListQuerySchema
    }
  }, async (request) => {
    await assertPermission(request, "system:project:list");
    return ok(request, await listPlatformProjects({
      db: app.db,
      page: request.query.page,
      pageSize: request.query.pageSize,
      visibility: request.query.visibility,
      keyword: request.query.keyword
    }));
  });

  route.get("/projects/:id", {
    preHandler: preAdmin,
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "平台项目详情",
      params: projectParamsSchema
    }
  }, async (request) => {
    await assertPermission(request, "system:project:list");
    const user = getCurrentUser(request);
    const project = await getPlatformProject({ db: app.db, id: request.params.id });
    if (!project) throw new NotFoundError("项目不存在");
    return ok(request, {
      project: {
        ...project,
        canManage: canManageProject(user, project),
        canEdit: canEditProject(user, project),
        canDelete: canDeleteProject(user, project)
      }
    });
  });

  route.delete("/projects/:id", {
    preHandler: preAdmin,
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "平台删除项目",
      params: projectParamsSchema
    }
  }, async (request) => {
    await assertPermission(request, "system:project:remove");
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canDeleteProject(user, project)) throw new ForbiddenError("当前账号不能删除项目");
    await app.db.transaction((tx) => deleteProjectInTransaction({
      db: tx, request, actor: user, project
    }));
    return ok(request, { message: "项目已删除" });
  });
}
