/**
 * 知识库用户态映射：把内部 parse/pipeline/job 状态收成 B 端可理解的 userStatus，
 * 并把 Worker 异常转成「用户信息 + 技术信息」两层，不把 exception 原文当作用户提示。
 */

export const KNOWLEDGE_USER_STATUSES = [
  "PENDING_PARSE",
  "PARSING",
  "READY_TO_VERIFY",
  "READY",
  "PARSE_FAILED",
  "SEARCHABLE_FILE_REQUIRED"
] as const;

export type KnowledgeUserStatus = (typeof KNOWLEDGE_USER_STATUSES)[number];

export const KNOWLEDGE_PARSE_ERROR_CODES = {
  PARSE_FAILED: "PARSE_FAILED",
  PDF_PAGE_PARSE_FAILED: "PDF_PAGE_PARSE_FAILED",
  SEARCH_SOURCE_REQUIRED: "SEARCH_SOURCE_REQUIRED",
  OCR_REQUIRED: "OCR_REQUIRED"
} as const;

export type KnowledgeParseErrorCode =
  (typeof KNOWLEDGE_PARSE_ERROR_CODES)[keyof typeof KNOWLEDGE_PARSE_ERROR_CODES];

export interface KnowledgeUserStatusInput {
  parseStatus?: string | null;
  pipelineStatus?: string | null;
  versionStatus?: string | null;
  usageMode?: string | null;
  hasSearchSource?: boolean;
  pageCount?: number;
  chunkCount?: number;
  jobStatus?: string | null;
}

export interface ParseFailureJobInput {
  id?: string | null;
  errorMessage?: string | null;
  result?: Record<string, unknown> | null;
  parser?: string | null;
}

export interface ParseFailureTechnical {
  parser: string | null;
  page?: number;
  reason: string;
  jobId?: string;
}

export interface ParseFailurePresentation {
  userMessage: string;
  errorCode: string;
  technical: ParseFailureTechnical;
}

const PAGE_FAILURE_PATTERN = /(?:第\s*)(\d+)(?:\s*页)|(?:page\s+)(\d+)/i;

export function hasSearchableContent(input: KnowledgeUserStatusInput): boolean {
  const parseStatus = input.parseStatus ?? "";
  const hasSearchSource = Boolean(input.hasSearchSource);
  const searchableParse = parseStatus === "PARSED"
    || parseStatus === "PARTIAL"
    || (parseStatus === "NO_TEXT_LAYER" && hasSearchSource);
  return searchableParse
    && (input.pageCount ?? 0) > 0
    && (input.chunkCount ?? 0) > 0;
}

/** 派生 B 端用户态。内部 DRAFT/APPROVED/PUBLISHED 与 parseStatus 仍保留给高级接口。 */
export function mapKnowledgeUserStatus(input: KnowledgeUserStatusInput): KnowledgeUserStatus {
  const parseStatus = input.parseStatus ?? "PENDING";
  const pipelineStatus = input.pipelineStatus ?? "UPLOAD_PENDING";
  const jobStatus = input.jobStatus ?? null;
  const hasSearchSource = Boolean(input.hasSearchSource);

  if (jobStatus === "ACTIVE" || parseStatus === "PARSING" || pipelineStatus === "PARSING" || pipelineStatus === "CHUNKING") {
    return "PARSING";
  }
  if (jobStatus === "QUEUED" || parseStatus === "PENDING") {
    return "PENDING_PARSE";
  }
  if (parseStatus === "FAILED" || pipelineStatus === "FAILED" || jobStatus === "FAILED") {
    return "PARSE_FAILED";
  }
  if (
    parseStatus === "OCR_REQUIRED"
    || jobStatus === "OCR_REQUIRED"
    || ((parseStatus === "NO_TEXT_LAYER" || parseStatus === "SEARCH_SOURCE_REQUIRED") && !hasSearchSource)
  ) {
    return "SEARCHABLE_FILE_REQUIRED";
  }
  if (hasSearchableContent(input) && input.versionStatus === "PUBLISHED" && (input.usageMode ?? "AI_ENABLED") === "AI_ENABLED") {
    return "READY";
  }
  if (hasSearchableContent(input) || parseStatus === "PARSED" || parseStatus === "PARTIAL") {
    return "READY_TO_VERIFY";
  }
  if ((parseStatus === "NO_TEXT_LAYER" || parseStatus === "SEARCH_SOURCE_REQUIRED") && hasSearchSource) {
    return "PARSING";
  }
  return "PENDING_PARSE";
}

