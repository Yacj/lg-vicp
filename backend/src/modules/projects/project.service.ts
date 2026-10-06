import { and, count, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { DbExecutor } from "../../db/client.js";
import { departments, projects, userDepartments, users } from "../../db/schema.js";
import { getPagination } from "../../shared/pagination.js";
import { AUDIT_ACTIONS, PROJECT_VISIBILITY, USER_ROLES, VISIBILITY_POLICY } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { BusinessError } from "../../shared/errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

export type CreateProjectInput = {
  name: string;
  description?: string;
  region?: string;
  buildingType?: string;
  visibility: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
  visibleDepartmentId?: string | null;
  includeChildDepartments?: boolean;
};

export type CreatedProjectListInput = {
  db: DbExecutor;
  ownerUserId: string;
  page: number;
  pageSize: number;
  visibility?: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
  keyword?: string;
};

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function projectKeywordWhere(keyword: string | undefined) {
  const normalized = keyword?.trim();
  if (!normalized) return undefined;
  const pattern = `%${escapeLikePattern(normalized)}%`;
  return or(
    ilike(projects.name, pattern),
    ilike(projects.region, pattern),
    ilike(projects.buildingType, pattern)
  );
}

export async function listCreatedProjects(input: CreatedProjectListInput) {
  const { skip, take } = getPagination(input.page, input.pageSize);
  const where = and(
    eq(projects.createdById, input.ownerUserId),
    isNull(projects.deletedAt),
    input.visibility ? eq(projects.visibility, input.visibility) : undefined,
    projectKeywordWhere(input.keyword)
  );

  const [items, [totalRow]] = await Promise.all([
    input.db.select().from(projects).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
    input.db.select({ value: count() }).from(projects).where(where)
  ]);

  return {
    items,
    total: totalRow?.value ?? 0,
    page: input.page,
    pageSize: input.pageSize
  };
}

/**
 * C 端可见项目：自己创建的 + 部门/子部门可见 + 历史 PUBLIC。
 * 过滤在 SQL 完成，不把全量项目下发给客户端。
 */
export function clientVisibleProjectWhere(user: Pick<AuthUser, "id" | "departmentIds" | "departmentScopeIds">) {
  const departmentIds = user.departmentIds ?? [];
  const scopeIds = user.departmentScopeIds ?? departmentIds;
  const departmentExact = departmentIds.length > 0
    ? and(
        eq(projects.visibility, PROJECT_VISIBILITY.DEPARTMENT),
        eq(projects.includeChildDepartments, false),
        inArray(projects.visibleDepartmentId, departmentIds)
      )
    : undefined;
  const departmentWithChildren = scopeIds.length > 0
    ? and(
        eq(projects.visibility, PROJECT_VISIBILITY.DEPARTMENT),
        eq(projects.includeChildDepartments, true),
        inArray(projects.visibleDepartmentId, scopeIds)
      )
    : undefined;
  return and(
    isNull(projects.deletedAt),
    or(
      eq(projects.createdById, user.id),
      eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC),
      departmentExact,
      departmentWithChildren
    )
  );
}

/** B 端超级管理员看全平台；其他账号不走此接口（登录已被拒绝）。 */
export function platformProjectScopeWhere(user: Pick<AuthUser, "id" | "role">) {
  if (user.role === USER_ROLES.SUPER_ADMIN) return undefined;
  return eq(projects.createdById, user.id);
}

export type ProjectStatistics = {
  total: number;
  public: number;
  private: number;
  department: number;
};

export async function getVisibleProjectStatistics(input: {
  db: DbExecutor;
  user: Pick<AuthUser, "id" | "role">;
}): Promise<ProjectStatistics> {
  const activeWhere = and(
    isNull(projects.deletedAt),
    platformProjectScopeWhere(input.user)
  );
  const [totalRow, publicRow, privateRow, departmentRow] = await Promise.all([
    input.db.select({ value: count() }).from(projects).where(activeWhere),
    input.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC))),
    input.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PRIVATE))),
    input.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.DEPARTMENT)))
  ]);
  return {
    total: totalRow[0]?.value ?? 0,
    public: publicRow[0]?.value ?? 0,
    private: privateRow[0]?.value ?? 0,
    department: departmentRow[0]?.value ?? 0
  };
}

