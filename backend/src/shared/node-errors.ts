import { AppError } from "./errors.js";

/**
 * 节点图库业务统一错误码（稳定字符串，用于日志、审计与响应 error.code 语义）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const NODE_ERROR_CODES = {
  NODE_ENTITY_NOT_FOUND: "NODE_ENTITY_NOT_FOUND",
  NODE_STATUS_CONFLICT: "NODE_STATUS_CONFLICT",
  NODE_DUPLICATE_KEY: "NODE_DUPLICATE_KEY",
  NODE_STRUCTURE_INVALID: "NODE_STRUCTURE_INVALID",
  NODE_REFERENCE_NOT_PUBLISHED: "NODE_REFERENCE_NOT_PUBLISHED",
  NODE_ATTACHMENT_REQUIRED: "NODE_ATTACHMENT_REQUIRED"
} as const;

export type NodeErrorCode = (typeof NODE_ERROR_CODES)[keyof typeof NODE_ERROR_CODES];

interface NodeErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const NODE_ERROR_SPECS: Record<NodeErrorCode, NodeErrorSpec> = {
  NODE_ENTITY_NOT_FOUND: { statusCode: 404, message: "节点图不存在" },
  NODE_STATUS_CONFLICT: { statusCode: 409, message: "当前状态不允许执行该操作" },
  NODE_DUPLICATE_KEY: { statusCode: 409, message: "同键节点图已存在，请先处理已有记录" },
  NODE_STRUCTURE_INVALID: { statusCode: 400, message: "节点图结构校验未通过" },
  NODE_REFERENCE_NOT_PUBLISHED: { statusCode: 400, message: "引用的保温系统或构造方案未发布或已失效" },
  NODE_ATTACHMENT_REQUIRED: { statusCode: 400, message: "节点图必须至少提供一张高清图或 CAD 文件" }
};

/** 节点图库业务错误：code 为稳定 NODE_* 错误码，statusCode 为数值型 HTTP 语义码 */
export class NodeError extends AppError {
  constructor(code: NodeErrorCode, message?: string) {
    const spec = NODE_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode);
  }
}