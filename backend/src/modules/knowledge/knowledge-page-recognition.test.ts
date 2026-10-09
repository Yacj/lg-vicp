import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});
import { generateObject } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import {
  extractPageLabelFromFileName,
  buildRecognitionDraft,
  emptyRecognitionMetadata,
  mergePageMetadata,
  pageRecognitionResultSchema,
  readPageRecognitionMeta,
  resolveOptionThermalResistances,
  assertThermalReferenceSetEditable
} from "../../shared/page-recognition.js";
import { assertKnowledgeVersionEditable } from "./knowledge-version-guard.js";
import { buildPageRecognitionPrompt, describePageRecognitionFailure } from "./knowledge-page-recognition.service.js";
import { getAiTaskRuntimePolicy, languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";

describe("页面图片识别提示词", () => {
  it("识别失败保留稳定错误码且不把底层异常直接给用户", () => {
    expect(describePageRecognitionFailure(Object.assign(new Error("gateway secret"), { name: "TimeoutError" })))
      .toEqual({ code: "PAGE_RECOGNITION_TIMEOUT", message: "页面识别超时，请重试" });
    expect(describePageRecognitionFailure(new Error("upstream internal stack")))
      .toEqual({ code: "PAGE_RECOGNITION_FAILED", message: "页面识别服务未能完成处理，请稍后重试" });
    expect(describePageRecognitionFailure(Object.assign(new Error("Insufficient Balance (request_id: secret)"), { name: "AI_APICallError" })))
      .toEqual({ code: "PAGE_RECOGNITION_BALANCE_INSUFFICIENT", message: "图片识别服务余额不足，请联系平台管理员处理后重试" });
    expect(describePageRecognitionFailure(Object.assign(new Error("Payment Required"), { name: "AI_APICallError", statusCode: 402 })))
      .toMatchObject({ code: "PAGE_RECOGNITION_BALANCE_INSUFFICIENT" });
    expect(describePageRecognitionFailure(Object.assign(new Error("服务暂时不可用"), { name: "AI_APICallError", statusCode: 503 })))
      .toMatchObject({ code: "PAGE_RECOGNITION_FAILED" });
  });
  it("图集结构化识别有独立输出预算，避免 1200 token 截断 JSON", () => {
    expect(languageModelSamplingOptions("PAGE_RECOGNITION").maxOutputTokens).toBe(8192);
    expect(getAiTaskRuntimePolicy("PAGE_RECOGNITION").timeoutMs).toBe(120_000);
    expect(languageModelSamplingOptions("VISION").maxOutputTokens).toBe(1200);
  });

  it("系统规则经 instructions 传给 AI SDK，图片和页码保留在用户消息", async () => {
    const prompt = buildPageRecognitionPrompt({
      documentTitle: "外墙图集",
      pageLabel: "12",
      physicalPageNumber: 12,
      imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    });
    const model = new MockLanguageModelV3({
      doGenerate: async () => { throw new Error("已到达模型调用"); }
    });

    await expect(generateObject({
      model,
      schema: pageRecognitionResultSchema,
      ...prompt,
      maxRetries: 0
    })).rejects.toThrow("已到达模型调用");
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(prompt.instructions).toContain("只提取页面真实存在的数据");
    expect(prompt.instructions).toContain("options[] 元素仅使用 thicknessMm、productThermalResistance、totalThermalResistance、kValue");
    expect(prompt.instructions).toContain("不要输出 physicalPageNumber、systemCode、constructionLayers");
    expect(prompt.messages).toHaveLength(1);
    expect(prompt.messages[0]?.role).toBe("user");
    expect(prompt.messages[0]?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("当前 physicalPageNumber：12")
    });
  });
});

function readPngWidth(buffer: Buffer): number | null {
  if (buffer.length < 24) return null;
  return buffer.readUInt32BE(16);
}

describe("extractPageLabelFromFileName", () => {
  it("解析 page-021.png → 21", () => {
    expect(extractPageLabelFromFileName("page-021.png")).toBe("21");
  });

  it("解析 page_022.jpg → 22", () => {
    expect(extractPageLabelFromFileName("page_022.jpg")).toBe("22");
  });

  it("解析嵌套路径 basename", () => {
    expect(extractPageLabelFromFileName("pages/page-023.png")).toBe("23");
  });
});

