import type { ReferencePageBlock } from "./reference-page.js";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
type Construction = NonNullable<ReferencePageBlock["renderModel"]>["constructions"][number];
export const constructionLabelForRead = (construction: Construction) => construction.rawConstructionLabel || construction.constructionCode || construction.systemName || "原页构造";

/** 仅消费已重验的实际引用匹配；全组比较，不造正式候选、来源或R口径。 */
export function renderConfirmedPageComparison(pages: ReferencePageBlock[], comparison?: DomainTurnSemantic["comparison"]) {
  const seen = new Set<string>();
  const rows = pages.flatMap(page => page.matches.flatMap(match => {
    const construction = page.renderModel?.constructions.find(item => item.constructionId === match.constructionId);
    const option = construction?.options.find(item => item.optionId === match.optionId);
    if (!construction || !option) return [];
    const key = JSON.stringify([page.page.documentId, page.page.versionId, page.page.pageId,
      match.confirmedRevision ?? page.renderModel?.confirmedRevision, construction.constructionId, option.optionId]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ page, construction, option }];
  }));
  const lines = ["以下按刚才实际展示的全部档位比较：", "| 构造/基层 | 厚度 mm | 原档位热阻 | 主断面传热阻 | K W/(m²·K) | 来源 |", "| --- | --- | --- | --- | --- | --- |"];
  const notes: string[] = [];
  for (const { page, construction, option } of rows) {
    const layers = option.layerValues?.flatMap(value => value.rValue == null ? [] : [`${construction.layers[value.layerIndex]?.name ?? "原构造层"}：${value.rValue}`]) ?? [];
    const resistance = option.productThermalResistance != null ? String(option.productThermalResistance) : layers.length ? layers.join("；") : "未提供";
    lines.push(`| ${constructionLabelForRead(construction)}${construction.baseMaterial ? ` / ${construction.baseMaterial}` : ""} | ${option.thicknessMm ?? "未提供"} | ${resistance} | ${option.totalThermalResistance ?? "未提供"} | ${option.kValue ?? "未提供"} | ${page.page.documentTitle}，${page.page.pageLabel ?? "印刷页码待核"} |`);
    if (layers.length) notes.push(`\n${constructionLabelForRead(construction)}的${layers.join("；")}来自逐档构造层证据（原表“热阻”列），不等于产品整体热阻。产品整体热阻${option.productThermalResistance == null ? "未提供，保持缺失" : "按独立字段保留"}。`);
  }
  lines.push(...notes);
  if (comparison && rows.length) {
    const key = comparison.metric === "K" ? "kValue" : comparison.metric === "TOTAL_R" ? "totalThermalResistance" : "productThermalResistance";
    const complete = rows.every(row => row.option[key] != null);
    if (complete) {
      const extreme = (comparison.direction === "MIN" ? Math.min : Math.max)(...rows.map(row => row.option[key]!));
      const names = rows.filter(row => row.option[key] === extreme).map(row => constructionLabelForRead(row.construction));
      lines.push(`\n这 ${rows.length} 条中，${names.join("、")}的${comparison.metric}${comparison.direction === "MIN" ? "最低" : "最高"}，为${extreme}。不能据此替换项目实际基层。`);
    } else lines.push("\n部分记录缺少所问独立指标，不能比较整个集合的极值。");
  }
  lines.push("\n数据来自本次实际引用的当前确认页，未重新查询、选择或确认方案；不同范围的热阻分别保留，参考值不代表计算或合规结论。");
  return lines.join("\n");
}
