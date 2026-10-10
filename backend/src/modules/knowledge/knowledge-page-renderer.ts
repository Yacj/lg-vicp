import { createHash } from "node:crypto";
import { z } from "zod";
import { pageRecognitionResultSchema, type PageRecognitionResult, type PageRecognitionOption } from "../../shared/page-recognition.js";

export const OPTION_FIELD_KEYS = ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue"] as const;
export type OptionFieldKey = typeof OPTION_FIELD_KEYS[number];
export type ThermalFieldKey = OptionFieldKey | "lambda" | "alpha";
type System = PageRecognitionResult["systems"][number];
export type RenderLayer = NonNullable<System["layers"]>[number] & { layerId: string };
export type RenderOptionRow = Record<OptionFieldKey, number | null> & {
  optionId: string;
  productSpecId: string | null;
};
export type PageRenderSection = {
  id: string;
  type: "THERMAL_SYSTEM" | "TEXT" | "NOTE";
  title?: string | null;
  text?: string;
  constructionCode?: string | null;
  schemeId?: string | null;
  specClass?: System["specClass"];
  baseMaterial?: string | null;
  baseThicknessMm?: number | null;
  commonLayers?: RenderLayer[];
  optionTable?: { columns: Array<{ fieldKey: OptionFieldKey; label: string; unit: string }>; rows: RenderOptionRow[] };
};
export type PageRenderModel = {
  pageId: string;
  pageLabel: string | null;
  pageTitle: string | null;
  sections: PageRenderSection[];
};
export type ReferenceHighlight = {
  sectionId: string;
  constructionCode?: string | null;
  optionId: string;
  /** λ/α 属于公共产品层，使用此 ID 定位该层。 */
  commonLayerId?: string;
  fieldKeys: ThermalFieldKey[];
  facts: Partial<Record<ThermalFieldKey, number>>;
};
export const referenceHighlightSchema = z.object({
  sectionId: z.string().min(1), constructionCode: z.string().nullable().optional(), optionId: z.string().min(1),
  commonLayerId: z.string().optional(),
  fieldKeys: z.array(z.enum([...OPTION_FIELD_KEYS, "lambda", "alpha"])),
  facts: z.object({ thicknessMm: z.number().optional(), productThermalResistance: z.number().optional(),
    totalThermalResistance: z.number().optional(), kValue: z.number().optional(), lambda: z.number().optional(), alpha: z.number().optional() })
});

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function systemKey(system: System): string {
  const identity = system.schemeId || system.constructionCode?.trim();
  return identity ? hash([identity, system.specClass ?? null])
    : hash([system.systemName ?? null, system.baseMaterial ?? null, system.baseThicknessMm ?? null, system.specClass ?? null]);
}
function optionKey(option: PageRecognitionOption): string {
  return hash([option.thicknessMm ?? null, option.productSpecId ?? null, option.catalogProductId ?? null]);
}
// 完整身份不使用位置或 R/K；重复身份才使用内容判别。完全重复的显示项合并，绑定时仍拒绝歧义。
function sectionId(pageId: string, system: System, systems: System[]): string {
  const key = systemKey(system);
  const content = { ...system, layers: [...(system.layers ?? [])].sort((a, b) => hash(a).localeCompare(hash(b))),
    options: [...(system.options ?? [])].sort((a, b) => hash(a).localeCompare(hash(b))) };
  return `${pageId}:system:${key}${systems.filter(item => systemKey(item) === key).length > 1 ? `:${hash(content)}` : ""}`;
}
function optionId(id: string, option: PageRecognitionOption, options: PageRecognitionOption[]): string {
  const key = optionKey(option);
  return `${id}:option:${key}${options.filter(item => optionKey(item) === key).length > 1 ? `:${hash(option)}` : ""}`;
}

