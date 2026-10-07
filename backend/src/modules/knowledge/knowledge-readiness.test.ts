import { describe, expect, it, vi } from "vitest";

// env 模块在导入链顶层解析环境变量，须先于被测模块完成注入
vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

import {
  deriveKnowledgeVersionReadiness,
  evaluateVersionAiReadiness,
  pageImageMissing,
  pageRequiresRecognition,
  summarizePageReadiness,
  type KnowledgePageReadinessFacts,
  type KnowledgePageReadinessRow,
  type KnowledgeReadinessSource
} from "./knowledge-readiness.js";

/**
 * 统一 Readiness 模型回归（页面驱动知识库收口）：
 * - 模式 A 传统文件链：ORIGINAL + 解析完成 → 审核 / 发布 / AI；
 * - 模式 B 页面驱动链：完整页面 + 识别确认 + page-aware chunks → 审核 / 发布 / AI；
 * - 两条链任一就绪即可；不再把「必须 ORIGINAL / 必须 parseStatus=PARSED」当作所有版本的硬前提。
 */

function page(overrides: Partial<KnowledgePageReadinessRow> = {}): KnowledgePageReadinessRow {
  return {
    pageImageObjectKey: "knowledge/page-images/doc/ver/p1.png",
    uploadSource: "ZIP",
    recognitionStatus: "CONFIRMED",
    recognitionRunId: null,
    hasText: false,
    ...overrides
  };
}

function source(overrides: Partial<KnowledgeReadinessSource> = {}): KnowledgeReadinessSource {
  return {
    usageMode: "AI_ENABLED",
    parseStatus: "PENDING",
    hasOriginalAsset: false,
    hasSearchSourceAsset: false,
    ...overrides
  };
}

const pdfTextPage: KnowledgePageReadinessRow = {
  pageImageObjectKey: "knowledge/previews/p1.png",
  uploadSource: null,
  recognitionStatus: null,
  recognitionRunId: null,
  hasText: true
};

describe("页面事实归一化（识别需求 / 缺图判定）", () => {
  it("BROWSE_ONLY 空版本产生 NO_PAGES 发布 blocker", () => {
    const readiness = deriveKnowledgeVersionReadiness(source({ usageMode: "BROWSE_ONLY", hasOriginalAsset: true, parseStatus: "PARSED" }), summarizePageReadiness([], 0));
    expect(readiness.publishReady).toBe(false);
    expect(readiness.publishBlockers.map((b) => b.code)).toContain("NO_PAGES");
  });

  it("STRICT 将 warnings 纳入统一 publishReady，审核/AI readiness 保持各自作用域", () => {
    const facts = summarizePageReadiness([page()], 1);
    const relaxed = deriveKnowledgeVersionReadiness(source({ strictPublishCheck: false }), facts);
    const strict = deriveKnowledgeVersionReadiness(source({ strictPublishCheck: true }), facts);
    expect(relaxed.publishReady).toBe(true);
    expect(strict.publishReady).toBe(false);
    expect(strict.publishBlockers.map((b) => b.code)).toContain("STRICT_PUBLISH_WARNING");
    expect(strict.reviewReady).toBe(true);
    expect(strict.aiReady).toBe(true);
    expect(deriveKnowledgeVersionReadiness(source({ strictPublishCheck: true, tocItemCount: 1, confirmedTocCount: 1 }), facts).publishReady).toBe(true);
  });
  it("仅离线页图（BATCH/ZIP/MANUAL）需要识别；传统文件链文本页不要求识别", () => {
    expect(pageRequiresRecognition(page())).toBe(true);
    expect(pageRequiresRecognition(pdfTextPage)).toBe(false);
  });

  it("普通文本页（已有文本且从未进入识别流程）不强制识别", () => {
    expect(pageRequiresRecognition(page({
      uploadSource: "MANUAL",
      recognitionStatus: null,
      recognitionRunId: null,
      hasText: true
    }))).toBe(false);
  });

  it("一旦进入识别流程，即使有文本也必须收敛到 CONFIRMED", () => {
    expect(pageRequiresRecognition(page({ recognitionStatus: "REVIEW_REQUIRED", hasText: true }))).toBe(true);
    expect(pageRequiresRecognition(page({ recognitionStatus: "PENDING", recognitionRunId: "run-1", hasText: true }))).toBe(true);
  });

  it("文本页无页图不算缺图；离线页图无页图算缺图", () => {
    expect(pageImageMissing(pdfTextPage)).toBe(false);
    expect(pageImageMissing(page({ pageImageObjectKey: null }))).toBe(true);
    expect(pageImageMissing({ pageImageObjectKey: null, hasText: false })).toBe(true);
  });

  it("summarizePageReadiness 按识别状态分布计数，并给出聚合计数", () => {
    const facts = summarizePageReadiness([
      page(),
      page({ recognitionStatus: "PENDING", recognitionRunId: "run-2" }),
      page({ recognitionStatus: "PROCESSING" }),
      page({ recognitionStatus: "REVIEW_REQUIRED" }),
      page({ recognitionStatus: "FAILED" })
    ], 7);
    expect(facts.pageCount).toBe(5);
    expect(facts.chunkCount).toBe(7);
    expect(facts.confirmedRecognitionPageCount).toBe(1);
    expect(facts.recognitionPendingPageCount).toBe(1);
    expect(facts.recognitionProcessingPageCount).toBe(1);
    expect(facts.recognitionReviewRequiredPageCount).toBe(1);
    expect(facts.recognitionFailedPageCount).toBe(1);
    expect(facts.unconfirmedRecognitionPageCount).toBe(4);
    expect(facts.hasOfflinePageImages).toBe(true);
  });
});

