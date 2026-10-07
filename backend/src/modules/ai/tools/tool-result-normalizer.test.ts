import { beforeAll, describe, expect, it } from "vitest";
import {
  normalizeComparisonForModel,
  normalizeProductDataForModel,
  normalizeSearchKnowledgeForModel,
  normalizeReferenceLookupForModel,
  normalizeToolResultForModel,
  toModelVisibleToolOutput
} from "./tool-result-normalizer.js";
import { emptyThermalState, freezeProductComparisonResult } from "../compare-product.js";
import { USER_LANGUAGE_NOTES } from "../../../shared/ai-response-policy.js";

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

describe("Tool Result Normalizer", () => {
  it("热工厚度范围与偏好经过二次归一仍保留，回答说明所有硬条件", () => {
    const data = normalizeToolResultForModel("thermal", { data: {
      found: false, candidates: [], thicknessMin: 18, thicknessMax: 25, preferThinner: true,
      metric: "K", targetValue: 0.3, lookupMode: "MAX_LIMIT",
      filters: [{ metric: "K", targetValue: 0.3, mode: "MAX_LIMIT" }]
    } });
    expect(data).toMatchObject({ thicknessMin: 18, thicknessMax: 25, preferThinner: true });
    expect((data as any).instruction).toContain("厚度 18～25mm");
    expect((data as any).instruction).toContain("不得偷偷放宽厚度");
  });
  it("跨体系回退不能同时要求先回答有", () => {
    const result = normalizeReferenceLookupForModel({ found: true, candidates: [], matchedSystemHint: false, isFallback: true, lookupMode: "APPROX" });
    expect(result.instruction).toContain("没有找到符合");
    expect(result.instruction).not.toContain("第一行直接回答有");
    expect((normalizeToolResultForModel("thermal", { data: result }) as any).instruction).not.toContain("第一行直接回答有");
    expect(normalizeReferenceLookupForModel({ found: true, candidates: [], matchedSystemHint: true }).instruction).toContain("第一行直接回答有");
  });
  it("search_knowledge 只保留 title/section/pageLabel/content", () => {
    const data = normalizeSearchKnowledgeForModel({
      hits: [{
        title: "图集",
        section: "5.2",
        pageLabel: "A7",
        content: "窗洞口应封堵"
      }]
    });
    expect(data.available).toBe(true);
    expect(data.hits[0]).toEqual({
      title: "图集",
      section: "5.2",
      pageLabel: "A7",
      content: "窗洞口应封堵"
    });
    expect(JSON.stringify(data)).not.toMatch(/documentId|chunkId|score|physicalPageNumber|citationAnchor/);
  });

  it("0 个可核验来源时明确说明，不进入选择", () => {
    const data = normalizeSearchKnowledgeForModel({ hits: [] });
    expect(data.available).toBe(false);
    expect(data.note).toBe(USER_LANGUAGE_NOTES.missingVerifiableSource);
  });

  it("get_product_data 不返回内部 ID 堆和编造禁令", () => {
    const data = normalizeProductDataForModel({
      products: [{ id: "p1", name: "VICP", summary: "薄抹灰", knowledgeDocumentIds: ["doc-1"] }],
      missingProductIds: ["missing"]
    });
    expect(data.products[0]).toMatchObject({ id: "p1", name: "VICP", hasTechnicalDocs: true });
    expect(data.missingNotes).toEqual([USER_LANGUAGE_NOTES.missingProduct]);
    expect(JSON.stringify(data)).not.toContain("knowledgeDocumentIds");
    expect(JSON.stringify(data)).not.toContain("禁止编造");
  });

  it("thermal 不把公式和过程细节交给模型", async () => {
    const { normalizeThermalForModel } = await import("./tool-result-normalizer.js");
    const data = normalizeThermalForModel({
      valid: true,
      K: 0.3,
      R: 3.3,
      pass: true,
      process: [{ title: "查表", formula: "K=1/R", value: 0.3 }]
    });
    expect(data.K).toBe(0.3);
    expect(data.process).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain("K=1/R");
  });

  it("选用表未命中时要求继续检索知识库，不宣布没有方案", async () => {
    const { normalizeReferenceLookupForModel } = await import("./tool-result-normalizer.js");
    const data = normalizeReferenceLookupForModel({
      found: false,
      candidates: [],
      notes: ["没有已发布且生效中的图集参考集，无法查表（请先在后台导入并审核发布）"]
    });
    expect(data.instruction).toContain("继续检索知识库");
    expect(data.instruction).not.toContain("暂未找到");
  });

  it("compare_products 去掉完整 ComparisonResult 倾倒", () => {
    const result = freezeProductComparisonResult({
      products: [
        { id: "a", name: "VICP", summary: "优势更明显", status: "ACTIVE" },
        { id: "b", name: "产品A", summary: "成本侧", status: "ACTIVE" }
      ],
      dimensions: [{
        key: "summary",
        label: "简介",
        sourceType: "PRODUCT_FIELD",
        items: [
          { productId: "a", value: "优势更明显" },
          { productId: "b", value: "成本侧" }
        ]
      }],
      evidenceRefs: [],
      missingNotes: [USER_LANGUAGE_NOTES.missingPrice],
      thermal: emptyThermalState(),
      ranking: null,
      scores: null
    });
    const normalized = normalizeComparisonForModel(result);
    expect(normalized.thermal.available).toBe(false);
    expect(normalized.thermal.note).toBe(USER_LANGUAGE_NOTES.missingThermal);
    expect(normalized.instruction).toContain("不要复述整份对比上下文");
    expect(normalized.differences[0]?.items[0]?.productName).toBe("VICP");
  });

  it("等待态不对模型暴露选项列表，避免写成 Markdown 编号", () => {
    const visible = toModelVisibleToolOutput({
      ok: true,
      comparison: { products: [] },
      __agentSignal: "WAITING_USER_INPUT",
      comparisonResult: { dump: true },
      comparisonContext: { huge: true },
      prompt: "请选择",
      options: [{ id: "1", title: "综合技术方案报告" }],
      availableTypes: [{ code: "technical_scheme" }],
      request: { type: "USER_SELECTION", options: [] }
    }) as Record<string, unknown>;
    expect(visible.comparisonResult).toBeUndefined();
    expect(visible.comparisonContext).toBeUndefined();
    expect(visible.__agentSignal).toBeUndefined();
    expect(visible.options).toBeUndefined();
    expect(visible.availableTypes).toBeUndefined();
    expect(visible.request).toBeUndefined();
    expect(visible.waiting).toBe(true);
    expect(String(visible.instruction)).toContain("不要把选项写成 Markdown 编号");
  });
});
