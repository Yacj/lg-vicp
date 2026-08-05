import { AppError } from "./errors.js";

/**
 * 主数据业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const MD_ERROR_CODES = {
  MD_STATUS_CONFLICT: "MD_STATUS_CONFLICT",
  MD_ENTITY_NOT_FOUND: "MD_ENTITY_NOT_FOUND",
  MD_DUPLICATE_KEY: "MD_DUPLICATE_KEY",
  MD_NOT_PUBLISHED: "MD_NOT_PUBLISHED"
} as const;

export type MdErrorCode = (typeof MD_ERROR_CODES)[keyof typeof MD_ERROR_CODES];

interface MdErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const MD_ERROR_SPECS: Record<MdErrorCode, MdErrorSpec> = {
  MD_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  MD_ENTITY_NOT_FOUND: { statusCode: 404, message: "主数据不存在" },
  MD_DUPLICATE_KEY: { statusCode: 409, message: "同键主数据已存在，请先处理已有记录" },
  MD_NOT_PUBLISHED: { statusCode: 404, message: "没有已发布且生效中的参数版本" }
};

/** 主数据业务错误：code 为稳定 MD_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class MdError extends AppError {
  constructor(code: MdErrorCode, message?: string) {
    const spec = MD_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}