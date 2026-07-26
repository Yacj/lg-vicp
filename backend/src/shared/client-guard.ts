import type { FastifyReply, FastifyRequest } from "fastify";
import { AUTH_CLIENTS } from "./constants.js";
import type { AuthClient } from "./auth-user.js";
import { getCurrentUser } from "./current-user.js";
import { ForbiddenError } from "./errors.js";

export function assertClient(request: FastifyRequest, allowed: readonly AuthClient[]) {
  const user = getCurrentUser(request);
  if (!allowed.includes(user.clientType)) {
    throw new ForbiddenError("当前登录端无权访问此接口");
  }
}

export function requireClient(...allowed: AuthClient[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    assertClient(request, allowed);
  };
}

export function isPlatformClient(clientType: AuthClient) {
  return clientType === AUTH_CLIENTS.B_ADMIN;
}
