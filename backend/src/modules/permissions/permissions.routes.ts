import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { permissions, rolePermissions, roles, userRoles } from "../../db/schema.js";
import { getCurrentUser } from "../../shared/current-user.js";
import { AUTH_CLIENTS } from "../../shared/constants.js";
import { requireClient } from "../../shared/client-guard.js";
import { ok } from "../../shared/response.js";

export async function permissionRoutes(app: FastifyInstance) {
  app.get("/permissions/me", {
    preHandler: [app.authenticate, requireClient(AUTH_CLIENTS.B_ADMIN)],
    schema: { tags: ["权限"], summary: "获取当前用户权限" }
  }, async (request) => {
    const user = getCurrentUser(request);
    const assigned = await app.db.select({
      roleCode: roles.code,
      permissionCode: permissions.code
    }).from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(userRoles.userId, user.id), eq(roles.enabled, true)));

    return ok(request, {
      user,
      roles: [...new Set(assigned.map((item) => item.roleCode))],
      permissions: [...new Set(assigned.map((item) => item.permissionCode).filter(Boolean))],
      capabilities: {
        canCreateProject: user.role === "SUPER_ADMIN" || user.role === "CHANNEL_USER",
        canReadPublicProjects: true,
        canManagePlatform: user.role === "SUPER_ADMIN"
      }
    });
  });
}
