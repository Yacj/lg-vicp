/**
 * Tool Result 三层隔离：
 * Raw Tool Result → Backend 内部落库
 * LLM Tool Context → 给模型理解（本文件）
 * User Response → 聊天正文 / sources / comparison_ready
 */
import { USER_LANGUAGE_NOTES } from "../../../shared/ai-response-policy.js";
import type { AgentToolName } from "../ai-capability-router.js";
import type { ProductComparisonResult } from "../compare-product.js";
import type { ReferenceLookupCandidate } from "../conversation-task.js";
import { formatLookupThickness, type LookupThickness } from "../../thermal/thermal-lookup-thickness.js";
import type { ThermalLookupFilter } from "../../thermal/thermal-lookup-mode.js";

export type KnowledgeHitForModel = {
  title: string;
  section: string | null;
  pageLabel: string | null;
  content: string;
};

export type NormalizedSearchKnowledge = {
  hits: KnowledgeHitForModel[];
  available: boolean;
  note?: string;
};

export type NormalizedProductData = {
  products: Array<{
    id: string;
    name: string;
    summary: string | null;
    hasTechnicalDocs: boolean;
  }>;
  missingNotes: string[];
};

export type NormalizedProjectState = {
  associated: boolean;
  name?: string | null;
  region?: string | null;
  buildingType?: string | null;
  description?: string | null;
  memories: Array<{ title: string | null; content: string }>;
};

export type NormalizedComparison = {
  products: Array<{ id: string; name: string; summary: string | null }>;
  differences: Array<{
    label: string;
    items: Array<{ productId: string; productName: string; value: string | number | null; note?: string }>;
  }>;
  thermal: { available: boolean; note?: string };
  missingNotes: string[];
  instruction: string;
};

export type NormalizedThermal = {
  valid: boolean;
  K: unknown;
  R: unknown;
  pass: boolean | null;
  notes: string[];
  process?: Array<{ title?: string; formula?: string; value?: unknown }>;
  instruction: string;
};

export type NormalizedReferenceLookup = LookupThickness & {
  filters?: ThermalLookupFilter[];
  requestedTolerance?: number;
  effectiveTolerance?: number;
  toleranceAdjusted?: boolean;
  metric?: "K" | "TOTAL_R" | "PRODUCT_R";
  targetValue?: number | null;
  tolerance?: number | null;
  found: boolean;
  candidates: ReferenceLookupCandidate[];
  /** 本次查询实际使用的 K 语义（APPROX / MAX_LIMIT / MIN_LIMIT / EXACT） */
  lookupMode?: string;
  kTolerance?: number | null;
  /** 体系提示是否命中；false 表示下方是其他体系的回退结果 */
  matchedSystemHint?: boolean | null;
  /** 是否为体系无匹配后的明确二级回退 */
  isFallback?: boolean;
  notes: string[];
  instruction: string;
};

export type NormalizedReport = {
  created: boolean;
  queued?: boolean;
  selectedNames?: string[];
  instruction: string;
};

const WAITING_INTERNAL_KEYS = new Set([
  "comparisonResult",
  "comparisonContext",
  "__agentSignal",
  "sourceToolCallId",
  "options",
  "availableTypes",
  "request"
]);

export function normalizeSearchKnowledgeForModel(input: {
  hits?: KnowledgeHitForModel[];
  retrievalFailed?: boolean;
}): NormalizedSearchKnowledge {
  const hits = (input.hits ?? []).map((hit) => ({
    title: hit.title,
    section: hit.section,
    pageLabel: hit.pageLabel,
    content: hit.content
  }));
  if (input.retrievalFailed) {
    return { hits: [], available: false, note: USER_LANGUAGE_NOTES.retrievalUnavailable };
  }
  if (hits.length === 0) {
    return { hits: [], available: false, note: USER_LANGUAGE_NOTES.missingVerifiableSource };
  }
  return { hits, available: true };
}

export function normalizeProductDataForModel(input: {
  products: Array<{ id: string; name: string; summary: string | null; knowledgeDocumentIds?: string[] }>;
  missingProductIds?: string[];
}): NormalizedProductData {
  const missingNotes = (input.missingProductIds ?? []).length > 0
    ? [USER_LANGUAGE_NOTES.missingProduct]
    : [];
  return {
    products: input.products.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary,
      hasTechnicalDocs: (item.knowledgeDocumentIds ?? []).length > 0
    })),
    missingNotes
  };
}