describe("Case A：传统文件知识不回归", () => {
  it("ORIGINAL + PARSED + chunks → reviewReady / publishReady / aiReady", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ hasOriginalAsset: true, parseStatus: "PARSED" }),
      summarizePageReadiness([pdfTextPage], 8)
    );
    expect(readiness.traditionalContentReady).toBe(true);
    expect(readiness.offlinePageContentReady).toBe(false);
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.publishReady).toBe(true);
    expect(readiness.searchableContentReady).toBe(true);
    expect(readiness.aiReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it("解析中的传统知识仍被拦截（不因放宽 ORIGINAL 约束而放行）", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ hasOriginalAsset: true, parseStatus: "PARSING" }),
      summarizePageReadiness([pdfTextPage], 0)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.blockers.map((blocker) => blocker.code)).toContain("TRADITIONAL_PARSE_INCOMPLETE");
  });
});

describe("Case B：纯页面 Knowledge Ready", () => {
  const readiness = deriveKnowledgeVersionReadiness(
    source({ hasOriginalAsset: false, parseStatus: "PENDING" }),
    summarizePageReadiness([page(), page(), page()], 12)
  );

  it("无 ORIGINAL、parseStatus=PENDING 也可审核 / 发布 / 被 AI 消费", () => {
    expect(readiness.hasOriginalAsset).toBe(false);
    expect(readiness.hasOfflinePageImages).toBe(true);
    expect(readiness.offlinePageContentReady).toBe(true);
    expect(readiness.hasFormalKnowledgeSource).toBe(true);
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.publishReady).toBe(true);
    expect(readiness.searchableContentReady).toBe(true);
    expect(readiness.aiReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });
});

describe("Case C/D/E：页面未确认 / 识别失败 / 缺图仍不能错误发布", () => {
  it("Case C：存在 REVIEW_REQUIRED 页面 → 审核与发布都拦截", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page(), page({ recognitionStatus: "REVIEW_REQUIRED" })], 10)
    );
    expect(readiness.reviewReady).toBe(false);
    expect(readiness.publishReady).toBe(false);
    const blocker = readiness.blockers.find((item) => item.code === "PAGE_REVIEW_REQUIRED");
    expect(blocker?.knowledgeErrorCode).toBe("KNOWLEDGE_VERSION_PAGES_UNCONFIRMED");
  });

  it("Case C：识别排队中（PENDING + runId）也拦截", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page({ recognitionStatus: "PENDING", recognitionRunId: "run-9" })], 10)
    );
    expect(readiness.blockers.map((item) => item.code)).toEqual(["PAGE_RECOGNITION_PENDING"]);
  });

  it("Case C：识别执行中（PROCESSING）拦截并提示稍后重试", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page({ recognitionStatus: "PROCESSING" })], 10)
    );
    expect(readiness.blockers.map((item) => item.code)).toEqual(["PAGE_RECOGNITION_PROCESSING"]);
  });

  it("Case D：存在 FAILED 页面 → 发布拦截，错误码可被 B 端识别", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page({ recognitionStatus: "FAILED" })], 10)
    );
    expect(readiness.publishReady).toBe(false);
    const blocker = readiness.blockers.find((item) => item.code === "PAGE_RECOGNITION_FAILED");
    expect(blocker?.knowledgeErrorCode).toBe("KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED");
  });

  it("Case E：页面缺原图 → 发布拦截", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page(), page({ pageImageObjectKey: null })], 10)
    );
    expect(readiness.publishReady).toBe(false);
    const blocker = readiness.blockers.find((item) => item.code === "PAGE_IMAGE_MISSING");
    expect(blocker?.knowledgeErrorCode).toBe("KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE");
  });

  it("Case E：无 ORIGINAL 且页面无图无文本 → 不给空知识库留放行口", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([{ pageImageObjectKey: null, hasText: false }], 0)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.blockers.length).toBeGreaterThan(0);
  });
});

