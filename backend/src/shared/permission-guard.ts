import type { FastifyRequest } from "fastify";
import { ForbiddenError } from "./errors.js";
import { getCurrentUser } from "./current-user.js";
import { getPermissionCodes } from "../modules/menus/menu.service.js";

/** 平台接口的按钮级权限守卫。超级管理员拥有全部权限。 */
export function requirePermission(permissionCode: string) {
  return async (request: FastifyRequest) => {
    const user = getCurrentUser(request);
    if (user.role === "SUPER_ADMIN") return;
    const permissions = await getPermissionCodes(request.server, user);
    if (!permissions.has(permissionCode)) {
      throw new ForbiddenError("当前账号没有执行此操作的权限");
    }
  };
}

export async function assertPermission(request: FastifyRequest, permissionCode: string) {
  const user = getCurrentUser(request);
  if (user.role === "SUPER_ADMIN") return user;
  const permissions = await getPermissionCodes(request.server, user);
  if (!permissions.has(permissionCode)) throw new ForbiddenError("当前账号没有执行此操作的权限");
  return user;
}