export function normalizeProjectStateForModel(input: {
  profile: { name?: string | null; region?: string | null; buildingType?: string | null; description?: string | null } | null;
  verifiedMemories?: Array<{ title: string | null; content: string }>;
}): NormalizedProjectState {
  if (!input.profile) {
    return { associated: false, memories: [] };
  }
  return {
    associated: true,
    name: input.profile.name ?? null,
    region: input.profile.region ?? null,
    buildingType: input.profile.buildingType ?? null,
    description: input.profile.description ?? null,
    memories: (input.verifiedMemories ?? []).map((item) => ({
      title: item.title,
      content: item.content
    }))
  };
}

export function normalizeComparisonForModel(
  result: ProductComparisonResult,
  productNames?: Map<string, string>
): NormalizedComparison {
  const nameById = productNames ?? new Map(result.products.map((item) => [item.id, item.name]));
  const thermalAvailable = result.thermal.status === "AVAILABLE" && (result.thermal.results?.length ?? 0) > 0;
  return {
    products: result.products.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary ?? null
    })),
    differences: result.dimensions.map((dimension) => ({
      label: dimension.label,
      items: dimension.items.map((item) => ({
        productId: item.productId,
        productName: nameById.get(item.productId) ?? item.productId,
        value: item.value ?? null,
        note: item.note
      }))
    })),
    thermal: thermalAvailable
      ? { available: true }
      : { available: false, note: USER_LANGUAGE_NOTES.missingThermal },
    missingNotes: result.missingNotes,
    instruction: "只解释差异，不要复述整份对比上下文。不要打分、排名或宣称唯一最优。"
  };
}