describe("Case F：有页面但无 chunks", () => {
  it("Test 8｜AI_ENABLED 且 chunkCount=0：不可正式发布（AI_ENABLED 必须有可检索内容）", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page()], 0)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.searchableContentReady).toBe(false);
    expect(readiness.aiReady).toBe(false);
    const blocker = readiness.blockers.find((item) => item.code === "SEARCHABLE_CONTENT_REQUIRED");
    expect(blocker?.knowledgeErrorCode).toBe("KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED");
    expect(blocker?.blocks).toEqual(["PUBLISH", "AI"]);
    expect(readiness.warnings.join(" ")).toContain("尚未生成可检索内容");
  });

  it("Test 8｜chunkCount 未采集（null）不按硬拦截处理：沿用历史放行口径", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page()], null)
    );
    expect(readiness.publishReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
  });

  it("Test 9｜BROWSE_ONLY 无 chunks：仅浏览版本不要求识别确认与 chunks，允许发布", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ usageMode: "BROWSE_ONLY" }),
      summarizePageReadiness([page({ recognitionStatus: "PENDING", recognitionRunId: "run-1" })], 0)
    );
    expect(readiness.offlinePageContentReady).toBe(true);
    expect(readiness.publishReady).toBe(true);
    expect(readiness.aiReady).toBe(false);
    expect(readiness.blockers).toHaveLength(0);
  });
});

describe("Test 10：readiness 与 blockers 同源（publishReady=true 时必无发布级 blocker）", () => {
  const cases: Array<[string, KnowledgeReadinessSource, KnowledgePageReadinessFacts]> = [
    ["页面未确认", source(), summarizePageReadiness([page({ recognitionStatus: "REVIEW_REQUIRED" })], 10)],
    ["识别失败", source(), summarizePageReadiness([page({ recognitionStatus: "FAILED" })], 10)],
    ["缺原图", source(), summarizePageReadiness([page({ pageImageObjectKey: null })], 10)],
    ["无 chunks", source(), summarizePageReadiness([page()], 0)],
    ["空版本", source(), summarizePageReadiness([], 0)],
    ["传统链解析中", source({ hasOriginalAsset: true, parseStatus: "PARSING" }), summarizePageReadiness([pdfTextPage], 0)]
  ];

  it.each(cases)("%s：publishReady 与 publishBlockers 完全一致", (_label, src, facts) => {
    const readiness = deriveKnowledgeVersionReadiness(src, facts);
    expect(readiness.publishReady).toBe(readiness.publishBlockers.length === 0);
    expect(readiness.reviewReady).toBe(readiness.reviewBlockers.length === 0);
    expect(readiness.aiReady).toBe(readiness.aiBlockers.length === 0 && src.usageMode === "AI_ENABLED" && readiness.searchableContentReady);
    // 每个 blocker 都必须声明作用域，且阻止发布
    expect(readiness.blockers.every((blocker) => blocker.blocks.includes("PUBLISH"))).toBe(true);
  });
});

