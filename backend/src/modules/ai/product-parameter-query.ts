import { z } from "zod";
import { describeNumberRoles, normalizeSemanticText } from "../thermal/semantic-query.js";
import { hasLambdaField, lambdaUnitIsValid } from "../../shared/lambda-field.js";

/** 独立属性合同；不能由图集 K/R Matcher 消费。 */
export const productParameterQuerySchema = z.object({
  parameter: z.literal("LAMBDA"),
  subjectType: z.enum(["PRODUCT_EQUIVALENT", "SPEC_EQUIVALENT", "SPEC_NOMINAL", "MATERIAL", "MATERIAL_LAYER", "ANY"]),
  subjectText: z.string().trim().min(1).max(160).nullable(),
  systemText: z.string().trim().min(1).max(200).nullable(),
  operator: z.enum(["READ", "EXACT", "LT", "LTE", "GT", "GTE", "APPROX"]),
  targetValue: z.number().positive().finite().nullable(),
  tolerance: z.number().positive().finite().nullable(),
  unit: z.literal("W/(m·K)"),
  evidence: z.string().min(1).max(2000)
}).strict();
export type ProductParameterQuery = z.infer<typeof productParameterQuerySchema>;

export function validateProductParameterEvidence(message: string, query: ProductParameterQuery, original?: string): string | null {
  const scope = original ? `${original}\n${message}` : message;
  if (!scope.includes(query.evidence) || !hasLambdaField(scope) || !lambdaUnitIsValid(scope))
    return "请明确导热系数 λ；其单位为 W/(m·K)，不能使用传热系数 K 的面积单位。";
  for (const name of [query.subjectText, query.systemText])
    if (name && !scope.includes(name)) return "参数查询的名称和体系条件必须保留用户原话，不能自动更正或补入名称。";
  const numbers = (text: string) => {
    const normalized = normalizeSemanticText(text);
    return describeNumberRoles(normalized).filter(n => (n.role === "UNKNOWN" || n.role === "THERMAL_TARGET")
      && !/±\s*$/.test(normalized.slice(0, n.index)));
  };
  const current = numbers(message), previous = original ? numbers(original) : [];
  if (query.operator === "READ") {
    if (query.targetValue != null || query.tolerance != null || current.length || original && previous.length)
      return "原问中的目标数值尚未保留，请核对本轮参数条件。";
    return null;
  }
  const targets = current.length ? current : previous;
  if (query.targetValue == null || targets.length !== 1 || Number(targets[0]!.raw) !== query.targetValue)
    return "导热系数目标值须来自本轮原话或有效待澄清原问，不能用型号、厚度或历史候选数值代替。";
  // SM-PARAMETER-COMPARISON-01：封闭标量比较符核验；未写比较符固定EXACT，无默认近似窗口。
  const comparisonTokens = (current.length ? message : scope).match(/不超过|不大于|不高于|不低于|不小于|小于|低于|大于|高于|左右|附近|接近|<=|>=|≤|≥|<|>|≈|±/g) ?? [];
  const operators: Record<string, string> = { "不超过": "LTE", "不大于": "LTE", "不高于": "LTE", "不低于": "GTE", "不小于": "GTE", "小于": "LT", "低于": "LT", "大于": "GT", "高于": "GT", "左右": "APPROX", "附近": "APPROX", "接近": "APPROX", "<=": "LTE", ">=": "GTE", "≤": "LTE", "≥": "GTE", "<": "LT", ">": "GT", "≈": "APPROX", "±": "APPROX" };
  const expected = [...new Set(comparisonTokens.map(token => operators[token]))];
  if (expected.length > 1 || query.operator !== (expected[0] ?? "EXACT"))
    return "λ 比较方式须与原话一致；未给比较符时按精确值读取，不能自行改成近似或上限。";
  if (query.tolerance != null) {
    const tolerance = /±\s*(\d+(?:\.\d+)?)/.exec(scope);
    if (query.operator !== "APPROX" || !tolerance || Number(tolerance[1]) !== query.tolerance)
      return "λ 容差只能使用原话明确给出的 ± 数值，不能采用 K/R 的默认容差。";
  }
  if (query.operator === "APPROX" && query.tolerance == null && /±\s*\d/.test(scope))
    return "原话明确给出的 λ 容差未被完整保留，请核对参数条件。";
  return null;
}
