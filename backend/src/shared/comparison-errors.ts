import { AppError } from "./errors.js";

/**
 * 材料对比规则引擎业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const COMPARISON_ERROR_CODES = {
  COMPARISON_ENTITY_NOT_FOUND: "COMPARISON_ENTITY_NOT_FOUND",
  COMPARISON_STATUS_CONFLICT: "COMPARISON_STATUS_CONFLICT",
  COMPARISON_DUPLICATE_KEY: "COMPARISON_DUPLICATE_KEY",
  COMPARISON_STRUCTURE_INVALID: "COMPARISON_STRUCTURE_INVALID",
  COMPARISON_VERSION_LOCKED: "COMPARISON_VERSION_LOCKED",
  COMPARISON_DIMENSION_FIXED: "COMPARISON_DIMENSION_FIXED",
  COMPARISON_NO_PUBLISHED_RULE: "COMPARISON_NO_PUBLISHED_RULE"
} as const;

export type ComparisonErrorCode = (typeof COMPARISON_ERROR_CODES)[keyof typeof COMPARISON_ERROR_CODES];

interface ComparisonErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const COMPARISON_ERROR_SPECS: Record<ComparisonErrorCode, ComparisonErrorSpec> = {
  COMPARISON_ENTITY_NOT_FOUND: { statusCode: 404, message: "材料对比版本、材料、规则或证据不存在" },
  COMPARISON_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  COMPARISON_DUPLICATE_KEY: { statusCode: 409, message: "材料或规则唯一约束冲突" },
  COMPARISON_STRUCTURE_INVALID: { statusCode: 400, message: "材料对比版本结构校验未通过" },
  COMPARISON_VERSION_LOCKED: { statusCode: 409, message: "版本已提交审核或已发布，不能修改内容，请派生新版本" },
  COMPARISON_DIMENSION_FIXED: { statusCode: 400, message: "五维固定维度不允许删除或禁用" },
  COMPARISON_NO_PUBLISHED_RULE: { statusCode: 400, message: "没有已发布且生效中的材料对比规则，请先在后台配置并审核发布" }
};

/** 材料对比规则引擎业务错误：code 为稳定 COMPARISON_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class ComparisonError extends AppError {
  constructor(code: ComparisonErrorCode, message?: string) {
    const spec = COMPARISON_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}