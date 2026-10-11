import { createHash } from "node:crypto";
import type { PageRecognitionResult } from "./page-recognition.js";

export const THERMAL_PAGE_FIELDS = ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue"] as const;
export type ThermalPageField = typeof THERMAL_PAGE_FIELDS[number];
export interface PageReferenceHighlight {
  pageId: string;
  constructionId: string;
  optionId: string;
  fieldKeys: ThermalPageField[];
  /** 清除引用标记后的回答字符位置，用于段落关联。 */
  answerOffset?: number;
}
type Layer = NonNullable<PageRecognitionResult["systems"][number]["layers"]>[number];
type Option = NonNullable<PageRecognitionResult["systems"][number]["options"]>[number];
export interface KnowledgePageRenderModel {
  pageTitle?: string | null;
  pageLabel?: string | null;
  constructions: {
    constructionId: string;
    constructionCode?: string | null;
    systemName?: string | null;
    specClass?: "I" | "II" | "III" | null;
    baseMaterial?: string | null;
    baseThicknessMm?: number | null;
    layers: (Layer & { layerId: string; variable?: boolean })[];
    material?: { name: string; lambda?: number | null; alpha?: number | null };
    options: (Pick<Option, ThermalPageField> & { optionId: string })[];
  }[];
  notes?: string[];
  warnings?: string[];
}

/** 已确认快照的只读投影；不补算、不解析全文、不修改识别数据。 */
export function buildKnowledgePageRenderModel(pageId: string, data: PageRecognitionResult | null | undefined): KnowledgePageRenderModel | null {
  if (!data) return null;
  // 快照变化后标识变化，旧引用不能误标新数据中的相同行序。
  const revision = createHash("sha256").update(JSON.stringify([pageId, data])).digest("hex").slice(0, 24);
  return {
    pageTitle: data.pageTitle, pageLabel: data.pageLabel,
    constructions: data.systems.map((system, systemIndex) => {
      const constructionId = `kp-${revision}-${systemIndex}`;
      const options = system.options ?? [];
      const layers = system.layers ?? [];
      const variableLayers = layers.filter(layer => layer.thicknessMm == null && layer.rValue == null && layer.lambda != null && layer.alpha != null);
      const variable = options.length > 1 && variableLayers.length === 1 ? variableLayers[0] : undefined;
      return {
        constructionId, constructionCode: system.constructionCode, systemName: system.systemName,
        specClass: system.specClass, baseMaterial: system.baseMaterial, baseThicknessMm: system.baseThicknessMm,
        layers: layers.map((layer, index) => ({ ...layer, layerId: `${constructionId}-l${index}`, ...(layer === variable ? { variable: true } : {}) })),
        ...(variable ? { material: { name: variable.name, lambda: variable.lambda, alpha: variable.alpha } } : {}),
        options: options.map((option, index) => ({ optionId: `${constructionId}-o${index}`, thicknessMm: option.thicknessMm,
          productThermalResistance: option.productThermalResistance, totalThermalResistance: option.totalThermalResistance, kValue: option.kValue }))
      };
    }), notes: data.notes, warnings: data.warnings
  };
}
