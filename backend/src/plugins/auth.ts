import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { users, userDepartments } from "../db/schema.js";
import { AUTH_CLIENTS } from "../shared/constants.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";
import { getPermissionCodes, getRoleScopes } from "../modules/menus/menu.service.js";
import { resolveAccessibleUserIds } from "../shared/project-access.js";
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
        channelType: users.channelType,
        adminLoginEnabled: users.adminLoginEnabled
      }).from(users).where(and(
        eq(users.id, payload.sub),
        eq(users.status, "ACTIVE"),
        isNull(users.deletedAt)
      )).limit(1);

      if (!user) {
        throw new UnauthorizedError("账号不存在或已被禁用");
      }

      const baseUser = {
        id: user.id,
        role: user.role,
        channelType: user.channelType,
        adminLoginEnabled: user.adminLoginEnabled,
        clientType
      };
      const [permissionCodes, roleScopes, departments] = await Promise.all([
        getPermissionCodes(app, baseUser),
        getRoleScopes(app, baseUser),
        app.db.select({ departmentId: userDepartments.departmentId }).from(userDepartments).where(eq(userDepartments.userId, user.id)),
      ]);
      const accessibleUserIds = await resolveAccessibleUserIds(app, {
        ...baseUser,
        departmentIds: departments.map(row => row.departmentId)
      }, roleScopes);
      request.currentUser = {
        ...baseUser,
        permissionCodes: [...permissionCodes],
        dataScope: roleScopes[0]?.dataScope ?? "SELF",
        departmentIds: departments.map(row => row.departmentId),
        accessibleUserIds
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
