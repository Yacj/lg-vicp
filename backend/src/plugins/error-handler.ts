import fp from "fastify-plugin";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError, ConflictError } from "../shared/errors.js";
import { uniqueViolationMessage } from "../shared/database-errors.js";
import { fail } from "../shared/response.js";

function sendBusinessError(reply: FastifyReply, requestId: string, statusCode: number, message: string, details?: unknown) {
  return reply.status(200).send(fail(requestId, statusCode, message, details));
}

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendBusinessError(reply, request.id, error.statusCode, error.message, error.details);
    }

    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => issue.message).join("；");
      return sendBusinessError(reply, request.id, 400, message);
    }

    const validationError = error as { validation?: unknown[] };
    if (validationError.validation) {
      return sendBusinessError(reply, request.id, 400, "请求参数格式不正确，请检查后重试");
    }

    const databaseError = error as { code?: string };
    if (databaseError.code === "23505") {
      const message = uniqueViolationMessage(error);
      const conflict = new ConflictError(message);
      return sendBusinessError(reply, request.id, conflict.statusCode, conflict.message);
    }
    if (databaseError.code === "23503") {
      return sendBusinessError(reply, request.id, 400, "关联的数据不存在或已失效");
    }

    const requestError = error as { statusCode?: number; message?: string };
    const statusCode =
      requestError.statusCode && requestError.statusCode >= 400 ? requestError.statusCode : 500;
    const message = statusCode >= 500 ? "服务器内部错误" : requestError.message ?? "请求处理失败";

    if (statusCode >= 500) {
      request.log.error({ err: error }, "请求处理失败");
      return reply.status(statusCode).send(fail(request.id, statusCode, message));
    }

    return sendBusinessError(reply, request.id, statusCode, message);
  });
});
