import type { ReferenceLookupCandidate } from "./conversation-task.js";
/** 操作确认与客户所需参数共用实际执行后的对象；不生成数值或将选择当作Snapshot确认。 */
export function solutionSelectionSummary(candidates: readonly ReferenceLookupCandidate[], includeLayers = true) {
  return candidates.map(c => [
    `${c.schemeName ?? c.schemeCode ?? "这套参考做法"}：${c.substrateMaterial ?? "当前基层"}${c.substrateThickness != null ? ` ${c.substrateThickness}mm` : ""}，采用${c.productName ?? "保温板"}${c.thicknessMm != null ? ` ${c.thicknessMm}mm` : ""}。`,
    c.kValue != null ? `整套构造的传热系数 K=${c.kValue} W/(m²·K)。` : "",
    c.productThermalResistance != null ? `${c.productThermalResistanceScope === "PRODUCT_LAYER_ROWS_ONLY" ? "原表产品层行热阻" : "保温产品这一层的热阻"} R=${c.productThermalResistance} m²·K/W；` : "",
    c.totalThermalResistance != null ? `整套构造的总热阻 R₀=${c.totalThermalResistance} m²·K/W。` : "",
    includeLayers && c.layers?.length ? `各层为：${c.layers.map(l => `${l.name}${l.thicknessMm != null ? ` ${l.thicknessMm}mm` : "（厚度未记录）"}`).join(" → ")}。` : "",
    `来源：${c.evidenceSource ?? "已核验来源"}${c.evidenceRef ? `，${c.evidenceRef}` : ""}。项目是否达标还需结合适用规范核对。`
  ].filter(Boolean).join("")).join("\n\n");
}
