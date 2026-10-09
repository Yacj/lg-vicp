import { pageRecognitionResultSchema, type PageRecognitionResult } from "../../shared/page-recognition.js";

/** 模型偶尔把多厚度表格的正常存储方式写成告警；仅在确有多档选项时降为说明。 */
export function normalizePageRecognitionAnnotations(result: PageRecognitionResult): PageRecognitionResult {
  const hasMultiThickness = result.systems.some((system) =>
    (system.options?.length ?? 0) > 1
    && system.options?.every((option) => option.thicknessMm != null && option.productThermalResistance != null)
    && system.layers?.some((layer) => layer.thicknessMm == null && layer.rValue == null)
  );
  if (!hasMultiThickness) return result;
  const notes = [...(result.notes ?? [])];
  const warnings: string[] = [];
  for (const warning of result.warnings ?? []) {
    if (/(?:layers|构造层).*?(?:留空|为空|null).*?(?:多厚度|不同厚度).*?(?:options|选项).*?(?:提供|列出)/i.test(warning)) {
      notes.push(warning);
    } else {
      warnings.push(warning);
    }
  }
  return { ...result, notes, warnings };
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return object(value) ? [value] : [];
}

function string(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function specClass(value: unknown): "I" | "II" | "III" | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/类$/, "");
  const classes: Record<string, "I" | "II" | "III"> = {
    I: "I", II: "II", III: "III", "Ⅰ": "I", "Ⅱ": "II", "Ⅲ": "III"
  };
  return classes[normalized] ?? null;
}

/**
 * 兼容模型输出中的纯表示差异。无法确认含义的值只留在全文/警告中，绝不补算热工数据。
 * 由 AI SDK 的 experimental_repairText 调用；最终仍必须通过正式 Zod schema。
 */
export function repairPageRecognitionText(text: string): string | null {
  if (text.length > 1_000_000) return null;
  let raw: unknown;
  try {
    const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const root = object(raw);
  if (!root) return null;
  if (pageRecognitionResultSchema.safeParse(root).success) return JSON.stringify(root);
  if (typeof (root.fullText ?? root.parsedText ?? root.text) !== "string" && items(root.systems).length === 0) return null;

  const repairWarnings: string[] = [];
  const systems = items(root.systems).flatMap((entry, systemIndex) => {
    const system = object(entry);
    if (!system) {
      repairWarnings.push(`第 ${systemIndex + 1} 个构造不是对象，已跳过`);
      return [];
    }
    const layers = items(system.layers ?? system.constructionLayers).flatMap((entry, layerIndex) => {
      const layer = object(entry);
      if (!layer) {
        repairWarnings.push(`第 ${systemIndex + 1} 个构造的第 ${layerIndex + 1} 层不是对象，已跳过`);
        return [];
      }
      const name = string(layer.name ?? layer.layerName)?.trim();
      if (!name) {
        repairWarnings.push(`第 ${systemIndex + 1} 个构造的第 ${layerIndex + 1} 层缺少名称，已跳过`);
        return [];
      }
      return [{
        order: Number.isInteger(number(layer.order)) ? number(layer.order) : null,
        name,
        thicknessMm: number(layer.thicknessMm ?? layer.thickness),
        lambda: number(layer.lambda ?? layer.thermalConductivity),
        alpha: number(layer.alpha ?? layer.correctionFactor),
        rValue: number(layer.rValue ?? layer.thermalResistance)
      }];
    });
    const options = items(system.options).flatMap((entry, optionIndex) => {
      const option = object(entry);
      if (!option) {
        repairWarnings.push(`第 ${systemIndex + 1} 个构造的第 ${optionIndex + 1} 档不是对象，已跳过`);
        return [];
      }
      // option.rValue / thermalResistance 的语义不明确，不能猜成产品层或总传热阻。
      if (option.rValue != null || option.thermalResistance != null) {
        repairWarnings.push(`第 ${systemIndex + 1} 个构造的第 ${optionIndex + 1} 档含未区分来源的热阻，未映射到产品层或总传热阻`);
      }
      return [{
        thicknessMm: number(option.thicknessMm ?? option.thickness),
        productThermalResistance: number(option.productThermalResistance),
        totalThermalResistance: number(option.totalThermalResistance),
        kValue: number(option.kValue)
      }];
    });
    const normalizedClass = specClass(system.specClass);
    if (system.specClass != null && normalizedClass === null) {
      repairWarnings.push(`第 ${systemIndex + 1} 个构造的规格等级无法识别，已留空`);
    }
    return [{
      systemName: string(system.systemName),
      specClass: normalizedClass,
      constructionCode: string(system.constructionCode),
      baseMaterial: string(system.baseMaterial),
      baseThicknessMm: number(system.baseThicknessMm),
      layers,
      options
    }];
  });
  const fullText = string(root.fullText ?? root.parsedText ?? root.text) ?? "";
  if (!fullText.trim()) repairWarnings.push("模型未返回可确认的页面全文，请人工补充后再确认");
  const repaired = {
    pageLabel: typeof root.pageLabel === "number" ? String(root.pageLabel) : string(root.pageLabel),
    pageTitle: string(root.pageTitle),
    fullText,
    systems,
    notes: strings(root.notes),
    warnings: [...strings(root.warnings), ...repairWarnings]
  };
  return pageRecognitionResultSchema.safeParse(repaired).success ? JSON.stringify(repaired) : null;
}

/** 仅记录字段路径，不记录可能包含文档内容的模型原文。 */
export function pageRecognitionSchemaIssues(text: string | undefined): string[] {
  if (!text || text.length > 1_000_000) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    const result = pageRecognitionResultSchema.safeParse(parsed);
    if (result.success) return [];
    return result.error.issues.slice(0, 12).map((issue) => issue.path.join(".") || "root");
  } catch {
    return ["JSON_PARSE"];
  }
}
