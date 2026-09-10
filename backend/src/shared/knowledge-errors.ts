import { AppError } from "./errors.js";

/**
 * 知识库用户工作流业务错误码（稳定字符串，随 details.errorCode 返回，参照 FILE_IN_USE 先例）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const KNOWLEDGE_ERROR_CODES = {
  /** 当前版本尚未完成可检索解析（解析中/失败/内容为空），不能进行 AI 测试 */
  KNOWLEDGE_NOT_READY_FOR_TEST: "KNOWLEDGE_NOT_READY_FOR_TEST",
  /** 当前文件没有文本层且未绑定可检索文本源（转曲件需补充 SEARCH_SOURCE） */
  KNOWLEDGE_SEARCH_SOURCE_REQUIRED: "KNOWLEDGE_SEARCH_SOURCE_REQUIRED"
} as const;

export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[keyof typeof KNOWLEDGE_ERROR_CODES];

interface KnowledgeErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const KNOWLEDGE_ERROR_SPECS: Record<KnowledgeErrorCode, KnowledgeErrorSpec> = {
  KNOWLEDGE_NOT_READY_FOR_TEST: { statusCode: 400, message: "知识库还在解析中，完成后即可测试。" },
  KNOWLEDGE_SEARCH_SOURCE_REQUIRED: { statusCode: 400, message: "当前文件无法读取文字，请先补充可搜索文字版本。" }
};

/** 知识库业务错误：code 为稳定 KNOWLEDGE_* 错误码（details.errorCode 透出），statusCode 为数值型 HTTP 语义码 */
export class KnowledgeError extends AppError {
  constructor(code: KnowledgeErrorCode, message?: string) {
    const spec = KNOWLEDGE_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode, { errorCode: code });
  }
}