describe("Test 11：页面链 Ready 时 optional ORIGINAL 解析失败不阻塞正式使用", () => {
  const pagesReady = () => summarizePageReadiness([page(), page()], 12);

  it("ORIGINAL parseStatus=FAILED + 页面链完整：仅 warning，不阻塞审核/发布/AI", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ hasOriginalAsset: true, parseStatus: "FAILED" }),
      pagesReady()
    );
    expect(readiness.offlinePageContentReady).toBe(true);
    expect(readiness.reviewReady).toBe(true);
    expect(readiness.publishReady).toBe(true);
    expect(readiness.aiReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.warnings.join(" ")).toContain("原始资料文本解析失败，不影响已确认页面内容的正式使用");
  });

  it("ORIGINAL 无文本层且无检索源 + 页面链完整：同样只 warning", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ hasOriginalAsset: true, parseStatus: "SEARCH_SOURCE_REQUIRED" }),
      pagesReady()
    );
    expect(readiness.publishReady).toBe(true);
    expect(readiness.blockers).toHaveLength(0);
    expect(readiness.warnings.join(" ")).toContain("不影响正式发布与 AI 使用");
  });

  it("页面链未就绪时 ORIGINAL 解析失败仍是硬拦截（不能被降级掩盖）", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source({ hasOriginalAsset: true, parseStatus: "FAILED" }),
      summarizePageReadiness([page({ recognitionStatus: "REVIEW_REQUIRED" })], 10)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.blockers.map((item) => item.code)).toContain("TRADITIONAL_PARSE_INCOMPLETE");
  });
});

describe("Case：无页面 / 两条链都未就绪", () => {
  it("空版本 → NO_PAGES + KNOWLEDGE_VERSION_EMPTY", () => {
    const readiness = deriveKnowledgeVersionReadiness(source(), summarizePageReadiness([], 0));
    expect(readiness.publishReady).toBe(false);
    const blocker = readiness.blockers.find((item) => item.code === "NO_PAGES");
    expect(blocker?.knowledgeErrorCode).toBe("KNOWLEDGE_VERSION_EMPTY");
  });

  it("页面无图且无 ORIGINAL → 兜底来源 blocker", () => {
    const readiness = deriveKnowledgeVersionReadiness(
      source(),
      summarizePageReadiness([page({ pageImageObjectKey: null, uploadSource: null, hasText: true })], 0)
    );
    expect(readiness.publishReady).toBe(false);
    expect(readiness.blockers.map((item) => item.code)).toContain("NO_FORMAL_KNOWLEDGE_SOURCE");
  });
});

describe("发布门禁兼容口径（evaluateVersionAiReadiness）", () => {
  it("页面驱动就绪时不再要求 ORIGINAL（原「缺少 ORIGINAL 正式原文件」硬拦截已移除）", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PENDING" },
      {
        hasOriginalAsset: false,
        hasSearchSourceAsset: false,
        pageCount: 3,
        fallbackPageLabelCount: 0,
        mappingCount: 0,
        reliableMappingCount: 0,
        verifiedMappingCount: 0,
        tocItemCount: 0,
        confirmedTocCount: 0,
        unconfirmedRecognitionPageCount: 0,
        pagesMissingImageCount: 0,
        hasOfflinePageImages: true,
        chunkCount: 9
      }
    );
    expect(result.eligible).toBe(true);
    expect(result.publishReady).toBe(true);
    expect(result.blockers.join(" ")).not.toContain("ORIGINAL");
  });

  it("两条链都未就绪时才拦截", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PENDING" },
      {
        hasOriginalAsset: false,
        hasSearchSourceAsset: false,
        pageCount: 0,
        fallbackPageLabelCount: 0,
        mappingCount: 0,
        reliableMappingCount: 0,
        verifiedMappingCount: 0,
        tocItemCount: 0,
        confirmedTocCount: 0,
        unconfirmedRecognitionPageCount: 0,
        pagesMissingImageCount: 0
      }
    );
    expect(result.eligible).toBe(false);
    expect(result.publishReady).toBe(false);
  });

  it("聚合口径（仅 unconfirmedRecognitionPageCount）保持既有提示", () => {
    const result = evaluateVersionAiReadiness(
      { usageMode: "AI_ENABLED", parseStatus: "PARSED" },
      {
        hasOriginalAsset: true,
        hasSearchSourceAsset: true,
        pageCount: 79,
        fallbackPageLabelCount: 0,
        mappingCount: 0,
        reliableMappingCount: 0,
        verifiedMappingCount: 0,
        tocItemCount: 0,
        confirmedTocCount: 0,
        unconfirmedRecognitionPageCount: 1,
        pagesMissingImageCount: 0,
        hasOfflinePageImages: true
      }
    );
    expect(result.eligible).toBe(false);
    expect(result.blockers.join(" ")).toContain("1 页识别未确认");
    expect(result.blockerCodes).toEqual(["KNOWLEDGE_VERSION_PAGES_UNCONFIRMED"]);
  });
});
