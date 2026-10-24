import type { ProductAnswerFacts } from "./product-answer.js";
import type { ProductKnowledgeAttribute } from "./product-knowledge-facts.js";

const labels = { LAMBDA: "材料层导热系数", CORRECTION: "修正系数", THICKNESS: "原表厚度" };
const cell = (text: string) => text.replaceAll("|", "\\|").replaceAll("\n", " ");

/** 多条记录按同一原表来源成行；每个值仍与自己的页/构造相连，不把异源值汇成范围。 */
function knowledgeTable(items: NonNullable<ProductAnswerFacts["knowledgeItems"]>) {
  const rows = ["| 名称 | 参数（按原表口径） | 来源 |", "| --- | --- | --- |"];
  for (const item of items) {
    const groups = new Map<string, ProductKnowledgeAttribute[]>();
    for (const a of item.attributes) {
      const s = a.source, key = JSON.stringify([s.documentId, s.versionId, s.pageId, s.constructionId]);
      const group = groups.get(key) ?? []; group.push(a); groups.set(key, group);
    }
    for (const attributes of groups.values()) {
      const s = attributes[0]!.source;
      const values = (["LAMBDA", "CORRECTION", "THICKNESS"] as const).flatMap(key => {
        const selected = attributes.filter(a => a.key === key);
        if (!selected.length) return [];
        const values = [...new Set(selected.map(a => a.value))].join("、");
        return [key === "LAMBDA" ? `材料层λ=${values} ${selected[0]!.unit}` : key === "CORRECTION" ? `α=${values}` : `原表厚度 ${values}mm`];
      });
      const source = `《${s.title}》${s.pageLabel ? `第${s.pageLabel}页` : "（页码未标明）"}${s.constructionName ? `，${s.constructionName}` : ""}`;
      const flagged = attributes.some(attribute => attribute.source.issues?.length);
      rows.push(`| ${cell(item.name)} | ${cell(values.join("；"))}${flagged ? "（原表待核对）" : ""} | ${cell(source)} |`);
    }
  }
  return rows.join("\n");
}

/** 同一来源的同一字段成组展示；不把不同来源的值并成供货范围或产品当量。 */
function attributeLines(attributes: ProductKnowledgeAttribute[]): string[] {
  const groups = new Map<string, { first: ProductKnowledgeAttribute; values: number[] }>();
  for (const attribute of attributes) {
    const s = attribute.source;
    const key = JSON.stringify([attribute.key, attribute.scope, attribute.unit, s.documentId, s.versionId, s.pageId, s.constructionId]);
    const group = groups.get(key);
    if (group) { if (!group.values.includes(attribute.value)) group.values.push(attribute.value); }
    else groups.set(key, { first: attribute, values: [attribute.value] });
  }
  return [...groups.values()].map(({ first: a, values }) => {
    const s = a.source;
    const value = values.join("、");
    const parameter = a.key === "LAMBDA" ? `λ=${value} ${a.unit}` : a.key === "CORRECTION" ? `α=${value}` : `${value}mm`;
    return `- ${labels[a.key]}：${parameter}${s.issues?.length ? "（原表待核对）" : ""}（《${s.title}》${s.pageLabel ? `第${s.pageLabel}页` : "，页码未标明"}，${s.constructionName}）`;
  });
}

/** 数值由Backend直接展示，后续参数焦点与客户看见的完整字段一致。 */
export function renderProductParameterFacts(facts: ProductAnswerFacts): string {
  const sections: string[] = [];
  if (facts.parameterExplanation) sections.push(facts.parameterExplanation);
  const filter = facts.parameterFilter;
  if (filter) sections.push(`按${{ LAMBDA: "导热系数 λ", CORRECTION: "修正系数 α", THICKNESS: "厚度" }[filter.field]}${{ READ: "", EXACT: "=", LT: "<", LTE: "≤", GT: ">", GTE: "≥" }[filter.operator]}${filter.operator === "READ" ? "查看其他记录" : `${filter.targetValue} ${filter.unit}查到以下记录`}：`);
  if ((facts.knowledgeItems?.length ?? 0) > 3) sections.push(knowledgeTable(facts.knowledgeItems!));
  else for (const item of facts.knowledgeItems ?? []) sections.push(`**${item.name}**\n${attributeLines(item.attributes).join("\n")}`);
  for (const product of facts.products) {
    const lines: string[] = [];
    if (product.thermalConductivity != null) lines.push(`- 产品当量导热系数：λ=${product.thermalConductivity} W/(m·K)`);
    if (product.correctionFactor != null) lines.push(`- 修正系数：α=${product.correctionFactor}`);
    if (product.thicknessOptionsMm.length) lines.push(`- 目录板厚：${product.thicknessOptionsMm.join("/")}mm`);
    if (product.specifications.length) lines.push(`- 已发布规格：${product.specifications.map(s => `${s.specCode}${s.thicknessMm == null ? "" : `/${s.thicknessMm}mm`}`).join("、")}`);
    sections.push(`**${product.name}**（产品目录）\n${lines.length ? lines.join("\n") : "这份记录没有提供所问参数。"}`);
  }
  if (facts.knowledgeItems?.some(item => item.attributes.some(a => a.scope === "CONSTRUCTION_OPTION")))
    sections.push("这里的原表厚度是对应构造的档位，供货规格还需单独确认。");
  if (facts.hasMore) sections.push("这里只列出部分记录，可以按具体产品继续查看。");
  const warnings = [...new Set((facts.knowledgeItems ?? []).flatMap(item => item.warnings))];
  if (warnings.length) sections.push(`这些资料有待核对项，原值已保留：${warnings.join("；")}`);
  return sections.join("\n\n");
}
