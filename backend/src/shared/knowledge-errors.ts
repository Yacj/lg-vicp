import { AppError } from "./errors.js";

/**
 * 知识库用户工作流业务错误码（稳定字符串，随 details.errorCode 返回，参照 FILE_IN_USE 先例）。
 * statusCode 为数值型 HTTP 语义码（与全局错误规范一致），用户提示使用中文。
 */
export const KNOWLEDGE_ERROR_CODES = {
  /** 当前版本尚未完成可检索解析（解析中/失败/内容为空），不能进行 AI 测试 */
  KNOWLEDGE_NOT_READY_FOR_TEST: "KNOWLEDGE_NOT_READY_FOR_TEST",
  /** 当前文件没有文本层且未绑定可检索文本源（转曲件需补充 SEARCH_SOURCE） */
  KNOWLEDGE_SEARCH_SOURCE_REQUIRED: "KNOWLEDGE_SEARCH_SOURCE_REQUIRED",
  /** 空版本发布门禁：版本没有任何 Knowledge Page（允许先建空 DRAFT，但不允许空版本发布） */
  KNOWLEDGE_VERSION_EMPTY: "KNOWLEDGE_VERSION_EMPTY",
  /** 发布前置状态：仅审核通过（APPROVED）的版本可以发布 */
  KNOWLEDGE_VERSION_NOT_APPROVED: "KNOWLEDGE_VERSION_NOT_APPROVED",
  /** 重复发布：版本已经是 PUBLISHED */
  KNOWLEDGE_VERSION_ALREADY_PUBLISHED: "KNOWLEDGE_VERSION_ALREADY_PUBLISHED",
  /** 页面确认门禁：离线页图版本的视觉识别尚未 CONFIRMED */
  KNOWLEDGE_VERSION_PAGES_UNCONFIRMED: "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
  /** 页面门禁：离线页图版本存在缺少原页图片的页面 */
  KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE: "KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE",
  /** 页面门禁：离线页图版本存在识别失败（FAILED）的页面 */
  KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED: "KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED",
  /** AI_ENABLED 发布门禁：正式来源已就绪，但没有任何可检索内容（chunkCount = 0） */
  KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED: "KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED"
} as const;

export type KnowledgeErrorCode = (typeof KNOWLEDGE_ERROR_CODES)[keyof typeof KNOWLEDGE_ERROR_CODES];

interface KnowledgeErrorSpec {
  /** 数值型 HTTP 语义码（与全局错误规范一致） */
  statusCode: number;
  message: string;
}

export const KNOWLEDGE_ERROR_SPECS: Record<KnowledgeErrorCode, KnowledgeErrorSpec> = {
  KNOWLEDGE_NOT_READY_FOR_TEST: { statusCode: 400, message: "知识库还在解析中，完成后即可测试。" },
  KNOWLEDGE_SEARCH_SOURCE_REQUIRED: { statusCode: 400, message: "当前文件无法读取文字，请先补充可搜索文字版本。" },
  KNOWLEDGE_VERSION_EMPTY: { statusCode: 400, message: "当前知识库还没有资料页面，请先上传页面后再发布。" },
  KNOWLEDGE_VERSION_NOT_APPROVED: { statusCode: 400, message: "当前版本尚未审核通过，不能发布。" },
  KNOWLEDGE_VERSION_ALREADY_PUBLISHED: { statusCode: 400, message: "当前版本已发布，无需重复发布。" },
  KNOWLEDGE_VERSION_PAGES_UNCONFIRMED: { statusCode: 400, message: "存在尚未完成识别确认的资料页面，请先完成确认后再发布。" },
  KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE: { statusCode: 400, message: "存在缺少原页图片的资料页面，请先补齐页面图片后再发布。" },
  KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED: { statusCode: 400, message: "存在识别失败的资料页面，请重新识别并确认后再发布。" },
  KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED: { statusCode: 400, message: "当前版本还没有可被 AI 检索的内容，请先生成可检索内容后再发布。" }
};

/** 判断任意字符串是否为已登记的稳定知识库错误码（发布门禁把 blocker 码映射为业务错误时使用） */
export function isKnowledgeErrorCode(code: string): code is KnowledgeErrorCode {
  return Object.prototype.hasOwnProperty.call(KNOWLEDGE_ERROR_SPECS, code);
}

/** 知识库业务错误：code 为稳定 KNOWLEDGE_* 错误码（details.errorCode 透出），statusCode 为数值型 HTTP 语义码 */
export class KnowledgeError extends AppError {
  constructor(code: KnowledgeErrorCode, message?: string) {
    const spec = KNOWLEDGE_ERROR_SPECS[code];
    super(code, message ?? spec.message, spec.statusCode, { errorCode: code });
  }
}
