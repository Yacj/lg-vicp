import { AppError } from "./errors.js";

/**
 * 保温系统/构造方案业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const CONSTRUCTION_ERROR_CODES = {
  CONSTRUCTION_ENTITY_NOT_FOUND: "CONSTRUCTION_ENTITY_NOT_FOUND",
  CONSTRUCTION_STATUS_CONFLICT: "CONSTRUCTION_STATUS_CONFLICT",
  CONSTRUCTION_DUPLICATE_KEY: "CONSTRUCTION_DUPLICATE_KEY",
  CONSTRUCTION_STRUCTURE_INVALID: "CONSTRUCTION_STRUCTURE_INVALID",
  CONSTRUCTION_REFERENCE_NOT_PUBLISHED: "CONSTRUCTION_REFERENCE_NOT_PUBLISHED",
  CONSTRUCTION_EFFECTIVE_RANGE_INVALID: "CONSTRUCTION_EFFECTIVE_RANGE_INVALID"
} as const;

export type ConstructionErrorCode = (typeof CONSTRUCTION_ERROR_CODES)[keyof typeof CONSTRUCTION_ERROR_CODES];

interface ConstructionErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const CONSTRUCTION_ERROR_SPECS: Record<ConstructionErrorCode, ConstructionErrorSpec> = {
  CONSTRUCTION_ENTITY_NOT_FOUND: { statusCode: 404, message: "保温系统或构造方案不存在" },
  CONSTRUCTION_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  CONSTRUCTION_DUPLICATE_KEY: { statusCode: 409, message: "同键构造方案已存在，请先处理已有记录" },
  CONSTRUCTION_STRUCTURE_INVALID: { statusCode: 400, message: "构造层结构校验未通过" },
  CONSTRUCTION_REFERENCE_NOT_PUBLISHED: { statusCode: 400, message: "引用的产品规格或材料未发布或已失效" },
  CONSTRUCTION_EFFECTIVE_RANGE_INVALID: { statusCode: 400, message: "生效区间不合法（生效时间晚于失效时间）" }
};

/** 保温系统/构造方案业务错误：code 为稳定 CONSTRUCTION_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class ConstructionError extends AppError {
  constructor(code: ConstructionErrorCode, message?: string) {
    const spec = CONSTRUCTION_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}