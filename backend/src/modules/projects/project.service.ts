import { and, count, desc, eq, ilike, isNull, or } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { DbExecutor } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { getPagination } from "../../shared/pagination.js";
import { AUDIT_ACTIONS, PROJECT_VISIBILITY, VISIBILITY_POLICY } from "../../shared/constants.js";
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