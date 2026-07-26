import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { permissions, rolePermissions, roles, userRoles, users } from "../db/schema.js";
import { AUTH_CLIENTS } from "../shared/constants.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";
import type { AuthClient } from "../shared/auth-user.js";

interface JwtPayload {
  sub: string;
  tokenType: "access";
  clientType?: AuthClient;
  jti?: string;
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, {
    secret: env.JWT_SECRET
  });

  app.decorate("authenticate", async (request) => {
    try {
      const payload = await request.jwtVerify<JwtPayload>();
      if (payload.tokenType !== "access") {
        throw new UnauthorizedError("令牌类型不正确");
      }

      const clientType = payload.clientType ?? AUTH_CLIENTS.B_ADMIN;
      if (payload.jti && await app.redis.exists(`auth:access:blacklist:${payload.jti}`)) {
        throw new UnauthorizedError("访问令牌已失效，请重新登录");
      }
      const [user] = await app.db.select({
        id: users.id,
        role: users.role,
        channelType: users.channelType
      }).from(users).where(and(
        eq(users.id, payload.sub),
        eq(users.status, "ACTIVE"),
        isNull(users.deletedAt)
      )).limit(1);

      if (!user) {
        throw new UnauthorizedError("账号不存在或已被禁用");
      }

      const permissionRows = user.role === "SUPER_ADMIN" ? [] : await app.db.select({ code: permissions.code }).from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));
      request.currentUser = {
        id: user.id,
        role: user.role,
        channelType: user.channelType,
        clientType,
        permissionCodes: permissionRows.map((row) => row.code)
      };
      const routePath = (request.url ?? "").split("?")[0] ?? "";
      if ((routePath.startsWith("/api/v1/platform") || routePath.startsWith("/api/v1/workspace")) && clientType !== AUTH_CLIENTS.B_ADMIN) {
        throw new ForbiddenError("当前登录端无权访问后台接口");
      }
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
        throw error;
      }
      throw new UnauthorizedError("登录状态无效或已过期");
    }
  });
});
