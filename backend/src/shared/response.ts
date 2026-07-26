import type { FastifyRequest } from "fastify";

export function ok<T>(request: FastifyRequest, data: T) {
  return {
    success: true,
    data,
    requestId: request.id
  };
}

export function fail(requestId: string, code: string, message: string) {
  return {
    success: false,
    error: {
      code,
      message
    },
    requestId
  };
}
