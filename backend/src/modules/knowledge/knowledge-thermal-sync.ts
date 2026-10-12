import type { PageRecognitionResult } from "../../shared/page-recognition.js";

export interface ThermalSyncRow {
  schemeId?: string; schemeCode?: string; systemName?: string | null; setId?: string;
  productSpecId?: string; thicknessMm: number; productThermalResistance: number;
  totalThermalResistance: number; kValue: number;
}

/** 逐档四项一致，不能只用行数宣称同步；仅诊断，不从知识页自动建立正式方案。 */
export function assessPageThermalSync(data: PageRecognitionResult | null | undefined, rows: ThermalSyncRow[]) {
  const options = (data?.systems ?? []).flatMap(system => (system.options ?? []).map(option => ({ system, option })));
  const sameText = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.normalize("NFKC").replace(/\s+/g, "").toLowerCase() === b.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const synced = options.filter(({ system, option }) => rows.some(row =>
    (system.schemeId ? row.schemeId === system.schemeId : sameText(row.schemeCode, system.constructionCode) && sameText(row.systemName, system.systemName))
    && (!option.productSpecId || row.productSpecId === option.productSpecId)
    && row.thicknessMm === option.thicknessMm && row.kValue === option.kValue
    && row.productThermalResistance === option.productThermalResistance && row.totalThermalResistance === option.totalThermalResistance)).length;
  const status = options.length === 0 ? "NOT_APPLICABLE" as const : synced === options.length ? "SYNCED" as const : synced ? "PARTIAL" as const : "NOT_SYNCED" as const;
  return { pageState: "PAGE_CONFIRMED" as const, status,
    referenceState: status === "SYNCED" ? "THERMAL_REFERENCE_SYNCED" as const : "THERMAL_REFERENCE_NOT_SYNCED" as const,
    expectedOptions: options.length, syncedRows: synced, missingRows: options.length - synced,
    message: status === "NOT_APPLICABLE" ? "该页没有热工档位" : status === "SYNCED" ? "已同步到热工参考集，正式查询还需参考集审核发布" : "已确认，但尚未完整同步到正式方案查询" };
}
