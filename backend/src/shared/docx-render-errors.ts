/** DOCX → LibreOffice → PDF 页面渲染错误码（英文稳定码 + 中文可读说明） */

export const DOCX_RENDER_ERROR_CODES = [
  "SOFFICE_NOT_FOUND",
  "DOCX_RENDER_TIMEOUT",
  "DOCX_RENDER_FAILED",
  "DOCX_RENDER_OUTPUT_MISSING",
  "DOCX_RENDER_DISABLED",
  "PDF_TEXT_PARSE_FAILED",
  "PDF_PAGE_RENDER_FAILED"
] as const;

export type DocxRenderErrorCode = (typeof DOCX_RENDER_ERROR_CODES)[number];

const DEFAULT_MESSAGES: Record<DocxRenderErrorCode, string> = {
  SOFFICE_NOT_FOUND: "未找到 LibreOffice（soffice），无法生成 DOCX 页面预览",
  DOCX_RENDER_TIMEOUT: "DOCX 转 PDF 超时，页面预览未生成",
  DOCX_RENDER_FAILED: "DOCX 转 PDF 失败，页面预览未生成",
  DOCX_RENDER_OUTPUT_MISSING: "LibreOffice 未产出 PDF 文件，页面预览未生成",
  DOCX_RENDER_DISABLED: "DOCX 页面渲染已关闭（DOCX_RENDER_ENABLED=false）",
  PDF_TEXT_PARSE_FAILED: "临时 PDF 文本提取失败，页面结构未生成",
  PDF_PAGE_RENDER_FAILED: "临时 PDF 页面图片渲染失败"
};

export class DocxRenderError extends Error {
  readonly code: DocxRenderErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: DocxRenderErrorCode, message?: string, details: Record<string, unknown> = {}) {
    super(message ?? DEFAULT_MESSAGES[code]);
    this.name = "DocxRenderError";
    this.code = code;
    this.details = details;
  }
}

export function isDocxRenderError(error: unknown): error is DocxRenderError {
  return error instanceof DocxRenderError;
}

export function docxRenderErrorMessage(code: DocxRenderErrorCode): string {
  return DEFAULT_MESSAGES[code];
}

/** 页面视觉完整成功：全部页图生成且无失败 */
export function isPageRenderingComplete(input: {
  pageCount: number;
  previewRendered: number;
  previewFailed: number;
}): boolean {
  return input.previewFailed === 0
    && input.previewRendered === input.pageCount
    && input.pageCount > 0;
}
