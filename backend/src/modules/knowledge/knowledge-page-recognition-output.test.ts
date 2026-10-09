import { generateObject } from "ai";
import { MockLanguageModelV3 } from "ai/test";
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
import { pageRecognitionResultSchema } from "../../shared/page-recognition.js";
import { assessBatchConfirmSafety } from "./knowledge-page-recognition.service.js";
import { normalizePageRecognitionAnnotations, pageRecognitionSchemaIssues, repairPageRecognitionText } from "./knowledge-page-recognition-output.js";

describe("页面识别输出格式修复", () => {
  it("双构造多厚度表按同一行配对，正常留空说明不作为风险", () => {
    const thicknesses = [40, 50, 60, 70, 80, 90];
    const productR = [0.661, 0.826, 0.992, 1.157, 1.322, 1.488];
    const totals = [
      [2.481, 2.646, 2.812, 2.977, 3.142, 3.308],
      [2.566, 2.731, 2.897, 3.062, 3.227, 3.393]
    ];
    const kValues = [
      [0.403, 0.378, 0.356, 0.336, 0.318, 0.302],
      [0.390, 0.366, 0.345, 0.327, 0.310, 0.295]
    ];
    const candidate = pageRecognitionResultSchema.parse({
      pageLabel: "29",
      fullText: "建筑外墙热工计算参考选用表，外墙A1-1、外墙A1-2",
      systems: [0, 1].map((systemIndex) => ({
        constructionCode: `外墙A1-${systemIndex + 1}`,
        layers: [{ order: 7, name: "热固复合聚苯板（G型）", thicknessMm: null, lambda: 0.055, alpha: 1.1, rValue: null }],
        options: thicknesses.map((thicknessMm, index) => ({
          thicknessMm,
          productThermalResistance: productR[index],
          totalThermalResistance: totals[systemIndex]![index],
          kValue: kValues[systemIndex]![index]
        }))
      })),
      warnings: ["热固复合聚苯板（G型）在layers中厚度和rValue留空，其多厚度数值在options中提供。"]
    });
    const normalized = normalizePageRecognitionAnnotations(candidate);
    expect(normalized.warnings).toEqual([]);
    expect(normalized.notes).toEqual(candidate.warnings);
    expect(assessBatchConfirmSafety(normalized)).toEqual({ safe: true, reasons: [] });
    expect(normalized.systems[1]?.options?.[5]).toMatchObject({
      thicknessMm: 90,
      productThermalResistance: 1.488,
      totalThermalResistance: 3.393,
      kValue: 0.295
    });
  });

  it("多厚度数值缺失时保留真实告警", () => {
    const result = pageRecognitionResultSchema.parse({
      fullText: "表格",
      systems: [{ layers: [{ name: "保温板", thicknessMm: null, rValue: null }], options: [{ thicknessMm: 40 }, { thicknessMm: 50 }] }],
      warnings: ["保温板在layers中厚度和rValue留空，其多厚度数值在options中提供。", "50mm 档总热阻不清晰，请核对原图"]
    });
    expect(normalizePageRecognitionAnnotations(result).warnings).toEqual(result.warnings);
  });

  it("修复明确的类型与字段表示差异，并保留人工审核", () => {
    const text = JSON.stringify({
      pageLabel: 2,
      fullText: "外墙构造表，保温层 25 mm，K=0.67",
      systems: [{
        systemName: "薄抹灰系统",
        specClass: "Ⅱ类",
        layers: [{ order: "1", layerName: "保温层", thickness: "25", thermalConductivity: "0.035" }],
        options: [{ thickness: "25", kValue: "0.67", rValue: "1.2" }]
      }],
      notes: "请核对原图",
      warnings: null
    });
    expect(pageRecognitionSchemaIssues(text)).toContain("pageLabel");
    const repaired = repairPageRecognitionText(text);
    expect(repaired).not.toBeNull();
    const candidate = pageRecognitionResultSchema.parse(JSON.parse(repaired!));
    expect(candidate.pageLabel).toBe("2");
    expect(candidate.systems[0]?.specClass).toBe("II");
    expect(candidate.systems[0]?.layers?.[0]).toMatchObject({ name: "保温层", thicknessMm: 25, lambda: 0.035 });
    expect(candidate.systems[0]?.options?.[0]).toMatchObject({
      thicknessMm: 25,
      kValue: 0.67,
      productThermalResistance: null,
      totalThermalResistance: null
    });
    expect(candidate.warnings?.join(" ")).toContain("未映射到产品层或总传热阻");
  });

  it("不补算或猜测含义不明的数值", () => {
    const repaired = repairPageRecognitionText(JSON.stringify({
      fullText: "R 0.8",
      systems: [{ options: [{ productThermalResistance: "0.8", totalThermalResistance: "0.9mm", kValue: "-" }] }]
    }));
    const candidate = pageRecognitionResultSchema.parse(JSON.parse(repaired!));
    expect(candidate.systems[0]?.options?.[0]).toMatchObject({
      productThermalResistance: 0.8,
      totalThermalResistance: null,
      kValue: null
    });
  });

  it("无法解析的输出仍然失败", () => {
    expect(repairPageRecognitionText("{invalid json")).toBeNull();
    expect(pageRecognitionSchemaIssues("{invalid json")).toEqual(["JSON_PARSE"]);
  });

  it("AI SDK 用修复后的内容重新校验正式 schema", async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => ({
        content: [{ type: "text", text: JSON.stringify({
          pageLabel: 2,
          fullText: "第 2 页文字",
          systems: [{ specClass: "Ⅱ", options: [{ thicknessMm: "25", kValue: "0.67" }] }]
        }) }],
        finishReason: "stop",
        usage: {
          inputTokens: { total: 8, noCache: 8, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 6, text: 6, reasoning: undefined }
        },
        warnings: []
      })
    });
    const result = await generateObject({
      model,
      schema: pageRecognitionResultSchema,
      prompt: "识别页面",
      experimental_repairText: async ({ text }) => repairPageRecognitionText(text),
      maxRetries: 0
    });
    expect(result.object).toMatchObject({
      pageLabel: "2",
      systems: [{ specClass: "II", options: [{ thicknessMm: 25, kValue: 0.67 }] }]
    });
    expect(model.doGenerateCalls).toHaveLength(1);
  });
});
