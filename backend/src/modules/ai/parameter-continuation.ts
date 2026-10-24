import { hasLambdaField, lambdaUnitIsValid } from "../../shared/lambda-field.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { parameterComparisons, parameterTargetNumbers, unsupportedParameterComparison, type ProductParameterQuery } from "./product-parameter-query.js";

/** 已完成参数查询上的字段变更：旧条件来自服务器记录，本轮只能变更有明确字段证据的部分。 */
export function mergeParameterContinuation(message: string, proposal: ProductParameterQuery, previous: ProductParameterQuery) {
  if (unsupportedParameterComparison(message)) return { error: "不等于某个数值的条件不能直接替换成等值或单侧范围。" };
  if (!message.includes(proposal.evidence)) return { error: "这次参数修改的证据与原话不一致。" };
  if (!lambdaUnitIsValid(message) || !hasLambdaField(message) && parseThermalLookupMessage(message).filters.length)
    return { error: "本轮出现了不同的指标或单位，不能直接沿用上次的导热系数条件。" };
  const numbers = parameterTargetNumbers(message), operators = parameterComparisons(message);
  if (numbers.length > 1 || operators.length > 1) return { error: "这次有多个数值或比较条件，请明确要替换哪一个。" };
  const targetValue = numbers.length ? Number(numbers[0]!.raw) : previous.targetValue;
  if (proposal.targetValue != null && proposal.targetValue !== targetValue) return { error: "不能用模型补充的数值替代本轮数值或上次已核验的目标。" };
  const operator = operators[0] ?? (previous.operator === "READ" && targetValue != null ? "EXACT" : previous.operator);
  const query = { ...previous, evidence: proposal.evidence, targetValue, operator };
  for (const field of ["subjectText", "systemText"] as const) {
    const name = proposal[field];
    if (name && name !== previous[field]) {
      if (!message.includes(name)) return { error: "新的名称条件必须来自本轮原话，不能补入正式名称。" };
      query[field] = name;
    }
  }
  // 容差修改沿用现有封闭±格式；没有明确新容差就保留原值，不新增默认窗口。
  if (proposal.tolerance !== previous.tolerance && proposal.tolerance != null)
    return { error: "修改近似容差时请明确新的±范围，不能仅凭模型给定容差。" };
  return { query };
}
