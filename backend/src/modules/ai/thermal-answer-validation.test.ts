import { describe, expect, it, vi } from "vitest";
import { buildAllowedAnswerFacts, buildCalculationAnswer, detectReferenceSourceConflicts, renderAllowedFactsForModel, validateAnswerFacts, validateOrRepairThermalAnswer } from "./thermal-answer-validation.js";
import { normalizeConversationLookupQuery } from "./tools/thermal-lookup.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

const candidate: ReferenceLookupCandidate = { id: "row-A", schemeCode: "S-A", productSpecId: "spec-A", specCode: "SP-A", thicknessMm: 60,
  productThermalResistance: 8, totalThermalResistance: 8.313, kValue: 0.12, lambda: 0.005, alpha: 1.25,
  sourcePageLabel: "A-22", evidenceSource: "正式资料" };

describe("发送前原子事实门禁", () => {
  it("EXACT身份失败允许实际值解释，禁止冒充命中或切换厚度", () => {
    const query = { systemId: "sys-i", schemeId: "scheme-i", thicknessMm: 18, filters: [{ metric: "K" as const, mode: "EXACT" as const, targetValue: 0.3 }] };
    const identity = { id: "identity", systemId: "sys-i", schemeId: "scheme-i", schemeCode: "A1-3", thicknessMm: 18, kValue: 0.303,
      productThermalResistance: 2.88, totalThermalResistance: 3.297 };
    const facts = buildAllowedAnswerFacts(query, [], "是不是正好0.300", 0, { identityMatchedButMetricFailed: [identity] });
    expect(facts.candidates).toEqual([]);
    expect(validateAnswerFacts("不是正好0.300，不满足这个精确条件；A1-3，18mm的实际K=0.303。", facts).passed).toBe(true);
    expect(validateAnswerFacts("A1-3，18mm，K=0.303，满足全部条件。", facts).passed).toBe(false);
    expect(validateAnswerFacts("A1-3，70mm，实际K=0.303，不满足条件。", facts).passed).toBe(false);
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!, facts).passed).toBe(true);
  });
  it.each(["产品层热阻 R=8.3", "总热阻 R₀=8", "厚度 18 mm", "K=0.3", "λ=0.003", "α=1.5", "方案 S-B", "规格 SP-B", "第7页", "最高", "全部", "唯一", "符合上海标准"])("拒绝不具备完整授权的事实：%s", invalid => {
    const facts = buildAllowedAnswerFacts({}, [candidate], "详细参数");
    expect(validateAnswerFacts(invalid, facts)).toEqual({ passed: false, code: "INVALID_FACT" });
    expect(validateAnswerFacts(`${facts.canonicalAnswers[0]}\n${invalid}`, facts).passed).toBe(false);
  });
  it("同一数值在另一候选里合法，也不能跨候选拼字段", () => {
    const other = { ...candidate, id: "row-B", schemeCode: "S-B", thicknessMm: 18, alpha: 1.5, productThermalResistance: 2.8 };
    const facts = buildAllowedAnswerFacts({}, [candidate, other], "详细参数列出来");
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!, facts).passed).toBe(true);
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!.replace("厚度 60 mm", "厚度 18 mm"), facts).passed).toBe(false);
    expect(validateAnswerFacts(facts.canonicalAnswers[0]!.replace("α=1.25", "α=1.5"), facts).passed).toBe(false);
  });
  it("事实快照不会随后续候选修改漂移，硬条件违规/相邻行不能进入正式事实", () => {
    const original = { ...candidate };
    const facts = buildAllowedAnswerFacts({ thicknessMm: 60 }, [original, { ...candidate, id: "neighbor", thicknessMm: 61 }]);
    original.productThermalResistance = 8.3;
    expect(facts.candidates).toHaveLength(1); expect(facts.candidates[0]?.productThermalResistance).toBe(8);
    expect(facts.canonicalAnswers[0]).toContain("R=8 ");
  });
  it("缺失印刷标签不会使用物理页序、atlasPage 或 evidenceRef", () => {
    const dirty = { ...candidate, sourcePageLabel: null, atlasPage: "7", evidenceRef: "第7页", physicalPageNumber: 7 };
    const facts = buildAllowedAnswerFacts({}, [dirty]);
    expect(facts.canonicalAnswers[0]).toContain("可查看原始来源页面"); expect(facts.canonicalAnswers[0]).not.toContain("第7页");
  });
  it.each([
    ["保温板自身热阻2.8左右", "PRODUCT_R", "APPROX"], ["板自身R2.8左右", "PRODUCT_R", "APPROX"],
    ["整墙热阻3.3左右", "TOTAL_R", "APPROX"], ["主断面传热阻就是3.3", "TOTAL_R", "EXACT"],
    ["传热系数0.3左右", "K", "APPROX"], ["K等于0.3", "K", "EXACT"], ["K不超过0.3", "K", "MAX_LIMIT"], ["总热阻不低于3.3", "TOTAL_R", "MIN_LIMIT"]
  ])("用户显式指标和模式不会被模型改写：%s", (message, metric, mode) => {
    const result = normalizeConversationLookupQuery({ metric: "TOTAL_R", targetValue: 8.3, mode: "EXACT" }, message!);
    expect(result.needsClarification).toBe(false); expect(result.query.filters?.[0]).toMatchObject({ metric, mode });
  });
  it("一次重生成仍违规时确定性 fallback，未经核验的草稿不会成为返回文本", async () => {
    const facts = buildAllowedAnswerFacts({}, [candidate]);
    const retry = vi.fn(async () => "产品R=8.3");
    const result = await validateOrRepairThermalAnswer("产品R=8.3", facts.canonicalAnswers, retry, facts);
    expect(retry).toHaveBeenCalledTimes(1); expect(result.fallback).toBe(true); expect(result.text).toBe(facts.canonicalAnswers[0]);
    const good = await validateOrRepairThermalAnswer(result.text, facts.canonicalAnswers, retry, facts);
    expect(good.repaired).toBe(false); expect(retry).toHaveBeenCalledTimes(1);
  });
  it("重生成异常仍使用已核验模板", async () => {
    const facts = buildAllowedAnswerFacts({}, [candidate]);
    const result = await validateOrRepairThermalAnswer("非法数字", facts.canonicalAnswers, async () => { throw new Error("不可用"); }, facts);
    expect(result.fallback).toBe(true); expect(validateAnswerFacts(result.text, facts).passed).toBe(true);
  });
  it("正式计算来自冻结展示数据，未授权适用范围不能直接宣称达标", () => {
    const answer = buildCalculationAnswer({ mode: "LAYERED", resultK: 0.12, totalResistance: 8.313, compliant: true, limitKValue: 0.3, steps: [], layers: [] });
    expect(answer).toContain("K=0.12"); expect(answer).toContain("R₀=8.313"); expect(answer).not.toContain("已达标"); expect(answer).toContain("适用范围");
  });
});

