export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "你没有权限执行此操作") {
    super("FORBIDDEN", message, 403);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "请先登录") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "请求的资源不存在") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "当前数据状态冲突") {
    super("CONFLICT", message, 409);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "服务暂时不可用，请稍后重试") {
    super("SERVICE_UNAVAILABLE", message, 503);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "请求过于频繁，请稍后重试") {
    super("TOO_MANY_REQUESTS", message, 429);
  }
}