export type PlatformProjectListItem = {
  id: string;
  name: string;
  visibility: typeof projects.$inferSelect["visibility"];
  visibleDepartmentId: string | null;
  includeChildDepartments: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  createdById: string;
  createdByName: string | null;
  ownerDepartmentId: string | null;
  ownerDepartmentName: string | null;
};

/**
 * 创建者主部门子查询：只用于表达式本身，JOIN ON 不能引用 SELECT 别名。
 * 先前 `.as("owner_department_id")` 再 `eq(departments.id, alias)` 会生成
 * `ON departments.id = owner_department_id`，PostgreSQL 报 column does not exist。
 */
export function ownerDepartmentIdSql() {
  return sql<string | null>`(
    select ud.department_id from ${userDepartments} ud
    where ud.user_id = ${projects.createdById}
    order by ud.is_primary desc, ud.created_at asc
    limit 1
  )`;
}

export function platformProjectSelect(db: DbExecutor) {
  const ownerDeptId = ownerDepartmentIdSql();
  return db.select({
    id: projects.id,
    name: projects.name,
    visibility: projects.visibility,
    visibleDepartmentId: projects.visibleDepartmentId,
    includeChildDepartments: projects.includeChildDepartments,
    status: projects.status,
    createdAt: projects.createdAt,
    updatedAt: projects.updatedAt,
    createdById: projects.createdById,
    createdByName: users.displayName,
    ownerDepartmentId: sql<string | null>`${ownerDeptId}`.as("owner_department_id"),
    ownerDepartmentName: departments.name
  }).from(projects)
    .leftJoin(users, eq(users.id, projects.createdById))
    .leftJoin(departments, sql`${departments.id} = ${ownerDeptId}`);
}

export async function listPlatformProjects(input: {
  db: DbExecutor;
  page: number;
  pageSize: number;
  visibility?: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
  keyword?: string;
}) {
  const { skip, take } = getPagination(input.page, input.pageSize);
  const where = and(
    isNull(projects.deletedAt),
    input.visibility ? eq(projects.visibility, input.visibility) : undefined,
    projectKeywordWhere(input.keyword)
  );

  const [items, [totalRow]] = await Promise.all([
    platformProjectSelect(input.db).where(where).orderBy(desc(projects.createdAt)).offset(skip).limit(take),
    input.db.select({ value: count() }).from(projects).where(where)
  ]);

  return {
    items,
    total: totalRow?.value ?? 0,
    page: input.page,
    pageSize: input.pageSize
  };
}

export async function getPlatformProject(input: { db: DbExecutor; id: string }) {
  const [item] = await platformProjectSelect(input.db).where(and(
    eq(projects.id, input.id),
    isNull(projects.deletedAt)
  )).limit(1);
  return item ?? null;
}

export async function assertVisibleDepartmentAssignable(db: DbExecutor, actor: AuthUser, departmentId: string | null | undefined) {
  if (!departmentId) return;
  const [row] = await db.select({ id: departments.id }).from(departments).where(and(
    eq(departments.id, departmentId),
    isNull(departments.deletedAt)
  )).limit(1);
  if (!row) throw new BusinessError("可见部门不存在");
  if (actor.role === USER_ROLES.SUPER_ADMIN) return;
  const allowed = new Set(actor.departmentIds ?? []);
  if (!allowed.has(departmentId)) {
    throw new BusinessError("只能将项目共享给自己所属的部门");
  }
}

export type UpdateProjectInput = {
  name?: string;
  description?: string;
  region?: string;
  buildingType?: string;
};

