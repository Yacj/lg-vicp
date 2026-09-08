import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { departments, userDepartments, users } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { resolveDataScope } from "./data-scope.js";

export type RoleScope = { dataScope: string; departmentIds?: string[] };
type ScopedActor = Pick<AuthUser, "id" | "role" | "departmentIds">;

async function expandDepartmentIds(app: FastifyInstance, roots: readonly string[], descendants: boolean) {
  const result = new Set(roots);
  if (!descendants || result.size === 0) return [...result];
  const rows = await app.db.select({ id: departments.id, parentId: departments.parentId })
    .from(departments)
    .where(isNull(departments.deletedAt));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.parentId && result.has(row.parentId) && !result.has(row.id)) {
        result.add(row.id);
        changed = true;
      }
    }
  }
  return [...result];
}

/** 解析当前账号可访问的登录账号 ID 集合；null 表示全量账号。 */
export async function resolveAccessibleUserIds(
  app: FastifyInstance,
  actor: ScopedActor,
  roleScopes: RoleScope[]
): Promise<string[] | null> {
  const effectiveScopes = roleScopes.length > 0 ? roleScopes : [{ dataScope: "SELF" }];
  const scopes = effectiveScopes.map((scope) => resolveDataScope({ role: actor.role, dataScope: scope.dataScope }));
  if (scopes.includes("ALL")) return null;

  const activeUsers = await app.db.select({ id: users.id }).from(users)
    .where(and(eq(users.status, "ACTIVE"), isNull(users.deletedAt)));
  const activeUserIds = new Set(activeUsers.map((user) => user.id));
  const userIds = new Set<string>([actor.id]);

  const addDepartmentUsers = async (departmentIds: readonly string[], descendants: boolean) => {
    const expandedIds = await expandDepartmentIds(app, departmentIds, descendants);
    if (expandedIds.length === 0) return;
    const rows = await app.db.select({ userId: userDepartments.userId }).from(userDepartments)
      .where(inArray(userDepartments.departmentId, expandedIds));
    for (const row of rows) {
      if (activeUserIds.has(row.userId)) userIds.add(row.userId);
    }
  };

  for (const [index, scope] of scopes.entries()) {
    if (scope === "SELF" || scope === "PROJECT_OWNER") continue;
    if (scope === "CUSTOM") {
      await addDepartmentUsers(effectiveScopes[index]?.departmentIds ?? [], false);
      continue;
    }
    if (scope === "DEPT" || scope === "DEPT_AND_CHILDREN") {
      await addDepartmentUsers(actor.departmentIds ?? [], scope === "DEPT_AND_CHILDREN");
    }
  }

  return [...userIds];
}
