/**
 * Tool Result 三层隔离：
 * Raw Tool Result → Backend 内部落库
 * LLM Tool Context → 给模型理解（本文件）
 * User Response → 聊天正文 / sources / comparison_ready
 */
import { USER_LANGUAGE_NOTES } from "../../../shared/ai-response-policy.js";
import type { AgentToolName } from "../ai-capability-router.js";
import type { ProductComparisonResult } from "../compare-product.js";

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

export type NormalizedReferenceLookup = {
  found: boolean;
  candidates: Array<{
    id: string;
    specClass?: string;
    thicknessMm?: number;
    kValue?: number;
    systemName?: string;
    atlasPage?: string | null;
    schemeId?: string;
    productSpecId?: string;
    evidenceSource?: string;
    evidenceRef?: string;
  }>;
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

export function normalizeReferenceLookupForModel(input: {
  found: boolean;
  candidates: NormalizedReferenceLookup["candidates"];
  notes?: string[];
}): NormalizedReferenceLookup {
  return {
    found: input.found,
    candidates: input.candidates,
    notes: input.notes ?? [],
    instruction: input.found
      ? "第一行直接回答有。只使用本结果中的数值。不要把整张构造表再用 Markdown 重写。页面图片由系统单独返回。不要把地区、气候区、基层、建筑类型当成查询前置，也不要展开热工公式。"
      : "这只说明当前已发布选用表没有匹配行，不代表知识库或图集原文没有方案。必须继续检索知识库/图集后再回答；有出处才能列方案。不要对用户说没有方案，也不要编造档位或 K 值。"
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
    const data = (record.data ?? record) as {
      valid?: boolean;
      found?: boolean;
      candidates?: NormalizedReferenceLookup["candidates"];
      K?: unknown;
      R?: unknown;
      pass?: boolean | null;
      notes?: string[];
      errors?: Array<{ message?: string } | string>;
    };
    if (Array.isArray(data.candidates) || typeof data.found === "boolean") {
      return normalizeReferenceLookupForModel({
        found: data.found ?? (data.candidates?.length ?? 0) > 0,
        candidates: data.candidates ?? [],
        notes: data.notes
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
