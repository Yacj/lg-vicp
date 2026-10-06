import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { refreshTokens, users } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { ForbiddenError, UnauthorizedError } from "../../shared/errors.js";
import { AUTH_CLIENTS, USER_ROLES } from "../../shared/constants.js";
import type { AppRole, AuthClient, UserRole } from "../../shared/auth-user.js";
import {
  appRoleForClient,
  buildAccessTokenClaims,
  requireAppAccessForLogin
} from "./user-app-access.service.js";

export type AccountClientGate = {
  role: string;
  adminLoginEnabled?: boolean;
};

const CLIENT_ACCESS_DENIED = "当前账号不能登录，请联系管理员";

/**
 * 兼容映射：无 user_app_access 行时按 users.role + 端推断有效身份。
 * 正式登录与鉴权优先读 user_app_access。
 */
export function resolveClientAccessRole(accountRole: string, clientType: AuthClient): UserRole {
  if (clientType === AUTH_CLIENTS.B_ADMIN) {
    if (accountRole !== USER_ROLES.SUPER_ADMIN) {
      throw new ForbiddenError(accountRole === USER_ROLES.CHANNEL_USER ? CLIENT_ACCESS_DENIED : "普通用户不能登录管理后台");
    }
    return USER_ROLES.SUPER_ADMIN;
  }
  if (accountRole !== USER_ROLES.NORMAL_USER && accountRole !== USER_ROLES.SUPER_ADMIN && accountRole !== USER_ROLES.CHANNEL_USER) {
    throw new ForbiddenError(CLIENT_ACCESS_DENIED);
  }
  return USER_ROLES.NORMAL_USER;
}

export function assertAccountCanUseClient(account: AccountClientGate, clientType: AuthClient): void {
  resolveClientAccessRole(account.role, clientType);
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createOpaqueRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function getAccessTokenExpiresIn(clientType: AuthClient): string {
  switch (clientType) {
    case AUTH_CLIENTS.B_ADMIN:
      return env.JWT_B_ACCESS_EXPIRES_IN;
    case AUTH_CLIENTS.C_APP:
      return env.JWT_C_ACCESS_EXPIRES_IN;
    case AUTH_CLIENTS.PC_AI:
      return env.JWT_PC_AI_ACCESS_EXPIRES_IN;
  }
}

export function signAccessToken(
  app: FastifyInstance,
  userId: string,
  clientType: AuthClient = AUTH_CLIENTS.B_ADMIN,
  jti = randomUUID(),
  role: AppRole = appRoleForClient(clientType)
): string {
  return app.jwt.sign(
    buildAccessTokenClaims({ userId, clientType, jti, role }),
    { expiresIn: getAccessTokenExpiresIn(clientType) }
  );
}

export async function issueTokenPair(
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  clientType: AuthClient = AUTH_CLIENTS.B_ADMIN,
  db: DbExecutor = app.db,
  role: AppRole = appRoleForClient(clientType)
) {
  const refreshToken = createOpaqueRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const accessJti = randomUUID();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [record] = await db.insert(refreshTokens).values({
    userId,
    clientType,
    accessJti,
    tokenHash: refreshTokenHash,
    expiresAt,
    ip: request.ip,
    userAgent: request.headers["user-agent"]
  }).returning({ id: refreshTokens.id });

  return {
    accessToken: signAccessToken(app, userId, clientType, accessJti, role),
    refreshToken,
    refreshTokenId: record!.id,
    refreshTokenExpiresAt: expiresAt
  };
}

export async function rotateRefreshToken(app: FastifyInstance, request: FastifyRequest, token: string) {
  const tokenHash = hashRefreshToken(token);

  return app.db.transaction(async (tx) => {
    const [stored] = await tx.select().from(refreshTokens).where(and(
      eq(refreshTokens.tokenHash, tokenHash),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date())
    )).limit(1);

    if (!stored) {
      throw new UnauthorizedError("刷新令牌无效或已过期");
    }

    const [user] = await tx.select({ id: users.id, role: users.role, adminLoginEnabled: users.adminLoginEnabled, status: users.status }).from(users).where(and(
      eq(users.id, stored.userId),
      isNull(users.deletedAt)
    )).limit(1);

    if (!user) {
      throw new UnauthorizedError("账号不可用，请重新登录");
    }

    const access = await requireAppAccessForLogin(tx, {
      userId: user.id,
      userStatus: user.status,
      clientType: stored.clientType
    });
    const clientType = stored.clientType;
    const nextToken = createOpaqueRefreshToken();
    const accessJti = randomUUID();
    const nextExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const [next] = await tx.insert(refreshTokens).values({
      userId: user.id,
      clientType,
      accessJti,
      tokenHash: hashRefreshToken(nextToken),
      expiresAt: nextExpiresAt,
      ip: request.ip,
      userAgent: request.headers["user-agent"]
    }).returning({ id: refreshTokens.id });

    // 条件更新是刷新令牌的单次消费闸门：并发请求中只有一个事务能成功撤销原令牌。
    const [revoked] = await tx.update(refreshTokens).set({
      revokedAt: new Date(),
      replacedByTokenId: next!.id
    }).where(and(
      eq(refreshTokens.id, stored.id),
      isNull(refreshTokens.revokedAt),
      gt(refreshTokens.expiresAt, new Date())
    )).returning({ id: refreshTokens.id });
    if (!revoked) {
      throw new UnauthorizedError("刷新令牌已被使用，请重新登录");
    }

    return {
      accessToken: signAccessToken(app, user.id, clientType, accessJti, access.role),
      refreshToken: nextToken,
      refreshTokenExpiresAt: nextExpiresAt,
      clientType
    };
  });
}
