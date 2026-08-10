import { AppError } from "./errors.js";

/**
 * 地方标准采集业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const STANDARD_ERROR_CODES = {
  STANDARD_STATUS_CONFLICT: "STANDARD_STATUS_CONFLICT",
  STANDARD_NOT_FOUND: "STANDARD_NOT_FOUND",
  STANDARD_DUPLICATE_KEY: "STANDARD_DUPLICATE_KEY",
  STANDARD_NOT_PUBLISHED: "STANDARD_NOT_PUBLISHED",
  STANDARD_EVIDENCE_REQUIRED: "STANDARD_EVIDENCE_REQUIRED",
  STANDARD_NOT_APPLICABLE: "STANDARD_NOT_APPLICABLE"
} as const;

export type StandardErrorCode = (typeof STANDARD_ERROR_CODES)[keyof typeof STANDARD_ERROR_CODES];

interface StandardErrorSpec {
  statusCode: number;
  message: string;
}

export const STANDARD_ERROR_SPECS: Record<StandardErrorCode, StandardErrorSpec> = {
  STANDARD_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  STANDARD_NOT_FOUND: { statusCode: 404, message: "标准记录不存在" },
  STANDARD_DUPLICATE_KEY: { statusCode: 409, message: "同编号标准已存在，请先处理已有记录或使用新编号" },
  STANDARD_NOT_PUBLISHED: { statusCode: 409, message: "标准文档尚未发布，无法执行该操作" },
  STANDARD_EVIDENCE_REQUIRED: { statusCode: 400, message: "人工录入必须提供证据来源与条款引用" },
  STANDARD_NOT_APPLICABLE: { statusCode: 409, message: "指标未关联已发布的适用范围" }
};

/** 地方标准采集业务错误：code 为稳定 STANDARD_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class StandardError extends AppError {
  constructor(code: StandardErrorCode, message?: string) {
    const spec = STANDARD_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}