import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { userAppAccess } from "../../db/schema.js";
import { AuthError } from "../../shared/auth-errors.js";
import type { AppAccessStatus, AppCode, AppRole, AuthClient, TokenAudience, UserAppAccessPublic } from "../../shared/auth-user.js";
import { APP_ACCESS_STATUSES, APP_CODES, APP_ROLES, AUTH_CLIENTS, TOKEN_AUDIENCES, USER_ROLES } from "../../shared/constants.js";
import { isUniqueViolation } from "../../shared/database-errors.js";
import { ForbiddenError } from "../../shared/errors.js";

export type UserAppAccessRow = {
  id: string;
  userId: string;
  app: AppCode;
  role: AppRole;
  status: AppAccessStatus;
};

export type AppAccessGateResult = UserAppAccessRow & { created: boolean };

const ADMIN_LOGIN_DENIED = "普通用户不能登录管理后台";
const CLIENT_LOGIN_DENIED = "当前账号不能登录，请联系管理员";

export function appCodeForClient(clientType: AuthClient): AppCode {
  return clientType === AUTH_CLIENTS.B_ADMIN ? APP_CODES.ADMIN : APP_CODES.CLIENT;
}

export function tokenAudienceForClient(clientType: AuthClient): TokenAudience {
  return clientType === AUTH_CLIENTS.B_ADMIN ? TOKEN_AUDIENCES.ADMIN : TOKEN_AUDIENCES.CLIENT;
}

export function appRoleForClient(clientType: AuthClient): AppRole {
  return clientType === AUTH_CLIENTS.B_ADMIN ? APP_ROLES.SUPER_ADMIN : APP_ROLES.NORMAL_USER;
}

export function shouldAutoProvisionClient(clientType: AuthClient): boolean {
  return clientType === AUTH_CLIENTS.C_APP || clientType === AUTH_CLIENTS.PC_AI;
}

export type LoginAccessDecision =
  | { action: "ALLOW"; access: { app: AppCode; role: AppRole; status: AppAccessStatus } }
  | { action: "USER_DISABLED" }
  | { action: "APP_ACCESS_DISABLED" }
  | { action: "AUTO_PROVISION_CLIENT" }
  | { action: "DENY_ADMIN" };

export function decideLoginAccess(input: {
  userStatus: "ACTIVE" | "DISABLED";
  clientType: AuthClient;
  existing: { app: AppCode; role: AppRole; status: AppAccessStatus } | null;
}): LoginAccessDecision {
  if (input.userStatus !== "ACTIVE") return { action: "USER_DISABLED" };
  const app = appCodeForClient(input.clientType);
  if (input.existing) {
    if (input.existing.status !== APP_ACCESS_STATUSES.ACTIVE) return { action: "APP_ACCESS_DISABLED" };
    return { action: "ALLOW", access: input.existing };
  }
  if (shouldAutoProvisionClient(input.clientType) && app === APP_CODES.CLIENT) {
    return { action: "AUTO_PROVISION_CLIENT" };
  }
  return { action: "DENY_ADMIN" };
}

/** 历史 users.role 迁移到 user_app_access。SUPER_ADMIN 默认只开 ADMIN。 */
export function migrationAccessRowsForRole(role: string): Array<{ app: AppCode; role: AppRole }> {
  if (role === USER_ROLES.SUPER_ADMIN) {
    return [{ app: APP_CODES.ADMIN, role: APP_ROLES.SUPER_ADMIN }];
  }
  if (role === USER_ROLES.NORMAL_USER || role === USER_ROLES.CHANNEL_USER) {
    return [{ app: APP_CODES.CLIENT, role: APP_ROLES.NORMAL_USER }];
  }
  return [];
}

export function initialAccessForProvision(source: "ADMIN_CREATE" | "CLIENT_REGISTER"): Array<{ app: AppCode; role: AppRole }> {
  if (source === "ADMIN_CREATE") {
    return [{ app: APP_CODES.ADMIN, role: APP_ROLES.SUPER_ADMIN }];
  }
  return [{ app: APP_CODES.CLIENT, role: APP_ROLES.NORMAL_USER }];
}

export function serializeAppAccess(rows: Array<{ app: AppCode; role: AppRole; status: AppAccessStatus }>): UserAppAccessPublic[] {
  return rows.map((row) => ({ app: row.app, role: row.role, status: row.status }));
}

export function buildAccessTokenClaims(input: {
  userId: string;
  clientType: AuthClient;
  jti: string;
  role?: AppRole;
}) {
  const audience = tokenAudienceForClient(input.clientType);
  return {
    sub: input.userId,
    tokenType: "access" as const,
    clientType: input.clientType,
    aud: audience,
    role: input.role ?? appRoleForClient(input.clientType),
    jti: input.jti
  };
}

export function resolvePayloadAudience(aud: unknown, clientType: AuthClient): TokenAudience {
  const value = Array.isArray(aud) ? aud[0] : aud;
  const expected = tokenAudienceForClient(clientType);
  if (value === undefined || value === null || value === "") {
    return expected;
  }
  if (value !== TOKEN_AUDIENCES.ADMIN && value !== TOKEN_AUDIENCES.CLIENT) {
    throw new ForbiddenError("令牌端不匹配，请重新登录");
  }
  if (value !== expected) {
    throw new ForbiddenError("令牌端不匹配，请重新登录");
  }
  return value;
}

