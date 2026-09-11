import { describe, expect, it } from "vitest";
import {
  canAskAiFromStatus,
  canRetryParse,
  deriveParsingStage,
  hasSearchableContent,
  mapKnowledgeUserStatus,
  toParseFailurePresentation
} from "./knowledge-user-status.js";

describe("mapKnowledgeUserStatus", () => {
  it("QUEUED / PENDING 映射为 PENDING_PARSE", () => {
    expect(mapKnowledgeUserStatus({ parseStatus: "PENDING", jobStatus: "QUEUED" })).toBe("PENDING_PARSE");
    expect(mapKnowledgeUserStatus({ parseStatus: "PENDING" })).toBe("PENDING_PARSE");
  });

  it("PARSING / CHUNKING / ACTIVE 映射为 PARSING", () => {
    expect(mapKnowledgeUserStatus({ parseStatus: "PARSING" })).toBe("PARSING");
    expect(mapKnowledgeUserStatus({ parseStatus: "PENDING", pipelineStatus: "CHUNKING" })).toBe("PARSING");
    expect(mapKnowledgeUserStatus({ parseStatus: "PENDING", jobStatus: "ACTIVE" })).toBe("PARSING");
  });

  it("PARSED 未发布映射为 READY_TO_VERIFY，且可 AI 测试", () => {
    const input = {
      parseStatus: "PARSED",
      versionStatus: "DRAFT",
      usageMode: "AI_ENABLED",
      pageCount: 3,
      chunkCount: 8
    };
    expect(mapKnowledgeUserStatus(input)).toBe("READY_TO_VERIFY");
    expect(canAskAiFromStatus(input)).toBe(true);
  });

  it("PUBLISHED + AI_ENABLED + 可检索内容映射为 READY", () => {
    expect(mapKnowledgeUserStatus({
      parseStatus: "PARSED",
      versionStatus: "PUBLISHED",
      usageMode: "AI_ENABLED",
      pageCount: 2,
      chunkCount: 4
    })).toBe("READY");
  });

  it("FAILED 映射为 PARSE_FAILED，且允许重试", () => {
    expect(mapKnowledgeUserStatus({ parseStatus: "FAILED", jobStatus: "FAILED" })).toBe("PARSE_FAILED");
    expect(canRetryParse({ userStatus: "PARSE_FAILED", versionStatus: "DRAFT" })).toBe(true);
    expect(canRetryParse({ userStatus: "PARSE_FAILED", versionStatus: "PUBLISHED" })).toBe(false);
  });

  it("无文本层且无检索源映射为 SEARCHABLE_FILE_REQUIRED", () => {
    expect(mapKnowledgeUserStatus({
      parseStatus: "SEARCH_SOURCE_REQUIRED",
      jobStatus: "COMPLETED",
      hasSearchSource: false
    })).toBe("SEARCHABLE_FILE_REQUIRED");
    expect(mapKnowledgeUserStatus({
      parseStatus: "NO_TEXT_LAYER",
      hasSearchSource: false
    })).toBe("SEARCHABLE_FILE_REQUIRED");
    expect(mapKnowledgeUserStatus({ parseStatus: "OCR_REQUIRED" })).toBe("SEARCHABLE_FILE_REQUIRED");
  });

  it("双源解析完成后按发布态进入验证或就绪", () => {
    const dual = {
      parseStatus: "NO_TEXT_LAYER",
      hasSearchSource: true,
      pageCount: 5,
      chunkCount: 10,
      usageMode: "AI_ENABLED"
    };
    expect(hasSearchableContent(dual)).toBe(true);
    expect(mapKnowledgeUserStatus({ ...dual, versionStatus: "DRAFT" })).toBe("READY_TO_VERIFY");
    expect(mapKnowledgeUserStatus({ ...dual, versionStatus: "PUBLISHED" })).toBe("READY");
  });
});

describe("toParseFailurePresentation", () => {
  it("页级失败转成用户文案，不暴露 exception 原文", () => {
    const presented = toParseFailurePresentation({
      id: "job-1",
      errorMessage: "unpdf failed at page 63: stream is damaged",
      parser: "unpdf"
    });
    expect(presented.userMessage).toBe("PDF 第 63 页解析失败，请检查文件是否损坏后重试。");
    expect(presented.errorCode).toBe("PDF_PAGE_PARSE_FAILED");
    expect(presented.technical).toEqual({
      parser: "unpdf",
      page: 63,
      reason: "unpdf failed at page 63: stream is damaged",
      jobId: "job-1"
    });
    expect(presented.userMessage).not.toContain("stream is damaged");
  });

  it("中文页码失败同样识别", () => {
    const presented = toParseFailurePresentation({
      errorMessage: "解析第 8 页时出错"
    });
    expect(presented.errorCode).toBe("PDF_PAGE_PARSE_FAILED");
    expect(presented.userMessage).toContain("第 8 页");
  });

  it("未知失败使用兜底用户文案", () => {
    const presented = toParseFailurePresentation({
      id: "job-2",
      errorMessage: "TypeError: Cannot read properties of undefined"
    });
    expect(presented.userMessage).toBe("文档解析失败，请重试或更换文件。");
    expect(presented.errorCode).toBe("PARSE_FAILED");
    expect(presented.technical.reason).toContain("TypeError");
  });

  it("优先使用 Worker 已写入的结构化 result", () => {
    const presented = toParseFailurePresentation({
      id: "job-3",
      errorMessage: "raw boom",
      result: {
        userMessage: "PDF 第 2 页解析失败，请检查文件是否损坏后重试。",
        errorCode: "PDF_PAGE_PARSE_FAILED",
        technical: { parser: "unpdf", page: 2, reason: "raw boom" }
      }
    });
    expect(presented.userMessage).toBe("PDF 第 2 页解析失败，请检查文件是否损坏后重试。");
    expect(presented.technical.parser).toBe("unpdf");
    expect(presented.technical.page).toBe(2);
  });

  it("无文本层完成态返回业务提示", () => {
    const presented = toParseFailurePresentation({
      id: "job-4",
      result: { status: "SEARCH_SOURCE_REQUIRED", message: "原文件没有文本层，请绑定检索文本源后重新解析" }
    }, "SEARCH_SOURCE_REQUIRED");
    expect(presented.errorCode).toBe("SEARCH_SOURCE_REQUIRED");
    expect(presented.userMessage).toContain("文本");
  });
});

describe("deriveParsingStage", () => {
  it("由 job 与 pipeline 派生舞台", () => {
    expect(deriveParsingStage({ jobStatus: "QUEUED" })).toBe("QUEUED");
    expect(deriveParsingStage({ jobStatus: "ACTIVE", pipelineStatus: "CHUNKING" })).toBe("CHUNKING");
    expect(deriveParsingStage({ jobStatus: "FAILED" })).toBe("FAILED");
  });
});
