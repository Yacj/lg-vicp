import type { FastifyRequest } from "fastify";
import type { AuthUser } from "./auth-user.js";
import { UnauthorizedError } from "./errors.js";

export function getCurrentUser(request: FastifyRequest): AuthUser {
  if (!request.currentUser) {
    throw new UnauthorizedError();
  }

  return request.currentUser;
}
