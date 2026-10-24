import { z } from "zod";
import type { ProductAnswerFacts } from "./product-answer.js";
import type { ProductParameterKey, ProductKnowledgeItem } from "./product-knowledge-facts.js";
import { parameterComparisons, parameterTargetNumbers, unsupportedParameterComparison } from "./product-parameter-query.js";
import { parseThermalThicknessMessage } from "../thermal/thermal-lookup-thickness.js";

const parameterFocusSchema = z.array(z.object({
  field: z.enum(["LAMBDA", "CORRECTION", "THICKNESS"]), value: z.number().positive().finite(), unit: z.string(),
  scope: z.enum(["CATALOG", "MATERIAL_LAYER", "CONSTRUCTION_OPTION"]),
  entityId: z.string().min(1), entityName: z.string().min(1), sourceKey: z.string().min(1)
}).strict()).max(2000);
export type ProductParameterFocus = z.infer<typeof parameterFocusSchema>;
export const parseProductParameterFocus = (value: unknown) => parameterFocusSchema.safeParse(value).data;

/** 仅从实际展示事实派生焦点；值、来源、对象不能由模型或用户提供。 */
export function buildProductParameterFocus(facts: ProductAnswerFacts, field?: ProductParameterKey | null): ProductParameterFocus {
  const focus: ProductParameterFocus = [];
  for (const product of facts.products) {
    const add = (key: ProductParameterKey, value: number | null, unit: string) => {
      if (value != null && (field == null || field === key))
        focus.push({ field: key, value, unit, scope: "CATALOG", entityId: product.id, entityName: product.name, sourceKey: `catalog:${product.id}:${key}:${value}` });
    };
    add("LAMBDA", product.thermalConductivity, "W/(m·K)");
    add("CORRECTION", product.correctionFactor, "");
    for (const value of product.thicknessOptionsMm) add("THICKNESS", value, "mm");
  }
  for (const item of facts.knowledgeItems ?? []) for (const attribute of item.attributes) {
    if (field != null && field !== attribute.key) continue;
    const source = attribute.source;
    focus.push({ field: attribute.key, value: attribute.value, unit: attribute.unit, scope: attribute.scope,
      entityId: item.id, entityName: item.name,
      sourceKey: JSON.stringify([source.documentId, source.versionId, source.pageId, source.revision, source.constructionId, source.layerId, attribute.key, attribute.value]) });
  }
  const unique = new Map<string, ProductParameterFocus[number]>();
  for (const value of focus) {
    const key = JSON.stringify([value.field, value.scope, value.value, value.entityName]);
    if (!unique.has(key)) unique.set(key, value);
  }
  return [...unique.values()];
}
export function resolveProductParameterFocus(saved: unknown, current: ProductParameterFocus, field?: ProductParameterKey | null) {
  const parsed = parseProductParameterFocus(saved);
  if (!parsed?.length) return { error: "上轮没有明确指向某个参数。你想按导热系数、修正系数还是厚度查看其他产品？" };
  const selected = parsed.filter(value => field == null || value.field === field);
  if (!selected.length) return { error: "上轮尚未展示这个参数，先查一下对应参数再继续。" };
  if (selected.some(old => !current.some(now => now.sourceKey === old.sourceKey && now.entityId === old.entityId
    && now.field === old.field && now.scope === old.scope && now.value === old.value)))
    return { error: "上轮参数对应的资料或数值已有变化，需要重新查看后再按它查找。" };
  const values = [...new Map(selected.map(value => [JSON.stringify([value.field, value.scope, value.value]), value])).values()];
  if (new Set(values.map(value => value.field)).size > 1)
    return { error: "刚才列了多个参数，你想按导热系数、修正系数还是厚度找？" };
  if (new Set(values.map(value => value.scope)).size > 1)
    return { error: "刚才同时展示了目录参数和原表材料层参数，你想按哪一种口径找其他产品？" };
  return { values, selected };
}
export function parameterComparisonMatches(value: number, reference: number, comparison: "READ" | "EXACT" | "LT" | "LTE" | "GT" | "GTE") {
  switch (comparison) {
    case "READ": return true;
    case "EXACT": return Math.abs(value - reference) <= 1e-9;
    case "LT": return value < reference;
    case "LTE": return value <= reference;
    case "GT": return value > reference;
    case "GTE": return value >= reference;
  }
}
/** 保留符合数值条件的事实及其来源，不把同名对象的其他值混入正式匹配结果。 */
export function filterKnowledgeByParameter(items: readonly ProductKnowledgeItem[], focus: ProductParameterFocus[number],
  match: "READ" | "EXACT" | "LT" | "LTE" | "GT" | "GTE", excludedNames: ReadonlySet<string>, targetValue = focus.value) {
  return items.flatMap(item => {
    if (excludedNames.has(item.name)) return [];
    const attributes = item.attributes.filter(attribute => attribute.key === focus.field && attribute.scope === focus.scope
      && parameterComparisonMatches(attribute.value, targetValue, match));
    if (!attributes.length) return [];
    const sources = [...new Map(attributes.map(attribute => [JSON.stringify(attribute.source), attribute.source])).values()];
    return [{ ...item, attributes, sources, warnings: [...new Set(sources.flatMap(source => source.issues ?? []))] }];
  });
}
/** 新数值来自本轮封闭工程字段；省略数值才用已绑定的参照值。 */
export function productContinuationTarget(message: string, field: ProductParameterKey, proposedMatch: "READ" | "EXACT" | "LT" | "LTE" | "GT" | "GTE" | null,
  previousMatch?: "READ" | "EXACT" | "LT" | "LTE" | "GT" | "GTE") {
  if (unsupportedParameterComparison(message)) return { error: "这次是不等于某个数值的条件，需要单独明确查询范围。" };
  const thickness = parseThermalThicknessMessage(message);
  const thicknessValues = [...new Set([thickness.query.thicknessMm, thickness.query.thicknessMin, thickness.query.thicknessMax].filter((value): value is number => value != null))];
  if (field !== "THICKNESS" && thicknessValues.length) return { error: "这轮还增加了厚度条件，需要同时核对对应构造或规格，不能只按原参数扩大查询。" };
  const values = field === "THICKNESS" && thicknessValues.length ? thicknessValues : parameterTargetNumbers(message).map(number => Number(number.raw));
  const comparisons = parameterComparisons(message);
  if (values.length > 1 || comparisons.length > 1 || comparisons[0] === "APPROX") return { error: "这次涉及多个边界或近似范围，需要明确要沿用的参数范围。" };
  const match = comparisons[0] ?? (values.length && previousMatch && previousMatch !== "READ" ? previousMatch : proposedMatch) ?? (values.length ? "EXACT" : null);
  return { value: values[0], match };
}
