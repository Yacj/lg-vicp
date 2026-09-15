import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { DbExecutor } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { getPagination } from "../../shared/pagination.js";
import { AUDIT_ACTIONS, PROJECT_VISIBILITY, USER_ROLES, VISIBILITY_POLICY } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

export type CreateProjectInput = {
  name: string;
  description?: string;
  region?: string;
  buildingType?: string;
  visibility: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
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

export async function listCreatedProjects(input: CreatedProjectListInput) {
  const { skip, take } = getPagination(input.page, input.pageSize);
  const normalizedKeyword = input.keyword?.trim();
  const keywordPattern = normalizedKeyword ? `%${escapeLikePattern(normalizedKeyword)}%` : undefined;
  const where = and(
    eq(projects.createdById, input.ownerUserId),
    isNull(projects.deletedAt),
    input.visibility ? eq(projects.visibility, input.visibility) : undefined,
    keywordPattern
      ? or(
          ilike(projects.name, keywordPattern),
          ilike(projects.region, keywordPattern),
          ilike(projects.buildingType, keywordPattern)
        )
      : undefined
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

/** 平台列表按最终业务口径返回公开项目；渠道账号可额外查看自己创建的私有项目。 */
export function platformProjectScopeWhere(user: Pick<AuthUser, "id" | "role">) {
  if (user.role === USER_ROLES.SUPER_ADMIN) return undefined;
  if (user.role === USER_ROLES.CHANNEL_USER) {
    return or(eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC), eq(projects.createdById, user.id));
  }
  return eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC);
}

export type ProjectStatistics = {
  total: number;
  public: number;
  private: number;
};

/** 当前账号可见项目的计数；不依赖 system:project:list，数据范围由业务角色约束。 */
export async function getVisibleProjectStatistics(input: {
  db: DbExecutor;
  user: Pick<AuthUser, "id" | "role">;
}): Promise<ProjectStatistics> {
  const activeWhere = and(
    isNull(projects.deletedAt),
    platformProjectScopeWhere(input.user)
  );
  const [totalRow, publicRow, privateRow] = await Promise.all([
    input.db.select({ value: count() }).from(projects).where(activeWhere),
    input.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PUBLIC))),
    input.db.select({ value: count() }).from(projects).where(and(activeWhere, eq(projects.visibility, PROJECT_VISIBILITY.PRIVATE)))
  ]);
  return {
    total: totalRow[0]?.value ?? 0,
    public: publicRow[0]?.value ?? 0,
    private: privateRow[0]?.value ?? 0
  };
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
}) {
  const [updated] = await input.db.update(projects)
    .set({ visibility: input.visibility, updatedAt: new Date() })
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
    beforeJson: { visibility: input.project.visibility },
    afterJson: { visibility: updated!.visibility }
  });

  return updated!;
}

export async function createProjectInTransaction(input: {
  db: DbExecutor;
  request: FastifyRequest;
  actor: AuthUser;
  project: CreateProjectInput;
}) {
  const [created] = await input.db.insert(projects).values({
    ...input.project,
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