import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../config/env.js";
import { departments, users, userDepartments } from "../db/schema.js";
import { APP_CODES, APP_ROLES, AUTH_CLIENTS, USER_ROLES } from "../shared/constants.js";
import { ForbiddenError, UnauthorizedError } from "../shared/errors.js";
import { AuthError } from "../shared/auth-errors.js";
import { getPermissionCodes, getRoleScopes } from "../modules/menus/menu.service.js";
import { resolveAccessibleUserIds } from "../shared/project-access.js";
import { buildDepartmentAncestorMap, departmentScopeIds } from "../shared/department-tree.js";
import type { AuthClient, TokenAudience } from "../shared/auth-user.js";
import {
  appCodeForClient,
  assertRouteAudience,
  findAppAccess,
  requireAppAccessForLogin,
  resolvePayloadAudience
} from "../modules/auth/user-app-access.service.js";

interface JwtPayload {
  sub: string;
  tokenType: "access";
  clientType?: AuthClient;
  aud?: TokenAudience | TokenAudience[];
  role?: string;
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
      const audience = resolvePayloadAudience(payload.aud, clientType);
      if (payload.jti && await app.redis.exists(`auth:access:blacklist:${payload.jti}`)) {
        throw new UnauthorizedError("访问令牌已失效，请重新登录");
      }
      const [user] = await app.db.select({
        id: users.id,
        role: users.role,
        channelType: users.channelType,
        adminLoginEnabled: users.adminLoginEnabled,
        status: users.status
      }).from(users).where(and(
        eq(users.id, payload.sub),
        isNull(users.deletedAt)
      )).limit(1);

      if (!user) {
        throw new UnauthorizedError("账号不存在或已被禁用");
      }
      if (user.status !== "ACTIVE") {
        throw new AuthError("USER_DISABLED");
      }

      const appCode = appCodeForClient(clientType);
      let access = await findAppAccess(app.db, user.id, appCode);
      if (access && access.status !== "ACTIVE") {
        throw new AuthError("APP_ACCESS_DISABLED");
      }
      if (!access && clientType !== AUTH_CLIENTS.B_ADMIN) {
        access = await requireAppAccessForLogin(app.db, {
          userId: user.id,
          userStatus: user.status,
          clientType
        });
      }
      if (!access || access.status !== "ACTIVE") {
        throw new AuthError("APP_ACCESS_DISABLED");
      }

      const accessRole = access.role === APP_ROLES.SUPER_ADMIN ? USER_ROLES.SUPER_ADMIN : USER_ROLES.NORMAL_USER;
      const clientSession = access.app === APP_CODES.CLIENT;
      const baseUser = {
        id: user.id,
        role: accessRole,
        channelType: clientSession ? null : user.channelType,
        adminLoginEnabled: access.app === APP_CODES.ADMIN && user.adminLoginEnabled,
        clientType,
        audience,
        app: access.app
      };
      const accessOptions = clientSession ? { ignoreAssignedRoles: true as const } : undefined;
      const [permissionCodes, roleScopes, memberships, departmentRows] = await Promise.all([
        getPermissionCodes(app, baseUser, accessOptions),
        getRoleScopes(app, baseUser, accessOptions),
        app.db.select({ departmentId: userDepartments.departmentId }).from(userDepartments).where(eq(userDepartments.userId, user.id)),
        app.db.select({ id: departments.id, parentId: departments.parentId }).from(departments)
      ]);
      const departmentIds = memberships.map((row) => row.departmentId);
      const scopeIds = departmentScopeIds(departmentIds, buildDepartmentAncestorMap(departmentRows));
      const accessibleUserIds = await resolveAccessibleUserIds(app, {
        ...baseUser,
        departmentIds
      }, roleScopes);
      request.currentUser = {
        ...baseUser,
        permissionCodes: [...permissionCodes],
        dataScope: roleScopes[0]?.dataScope ?? "SELF",
        departmentIds,
        departmentScopeIds: scopeIds,
        accessibleUserIds
      };
      const routePath = (request.url ?? "").split("?")[0] ?? "";
      assertRouteAudience(routePath, audience, clientType);
      if (routePath.startsWith("/api/v1/platform") || routePath.startsWith("/api/v1/workspace")) {
        if (access.app !== APP_CODES.ADMIN || access.role !== APP_ROLES.SUPER_ADMIN) {
          throw new ForbiddenError("当前仅超级管理员可访问后台接口");
        }
      }
    } catch (error) {
      if (error instanceof UnauthorizedError || error instanceof ForbiddenError || error instanceof AuthError) {
        throw error;
      }
      throw new UnauthorizedError("登录状态无效或已过期");
    }
  });
});
