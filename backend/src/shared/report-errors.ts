import { AppError } from "./errors.js";

/**
 * 报告模板 / 模板报告业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const REPORT_ERROR_CODES = {
  REPORT_TEMPLATE_NOT_FOUND: "REPORT_TEMPLATE_NOT_FOUND",
  REPORT_TEMPLATE_STATUS_CONFLICT: "REPORT_TEMPLATE_STATUS_CONFLICT",
  REPORT_TEMPLATE_DUPLICATE_KEY: "REPORT_TEMPLATE_DUPLICATE_KEY",
  REPORT_TEMPLATE_STRUCTURE_INVALID: "REPORT_TEMPLATE_STRUCTURE_INVALID",
  REPORT_TEMPLATE_NOT_PUBLISHED: "REPORT_TEMPLATE_NOT_PUBLISHED",
  REPORT_SELECTION_NOT_FOUND: "REPORT_SELECTION_NOT_FOUND",
  REPORT_SELECTION_PROJECT_MISMATCH: "REPORT_SELECTION_PROJECT_MISMATCH",
  REPORT_NOT_REVIEWABLE: "REPORT_NOT_REVIEWABLE",
  REPORT_REVIEW_STATUS_CONFLICT: "REPORT_REVIEW_STATUS_CONFLICT",
  REPORT_SNAPSHOT_NOT_FOUND: "REPORT_SNAPSHOT_NOT_FOUND"
} as const;

export type ReportErrorCode = (typeof REPORT_ERROR_CODES)[keyof typeof REPORT_ERROR_CODES];

interface ReportErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const REPORT_ERROR_SPECS: Record<ReportErrorCode, ReportErrorSpec> = {
  REPORT_TEMPLATE_NOT_FOUND: { statusCode: 404, message: "报告模板不存在" },
  REPORT_TEMPLATE_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  REPORT_TEMPLATE_DUPLICATE_KEY: { statusCode: 409, message: "同键报告模板已存在，请先处理已有记录" },
  REPORT_TEMPLATE_STRUCTURE_INVALID: { statusCode: 400, message: "报告模板章节配置校验未通过" },
  REPORT_TEMPLATE_NOT_PUBLISHED: { statusCode: 400, message: "报告模板未发布或已失效，不能用于生成报告" },
  REPORT_SELECTION_NOT_FOUND: { statusCode: 404, message: "候选方案确认记录不存在" },
  REPORT_SELECTION_PROJECT_MISMATCH: { statusCode: 400, message: "候选方案确认记录不属于当前项目" },
  REPORT_NOT_REVIEWABLE: { statusCode: 409, message: "该报告不是模板报告或未处于可审核状态" },
  REPORT_REVIEW_STATUS_CONFLICT: { statusCode: 409, message: "报告当前状态不允许执行该审核操作" },
  REPORT_SNAPSHOT_NOT_FOUND: { statusCode: 404, message: "报告数据快照不存在" }
};

/** 报告模板 / 模板报告业务错误：code 为稳定 REPORT_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class ReportError extends AppError {
  constructor(code: ReportErrorCode, message?: string) {
    const spec = REPORT_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}