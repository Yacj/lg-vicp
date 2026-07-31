import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { refreshTokens, users } from "../../db/schema.js";
import { env } from "../../config/env.js";
import { UnauthorizedError } from "../../shared/errors.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import type { AuthClient } from "../../shared/auth-user.js";

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

export function signAccessToken(app: FastifyInstance, userId: string, clientType: AuthClient = AUTH_CLIENTS.B_ADMIN, jti = randomUUID()): string {
  return app.jwt.sign(
    { sub: userId, tokenType: "access", clientType, jti },
    { expiresIn: getAccessTokenExpiresIn(clientType) }
  );
}

export async function issueTokenPair(
  app: FastifyInstance,
  request: FastifyRequest,
  userId: string,
  clientType: AuthClient = AUTH_CLIENTS.B_ADMIN,
  db: DbExecutor = app.db
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
    accessToken: signAccessToken(app, userId, clientType, accessJti),
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

    const [user] = await tx.select({ id: users.id, role: users.role }).from(users).where(and(
      eq(users.id, stored.userId),
      eq(users.status, "ACTIVE"),
      isNull(users.deletedAt)
    )).limit(1);

    if (!user) {
      throw new UnauthorizedError("账号不可用，请重新登录");
    }

    const clientType = user.role === "NORMAL_USER" && stored.clientType === AUTH_CLIENTS.B_ADMIN
      ? AUTH_CLIENTS.C_APP
      : stored.clientType;
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

    await tx.update(refreshTokens).set({
      revokedAt: new Date(),
      replacedByTokenId: next!.id
    }).where(eq(refreshTokens.id, stored.id));

    return {
      accessToken: signAccessToken(app, user.id, clientType, accessJti),
      refreshToken: nextToken,
      refreshTokenExpiresAt: nextExpiresAt,
      clientType
    };
  });
}
