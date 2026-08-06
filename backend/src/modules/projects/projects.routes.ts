import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { projects } from "../../db/schema.js";
import { AUDIT_ACTIONS, AUTH_CLIENTS, PROJECT_VISIBILITY } from "../../shared/constants.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { ForbiddenError, NotFoundError,BusinessError } from "../../shared/errors.js";
import { getPagination, paginationQuerySchema } from "../../shared/pagination.js";
import { canCreateProjectFromClient, canManageProject, canViewProject } from "../../shared/permissions.js";
import { assertPermission } from "../../shared/permission-guard.js";
import { ok } from "../../shared/response.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { createProjectInTransaction, listCreatedProjects } from "./project.service.js";
import {
  clientProjectListQuerySchema,
  createProjectBodySchema,
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

export async function workspaceProjectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/projects", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "创建项目", body: createProjectBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    await assertPermission(request, "project.create");
    if (!canCreateProjectFromClient(user)) {
      throw new BusinessError("当前登录端或账号不能创建项目");
    }

    const project = await app.db.transaction((tx) => createProjectInTransaction({
      db: tx,
      request,
      actor: user,
      project: request.body
    }));

    return ok(request, { message: "项目创建成功", project });
  });

  route.get("/projects/my", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "获取我创建的项目", querystring: paginationQuerySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(eq(projects.createdById, user.id), isNull(projects.deletedAt));
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(projects).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(projects).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.patch("/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "修改项目信息", params: projectParamsSchema, body: updateProjectBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canManageProject(user, project)) throw new ForbiddenError("只有项目创建者或超级管理员可以修改项目");

    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(projects).set({ ...request.body, updatedAt: new Date() })
        .where(eq(projects.id, project.id)).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.PROJECT_UPDATED, targetType: "project", targetId: project.id,
        beforeJson: project, afterJson: row
      });
      return row!;
    });
    return ok(request, { message: "项目修改成功", project: updated });
  });

  route.patch("/projects/:id/visibility", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "切换项目公开状态", params: projectParamsSchema, body: updateVisibilityBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canManageProject(user, project)) throw new ForbiddenError("只有项目创建者或超级管理员可以修改项目可见性");

    const updated = await app.db.transaction(async (tx) => {
      const [row] = await tx.update(projects).set({ visibility: request.body.visibility, updatedAt: new Date() })
        .where(eq(projects.id, project.id)).returning();
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.PROJECT_VISIBILITY_CHANGED, targetType: "project", targetId: project.id,
        beforeJson: { visibility: project.visibility }, afterJson: { visibility: row!.visibility }
      });
      return row!;
    });
    return ok(request, { message: "项目可见性修改成功", project: updated });
  });

  route.delete("/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["B端 / 工作台 / 项目"], summary: "删除项目", params: projectParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project) throw new NotFoundError("项目不存在");
    if (!canManageProject(user, project)) throw new ForbiddenError("只有项目创建者或超级管理员可以删除项目");

    await app.db.transaction(async (tx) => {
      await tx.update(projects).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      await writeAuditLog({
        db: tx, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.PROJECT_DELETED, targetType: "project", targetId: project.id,
        beforeJson: project
      });
    });
    return ok(request, { message: "项目已删除" });
  });
}

export async function projectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();

  route.post("/projects", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "创建项目", body: createProjectBodySchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    if (user.clientType === AUTH_CLIENTS.B_ADMIN) {
      await assertPermission(request, "project.create");
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
    return ok(request, { message: "项目创建成功", project });
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
    return ok(request, data);
  });

  route.get("/projects/public", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "获取公开项目", querystring: paginationQuerySchema }
  }, async (request) => {
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC), eq(projects.status, "active"), isNull(projects.deletedAt));
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(projects).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(projects).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });

  route.get("/projects/:id", {
    preHandler: [app.authenticate],
    schema: { tags: ["共用 / 项目"], summary: "获取项目详情", params: projectParamsSchema }
  }, async (request) => {
    const user = getCurrentUser(request);
    const project = await findActiveProject(app, request.params.id);
    if (!project || !canViewProject(user, project)) throw new NotFoundError("项目不存在或无权查看");

    if (project.visibility === PROJECT_VISIBILITY.PUBLIC && project.createdById !== user.id) {
      await writeAuditLog({
        db: app.db, request, actor: user, projectId: project.id,
        action: AUDIT_ACTIONS.PUBLIC_PROJECT_VIEWED, targetType: "project", targetId: project.id
      });
    }
    return ok(request, { project });
  });
}

export async function platformProjectRoutes(app: FastifyInstance) {
  const route = app.withTypeProvider<ZodTypeProvider>();
  route.get("/projects/statistics", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "查询项目统计",
    }
  }, async (request) => {
    await assertPermission(request, "system:project:list");
    const activeWhere = isNull(projects.deletedAt);
    const [totalRow, publicRow, privateRow] = await Promise.all([
      app.db.select({ value: count() }).from(projects).where(activeWhere),
      app.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC))),
      app.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PRIVATE)))
    ]);
    return ok(request, {
      total: totalRow[0]?.value ?? 0,
      public: publicRow[0]?.value ?? 0,
      private: privateRow[0]?.value ?? 0
    });
  });

  route.get("/projects", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["B端 / 平台 / 项目"],
      summary: "平台项目列表",
      querystring: paginationQuerySchema.extend({
        visibility: z.enum([PROJECT_VISIBILITY.PRIVATE, PROJECT_VISIBILITY.PUBLIC]).optional()
      })
    }
  }, async (request) => {
    await assertPermission(request, "system:project:list");
    const { skip, take } = getPagination(request.query.page, request.query.pageSize);
    const where = and(
      request.query.visibility ? eq(projects.visibility, request.query.visibility) : undefined,
      isNull(projects.deletedAt)
    );
    const [items, [totalRow]] = await Promise.all([
      app.db.select().from(projects).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
      app.db.select({ value: count() }).from(projects).where(where)
    ]);
    return ok(request, { items, total: totalRow?.value ?? 0, page: request.query.page, pageSize: request.query.pageSize });
  });
}
