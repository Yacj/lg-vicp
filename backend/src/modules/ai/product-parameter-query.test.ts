import { describe, expect, it } from "vitest";
import { inheritParameterTarget, productParameterQuerySchema, validateProductParameterEvidence, type ProductParameterQuery } from "./product-parameter-query.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { hasLambdaField, insideThermalUnit, lambdaUnitIsValid } from "../../shared/lambda-field.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { applySemanticQuery } from "../thermal/semantic-query.js";
export const lambdaQuery = (patch: Partial<ProductParameterQuery> = {}): ProductParameterQuery => ({ parameter: "LAMBDA", subjectType: "ANY", subjectText: null,
  systemText: null, operator: "EXACT", targetValue: .3, tolerance: null, unit: "W/(m·K)", evidence: "导热系数", ...patch });
describe("SM-PARAMETER-FIELD/UNIT/COMPARISON-01封闭字段，非意图路由", () => {
  it.each(["导热系数0.3", "λ=0.3", "lambda 0.3", "λ0.3 W/(m·K)", "导热系数0.3 W/(m.K)"])("%s字段明确且不误提取K", text => {
    expect(hasLambdaField(text)).toBe(true); expect(lambdaUnitIsValid(text)).toBe(true);
    expect(parseThermalLookupMessage(text).filters).toEqual([]);
    expect(validateProductParameterEvidence(text, lambdaQuery({ evidence: text }))).toBeNull();
  });
  it.each(["系数0.3", "传热系数0.3", "产品热阻0.3", "0.3mm", "LambdaBoard25"])("%s不是λ字段证据", text => {
    expect(hasLambdaField(text)).toBe(false);
    expect(validateProductParameterEvidence(text, lambdaQuery({ evidence: text }))).not.toBeNull();
  });
  it.each(["导热系数0.3 W/(m²·K)", "λ0.3 W/(m2.K)", "λ0.3 W/m²K"])("%s不接受面积单位", text => expect(validateProductParameterEvidence(text, lambdaQuery({ evidence: text }))).not.toBeNull());
  it("单位内部开尔文不是K指标，双指标原话仍可明确提取K", () => {
    expect(insideThermalUnit("λ0.3W/(m·K)", 9)).toBe(true);
    expect(parseThermalLookupMessage("λ0.005 W/(m·K)，K0.3").filters).toEqual([expect.objectContaining({ metric: "K", targetValue: .3 })]);
  });
  it.each([["小于", "LT"], ["不超过", "LTE"], ["大于", "GT"], ["不低于", "GTE"]] as const)("封闭%s比较独立于K包含边界的旧语义", (word, operator) => {
    const text = `λ${word}0.3`; expect(validateProductParameterEvidence(text, lambdaQuery({ operator, evidence: text }))).toBeNull();
    expect(validateProductParameterEvidence(text, lambdaQuery({ operator: "EXACT", evidence: text }))).not.toBeNull();
  });
  it("默认精确；近似无容差不造窗口，显式±只能来自原话", () => {
    const text = "λ0.3左右±0.01";
    expect(validateProductParameterEvidence(text, lambdaQuery({ operator: "APPROX", tolerance: .01, evidence: text }))).toBeNull();
    const spaced = "λ 0.3 左右 ±   0.01";
    expect(validateProductParameterEvidence(spaced, lambdaQuery({ operator: "APPROX", tolerance: .01, evidence: spaced }))).toBeNull();
    expect(validateProductParameterEvidence(text, lambdaQuery({ operator: "APPROX", evidence: text }))).not.toBeNull();
    expect(validateProductParameterEvidence("λ0.3左右", lambdaQuery({ operator: "APPROX", tolerance: .02, evidence: "λ0.3左右" }))).not.toBeNull();
    expect(validateProductParameterEvidence("λ0.3", lambdaQuery({ operator: "APPROX", evidence: "λ0.3" }))).not.toBeNull();
  });
  it("只补充导热系数时继承原问唯一目标与比较符，不把0.35丢掉", () => {
    const read = lambdaQuery({ operator: "READ", targetValue: null, evidence: "导热系数" });
    expect(inheritParameterTarget("薄膜灰 小于 0.35有哪些方案", "导热系数", read)).toMatchObject({ operator: "LT", targetValue: .35 });
    expect(inheritParameterTarget("保温0.3", "导热系数", read)).toMatchObject({ operator: "EXACT", targetValue: .3 });
    expect(inheritParameterTarget("0.2还是0.3", "导热系数", read)).toEqual(read);
    expect(inheritParameterTarget("保温0.3", "K", read)).toEqual(read);
    expect(inheritParameterTarget("保温0.3", "导热系数0.2", read)).toEqual(read);
  });
  it("跨轮只绑定有效原问唯一目标，不补厚度、旧指标或未说出的名称", () => {
    expect(validateProductParameterEvidence("导热系数", lambdaQuery(), "有保温0.3的材料么")).toBeNull();
    expect(validateProductParameterEvidence("导热系数", lambdaQuery(), "保温0.3mm")).not.toBeNull();
    expect(validateProductParameterEvidence("导热系数0.2", lambdaQuery({ evidence: "导热系数0.2" }), "保温0.3")).not.toBeNull();
    expect(validateProductParameterEvidence("导热系数", lambdaQuery(), "0.2还是0.3")).not.toBeNull();
    expect(validateProductParameterEvidence("薄膜灰λ0.3", lambdaQuery({ systemText: "薄抹灰", evidence: "薄膜灰λ0.3" }))).not.toBeNull();
  });
  it("原问与澄清之间的换行表示不丢数值，不接受重排、改字或额外身份", () => {
    const original = "有保温0.3的材料吗？", message = "导热系数。";
    for (const separator of ["", "\n"]) expect(validateProductParameterEvidence(message, lambdaQuery({ evidence: original + separator + message }), original)).toBeNull();
    for (const evidence of [message + original, "有保温0.2的材料吗？导热系数。", "VICP导热系数。", "有保温0.3的材料导热系数。"])
      expect(validateProductParameterEvidence(message, lambdaQuery({ evidence }), original)).not.toBeNull();
    expect(validateProductParameterEvidence(message, lambdaQuery({ evidence: original + message, targetValue: .2 }), original)).not.toBeNull();
  });
  it("READ不能丢目标，λ不能塞入图集Metric，即便模型只引用数字", () => {
    expect(validateProductParameterEvidence("导热系数", lambdaQuery({ operator: "READ", targetValue: null }), "保温0.3")).not.toBeNull();
    expect(productParameterQuerySchema.safeParse({ ...lambdaQuery(), parameter: "K" }).success).toBe(false);
    const query = { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .99, unresolved: [], preferences: [], constraints: [{ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null, metric: "K", operator: "APPROX", value: .3, evidence: "0.3", hard: true, confidence: .99 }] };
    expect(applySemanticQuery("导热系数0.3", query, { entities: [], aliases: [] }).unresolved).toContainEqual(expect.objectContaining({ reason: "导热系数 λ 不能作为传热系数 K 的查询条件。" }));
  });
});
describe("独立参数目标的Policy边界", () => {
  const semantic = () => domainSemanticFixture("导热系数", "PRODUCT_PARAMETER_QUERY", { parameterQuery: lambdaQuery(), pageQuery: null, relation: "CONTINUE", queryContext: "CLARIFICATION_REPLY", reference: { scope: "NONE", revision: null, items: [] } });
  it("是只读参数读取而非图集QUERY/计算/方案授权", () => expect(applyDomainPolicy("导热系数", semantic())).toMatchObject({ intent: "PRODUCT_PARAMETER_QUERY", mutation: "NONE", policyReason: "READ_ONLY_SEMANTIC" }));
  it.each(["NEGATED", "QUOTED", "HYPOTHETICAL"])("%s不授予参数执行", mode => {
    const s = semantic(); s.effectRequest = { direct: true, polarity: mode === "NEGATED" ? "NEGATED" : "AFFIRMATIVE", speechAct: mode === "NEGATED" ? "REQUEST" : mode as "QUOTED" | "HYPOTHETICAL", evidence: "导热系数" };
    expect(applyDomainPolicy("导热系数", s).intent).toBe("CLARIFY");
  });
  it("混入候选、报告或低置信提案不绕过原门禁", () => {
    for (const patch of [{ requestedEffect: "CALCULATE" }, { confidence: .79 }, { constraintPatch: [{ field: "metric", op: "SET", value: .3, evidence: "导热系数" }] }, { parameterQuery: null }])
      expect(applyDomainPolicy("导热系数", { ...semantic(), ...patch } as any).intent).toBe("CLARIFY");
  });
});