/**
 * 阶段2 B2：零命中的三种情况必须说三种话。
 * 真实失败是「保温0.3的材料有么」→「产品热阻」之后回答「没有档位」，
 * 让用户以为资料里没有材料，而实际是「该指标下的已发布档位是这些值」。
 */
describe("零命中话术：缺列 / 有档位但不等 / 真无方案，三者不得混说", () => {
  const query = { filters: [{ metric: "PRODUCT_R" as const, mode: "APPROX" as const, targetValue: 0.3 }] };

  it("整表缺该指标字段 → 明确说「没有记录该字段」，不得说「没有满足条件的方案」", () => {
    const facts = buildAllowedAnswerFacts(query, [], "产品热阻", 0, { missingMetricFields: ["PRODUCT_R"] });
    expect(facts.missingMetricFields).toEqual(["PRODUCT_R"]);
    const answer = facts.canonicalAnswers[0]!;
    expect(answer).toContain("没有记录产品层热阻 R 字段");
    expect(answer).not.toContain("没有找到同时满足");
    expect(validateAnswerFacts(answer, facts).passed).toBe(true);
  });

  it("只有指标条件、零命中 → 列出已发布真实取值，不得只说「没有档位」", () => {
    const facts = buildAllowedAnswerFacts(query, [], "产品热阻", 0, { metricScope: { metric: "PRODUCT_R", values: [4, 5, 6], count: 3 } });
    const answer = facts.canonicalAnswers[0]!;
    expect(answer).toContain("4、5、6");
    expect(answer).toContain("产品层热阻 R");
    expect(answer).not.toContain("没有找到同时满足");
    expect(validateAnswerFacts(answer, facts).passed).toBe(true);
  });

  it("零命中时允许复述范围内的真实取值，但不允许复述范围外的数值", () => {
    const facts = buildAllowedAnswerFacts(query, [], "产品热阻", 0, { metricScope: { metric: "PRODUCT_R", values: [4, 5], count: 2 } });
    expect(validateAnswerFacts("已发布档位里产品层热阻 R=4，产品层热阻 R=5。", facts).passed).toBe(true);
    // 7 不在已发布取值里：零命中场景下也不允许凭空多报一个档位。
    expect(validateAnswerFacts("已发布档位里产品层热阻 R=7。", facts).passed).toBe(false);
  });

  it("身份命中但指标不满足时优先解释实际值，不被指标取值概览覆盖", () => {
    const identity = { id: "row-x", schemeCode: "A1-3", thicknessMm: 25, productThermalResistance: 4, totalThermalResistance: 4.307, kValue: 0.232 };
    const facts = buildAllowedAnswerFacts(query, [], "产品热阻", 0, {
      identityMatchedButMetricFailed: [identity],
      metricScope: { metric: "PRODUCT_R", values: [4, 5], count: 2 }
    });
    expect(facts.canonicalAnswers[0]).toContain("实际正式值");
    expect(facts.canonicalAnswers[0]).toContain("A1-3");
  });

  it("既无缺列也无取值概览 → 才使用通用「没有同时满足条件」表述", () => {
    const facts = buildAllowedAnswerFacts({ thicknessMm: 18, specClass: "III" }, [], "", 0);
    expect(facts.canonicalAnswers[0]).toContain("没有找到同时满足");
  });
});

