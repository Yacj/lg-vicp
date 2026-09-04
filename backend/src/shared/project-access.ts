import { and, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { departments, userDepartments, users } from "../db/schema.js";
import type { AuthUser } from "./auth-user.js";
import { resolveDataScope, type ResolvedDataScope } from "./data-scope.js";

export type RoleScope = { dataScope: string; departmentIds?: string[] };
type ScopedActor = Pick<AuthUser, "id" | "role" | "channelId" | "departmentIds">;
type ActiveUserNode = {
  id: string;
  role: string;
  channelId: string | null;
  parentChannelId: string | null;
};

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

function addChannelUsers(
  userIds: Set<string>,
  actor: ScopedActor,
  scope: ResolvedDataScope,
  activeUsers: readonly ActiveUserNode[]
) {
  if (scope !== "CHANNEL" && scope !== "CHANNEL_AND_CHILDREN") return;

  // 渠道树只使用渠道账号自身的 users.id 与 parentChannelId。
  // channelId 表示账号所属渠道，仅用于把普通客户挂入渠道树。
  const channelIds = new Set<string>();
  if (actor.role === "CHANNEL_USER") channelIds.add(actor.id);
  else if (actor.channelId) channelIds.add(actor.channelId);
  if (channelIds.size === 0) return;

  if (scope === "CHANNEL_AND_CHILDREN") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const user of activeUsers) {
        if (user.role === "CHANNEL_USER" && user.parentChannelId && channelIds.has(user.parentChannelId) && !channelIds.has(user.id)) {
          channelIds.add(user.id);
          changed = true;
        }
      }
    }
  }

  for (const user of activeUsers) {
    if (user.role === "CHANNEL_USER" ? channelIds.has(user.id) : Boolean(user.channelId && channelIds.has(user.channelId))) {
      userIds.add(user.id);
    }
  }
}

/**
 * 解析当前账号可访问的登录账号 ID 集合。
 * null 表示 ALL，全量账号；数组包含渠道账号和渠道归属的普通客户账号。
 */
export async function resolveAccessibleUserIds(
  app: FastifyInstance,
  actor: ScopedActor,
  roleScopes: RoleScope[]
): Promise<string[] | null> {
  const effectiveScopes = roleScopes.length > 0 ? roleScopes : [{ dataScope: "SELF" }];
  const scopes = effectiveScopes.map((scope) => resolveDataScope({ role: actor.role, dataScope: scope.dataScope }));
  if (scopes.includes("ALL")) return null;

  const activeUsers = await app.db.select({
    id: users.id,
    role: users.role,
    channelId: users.channelId,
    parentChannelId: users.parentChannelId
  }).from(users).where(and(eq(users.status, "ACTIVE"), isNull(users.deletedAt)));
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
      continue;
    }
    addChannelUsers(userIds, actor, scope, activeUsers);
  }

  return [...userIds];
}
