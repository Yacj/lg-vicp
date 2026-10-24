import { expect, it } from "vitest";
import { mergeParameterContinuation } from "./parameter-continuation.js";
import type { ProductParameterQuery } from "./product-parameter-query.js";
const previous: ProductParameterQuery = { parameter: "LAMBDA", subjectType: "MATERIAL", subjectText: "正式材料甲", systemText: null,
  operator: "LT", targetValue: .35, tolerance: null, unit: "W/(m·K)", evidence: "正式材料甲导热系数小于0.35" };
it("改变数值只覆盖目标，后端保留指标/比较符/名称与归属，模型的READ/ANY不清空旧条件", () => {
  for (const target of [.17, .2, .41]) {
    const message = `改成${target}`;
    const proposal = { ...previous, subjectType: "ANY" as const, subjectText: null, operator: "READ" as const, targetValue: null, evidence: message };
    expect(mergeParameterContinuation(message, proposal, previous).query).toMatchObject({
      parameter: "LAMBDA", operator: "LT", targetValue: target, subjectType: "MATERIAL", subjectText: "正式材料甲"
    });
  }
});
it("仅修改比较方式沿用已执行的目标；原名称不是来自LLM再造的证据", () => {
  const message = "改成不超过";
  expect(mergeParameterContinuation(message, { ...previous, operator: "LTE", evidence: message }, previous).query)
    .toMatchObject({ operator: "LTE", targetValue: .35, subjectText: "正式材料甲" });
});
it("指标切换、错误单位、多目标与模型补值不借历史参数继续执行", () => {
  for (const message of ["K0.2", "产品热阻0.2", "λ0.2 W/(m²·K)", "0.2或0.3"])
    expect(mergeParameterContinuation(message, { ...previous, evidence: message }, previous).error).toBeTruthy();
  expect(mergeParameterContinuation("改成0.2", { ...previous, targetValue: .005, evidence: "改成0.2" }, previous).error).toBeTruthy();
  expect(mergeParameterContinuation("改成0.2", { ...previous, subjectText: "模型补的名称", targetValue: .2, evidence: "改成0.2" }, previous).error).toBeTruthy();
});