export function normalizeReferenceLookupForModel(input: LookupThickness & {
  filters?: ThermalLookupFilter[];
  requestedTolerance?: number;
  effectiveTolerance?: number;
  toleranceAdjusted?: boolean;
  metric?: "K" | "TOTAL_R" | "PRODUCT_R";
  targetValue?: number | null;
  tolerance?: number | null;
  found: boolean;
  candidates: NormalizedReferenceLookup["candidates"];
  notes?: string[];
  lookupMode?: string;
  kTolerance?: number | null;
  matchedSystemHint?: boolean | null;
  isFallback?: boolean;
}): NormalizedReferenceLookup {
  const mode = input.lookupMode;
  const multiple = (input.filters?.length ?? 0) > 1;
  const metricLabel = input.metric === "TOTAL_R" ? "总热阻 R" : input.metric === "PRODUCT_R" ? "产品层热阻 R" : "传热系数 K";
  const modeInstruction = input.filters?.length === 0 && input.targetValue == null ? "" : multiple
    ? "本次包含多个热工条件，候选必须同时满足全部条件。有结果时说明找到同时符合这些筛选条件的参考方案；无结果时说明没有找到同时满足全部条件的正式参考方案。列出 K、总热阻、产品层热阻、厚度、构造与原始页，不得输出内部条件数组、枚举或宣称规范达标。"
    : mode === "APPROX"
    ? `本次是${metricLabel}近似查询：只能说「接近 / 约为 / 与目标值很接近」，不能称为满足上限或下限，更不能称为规范达标。`
    : mode === "MAX_LIMIT"
      ? `本次是上限查询：候选均满足${metricLabel} ≤ 目标值，可以说「满足不超过目标值的筛选条件」；不能说满足当地规范。`
      : mode === "MIN_LIMIT"
        ? `本次是下限查询：候选均满足${metricLabel} ≥ 目标值，按最接近下限排序；不能说满足当地规范。`
        : mode === "EXACT"
          ? `本次是${metricLabel}精确查询：只返回固定数值精度内相等的已发布档位。`
          : "";
  const fallback = input.isFallback === true || input.matchedSystemHint === false;
  const fallbackInstruction = fallback
    ? "注意：没有找到符合用户所述保温体系的正式方案，下方是其他体系中接近目标的参考结果。必须先用一句话说明「没有找到符合该体系的正式方案」，再说明下面是其他体系的接近结果，禁止让用户误以为这些就是该体系方案。"
    : "";
  const base = input.found
    ? `${fallback ? "第一句说明没有找到符合用户所述体系条件的正式参考方案，随后说明其他体系的参考结果。" : "第一行直接回答有。"}只使用本结果中的数值。不要把整张构造表再用 Markdown 重写。页面图片由系统单独返回。不要把地区、气候区、基层、建筑类型当成查询前置，也不要展开热工公式。不要暴露内部字段名（如 thermal_reference_rows、systemHint、candidate score）。`
    : "这只说明当前已发布选用表没有匹配行，不代表知识库或图集原文没有方案。必须继续检索知识库/图集后再回答；有出处才能列方案。不要对用户说没有方案，也不要编造档位或 K 值。";
  return {
    thicknessMm: input.thicknessMm,
    thicknessMin: input.thicknessMin,
    thicknessMax: input.thicknessMax,
    preferThinner: input.preferThinner,
    filters: input.filters,
    requestedTolerance: input.requestedTolerance,
    effectiveTolerance: input.effectiveTolerance,
    toleranceAdjusted: input.toleranceAdjusted,
    metric: input.metric,
    targetValue: input.targetValue ?? null,
    tolerance: input.tolerance ?? null,
    found: input.found,
    candidates: input.candidates,
    lookupMode: mode,
    kTolerance: input.kTolerance ?? null,
    matchedSystemHint: input.matchedSystemHint ?? null,
    isFallback: input.isFallback ?? false,
    notes: input.notes ?? [],
    instruction: [base, modeInstruction, fallbackInstruction,
      formatLookupThickness(input) ? `用简单中文说明本次同时按「${formatLookupThickness(input)}」和热工条件筛选；无结果时复述当前条件，不得偷偷放宽厚度或编造接近方案，不输出内部字段名。` : "",
      input.preferThinner ? "用户希望薄一点；在满足全部硬条件的结果中按厚度升序展示，不宣称唯一最优，不编造厚度范围。" : "",
      input.toleranceAdjusted || input.filters?.some((filter) => filter.toleranceAdjusted)
        ? "请说明用户给出的查询范围较大，已按允许的最大范围筛选，并标明实际采用的范围。" : ""
    ].filter(Boolean).join("")
  };
}

export function normalizeThermalForModel(input: {
  valid: boolean;
  K: unknown;
  R: unknown;
  pass?: boolean | null;
  notes?: string[];
  errors?: Array<{ message?: string } | string>;
  process?: Array<{ title?: string; formula?: string; value?: unknown }>;
}): NormalizedThermal {
  const errorNotes = (input.errors ?? []).map((item) => typeof item === "string" ? item : item.message ?? "")
    .filter(Boolean);
  return {
    valid: input.valid,
    K: input.K,
    R: input.R,
    pass: input.pass ?? null,
    notes: [...(input.notes ?? []), ...errorNotes],
    instruction: input.valid
      ? "先给结果，再给简短解释。计算过程只有用户问“怎么算的”时再展开。"
      : USER_LANGUAGE_NOTES.missingThermal
  };
}

export function normalizeReportForModel(input: {
  created?: boolean;
  queued?: boolean;
  selectedNames?: string[];
  blocked?: boolean;
  message?: string;
}): NormalizedReport {
  if (input.blocked) {
    return {
      created: false,
      instruction: input.message ?? "还不能生成报告，请先确认要纳入的产品。"
    };
  }
  if (input.queued) {
    return {
      created: false,
      queued: true,
      selectedNames: input.selectedNames,
      instruction: USER_LANGUAGE_NOTES.reportQueued
    };
  }
  return {
    created: input.created !== false,
    selectedNames: input.selectedNames,
    instruction: USER_LANGUAGE_NOTES.reportCreated
  };
}