export function assertRouteAudience(routePath: string, audience: TokenAudience, clientType: AuthClient): void {
  const path = routePath.split("?")[0] ?? "";
  const isPlatform = path.startsWith("/api/v1/platform") || path.startsWith("/api/v1/workspace");
  const isClientApi = path.startsWith("/api/v1/client");
  if (isPlatform) {
    if (clientType !== AUTH_CLIENTS.B_ADMIN || audience !== TOKEN_AUDIENCES.ADMIN) {
      throw new ForbiddenError("当前登录端无权访问后台接口");
    }
  }
  if (isClientApi) {
    if (clientType === AUTH_CLIENTS.B_ADMIN || audience !== TOKEN_AUDIENCES.CLIENT) {
      throw new ForbiddenError("当前登录端无权访问客户端接口");
    }
  }
}

export async function findAppAccess(db: DbExecutor, userId: string, app: AppCode): Promise<UserAppAccessRow | null> {
  const [row] = await db.select({
    id: userAppAccess.id,
    userId: userAppAccess.userId,
    app: userAppAccess.app,
    role: userAppAccess.role,
    status: userAppAccess.status
  }).from(userAppAccess).where(and(
    eq(userAppAccess.userId, userId),
    eq(userAppAccess.app, app)
  )).limit(1);
  return row ?? null;
}

export async function listAppAccessForUser(db: DbExecutor, userId: string): Promise<UserAppAccessRow[]> {
  return db.select({
    id: userAppAccess.id,
    userId: userAppAccess.userId,
    app: userAppAccess.app,
    role: userAppAccess.role,
    status: userAppAccess.status
  }).from(userAppAccess).where(eq(userAppAccess.userId, userId));
}

export async function listAppAccessByUserIds(db: DbExecutor, userIds: string[]): Promise<Map<string, UserAppAccessPublic[]>> {
  const map = new Map<string, UserAppAccessPublic[]>();
  if (userIds.length === 0) return map;
  const rows = await db.select({
    userId: userAppAccess.userId,
    app: userAppAccess.app,
    role: userAppAccess.role,
    status: userAppAccess.status
  }).from(userAppAccess).where(inArray(userAppAccess.userId, userIds));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push({ app: row.app, role: row.role, status: row.status });
    map.set(row.userId, list);
  }
  return map;
}

export async function ensureAppAccess(
  db: DbExecutor,
  input: { userId: string; app: AppCode; role: AppRole }
): Promise<{ access: UserAppAccessRow; created: boolean }> {
  const existing = await findAppAccess(db, input.userId, input.app);
  if (existing) return { access: existing, created: false };

  try {
    const [inserted] = await db.insert(userAppAccess).values({
      userId: input.userId,
      app: input.app,
      role: input.role,
      status: APP_ACCESS_STATUSES.ACTIVE
    }).onConflictDoNothing({
      target: [userAppAccess.userId, userAppAccess.app]
    }).returning({
      id: userAppAccess.id,
      userId: userAppAccess.userId,
      app: userAppAccess.app,
      role: userAppAccess.role,
      status: userAppAccess.status
    });
    if (inserted) return { access: inserted, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }

  const retried = await findAppAccess(db, input.userId, input.app);
  if (!retried) throw new AuthError("WECHAT_API_ERROR", "开通端访问失败，请稍后重试");
  return { access: retried, created: false };
}

export async function ensureAdminAppAccess(db: DbExecutor, userId: string) {
  return ensureAppAccess(db, { userId, app: APP_CODES.ADMIN, role: APP_ROLES.SUPER_ADMIN });
}

export async function ensureClientAppAccess(db: DbExecutor, userId: string) {
  return ensureAppAccess(db, { userId, app: APP_CODES.CLIENT, role: APP_ROLES.NORMAL_USER });
}

/**
 * 登录闸门：用户级禁用优先；再校验对应端 access。
 * C / PC AI 端若尚无 CLIENT 行则自动开通 NORMAL_USER，不新建第二个 User。
 * B 端缺少 ADMIN 行时拒绝，不自动开通。
 */
export async function requireAppAccessForLogin(
  db: DbExecutor,
  input: {
    userId: string;
    userStatus: "ACTIVE" | "DISABLED";
    clientType: AuthClient;
  }
): Promise<AppAccessGateResult> {
  if (input.userStatus !== "ACTIVE") {
    throw new AuthError("USER_DISABLED");
  }

  const app = appCodeForClient(input.clientType);
  const existing = await findAppAccess(db, input.userId, app);
  const decision = decideLoginAccess({
    userStatus: input.userStatus,
    clientType: input.clientType,
    existing
  });
  if (decision.action === "USER_DISABLED") throw new AuthError("USER_DISABLED");
  if (decision.action === "APP_ACCESS_DISABLED") throw new AuthError("APP_ACCESS_DISABLED");
  if (decision.action === "DENY_ADMIN") {
    throw new ForbiddenError(app === APP_CODES.ADMIN ? ADMIN_LOGIN_DENIED : CLIENT_LOGIN_DENIED);
  }
  if (decision.action === "ALLOW") {
    return { ...existing!, created: false };
  }

  const { access, created } = await ensureClientAppAccess(db, input.userId);
  if (access.status !== APP_ACCESS_STATUSES.ACTIVE) {
    throw new AuthError("APP_ACCESS_DISABLED");
  }
  return { ...access, created };
}