export async function updateProjectInTransaction(input: {
  db: DbExecutor;
  request: FastifyRequest;
  actor: AuthUser;
  project: typeof projects.$inferSelect;
  patch: UpdateProjectInput;
}) {
  const [updated] = await input.db.update(projects)
    .set({ ...input.patch, updatedAt: new Date() })
    .where(eq(projects.id, input.project.id))
    .returning();

  await writeAuditLog({
    db: input.db,
    request: input.request,
    actor: input.actor,
    projectId: input.project.id,
    action: AUDIT_ACTIONS.PROJECT_UPDATED,
    targetType: "project",
    targetId: input.project.id,
    beforeJson: input.project,
    afterJson: updated
  });

  return updated!;
}

export async function updateProjectVisibilityInTransaction(input: {
  db: DbExecutor;
  request: FastifyRequest;
  actor: AuthUser;
  project: typeof projects.$inferSelect;
  visibility: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
  visibleDepartmentId?: string | null;
  includeChildDepartments?: boolean;
}) {
  const nextDepartmentId = input.visibility === PROJECT_VISIBILITY.DEPARTMENT
    ? (input.visibleDepartmentId ?? input.project.visibleDepartmentId)
    : null;
  const [updated] = await input.db.update(projects)
    .set({
      visibility: input.visibility,
      visibleDepartmentId: nextDepartmentId,
      includeChildDepartments: input.includeChildDepartments ?? input.project.includeChildDepartments,
      updatedAt: new Date()
    })
    .where(eq(projects.id, input.project.id))
    .returning();

  await writeAuditLog({
    db: input.db,
    request: input.request,
    actor: input.actor,
    projectId: input.project.id,
    action: AUDIT_ACTIONS.PROJECT_VISIBILITY_CHANGED,
    targetType: "project",
    targetId: input.project.id,
    beforeJson: {
      visibility: input.project.visibility,
      visibleDepartmentId: input.project.visibleDepartmentId,
      includeChildDepartments: input.project.includeChildDepartments
    },
    afterJson: {
      visibility: updated!.visibility,
      visibleDepartmentId: updated!.visibleDepartmentId,
      includeChildDepartments: updated!.includeChildDepartments
    }
  });

  return updated!;
}

export async function createProjectInTransaction(input: {
  db: DbExecutor;
  request: FastifyRequest;
  actor: AuthUser;
  project: CreateProjectInput;
}) {
  await assertVisibleDepartmentAssignable(input.db, input.actor, input.project.visibleDepartmentId);
  const [created] = await input.db.insert(projects).values({
    name: input.project.name,
    description: input.project.description,
    region: input.project.region,
    buildingType: input.project.buildingType,
    visibility: input.project.visibility,
    visibleDepartmentId: input.project.visibility === PROJECT_VISIBILITY.DEPARTMENT
      ? (input.project.visibleDepartmentId ?? null)
      : null,
    includeChildDepartments: input.project.includeChildDepartments ?? true,
    visibilityPolicy: VISIBILITY_POLICY.LOGGED_IN_USERS,
    createdById: input.actor.id
  }).returning();

  await writeAuditLog({
    db: input.db,
    request: input.request,
    actor: input.actor,
    projectId: created!.id,
    action: AUDIT_ACTIONS.PROJECT_CREATED,
    targetType: "project",
    targetId: created!.id,
    afterJson: created
  });

  return created!;
}

export async function deleteProjectInTransaction(input: {
  db: DbExecutor;
  request: FastifyRequest;
  actor: AuthUser;
  project: typeof projects.$inferSelect;
}) {
  await input.db.update(projects).set({ deletedAt: new Date(), status: "deleted", updatedAt: new Date() })
    .where(eq(projects.id, input.project.id));
  await writeAuditLog({
    db: input.db,
    request: input.request,
    actor: input.actor,
    projectId: input.project.id,
    action: AUDIT_ACTIONS.PROJECT_DELETED,
    targetType: "project",
    targetId: input.project.id,
    beforeJson: input.project
  });
}
