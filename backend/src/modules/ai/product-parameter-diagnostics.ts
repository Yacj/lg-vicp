import { z } from "zod";
import type { ProductParameterQuery } from "./product-parameter-query.js";

export const parameterSourceKinds = ["CATALOG", "SPEC_PARAMETER", "MATERIAL_PARAMETER", "KNOWLEDGE_FACT", "CONFIRMED_LAYER"] as const;
export const parameterDiagnosticsSchema = z.object({
  issues: z.array(z.enum(["PARAMETER_NOT_INDEXED", "VALUE_NO_MATCH", "NAME_UNRESOLVED", "SOURCE_SCOPE_LIMITED", "FILTER_CONFLICT", "RESULT_OBJECT_UNRESOLVED"])),
  scannedCount: z.number().int().nonnegative(), identityCount: z.number().int().nonnegative(), matchedCount: z.number().int().nonnegative(),
  excludedValueCount: z.number().int().nonnegative(), conflictCount: z.number().int().nonnegative(), matchedSourceCount: z.number().int().nonnegative(),
  coverage: z.literal("AUTHORIZED_PUBLISHED_ONLY"), missingTolerance: z.boolean(),
  checkedSourceKinds: z.array(z.enum(parameterSourceKinds)).optional()
});
export type ParameterDiagnostics = z.infer<typeof parameterDiagnosticsSchema>;
const sourceLabels: Record<typeof parameterSourceKinds[number], string> = {
  CATALOG: "正式产品目录", SPEC_PARAMETER: "已发布规格参数", MATERIAL_PARAMETER: "已发布材料参数",
  KNOWLEDGE_FACT: "当前发布资料中的已核验参数", CONFIRMED_LAYER: "已确认原页的材料层参数"
};
export function renderParameterQueryExplanation(query: ProductParameterQuery, diagnostics: ParameterDiagnostics) {
  const operators = { READ: "读取参数", EXACT: "精确匹配", LT: "小于", LTE: "不大于", GT: "大于", GTE: "不小于", APPROX: "按指定容差匹配" };
  const lines = [`上次查询的是导热系数 λ${query.targetValue == null ? "" : `，目标 ${query.targetValue} W/(m·K)`}，按${operators[query.operator]}处理。`];
  if (diagnostics.checkedSourceKinds?.length) lines.push(`当时核验的资料类别：${diagnostics.checkedSourceKinds.map(kind => sourceLabels[kind]).join("、")}。`);
  else lines.push("上次记录没有保存资料类别，无法据此列明逐类搜索范围；可以重新读取参数后核对。");
  if (diagnostics.issues.includes("VALUE_NO_MATCH")) lines.push("当时可核验范围内有独立 λ 参数，但没有满足该数值条件的记录；这不能说明其他资料或市场上不存在。");
  if (diagnostics.issues.includes("PARAMETER_NOT_INDEXED")) lines.push("当时缺少所问归属的独立 λ 字段，不能把缺字段解释成数值不匹配。");
  if (diagnostics.issues.includes("NAME_UNRESOLVED")) lines.push("当时未能核验所述名称与产品或体系的正式对应关系。");
  if (diagnostics.issues.includes("SOURCE_SCOPE_LIMITED")) lines.push("部分来源的参数归属或证据不足，已排除；结果仅覆盖当时有权读取、已发布且可核验的参数。");
  if (diagnostics.conflictCount) lines.push("同一参数身份存在来源值冲突，相关记录未参与匹配。");
  if (diagnostics.missingTolerance) lines.push("近似查询还缺明确的数值范围或 ± 容差，没有套用 K/R 的默认窗口。");
  if (diagnostics.issues.includes("RESULT_OBJECT_UNRESOLVED")) lines.push("参数记录已找到，但用户希望得到的是完整方案，仍需明确参数属于方案中的哪个对象，不能把参数命中数当方案数。");
  lines.push("可以改查具体产品或材料的 λ，或核对正式原页。这里仅解释上次查询记录，没有重新筛选、计算或选择方案。");
  return lines.join("\n");
}