export function deriveParsingStage(input: {
  jobStatus?: string | null;
  pipelineStatus?: string | null;
}): string | null {
  const jobStatus = input.jobStatus ?? null;
  const pipelineStatus = input.pipelineStatus ?? null;
  if (jobStatus === "QUEUED") return "QUEUED";
  if (pipelineStatus === "CHUNKING") return "CHUNKING";
  if (jobStatus === "ACTIVE" || pipelineStatus === "PARSING") return "PARSING";
  if (jobStatus === "COMPLETED") return "COMPLETED";
  if (jobStatus === "FAILED" || pipelineStatus === "FAILED") return "FAILED";
  if (jobStatus === "OCR_REQUIRED") return "OCR_REQUIRED";
  return jobStatus;
}

export function toParseFailurePresentation(
  job: ParseFailureJobInput,
  parseStatus?: string | null
): ParseFailurePresentation {
  const stored = job.result ?? {};
  const storedUserMessage = typeof stored.userMessage === "string" ? stored.userMessage : null;
  const storedErrorCode = typeof stored.errorCode === "string" ? stored.errorCode : null;
  const storedTechnical = stored.technical && typeof stored.technical === "object"
    ? stored.technical as Record<string, unknown>
    : null;
  const storedPage = typeof storedTechnical?.page === "number" ? storedTechnical.page : undefined;
  const reason = job.errorMessage
    || (typeof stored.message === "string" ? stored.message : null)
    || (typeof stored.reason === "string" ? stored.reason : null)
    || "文档解析失败";

  if (parseStatus === "SEARCH_SOURCE_REQUIRED" || stored.status === "SEARCH_SOURCE_REQUIRED") {
    return {
      userMessage: storedUserMessage
        ?? (typeof stored.message === "string" ? stored.message : null)
        ?? "当前 PDF 无法直接读取文字，请补充可搜索文字版本，或仅作为原文浏览。",
      errorCode: storedErrorCode ?? KNOWLEDGE_PARSE_ERROR_CODES.SEARCH_SOURCE_REQUIRED,
      technical: {
        parser: (typeof storedTechnical?.parser === "string" ? storedTechnical.parser : job.parser) ?? null,
        reason,
        ...(job.id ? { jobId: job.id } : {})
      }
    };
  }
  if (parseStatus === "OCR_REQUIRED" || stored.status === "OCR_REQUIRED") {
    return {
      userMessage: storedUserMessage
        ?? (typeof stored.message === "string" ? stored.message : null)
        ?? "当前文件无法读取文字，请先补充可搜索文字版本。",
      errorCode: storedErrorCode ?? KNOWLEDGE_PARSE_ERROR_CODES.OCR_REQUIRED,
      technical: {
        parser: (typeof storedTechnical?.parser === "string" ? storedTechnical.parser : job.parser) ?? null,
        reason,
        ...(job.id ? { jobId: job.id } : {})
      }
    };
  }

  const pageMatch = reason.match(PAGE_FAILURE_PATTERN);
  const matchedPage = pageMatch ? Number(pageMatch[1] || pageMatch[2]) : undefined;
  const page = storedPage ?? (matchedPage != null && Number.isFinite(matchedPage) ? matchedPage : undefined);
  const derivedCode = page != null && Number.isFinite(page)
    ? KNOWLEDGE_PARSE_ERROR_CODES.PDF_PAGE_PARSE_FAILED
    : KNOWLEDGE_PARSE_ERROR_CODES.PARSE_FAILED;
  const derivedMessage = page != null && Number.isFinite(page)
    ? `PDF 第 ${page} 页解析失败，请检查文件是否损坏后重试。`
    : "文档解析失败，请重试或更换文件。";

  return {
    userMessage: storedUserMessage ?? derivedMessage,
    errorCode: storedErrorCode ?? derivedCode,
    technical: {
      parser: (typeof storedTechnical?.parser === "string" ? storedTechnical.parser : job.parser) ?? null,
      ...(page != null && Number.isFinite(page) ? { page } : {}),
      reason,
      ...(job.id ? { jobId: job.id } : {})
    }
  };
}

export function canAskAiFromStatus(input: KnowledgeUserStatusInput): boolean {
  const userStatus = mapKnowledgeUserStatus(input);
  return (userStatus === "READY_TO_VERIFY" || userStatus === "READY")
    && hasSearchableContent(input)
    && (input.usageMode ?? "AI_ENABLED") !== "BROWSE_ONLY";
}

export function canRetryParse(input: {
  userStatus: KnowledgeUserStatus;
  versionStatus?: string | null;
}): boolean {
  return input.userStatus === "PARSE_FAILED"
    && input.versionStatus !== "PUBLISHED"
    && input.versionStatus !== "DISABLED";
}
