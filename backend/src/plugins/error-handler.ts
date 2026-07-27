import fp from "fastify-plugin";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../shared/errors.js";
import { fail } from "../shared/response.js";

function sendBusinessError(reply: FastifyReply, requestId: string, code: string, message: string) {
  return reply.status(200).send(fail(requestId, code, message));
}

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return sendBusinessError(reply, request.id, error.code, error.message);
    }

    if (error instanceof ZodError) {
      const message = error.issues.map((issue) => issue.message).join("；");
      return sendBusinessError(reply, request.id, "VALIDATION_ERROR", message);
    }

    const validationError = error as { validation?: unknown[] };
    if (validationError.validation) {
      return sendBusinessError(
        reply,
        request.id,
        "VALIDATION_ERROR",
        "请求参数格式不正确，请检查后重试"
      );
    }

    const databaseError = error as { code?: string };
    if (databaseError.code === "23505") {
      return sendBusinessError(reply, request.id, "CONFLICT", "数据已存在，请勿重复提交");
    }
    if (databaseError.code === "23503") {
      return sendBusinessError(reply, request.id, "REFERENCE_INVALID", "关联的数据不存在或已失效");
    }

    const requestError = error as { statusCode?: number; message?: string };
    const statusCode =
      requestError.statusCode && requestError.statusCode >= 400 ? requestError.statusCode : 500;
    const code = statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR";
    const message = statusCode >= 500 ? "服务器内部错误" : requestError.message ?? "请求处理失败";

    if (statusCode >= 500) {
      request.log.error({ err: error }, "请求处理失败");
      return reply.status(statusCode).send(fail(request.id, code, message));
    }

    return sendBusinessError(reply, request.id, code, message);
  });
});