describe("page recognition metadata state", () => {
  it("keeps manual page fields synchronized with the structured draft", () => {
    const draft = buildRecognitionDraft({
      structuredData: { pageLabel: "22", pageTitle: "AI 标题", fullText: "旧文本", systems: [] },
      pageLabel: "22A",
      pageTitle: "人工标题",
      parsedText: "人工修正文"
    });
    expect(draft).toMatchObject({ pageLabel: "22A", pageTitle: "人工标题", fullText: "人工修正文" });
  });

  it("识别完成进入 REVIEW_REQUIRED，不直接 CONFIRMED", () => {
    const meta = mergePageMetadata(null, emptyRecognitionMetadata({
      recognitionStatus: "REVIEW_REQUIRED",
      structuredData: pageRecognitionResultSchema.parse({
        fullText: "示例",
        systems: [{ constructionCode: "A1-1", options: [{ thicknessMm: 50, rValue: 1.2, kValue: 0.7 }] }]
      })
    }));
    expect(readPageRecognitionMeta(meta).recognitionStatus).toBe("REVIEW_REQUIRED");
    expect(readPageRecognitionMeta(meta).confirmedStructuredData).toBeNull();
  });

  it("重新识别保留 confirmedStructuredData", () => {
    const confirmed = pageRecognitionResultSchema.parse({ fullText: "旧确认", systems: [] });
    const meta = mergePageMetadata(
      emptyRecognitionMetadata({
        recognitionStatus: "CONFIRMED",
        structuredData: confirmed,
        confirmedStructuredData: confirmed
      }),
      {
        recognitionStatus: "PENDING",
        structuredData: null,
        confirmedStructuredData: confirmed
      }
    );
    const read = readPageRecognitionMeta(meta);
    expect(read.recognitionStatus).toBe("PENDING");
    expect(read.confirmedStructuredData?.fullText).toBe("旧确认");
  });
});

describe("thermal recognition resistance fields", () => {
  it("keeps product R and total R distinct through recognition parsing", () => {
    const result = pageRecognitionResultSchema.parse({
      fullText: "A1-3 18mm",
      systems: [{ constructionCode: "A1-3", options: [{
        thicknessMm: 18,
        productThermalResistance: 2.88,
        totalThermalResistance: 3.297,
        kValue: 0.303
      }] }]
    });
    const option = result.systems[0]!.options![0]!;
    expect(option.productThermalResistance).toBe(2.88);
    expect(option.totalThermalResistance).toBe(3.297);
    expect(resolveOptionThermalResistances(option)).toMatchObject({
      productThermalResistance: 2.88,
      totalThermalResistance: 3.297,
      kValue: 0.303,
      skipFormalWrite: false
    });
  });

  it("warns and refuses to map legacy rValue with unknown meaning", () => {
    const option = pageRecognitionResultSchema.parse({
      fullText: "legacy",
      systems: [{ options: [{ thicknessMm: 18, rValue: 3.297, kValue: 0.303 }] }]
    }).systems[0]!.options![0]!;
    expect(resolveOptionThermalResistances(option)).toMatchObject({
      productThermalResistance: null,
      totalThermalResistance: null,
      skipFormalWrite: true
    });
    expect(resolveOptionThermalResistances(option).warnings.join(" ")).toContain("无法区分");
  });
});

describe("page and thermal set immutability", () => {
  it("rejects writes to PUBLISHED knowledge versions and thermal sets", () => {
    expect(() => assertKnowledgeVersionEditable({ status: "PUBLISHED" })).toThrowError(
      expect.objectContaining({ code: "KNOWLEDGE_VERSION_NOT_EDITABLE", statusCode: 409 })
    );
    expect(() => assertThermalReferenceSetEditable({ status: "PUBLISHED" })).toThrowError(
      expect.objectContaining({ code: "THERMAL_REFERENCE_SET_NOT_EDITABLE", statusCode: 409 })
    );
    expect(() => assertThermalReferenceSetEditable({ status: "DRAFT" })).not.toThrow();
  });
});

describe("PNG IHDR width", () => {
  it("读取最小 PNG IHDR 宽度", () => {
    const png = Buffer.alloc(33);
    png.write("\u0089PNG\r\n\u001a\n", 0, "binary");
    png.writeUInt32BE(13, 8);
    png.write("IHDR", 12);
    png.writeUInt32BE(1600, 16);
    png.writeUInt32BE(900, 20);
    expect(readPngWidth(png)).toBe(1600);
  });
});
