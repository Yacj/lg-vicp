import { AppError } from "./errors.js";

/**
 * 统一审核中心业务错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const REVIEW_ERROR_CODES = {
  REVIEW_ENTITY_UNSUPPORTED: "REVIEW_ENTITY_UNSUPPORTED",
  REVIEW_RECORD_NOT_FOUND: "REVIEW_RECORD_NOT_FOUND",
  REVIEW_ENTITY_NOT_PENDING: "REVIEW_ENTITY_NOT_PENDING"
} as const;

export type ReviewErrorCode = (typeof REVIEW_ERROR_CODES)[keyof typeof REVIEW_ERROR_CODES];

interface ReviewErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const REVIEW_ERROR_SPECS: Record<ReviewErrorCode, ReviewErrorSpec> = {
  REVIEW_ENTITY_UNSUPPORTED: { statusCode: 400, message: "该实体类型不在统一审核范围内" },
  REVIEW_RECORD_NOT_FOUND: { statusCode: 404, message: "审核记录不存在" },
  REVIEW_ENTITY_NOT_PENDING: { statusCode: 409, message: "该实体当前不在待审核状态" }
};

/** 统一审核中心业务错误：code 为稳定 REVIEW_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class ReviewError extends AppError {
  constructor(code: ReviewErrorCode, message?: string) {
    const spec = REVIEW_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}