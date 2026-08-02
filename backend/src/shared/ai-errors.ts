import { AppError } from "./errors.js";

/**
 * AI 业务统一错误码（稳定字符串，用于 SSE error 事件与消息落库 errorCode）。
 * 日志、审计、用户提示只使用中文友好信息，不暴露内部 URL 与密钥。
 */
export const AI_ERROR_CODES = {
  AI_PROVIDER_UNAVAILABLE: "AI_PROVIDER_UNAVAILABLE",
  AI_MODEL_UNAVAILABLE: "AI_MODEL_UNAVAILABLE",
  AI_MODEL_TIMEOUT: "AI_MODEL_TIMEOUT",
  AI_PROVIDER_RATE_LIMIT: "AI_PROVIDER_RATE_LIMIT",
  AI_CONTENT_REJECTED: "AI_CONTENT_REJECTED",
  AI_CONTEXT_TOO_LONG: "AI_CONTEXT_TOO_LONG",
  AI_STREAM_INTERRUPTED: "AI_STREAM_INTERRUPTED",
  AI_CONFIG_INVALID: "AI_CONFIG_INVALID",
  AI_CONVERSATION_NOT_FOUND: "AI_CONVERSATION_NOT_FOUND",
  AI_CONVERSATION_FORBIDDEN: "AI_CONVERSATION_FORBIDDEN",
  AI_MESSAGE_NOT_FOUND: "AI_MESSAGE_NOT_FOUND",
  AI_GENERATION_NOT_RUNNING: "AI_GENERATION_NOT_RUNNING",
  AI_REASONING_NOT_SUPPORTED: "AI_REASONING_NOT_SUPPORTED",
  AI_QUOTA_EXCEEDED: "AI_QUOTA_EXCEEDED"
} as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[keyof typeof AI_ERROR_CODES];

interface AiErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  retryable: boolean;
  message: string;
}

export const AI_ERROR_SPECS: Record<AiErrorCode, AiErrorSpec> = {
  AI_PROVIDER_UNAVAILABLE: { statusCode: 500, retryable: true, message: "AI 服务商暂时不可用，请稍后重试" },
  AI_MODEL_UNAVAILABLE: { statusCode: 500, retryable: true, message: "AI 模型暂不可用，请稍后重试" },
  AI_MODEL_TIMEOUT: { statusCode: 500, retryable: true, message: "AI 模型响应超时，请稍后重试" },
  AI_PROVIDER_RATE_LIMIT: { statusCode: 429, retryable: true, message: "AI 服务商请求过于频繁，请稍后重试" },
  AI_CONTENT_REJECTED: { statusCode: 400, retryable: false, message: "模型拒绝了当前请求内容，请调整后重试" },
  AI_CONTEXT_TOO_LONG: { statusCode: 400, retryable: false, message: "上下文内容过长，请缩短问题或新建会话" },
  AI_STREAM_INTERRUPTED: { statusCode: 500, retryable: true, message: "AI 回答生成中断，请重试" },
  AI_CONFIG_INVALID: { statusCode: 500, retryable: false, message: "AI 功能配置不完整，请联系管理员" },
  AI_CONVERSATION_NOT_FOUND: { statusCode: 404, retryable: false, message: "会话不存在" },
  AI_CONVERSATION_FORBIDDEN: { statusCode: 403, retryable: false, message: "无权访问该会话" },
  AI_MESSAGE_NOT_FOUND: { statusCode: 404, retryable: false, message: "消息不存在" },
  AI_GENERATION_NOT_RUNNING: { statusCode: 409, retryable: false, message: "当前没有正在进行的生成任务" },
  AI_REASONING_NOT_SUPPORTED: { statusCode: 400, retryable: false, message: "当前会话或模型不支持深度思考" },
  AI_QUOTA_EXCEEDED: { statusCode: 429, retryable: true, message: "AI 使用额度已达上限，请稍后再试" }
};

/** AI 业务错误：code 为稳定 AI_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class AiError extends AppError {
  public readonly retryable: boolean;

  constructor(code: AiErrorCode, message?: string) {
    const spec = AI_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
    this.retryable = spec.retryable;
  }
}

/**
 * 将底层 AI SDK / 服务商错误映射为统一 AI 业务错误。
 * 只接收已脱敏的错误对象；完整堆栈仅写入日志，不进入响应。
 */
export function toAiError(error: unknown): AiError {
  const name = error instanceof Error ? error.name : "";
  const raw = error instanceof Error ? error.message : String(error);
  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : undefined;
  const text = `${name} ${raw}`;

  if (statusCode === 429 || /rate\s*limit|too\s*many/i.test(text)) {
    return new AiError("AI_PROVIDER_RATE_LIMIT");
  }
  if (name.includes("Timeout") || /timed?\s*out|timeout/i.test(text)) {
    return new AiError("AI_MODEL_TIMEOUT");
  }
  if (/content\s*(filter|policy)|ContentPolicy|refus/i.test(text)) {
    return new AiError("AI_CONTENT_REJECTED");
  }
  if (/context.*(too\s*long|exceed)|maximum\s*context/i.test(text)) {
    return new AiError("AI_CONTEXT_TOO_LONG");
  }
  if (statusCode === 401 || statusCode === 403 || /unauthoriz|invalid.*key|api\s*key/i.test(text)) {
    return new AiError("AI_CONFIG_INVALID");
  }
  return new AiError("AI_PROVIDER_UNAVAILABLE");
}