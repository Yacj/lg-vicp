import { describe, expect, it } from "vitest";
import {
  comparisonBenchmarkTypeSchema,
  comparisonEvidenceSideSchema,
  comparisonMaterialCategorySchema,
  comparisonRuleBatchCreateSchema,
  comparisonRuleCreateSchema,
  comparisonVersionCreateSchema
} from "./comparison.schemas.js";

describe("comparison 枚举镜像", () => {
  it("材料类别覆盖 VICP 与五类竞品", () => {
    expect(comparisonMaterialCategorySchema.options).toEqual([
      "VICP", "EPS", "XPS", "ROCK_WOOL", "PU", "TRADITIONAL_BOARD"
    ]);
  });

  it("比较基准覆盖同厚度/同导热系数/同热阻/性能/其他", () => {
    expect(comparisonBenchmarkTypeSchema.options).toEqual([
      "SAME_THICKNESS", "SAME_LAMBDA", "SAME_R_VALUE", "PERFORMANCE", "OTHER"
    ]);
  });

  it("证据侧仅 VICP 与竞品两侧", () => {
    expect(comparisonEvidenceSideSchema.options).toEqual(["VICP", "COMPETITOR"]);
  });
});

describe("版本创建校验", () => {
  it("code/name 必填", () => {
    const result = comparisonVersionCreateSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("接受完整字段（effectiveAt 支持 ISO 字符串转换）", () => {
    const result = comparisonVersionCreateSchema.safeParse({
      code: "VICP-VS-EPS-2026",
      name: "VICP 对比 EPS",
      evidenceLevel: "A",
      effectiveAt: "2026-01-01T00:00:00Z"
    });
    expect(result.success).toBe(true);
  });

  it("evidenceLevel 拒绝非法等级", () => {
    const result = comparisonVersionCreateSchema.safeParse({
      code: "X", name: "Y", evidenceLevel: "D"
    });
    expect(result.success).toBe(false);
  });

  it("update schema 为 partial（可只改 name）", () => {
    const result = comparisonVersionCreateSchema.partial().safeParse({ name: "改名" });
    expect(result.success).toBe(true);
  });
});

describe("规则创建校验", () => {
  const base = {
    dimensionId: "11111111-1111-4111-8111-111111111111",
    vicpMaterialId: "22222222-2222-4222-8222-222222222222",
    competitorMaterialId: "33333333-3333-4333-8333-333333333333",
    benchmarkType: "SAME_THICKNESS",
    benchmarkDesc: "同厚度 50mm 对比",
    vicpValue: 0.032,
    vicpUnit: "W/(m·K)",
    advantageText: "导热系数更低",
    applicability: "适用于夏热冬冷地区",
    mandatoryDisclosure: "数值以检测报告为准"
  };

  it("必填完整时通过", () => {
    expect(comparisonRuleCreateSchema.safeParse(base).success).toBe(true);
  });

  it("vicpValue 必须为正数（0 拒绝）", () => {
    const result = comparisonRuleCreateSchema.safeParse({ ...base, vicpValue: 0 });
    expect(result.success).toBe(false);
  });

  it("competitorValue 可空（定量不足时仅 VICP 侧）", () => {
    const result = comparisonRuleCreateSchema.safeParse({ ...base, competitorValue: null });
    expect(result.success).toBe(true);
  });

  it("advantageText / applicability / mandatoryDisclosure 必填", () => {
    expect(comparisonRuleCreateSchema.safeParse({ ...base, advantageText: "" }).success).toBe(false);
    expect(comparisonRuleCreateSchema.safeParse({ ...base, applicability: "" }).success).toBe(false);
    expect(comparisonRuleCreateSchema.safeParse({ ...base, mandatoryDisclosure: "" }).success).toBe(false);
  });
});

describe("批量导入校验", () => {
  const material = {
    materialKey: "vicp|VICP 板|V-50",
    category: "VICP",
    name: "VICP 板",
    model: "V-50"
  };
  const rule = {
    vicpMaterialKey: "vicp|VICP 板|V-50",
    competitorMaterialKey: "eps|EPS 板|E-50",
    dimensionId: "11111111-1111-4111-8111-111111111111",
    benchmarkType: "SAME_THICKNESS",
    benchmarkDesc: "同厚度对比",
    vicpValue: 0.032,
    vicpUnit: "W/(m·K)",
    advantageText: "导热系数更低",
    applicability: "适用条件",
    mandatoryDisclosure: "必要披露"
  };

  it("材料与规则同时提供时通过", () => {
    const result = comparisonRuleBatchCreateSchema.safeParse({ materials: [material], rules: [rule] });
    expect(result.success).toBe(true);
  });

  it("规则引用材料必须同时导入（refine 拦截）", () => {
    const result = comparisonRuleBatchCreateSchema.safeParse({ materials: [], rules: [rule] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("必须同时提供");
  });

  it("materials 与 rules 同时为空可通过（空导入幂等）", () => {
    expect(comparisonRuleBatchCreateSchema.safeParse({ materials: [], rules: [] }).success).toBe(true);
  });
});