export function normalizeToolResultForModel(toolName: AgentToolName | string, raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const record = raw as Record<string, unknown>;
  if (toolName === "search_knowledge") {
    const data = (record.data ?? record) as {
      hits?: KnowledgeHitForModel[];
      retrievalFailed?: boolean;
      context?: string;
    };
    if (Array.isArray(data.hits)) {
      return normalizeSearchKnowledgeForModel(data);
    }
    return data;
  }
  if (toolName === "get_product_data") {
    const data = (record.data ?? record) as {
      products: Array<{ id: string; name: string; summary: string | null; knowledgeDocumentIds?: string[] }>;
      missingProductIds?: string[];
    };
    if (Array.isArray(data.products)) return normalizeProductDataForModel(data);
  }
  if (toolName === "get_project_state") {
    const data = (record.data ?? record) as {
      profile: NormalizedProjectState extends never ? never : {
        name?: string | null;
        region?: string | null;
        buildingType?: string | null;
        description?: string | null;
      } | null;
      verifiedMemories?: Array<{ title: string | null; content: string }>;
    };
    return normalizeProjectStateForModel(data);
  }
  if (toolName === "compare_products" || toolName === "compare_solutions") {
    const comparison = (record.comparison ?? record.data ?? record) as ProductComparisonResult;
    if (comparison && Array.isArray(comparison.products) && Array.isArray(comparison.dimensions)) {
      return normalizeComparisonForModel(comparison);
    }
  }
  if (toolName === "thermal" || toolName === "thermal_calculate") {
    const data = (record.data ?? record) as LookupThickness & {
      valid?: boolean;
      found?: boolean;
      filters?: ThermalLookupFilter[];
      requestedTolerance?: number;
      effectiveTolerance?: number;
      toleranceAdjusted?: boolean;
      metric?: "K" | "TOTAL_R" | "PRODUCT_R";
      targetValue?: number | null;
      tolerance?: number | null;
      candidates?: NormalizedReferenceLookup["candidates"];
      K?: unknown;
      R?: unknown;
      pass?: boolean | null;
      notes?: string[];
      lookupMode?: string;
      kTolerance?: number | null;
      matchedSystemHint?: boolean | null;
      isFallback?: boolean;
      errors?: Array<{ message?: string } | string>;
    };
    if (Array.isArray(data.candidates) || typeof data.found === "boolean") {
      return normalizeReferenceLookupForModel({
        thicknessMm: data.thicknessMm,
        thicknessMin: data.thicknessMin,
        thicknessMax: data.thicknessMax,
        preferThinner: data.preferThinner,
        filters: data.filters,
        requestedTolerance: data.requestedTolerance,
        effectiveTolerance: data.effectiveTolerance,
        toleranceAdjusted: data.toleranceAdjusted,
        metric: data.metric,
        targetValue: data.targetValue,
        tolerance: data.tolerance,
        found: data.found ?? (data.candidates?.length ?? 0) > 0,
        candidates: data.candidates ?? [],
        notes: data.notes,
        lookupMode: data.lookupMode,
        kTolerance: data.kTolerance,
        matchedSystemHint: data.matchedSystemHint,
        isFallback: data.isFallback
      });
    }
    if (typeof data.valid === "boolean") {
      return normalizeThermalForModel({
        valid: data.valid,
        K: data.K,
        R: data.R,
        pass: data.pass,
        notes: data.notes,
        errors: data.errors
      });
    }
  }
  if (toolName === "generate_report") {
    const data = (record.data ?? record) as {
      selectedNames?: string[];
      blocked?: boolean;
      message?: string;
      selectedProductIds?: string[];
      queued?: boolean;
    };
    return normalizeReportForModel({
      created: !data.blocked && !data.queued,
      queued: data.queued,
      selectedNames: data.selectedNames,
      blocked: data.blocked,
      message: data.message
    });
  }
  return raw;
}

/** 从给模型的工具结果中去掉等待态内部字段，避免把完整 ComparisonResult 倾倒进上下文。 */
export function toModelVisibleToolOutput(output: unknown): unknown {
  if (!output || typeof output !== "object") return output;
  const record = output as Record<string, unknown>;
  const visible: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (WAITING_INTERNAL_KEYS.has(key)) continue;
    visible[key] = value;
  }
  if (record.__agentSignal === "WAITING_USER_INPUT") {
    visible.waiting = true;
    visible.instruction = "请等待用户在界面中选择。不要把选项写成 Markdown 编号列表，也不要让用户回复数字。";
  }
  return visible;
}
