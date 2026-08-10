import { AppError } from "./errors.js";

/**
 * 图集热工参考表业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const THERMAL_ERROR_CODES = {
  THERMAL_ENTITY_NOT_FOUND: "THERMAL_ENTITY_NOT_FOUND",
  THERMAL_STATUS_CONFLICT: "THERMAL_STATUS_CONFLICT",
  THERMAL_DUPLICATE_KEY: "THERMAL_DUPLICATE_KEY",
  THERMAL_IMPORT_INVALID: "THERMAL_IMPORT_INVALID",
  THERMAL_STRUCTURE_INVALID: "THERMAL_STRUCTURE_INVALID",
  THERMAL_SET_VERSION_CONFLICT: "THERMAL_SET_VERSION_CONFLICT",
  THERMAL_REFERENCE_NOT_PUBLISHED: "THERMAL_REFERENCE_NOT_PUBLISHED",
  /** 计算引擎：EQUIVALENT/LAYERED 模式缺少已发布计算规则（计算接口以字段级错误返回，不抛异常） */
  THERMAL_CALC_RULE_NOT_PUBLISHED: "THERMAL_CALC_RULE_NOT_PUBLISHED",
  /** 计算引擎：请求地区缺少已发布标准限值，合格判定暂缺（不阻断计算，compliant=null） */
  THERMAL_STANDARD_LIMIT_NOT_FOUND: "THERMAL_STANDARD_LIMIT_NOT_FOUND"
} as const;

export type ThermalErrorCode = (typeof THERMAL_ERROR_CODES)[keyof typeof THERMAL_ERROR_CODES];

interface ThermalErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const THERMAL_ERROR_SPECS: Record<ThermalErrorCode, ThermalErrorSpec> = {
  THERMAL_ENTITY_NOT_FOUND: { statusCode: 404, message: "图集热工参考集或导入作业不存在" },
  THERMAL_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  THERMAL_DUPLICATE_KEY: { statusCode: 409, message: "参考行唯一约束冲突，导入已整体回滚" },
  THERMAL_IMPORT_INVALID: { statusCode: 400, message: "导入文件存在错误行，需显式确认忽略" },
  THERMAL_STRUCTURE_INVALID: { statusCode: 400, message: "图集热工参考集结构校验未通过" },
  THERMAL_SET_VERSION_CONFLICT: { statusCode: 409, message: "参考集最新版本状态不允许应用导入，请先派生新版本草稿" },
  THERMAL_REFERENCE_NOT_PUBLISHED: { statusCode: 400, message: "引用的构造方案或产品规格未发布或已失效" },
  THERMAL_CALC_RULE_NOT_PUBLISHED: { statusCode: 400, message: "没有已发布且生效中的计算规则，请先在后台配置并审核发布" },
  THERMAL_STANDARD_LIMIT_NOT_FOUND: { statusCode: 400, message: "该地区没有已发布且生效中的标准限值，合格判定暂缺" }
};

/** 图集热工参考表业务错误：code 为稳定 THERMAL_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class ThermalError extends AppError {
  constructor(code: ThermalErrorCode, message?: string) {
    const spec = THERMAL_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}