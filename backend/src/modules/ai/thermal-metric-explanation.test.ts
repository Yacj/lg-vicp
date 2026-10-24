import { expect, it } from "vitest";
import { explainThermalMetric } from "./thermal-metric-explanation.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
import { applyDomainPolicy } from "./ai-domain-policy.js";

it.each([
  ["K", "传热系数 K", "W/(m²·K)", "K 越小"],
  ["PRODUCT_R", "产品层热阻 R", "(m²·K)/W", "R 越大"],
  ["TOTAL_R", "总热阻 R₀", "(m²·K)/W", "不能当作板材自身热阻"]
] as const)("含义优先解释所问%s，不拿芯层公式替代指标定义", (metric, first, unit, direction) => {
  const answer = explainThermalMetric({ metric, explanationAspect: "MEANING" });
  expect(answer.startsWith(first)).toBe(true);
  expect(answer).toContain(unit); expect(answer).toContain(direction);
  expect(answer).not.toContain("R=δ");
  expect(answer.length).toBeLessThan(180);
});
it("未明R口径或多指标含义不凭历史强行指定完整产品", () => {
  const answer = explainThermalMetric({ metric: null, explanationAspect: "MEANING" });
  expect(answer).toContain("芯层、完整产品和整构造");
  expect(answer).toContain("λ 也不能当作 K");
});
it("口径解释保留原表缺值，不产生工程数值", () => {
  const answer = explainThermalMetric({ metric: "PRODUCT_R", explanationAspect: "SCOPE" });
  expect(answer).toContain("三者不能互填"); expect(answer).toContain("未单独给出");
  expect(answer).not.toMatch(/\d/);
});
it("定性变化保留材料、系数、其他层及表面热阻相同的前提", () => {
  const answer = explainThermalMetric({ metric: null, explanationAspect: "RELATIONSHIP" });
  expect(answer).toContain("修正系数 α 相同"); expect(answer).toContain("其他构造层及表面热阻不变");
  expect(answer).toContain("芯材越厚，该芯层热阻越大"); expect(answer).toContain("不计算具体厚度");
});
it("旧记录未提供解释目标仍兼容原合同", () => {
  const answer = explainThermalMetric({ metric: null });
  expect(answer).toContain("R=δ/(λ×α)"); expect(answer).toContain("未单独给出");
});
it("λ与K的概念比较完整保留两项，顺序不由旧R话题覆盖", () => {
  const answer = explainThermalMetric({ metric: null, explanationAspect: "MEANING", definitionSubjects: ["LAMBDA", "K"] });
  expect(answer).toContain("不同的指标"); expect(answer).toContain("材料本身"); expect(answer).toContain("整套构造");
  expect(answer.indexOf("导热系数 λ")).toBeLessThan(answer.indexOf("传热系数 K"));
  expect(answer).not.toContain("热阻 R"); expect(answer).not.toContain("芯材");
});
it("产品R与整构造R对比只解释明确口径，不附带厚度计算前提", () => {
  const answer = explainThermalMetric({ metric: null, explanationAspect: "SCOPE", definitionSubjects: ["PRODUCT_R", "TOTAL_R"] });
  expect(answer).toContain("产品层热阻 R"); expect(answer).toContain("整构造总热阻 R₀");
  expect(answer).not.toContain("R=δ"); expect(answer).not.toContain("未单独给出");
});
it("明确产品R的含义不因选择口径解释而退回无焦点长段落", () => {
  const answer = explainThermalMetric({ metric: "PRODUCT_R", explanationAspect: "SCOPE", definitionSubjects: ["PRODUCT_R"] });
  expect(answer.startsWith("产品层热阻 R")).toBe(true);
  expect(answer).toContain("不能拿芯层或总热阻代替");
  expect(answer).not.toContain("仅凭芯材厚度");
});
it("解释目标不能附着在数值核对读取上，也不能授权计算或方案操作", () => {
  const message = "只解释这项指标的意思";
  const semantic = domainSemanticFixture(message, "KNOWLEDGE_EXPLAIN", {
    reference: { scope: "NONE", revision: null, items: [] },
    factRead: { mode: "DEFINE", metric: "K", explanationAspect: "MEANING", definitionSubjects: ["K"], historyClaim: false, evidence: message }
  });
  const valid = domainTurnSemanticSchema.parse(semantic);
  expect(applyDomainPolicy(message, valid, null)).toMatchObject({ intent: "KNOWLEDGE_EXPLAIN", mutation: "NONE" });
  for (const mode of ["VERIFY", "COMPARE", "EXPLAIN"] as const)
    expect(applyDomainPolicy(message, { ...valid, factRead: { ...valid.factRead!, mode } }, null))
      .toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "FACT_READ_INVALID" });
  expect(applyDomainPolicy(message, { ...valid, requestedEffect: "CALCULATE" }, null).intent).toBe("CLARIFY");
  expect(applyDomainPolicy(message, { ...valid, evidence: "伪造证据" }, null).intent).toBe("CLARIFY");
});
