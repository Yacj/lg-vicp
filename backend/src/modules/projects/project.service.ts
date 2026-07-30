import type { FastifyRequest } from "fastify";
import type { DbExecutor } from "../../db/client.js";
import { projects } from "../../db/schema.js";
import { AUDIT_ACTIONS, PROJECT_VISIBILITY, VISIBILITY_POLICY } from "../../shared/constants.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

export type CreateProjectInput = {
  name: string;
  description?: string;
  visibility: typeof PROJECT_VISIBILITY[keyof typeof PROJECT_VISIBILITY];
};

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