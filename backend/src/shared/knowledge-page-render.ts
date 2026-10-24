import { createHash } from "node:crypto";
import type { PageRecognitionResult } from "./page-recognition.js";
import { auditedSourceTableHeaders } from "./confirmed-source-table-headers.js";

export const THERMAL_PAGE_FIELDS = ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue"] as const;
export type ThermalPageField = typeof THERMAL_PAGE_FIELDS[number];

/** 兼容旧确认字段：只接受整个systemName就是封闭构造编码，不从描述文字猜编号。 */
export function confirmedConstructionCode(system: { constructionCode?: string | null; systemName?: string | null }) {
  if (system.constructionCode) return system.constructionCode;
  const text = system.systemName?.normalize("NFKC").replace(/\s/g, "");
  return text && /^(?:外墙)?[A-Z]{1,4}\d+(?:-\d+)+$/i.test(text) ? text : system.constructionCode;
}
export interface PageReferenceHighlight {
  confirmedRevision?: string;
  pageId: string;
  constructionId: string;
  optionId: string;
  fieldKeys: ThermalPageField[];
  /** 清除引用标记后的回答字符位置，用于段落关联。 */
  answerOffset?: number;
}
type Layer = NonNullable<PageRecognitionResult["systems"][number]["layers"]>[number];
type Option = NonNullable<PageRecognitionResult["systems"][number]["options"]>[number];
type System = PageRecognitionResult["systems"][number];
export interface KnowledgePageRenderModel {
  confirmedRevision?: string;
  schemaVersion?: 2;
  pageTitle?: string | null;
  pageLabel?: string | null;
  constructions: (Pick<System, "rawConstructionLabel" | "applicationPart" | "roofForm" | "placement" | "waterproofGrade" | "sourceColumns" | "sourceTableHeaders" | "diagramNotes"> & {
    constructionId: string;
    constructionCode?: string | null;
    systemName?: string | null;
    specClass?: "I" | "II" | "III" | null;
    baseMaterial?: string | null;
    baseThicknessMm?: number | null;
    layers: (Layer & { layerId: string; variable?: boolean })[];
    material?: { name: string; lambda?: number | null; alpha?: number | null };
    options: (Pick<Option, ThermalPageField | "sourceRowLabel" | "fieldEvidence" | "layerValues"> & { optionId: string })[];
    /** 仅表示经原表核对的物理列布局，不改变任何热阻字段的事实口径。 */
    sourceTableLayout?: { resistance: "SHARED_LAYER_OPTION" };
    /** 显示专用；sourceColumns仍为原确认语义，查询/证据验证不得使用本字段。 */
    sourceDisplayColumns?: System["sourceColumns"];
  })[];
  notes?: string[];
  warnings?: string[];
}

/** 已确认快照的只读投影；原表头校正仅命中核对过的内容指纹，不补算或修改识别数据。 */
export function buildKnowledgePageRenderModel(pageId: string, data: PageRecognitionResult | null | undefined): KnowledgePageRenderModel | null {
  if (!data) return null;
  // 快照变化后标识变化，旧引用不能误标新数据中的相同行序。
  const revision = createHash("sha256").update(JSON.stringify([pageId, data])).digest("hex").slice(0, 24);
  const sourceHeaders = auditedSourceTableHeaders(data);
  return {
    ...(data.schemaVersion === 2 ? { schemaVersion: data.schemaVersion, confirmedRevision: revision } : {}),
    pageTitle: data.pageTitle, pageLabel: data.pageLabel,
    constructions: data.systems.map((system, systemIndex) => {
      const constructionId = `kp-${revision}-${systemIndex}`;
      const constructionCode = data.schemaVersion === 2 ? system.constructionCode : confirmedConstructionCode(system);
      const canonical = (value: string | null | undefined) => value?.normalize("NFKC").replace(/\s/g, "").replace(/^外墙/, "").toUpperCase();
      const codeOnlyName = !system.constructionCode && system.systemName && constructionCode && canonical(system.systemName) === canonical(constructionCode);
      const options = system.options ?? [];
      const layers = system.layers ?? [];
      const variableLayers = layers.filter(layer => layer.sourceRegion !== "DIAGRAM" && layer.thicknessMm == null && layer.rValue == null && layer.lambda != null && layer.alpha != null);
      const variable = options.length > 1 && variableLayers.length === 1 ? variableLayers[0] : undefined;
      return {
        constructionId, constructionCode, systemName: codeOnlyName ? data.pageTitle : system.systemName,
        rawConstructionLabel: system.rawConstructionLabel, applicationPart: system.applicationPart, roofForm: system.roofForm,
        placement: system.placement, waterproofGrade: system.waterproofGrade,
        sourceColumns: system.sourceColumns,
        ...(sourceHeaders ? { sourceDisplayColumns: sourceHeaders.columns.map(column => ({ ...column })) } : {}),
        sourceTableHeaders: sourceHeaders ? { ...sourceHeaders.tableHeaders } : system.sourceTableHeaders, diagramNotes: system.diagramNotes,
        ...(sourceHeaders ? { sourceTableLayout: { resistance: "SHARED_LAYER_OPTION" as const } } : {}),
        specClass: system.specClass, baseMaterial: system.baseMaterial, baseThicknessMm: system.baseThicknessMm,
        layers: layers.map((layer, index) => ({ ...layer, layerId: `${constructionId}-l${index}`, ...(layer === variable ? { variable: true } : {}) })),
        ...(variable ? { material: { name: variable.name, lambda: variable.lambda, alpha: variable.alpha } } : {}),
        options: options.map((option, index) => ({ optionId: `${constructionId}-o${index}`, thicknessMm: option.thicknessMm,
          productThermalResistance: option.productThermalResistance, totalThermalResistance: option.totalThermalResistance, kValue: option.kValue,
          sourceRowLabel: option.sourceRowLabel, fieldEvidence: option.fieldEvidence, layerValues: option.layerValues }))
      };
    }), notes: data.notes, warnings: data.warnings
  };
}
