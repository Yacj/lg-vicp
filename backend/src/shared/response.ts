import type { FastifyRequest } from "fastify";

export function ok<T>(request: FastifyRequest, data: T) {
  return {
    success: true,
    data,
    requestId: request.id
  };
}

export function fail(requestId: string, code: number, message: string, details?: unknown) {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details })
    },
    requestId
  };
}