/** 只读人工确认快照；无确认数据返回 null，不借用 draft 或 parsedText 冒充确认结果。 */
export function renderKnowledgePage(page: {
  id: string; pageLabel?: string | null; pageTitle?: string | null; metadata?: unknown;
}): PageRenderModel | null {
  const metadata = page.metadata as { confirmedStructuredData?: unknown } | null | undefined;
  const parsed = pageRecognitionResultSchema.safeParse(metadata?.confirmedStructuredData);
  if (!parsed.success) return null;
  const data = parsed.data;
  const sections: PageRenderSection[] = [];
  for (const system of data.systems) {
    const id = sectionId(page.id, system, data.systems);
    if (sections.some(section => section.id === id)) continue;
    const options = system.options ?? [];
    const rows = new Map<string, RenderOptionRow>();
    for (const option of options) {
      const rowId = optionId(id, option, options);
      rows.set(rowId, { optionId: rowId, productSpecId: option.productSpecId ?? null,
        thicknessMm: option.thicknessMm ?? null, productThermalResistance: option.productThermalResistance ?? null,
        totalThermalResistance: option.totalThermalResistance ?? null, kValue: option.kValue ?? null });
    }
    const layers = new Map<string, RenderLayer>();
    for (const layer of system.layers ?? []) {
      const layerId = `${id}:layer:${hash([layer.order ?? null, layer.name])}`;
      // 同名同层序但不同参数时保留独立显示，禁止将不同属性互相覆盖。
      const duplicate = (system.layers ?? []).filter(item => item.order === layer.order && item.name === layer.name).length > 1;
      const uniqueId = duplicate ? `${layerId}:${hash(layer)}` : layerId;
      layers.set(uniqueId, { ...layer, layerId: uniqueId });
    }
    sections.push({ id, type: "THERMAL_SYSTEM", title: system.systemName ?? null,
      constructionCode: system.constructionCode ?? null, schemeId: system.schemeId ?? null, specClass: system.specClass ?? null,
      baseMaterial: system.baseMaterial ?? null, baseThicknessMm: system.baseThicknessMm ?? null,
      commonLayers: [...layers.values()], optionTable: {
        columns: [
          { fieldKey: "thicknessMm", label: "产品厚度", unit: "mm" },
          { fieldKey: "productThermalResistance", label: "产品层热阻 R", unit: "m²·K/W" },
          { fieldKey: "totalThermalResistance", label: "外墙主断面总热阻 R₀", unit: "m²·K/W" },
          { fieldKey: "kValue", label: "传热系数 K", unit: "W/(m²·K)" }
        ], rows: [...rows.values()]
      } });
  }
  if (data.fullText) sections.push({ id: `${page.id}:text`, type: "TEXT", text: data.fullText });
  for (const note of new Set(data.notes ?? [])) sections.push({ id: `${page.id}:note:${hash(note)}`, type: "NOTE", text: note });
  return { pageId: page.id, pageLabel: page.pageLabel?.trim() || null, pageTitle: page.pageTitle ?? null, sections };
}

/** 精确绑定同页同构造同档位；正式行与确认快照冲突或有歧义时不生成定位。 */
export function resolveReferenceHighlight(candidate: {
  sourcePageId?: string | null; sourceDocumentId?: string | null;
  schemeId?: string; schemeCode?: string; productSpecId?: string; catalogProductId?: string | null;
  specClass?: string; thicknessMm?: number; productThermalResistance?: number;
  totalThermalResistance?: number; kValue?: number;
}, page: { pageId: string; documentId: string; metadata?: unknown }): ReferenceHighlight | null {
  if (candidate.sourcePageId !== page.pageId || candidate.sourceDocumentId && candidate.sourceDocumentId !== page.documentId) return null;
  const metadata = page.metadata as { confirmedStructuredData?: unknown } | null | undefined;
  const parsed = pageRecognitionResultSchema.safeParse(metadata?.confirmedStructuredData);
  if (!parsed.success) return null;
  const systems = parsed.data.systems;
  const matches = systems.flatMap(system => {
    if (system.specClass && candidate.specClass && system.specClass !== candidate.specClass) return [];
    if (system.schemeId ? system.schemeId !== candidate.schemeId : !candidate.schemeCode || system.constructionCode !== candidate.schemeCode) return [];
    return (system.options ?? []).filter(option => option.thicknessMm != null && option.thicknessMm === candidate.thicknessMm
      && (!option.productSpecId || option.productSpecId === candidate.productSpecId)
      && (!option.catalogProductId || option.catalogProductId === candidate.catalogProductId)).map(option => ({ system, option }));
  });
  if (matches.length !== 1) return null;
  const { system, option } = matches[0]!;
  // 与现有确认参数门禁一致，仅兼容正式 numeric 的存储精度，不作查询容差。
  if (OPTION_FIELD_KEYS.some(key => option[key] == null || candidate[key] == null
    || !Number.isFinite(candidate[key]) || Math.abs(option[key]! - candidate[key]!) > 0.00005)) return null;
  const id = sectionId(page.pageId, system, systems);
  const facts: ReferenceHighlight["facts"] = Object.fromEntries(OPTION_FIELD_KEYS.map(key => [key, option[key]]));
  const model = renderKnowledgePage({ id: page.pageId, metadata: page.metadata });
  const productLayers = model?.sections.find(section => section.id === id)?.commonLayers?.filter(layer => /VICP|保温板/i.test(layer.name)) ?? [];
  const fieldKeys: ThermalFieldKey[] = [...OPTION_FIELD_KEYS];
  const uniqueProductLayer = productLayers.length === 1 && (system.layers ?? []).filter(layer => /VICP|保温板/i.test(layer.name)).length === 1;
  if (uniqueProductLayer) for (const key of ["lambda", "alpha"] as const) {
    const value = productLayers[0]![key];
    if (value != null) { facts[key] = value; fieldKeys.push(key); }
  }
  return { sectionId: id, constructionCode: system.constructionCode ?? null,
    optionId: optionId(id, option, system.options ?? []),
    ...(uniqueProductLayer ? { commonLayerId: productLayers[0]!.layerId } : {}), fieldKeys, facts };
}
