import "dotenv/config";
import { describe, expect, it } from "vitest";
import { diagnoseReferenceQuery } from "../thermal/reference-query-diagnostics.js";
import { referenceQueryReplyFacts, renderReferenceQueryResponse } from "../thermal/reference-query-response.js";
import type { ThermalQueryState } from "../thermal/thermal-query-state.js";
import { validateReferenceQueryNarrative, validateReferenceQueryNarrativeReview } from "./reference-query-narrative.js";

const query: ThermalQueryState = { systemHint: "薄抹灰", thicknessMm: 45,
  filters: [{ metric: "PRODUCT_R", targetValue: 7.9, mode: "MIN_LIMIT" }] };
const diagnostics = diagnoseReferenceQuery(query, [
  { systemName: "薄抹灰", thicknessMm: 45, productThermalResistance: 3 },
  { systemName: "薄抹灰", thicknessMm: 45 }
], "JOINT");
const facts = referenceQueryReplyFacts(diagnostics, query);
const verdict = { supported: true, scope: "CURRENT_DOCUMENTS", reason: "NO_MATCHING_VALUE", unsupportedClaims: [],
  assertedRecordValues: [], queryClaims: [{ metric: "PRODUCT_R", target: 7.9, operator: "MIN_LIMIT" }],
  missingMetricClaim: false, incompleteCoveragePreserved: true, layerScopePreserved: true,
  proposedActions: ["CHECK_PRODUCT_DETAILS"], executedActions: [] };

describe("查询结论与客服表达分别核验", () => {
  it("未匹配的体系名称仍保留明确角色，不交给表达层猜测类别", () => {
    const q={systemHint:"体系甲",filters:[{metric:"K" as const,mode:"LT" as const,targetValue:.41}]};
    const d=diagnoseReferenceQuery(q,[{systemName:"体系乙",kValue:.3}],"JOINT");
    const f=referenceQueryReplyFacts(d,q);
    expect(f.reason).toBe("IDENTITY_NOT_FOUND");
    expect(f.identityDetails).toEqual([{role:"SYSTEM",label:"体系名称",value:"体系甲"}]);
    expect(f.requested).toContainEqual(expect.objectContaining({metric:"K",operator:"LT",target:.41}));
  });
  it("保留真实查询目标和部分缺列，不把内部取值清单当作客服答案", () => {
    const answer = renderReferenceQueryResponse(diagnostics, query);
    expect(answer).toContain("7.9"); expect(answer).toContain("不低于");
    expect(answer).toContain("45mm"); expect(answer).toContain("薄抹灰");
    expect(answer).toContain("有些表格没有单列"); expect(answer).not.toContain("可核验取值");
    expect(answer).not.toContain("3 m²"); expect(answer).not.toContain("有权访问");
    expect(diagnostics.metricScopes[0]?.values).toEqual([3]); // 诊断证据仍然完整。
  });
  it("不同失败原因不互换：缺资料、缺参数与数值不匹配", () => {
    const empty = diagnoseReferenceQuery(query, [], "JOINT");
    const missing = diagnoseReferenceQuery(query, [{ systemName: "薄抹灰", thicknessMm: 45 }], "JOINT");
    expect(referenceQueryReplyFacts(empty, query).reason).toBe("NO_READABLE_PUBLISHED_DATA");
    expect(referenceQueryReplyFacts(missing, query).reason).toBe("METRIC_NOT_PROVIDED");
    expect(renderReferenceQueryResponse(missing, query)).toContain("没有单独记录");
    expect(renderReferenceQueryResponse(missing, query)).not.toContain("没有符合");
    expect(facts.reason).toBe("NO_MATCHING_VALUE");
  });
  it("原始范围值不能被拼进自然回答，更不能编新厚度或页码", () => {
    expect(validateReferenceQueryNarrative({ answer: "暂没查到薄抹灰45mm、板自身热阻不低于7.9的记录，部分表格未单列这个值。" }, facts)).toBeTruthy();
    for (const answer of ["板自身热阻有3。", "可以选60mm。", "见第37页。", "共有59种产品。"])
      expect(validateReferenceQueryNarrative({ answer }, facts)).toBeNull();
  });
  it("有实际命中时不进入无结果表达合同", () => {
    expect(validateReferenceQueryNarrative({ answer: "没找到。" }, { ...facts, matchedCount: 1 })).toBeNull();
  });
  it("允许自然表达，但不能把目标说成实值、改变指标/边界或伪造执行动作", () => {
    expect(validateReferenceQueryNarrativeReview(verdict, facts)).toBe(true);
    const changes = [
      { scope: "GLOBAL" }, { reason: "METRIC_NOT_PROVIDED" }, { missingMetricClaim: true },
      { assertedRecordValues: [7.9] }, { executedActions: ["CALCULATE"] }, { proposedActions: ["CREATE_REPORT"] },
      { incompleteCoveragePreserved: false }, { layerScopePreserved: false },
      { queryClaims: [] }, { queryClaims: [{ metric: "K", target: 7.9, operator: "MIN_LIMIT" }] },
      { queryClaims: [{ metric: "PRODUCT_R", target: 7.9, operator: "APPROX" }] },
      { unsupportedClaims: ["省略了薄抹灰/45mm条件"] }
    ];
    for (const changed of changes) expect(validateReferenceQueryNarrativeReview({ ...verdict, ...changed }, facts)).toBe(false);
  });
  it("模型自报supported不能代替结构和完整字段校验", () => {
    expect(validateReferenceQueryNarrativeReview({ supported: true }, facts)).toBe(false);
    expect(validateReferenceQueryNarrativeReview({ ...verdict, arbitraryAuthorization: true }, facts)).toBe(false);
  });
});