/**
 * 阶段2 来源契约：正式热工参考集（thermal_reference_rows）与已确认图集页
 * （页面识别确认的 confirmedStructuredData）是两条不同审核链路。
 * 同一构造同一厚度上数值不一致时，不得静默择一，也不得把页面确认值说成正式集值。
 */
describe("跨来源契约：来源类型必须可区分，数值冲突不得静默择一", () => {
  const source = { sourceDocumentId: "doc", sourceVersionId: "v", sourcePageId: "page-22", systemId: "sys", schemeId: "scheme", productSpecId: "spec" };
  const thermalRow = { ...source, id: "row-35", referenceKind: "THERMAL_ROW" as const, schemeCode: "A1-3", thicknessMm: 35,
    productThermalResistance: 5, totalThermalResistance: 5.3068, kValue: 0.1884, sourcePageLabel: "22", evidenceSource: "正式热工集" };
  const knowledgePage = { ...source, id: "page-22-opt-1", referenceKind: "KNOWLEDGE_PAGE" as const, constructionCode: "A1-3", thicknessMm: 35,
    productThermalResistance: 4.8, totalThermalResistance: 5.1068, kValue: 0.1958, sourcePageLabel: "22", evidenceSource: "图集页 P22" };

  it("同构造同厚度但产品层 R 不同 → 报冲突，两个来源的值都保留", () => {
    const conflicts = detectReferenceSourceConflicts([thermalRow, knowledgePage]);
    expect(conflicts).toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: "A1-3", thicknessMm: 35, metric: "PRODUCT_R", thermalRow: 5, knowledgePage: 4.8 })
    ]));
    expect(conflicts.find((item) => item.metric === "PRODUCT_R")).toBeDefined();
  });

  it("数值一致的同一档位不报冲突", () => {
    expect(detectReferenceSourceConflicts([thermalRow, { ...knowledgePage, productThermalResistance: 5,
      totalThermalResistance: 5.3068, kValue: 0.1884 }])).toEqual([]);
  });

  it("不同厚度不比较（甲方 Excel 的整体 25mm 与分层 35mm 不是冲突）", () => {
    const overall25 = { ...thermalRow, thicknessMm: 25, productThermalResistance: 4 };
    expect(detectReferenceSourceConflicts([overall25, knowledgePage])).toEqual([]);
  });

  it("冲突说明写明两个来源，并提示核对原页", () => {
    const facts = buildAllowedAnswerFacts({}, [thermalRow, knowledgePage], "详细参数");
    expect(facts.sourceConflicts?.length).toBeGreaterThan(0);
    const answer = facts.canonicalAnswers[0]!;
    expect(answer).toContain("正式热工参考集（已审核发布）为 5");
    expect(answer).toContain("已确认图集页（页面识别确认）为 4.8");
    expect(answer).toContain("请以原始图集页核对");
    expect(validateAnswerFacts(answer, facts).passed).toBe(true);
  });

  it("渲染给模型的事实时标注来源类型，并单列冲突段", () => {
    const facts = buildAllowedAnswerFacts({}, [thermalRow], "详细参数");
    expect(renderAllowedFactsForModel(facts)).toContain("来源类型 正式热工参考集（已审核发布）");
    const withConflict = buildAllowedAnswerFacts({}, [thermalRow, knowledgePage], "详细参数");
    expect(renderAllowedFactsForModel(withConflict)).toContain("跨来源数值不一致");
  });

  it("默认（未标 referenceKind）按正式热工参考集处理，不误标成图集页", () => {
    const facts = buildAllowedAnswerFacts({}, [{ ...thermalRow, referenceKind: undefined }], "详细参数");
    expect(facts.canonicalAnswers[0]).toContain("正式热工参考集（已审核发布）");
    expect(facts.canonicalAnswers[0]).not.toContain("已确认图集页");
  });
});
