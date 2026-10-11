/**
 * Conversation Runtime 任务状态。
 * TaskType 只存在于 Backend Runtime，不是独立 Agent，也不是 C 端 Scene 选择器。
 */
import { wrapContextForReasoning } from "../../shared/ai-response-policy.js";
import { z } from "zod";
import { pageRecognitionLayerSchema } from "../../shared/page-recognition.js";
import { thermalQueryStateSchema, constraintMatchSchema, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import { THERMAL_FACT_RULES } from "./thermal-answer-facts.js";
import { formatLookupThickness } from "../thermal/thermal-lookup-thickness.js";
import { THERMAL_LOOKUP_METRICS, type ThermalLookupMode } from "../thermal/thermal-lookup-mode.js";
export const CONVERSATION_TASK_TYPES = [
  "GENERAL",
  "PRODUCT_CONSULTATION",
  "COMPARISON",
  "REPORT_PREPARATION",
  "REPORT_GENERATION"
] as const;

export type ConversationTaskType = (typeof CONVERSATION_TASK_TYPES)[number];

export const CONVERSATION_UI_ACTIONS = ["SELECT_PRODUCTS", "GENERATE_REPORT", "SELECT_KNOWLEDGE_SOURCES"] as const;
export type ConversationUiAction = (typeof CONVERSATION_UI_ACTIONS)[number];

export type ConversationPendingSelection = {
  type: "COMPARISON_SELECTION" | "USER_SELECTION";
  selectionKind?: "KNOWLEDGE_SOURCE" | "REPORT_TYPE" | "PRODUCT" | "GENERIC";
  multiple: boolean;
  optionIds: string[];
};

export type ReferenceLookupSpecClass = "I" | "II" | "III";

/** 所有指标共用同一查询语义。 */
export type ReferenceLookupMode = ThermalLookupMode;

/** 候选类型与状态解析共用 schema；新增正式字段只在此登记。 */
export const referenceLookupCandidateSchema = z.object({
  id: z.string().trim().min(1),
  constraintMatch: constraintMatchSchema.optional(),
  structureType: z.string().optional(), regionCode: z.string().optional(), standardLimitId: z.string().optional(),
  sourceVersionId: z.string().nullable().optional(),
  specClass: z.enum(["I", "II", "III"]).optional(),
  thicknessMm: z.number().finite().optional(),
  kValue: z.number().finite().optional(),
  lambda: z.number().finite().optional(),
  alpha: z.number().finite().optional(),
  layers: z.array(pageRecognitionLayerSchema).optional(),
  systemId: z.string().optional(),
  systemCode: z.string().nullable().optional(),
  systemName: z.string().optional(),
  atlasPage: z.string().nullable().optional(),
  schemeId: z.string().optional(),
  schemeCode: z.string().optional(),
  schemeVersion: z.number().optional(),
  substrateMaterial: z.string().optional(),
  substrateThickness: z.number().nullable().optional(),
  productSpecId: z.string().optional(),
  catalogProductId: z.string().nullable().optional(),
  specCode: z.string().optional(),
  specVersion: z.number().optional(),
  setId: z.string().optional(),
  setCode: z.string().optional(),
  setVersion: z.number().optional(),
  setPriority: z.number().optional(),
  setBuildingTypes: z.array(z.string()).optional(),
  matchType: z.enum(["EXACT", "NEIGHBOR"]).optional(),
  neighborGap: z.number().nullable().optional(),
  matchedConditions: z.array(z.string()).optional(),
  unmatchedConditions: z.array(z.string()).optional(),
  missingConditions: z.array(z.string()).optional(),
  ranking: z.object({ kGap: z.number(), metric: z.enum(THERMAL_LOOKUP_METRICS).optional(), metricGap: z.number().optional(), isClosestToTarget: z.boolean() }).optional(),
  compliant: z.boolean().nullable().optional(),
  evidenceSource: z.string().optional(),
  evidenceRef: z.string().optional(),
  productThermalResistance: z.number().finite().optional(),
  totalThermalResistance: z.number().finite().optional(),
  sourceDocumentId: z.string().nullable().optional(),
  sourcePageId: z.string().nullable().optional(),
  sourcePageLabel: z.string().nullable().optional(),
  optionId: z.string().optional()
});
export type ReferenceLookupCandidate = z.infer<typeof referenceLookupCandidateSchema>;

export type LastReferenceLookup = {
  query: ThermalQueryState;
  selectedCandidateIds?: string[];
  candidates: ReferenceLookupCandidate[];
  createdAt: string;
  matchedSystemHint?: boolean | null;
  isFallback?: boolean;
};

export type ConversationTaskState = {
  taskType: ConversationTaskType;
  selectedProductIds?: string[];
  confirmedKnowledgeSourceIds?: string[];
  confirmedKnowledgeSourceKind?: "atlas" | "standard" | "technical_manual" | "approved_document";
  knowledgeSourceCandidateIds?: string[];
  selectedReportType?: string;
  comparisonContext?: Record<string, unknown>;
  pendingSelection?: ConversationPendingSelection;
  reportContextSnapshotId?: string | null;
  userGoal?: string;
  lastReferenceLookup?: LastReferenceLookup;
};

export type ConversationTaskDecision = {
  state: ConversationTaskState;
  /** 用户已明确确认生成报告，Backend 直接走 Snapshot，不再问模型 */
  generateReportNow: boolean;
  /** 简单问答：不强制进入 Tool Loop */
  skipToolLoop: boolean;
  source: "UI_ACTION" | "TASK_STATE" | "CONTEXT" | "INTENT";
};

const PRODUCT_CONSULTATION_PATTERN = /产品|vicp|vlcp|适用|优势|特点|性能|介绍/i;
const COMPARISON_INTENT_PATTERN = /对比|区别|竞品|vs|比起|相比|性价比|哪个好|差在哪/i;
const REPORT_INTENT_PATTERN = /生成报告|出一份报告|对比报告|工程报告/;
const GREETING_PATTERN = /^(你好|您好|嗨|哈喽|在吗|hello|hi)[！!。.?？\s]*$/i;

export function parseConversationTaskState(raw: unknown): ConversationTaskState {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const taskType = CONVERSATION_TASK_TYPES.includes(value.taskType as ConversationTaskType)
    ? value.taskType as ConversationTaskType
    : "GENERAL";
  const selectedProductIds = Array.isArray(value.selectedProductIds)
    ? value.selectedProductIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  const pending = value.pendingSelection && typeof value.pendingSelection === "object"
    ? value.pendingSelection as Record<string, unknown>
    : null;
  const confirmedKnowledgeSourceIds = Array.isArray(value.confirmedKnowledgeSourceIds)
    ? uniqueIds(value.confirmedKnowledgeSourceIds.filter((item): item is string => typeof item === "string"))
    : undefined;
  const knowledgeSourceCandidateIds = Array.isArray(value.knowledgeSourceCandidateIds)
    ? uniqueIds(value.knowledgeSourceCandidateIds.filter((item): item is string => typeof item === "string"))
    : undefined;
  const pendingType = pending?.type === "USER_SELECTION" || pending?.type === "COMPARISON_SELECTION"
    ? pending.type
    : null;
  return {
    taskType,
    selectedProductIds: selectedProductIds && selectedProductIds.length > 0 ? uniqueIds(selectedProductIds) : undefined,
    confirmedKnowledgeSourceIds: confirmedKnowledgeSourceIds && confirmedKnowledgeSourceIds.length > 0
      ? confirmedKnowledgeSourceIds
      : undefined,
    confirmedKnowledgeSourceKind: value.confirmedKnowledgeSourceKind === "atlas"
      || value.confirmedKnowledgeSourceKind === "standard"
      || value.confirmedKnowledgeSourceKind === "technical_manual"
      || value.confirmedKnowledgeSourceKind === "approved_document"
      ? value.confirmedKnowledgeSourceKind
      : undefined,
    knowledgeSourceCandidateIds: knowledgeSourceCandidateIds && knowledgeSourceCandidateIds.length > 0
      ? knowledgeSourceCandidateIds
      : undefined,
    selectedReportType: typeof value.selectedReportType === "string" ? value.selectedReportType : undefined,
    comparisonContext: value.comparisonContext && typeof value.comparisonContext === "object"
      ? value.comparisonContext as Record<string, unknown>
      : undefined,
    pendingSelection: pendingType && pending
      ? {
        type: pendingType,
        selectionKind: pending.selectionKind === "KNOWLEDGE_SOURCE"
          || pending.selectionKind === "REPORT_TYPE"
          || pending.selectionKind === "PRODUCT"
          || pending.selectionKind === "GENERIC"
          ? pending.selectionKind
          : pendingType === "COMPARISON_SELECTION" ? "PRODUCT" : undefined,
        multiple: pendingType === "COMPARISON_SELECTION" ? true : Boolean(pending.multiple),
        optionIds: Array.isArray(pending.optionIds)
          ? uniqueIds(pending.optionIds.filter((item): item is string => typeof item === "string"))
          : []
      }
      : undefined,
    reportContextSnapshotId: typeof value.reportContextSnapshotId === "string"
      ? value.reportContextSnapshotId
      : value.reportContextSnapshotId === null
        ? null
        : undefined,
    userGoal: typeof value.userGoal === "string" ? value.userGoal : undefined,
    lastReferenceLookup: parseLastReferenceLookup(value.lastReferenceLookup)
  };
}

function parseLastReferenceLookup(raw: unknown): LastReferenceLookup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const queryRaw = value.query && typeof value.query === "object" ? value.query as Record<string, unknown> : {};
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const parsed = referenceLookupCandidateSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    : [];
  if (candidates.length === 0 && typeof value.createdAt !== "string") return undefined;
  // 历史 JSON 单字段损坏不能让整个会话崩溃，也不能静默丢掉硬条件后放宽查询。
  const parsedQuery = thermalQueryStateSchema.safeParse(queryRaw);
  const repairedQuery: Record<string, unknown> = {};
  const invalidFields: string[] = [];
  if (!parsedQuery.success) for (const [field, schema] of Object.entries(thermalQueryStateSchema.shape)) {
    const parsed = schema.safeParse(queryRaw[field]);
    if (parsed.success) repairedQuery[field] = parsed.data;
    else invalidFields.push(field);
  }
  const query: ThermalQueryState = parsedQuery.success ? parsedQuery.data : {
    ...thermalQueryStateSchema.parse(repairedQuery),
    unresolved: [...((repairedQuery.unresolved ?? []) as NonNullable<ThermalQueryState["unresolved"]>),
      ...invalidFields.map(field => ({ field, reason: "历史条件数据无法校验，请重新确认该条件。" }))]
  };
  return {
    query,
    selectedCandidateIds: Array.isArray(value.selectedCandidateIds) ? value.selectedCandidateIds.filter((id): id is string => typeof id === "string") : undefined,
    candidates,
    matchedSystemHint: typeof value.matchedSystemHint === "boolean" || value.matchedSystemHint === null ? value.matchedSystemHint : undefined,
    isFallback: typeof value.isFallback === "boolean" ? value.isFallback : undefined,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date(0).toISOString()
  };
}

export function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map((item) => item.trim()).filter(Boolean))];
}

export function mergeConversationTaskState(
  current: ConversationTaskState | null | undefined,
  patch: Partial<ConversationTaskState>
): ConversationTaskState {
  const base = current ?? { taskType: "GENERAL" as const };
  const selectedProductIds = patch.selectedProductIds !== undefined
    ? uniqueIds(patch.selectedProductIds)
    : base.selectedProductIds;
  const confirmedKnowledgeSourceIds = patch.confirmedKnowledgeSourceIds !== undefined
    ? uniqueIds(patch.confirmedKnowledgeSourceIds)
    : base.confirmedKnowledgeSourceIds;
  const knowledgeSourceCandidateIds = patch.knowledgeSourceCandidateIds !== undefined
    ? uniqueIds(patch.knowledgeSourceCandidateIds)
    : base.knowledgeSourceCandidateIds;
  return {
    taskType: patch.taskType ?? base.taskType,
    selectedProductIds: selectedProductIds && selectedProductIds.length > 0 ? selectedProductIds : undefined,
    confirmedKnowledgeSourceIds: confirmedKnowledgeSourceIds && confirmedKnowledgeSourceIds.length > 0
      ? confirmedKnowledgeSourceIds
      : undefined,
    confirmedKnowledgeSourceKind: patch.confirmedKnowledgeSourceKind !== undefined
      ? patch.confirmedKnowledgeSourceKind
      : base.confirmedKnowledgeSourceKind,
    knowledgeSourceCandidateIds: knowledgeSourceCandidateIds && knowledgeSourceCandidateIds.length > 0
      ? knowledgeSourceCandidateIds
      : undefined,
    selectedReportType: patch.selectedReportType !== undefined ? patch.selectedReportType : base.selectedReportType,
    comparisonContext: patch.comparisonContext !== undefined ? patch.comparisonContext : base.comparisonContext,
    pendingSelection: patch.pendingSelection !== undefined ? patch.pendingSelection : base.pendingSelection,
    reportContextSnapshotId: patch.reportContextSnapshotId !== undefined
      ? patch.reportContextSnapshotId
      : base.reportContextSnapshotId,
    userGoal: patch.userGoal !== undefined ? patch.userGoal : base.userGoal,
    lastReferenceLookup: patch.lastReferenceLookup !== undefined
      ? patch.lastReferenceLookup
      : base.lastReferenceLookup
  };
}

function formatLastReferenceLookupContext(lookup: LastReferenceLookup): string {
  const modeLabel = lookup.query.mode === "APPROX"
    ? "近似（左右/接近，未要求上限）"
    : lookup.query.mode === "MAX_LIMIT"
      ? "上限（不超过）"
      : lookup.query.mode === "MIN_LIMIT"
        ? "下限（不低于）"
        : lookup.query.mode === "EXACT" ? "精确相等" : null;
  const queryBits = [
    lookup.query.filters?.length ? `全部条件同时满足：${lookup.query.filters.map((filter) => {
      const label = filter.metric === "K" ? "传热系数 K" : filter.metric === "TOTAL_R" ? "总热阻" : "产品层热阻";
      const symbol = filter.mode === "MAX_LIMIT" ? "≤" : filter.mode === "MIN_LIMIT" ? "≥" : filter.mode === "EXACT" ? "=" : "≈";
      return `${label}${symbol}${filter.targetValue}${filter.tolerance !== undefined ? `，实际范围±${filter.tolerance}` : ""}`;
    }).join(" 且 ")}` : null,
    lookup.query.targetValue !== undefined ? `目标${lookup.query.metric === "TOTAL_R" ? "总热阻" : lookup.query.metric === "PRODUCT_R" ? "产品层热阻" : "传热系数"} ${lookup.query.targetValue}` : null,
    lookup.query.targetR !== undefined ? `目标总热阻 ${lookup.query.targetR}` : null,
    lookup.query.targetK !== undefined ? `目标传热系数 ${lookup.query.targetK}` : null,
    modeLabel ? `查询语义 ${modeLabel}` : null,
    lookup.query.systemHint ? `体系 ${lookup.query.systemHint}` : null,
    lookup.query.specClass ? `${lookup.query.specClass}型` : null,
    formatLookupThickness(lookup.query),
    lookup.query.preferThinner ? "满足条件后优先较薄方案" : null
  ].filter(Boolean);
  const candidateLines = lookup.candidates.slice(0, 12).map((item) => {
    const bits = [
      item.schemeCode ? `方案 ${item.schemeCode}` : null,
      item.lambda !== undefined ? `λ=${item.lambda}` : null,
      item.alpha !== undefined ? `α=${item.alpha}` : null,
      item.productThermalResistance !== undefined ? `产品层热阻 ${item.productThermalResistance}` : null,
      item.totalThermalResistance !== undefined ? `外墙主断面总热阻 R₀ ${item.totalThermalResistance}` : null,
      item.sourcePageId ? `sourcePageId=${item.sourcePageId}，原页标签 ${item.sourcePageLabel ?? "未标注"}` : null,
      item.specClass ? `${item.specClass}型` : null,
      item.kValue !== undefined ? `K=${item.kValue}` : null,
      item.thicknessMm !== undefined ? `厚度 ${item.thicknessMm}mm` : null,
      item.systemName ?? null,
      item.schemeId ? `schemeId=${item.schemeId}` : null,
      item.productSpecId ? `productSpecId=${item.productSpecId}` : null,
      item.evidenceSource
        ? `出处：${item.evidenceSource}`
        : null
    ].filter(Boolean);
    return `- ${bits.join("，")}`;
  });
  return [
    "已查询的参考档位（结构化结果，优先于知识检索片段）：",
    lookup.isFallback || lookup.matchedSystemHint === false ? "上一轮未找到用户指定体系，以下候选属于其他体系的明确回退，不能称为指定体系命中。" : null,
    lookup.candidates.length === 0 ? "上一轮参考表未命中，仍保留查询条件；新的条件需要重新查询。" : null,
    queryBits.length > 0 ? `查询：${queryBits.join("；")}` : null,
    ...candidateLines,
    THERMAL_FACT_RULES,
    "纯参数或原页指代可复用上述历史结果；K、模式、热阻、厚度、型号、体系、方案或规格条件变化时必须重新查已发布数据库，历史候选仅用于理解指代与补全缺省条件。不要用知识检索片段覆盖上述数值。"
  ].filter(Boolean).join("\n");
}

export function formatConversationTaskContext(state: ConversationTaskState | null | undefined): string | null {
  if (!state || state.taskType === "GENERAL"
    && !state.selectedProductIds?.length
    && !state.reportContextSnapshotId
    && !state.confirmedKnowledgeSourceIds?.length
    && !state.selectedReportType
    && !state.lastReferenceLookup) {
    return null;
  }
  const lines = [
    state.userGoal ? `用户目标：${state.userGoal}` : null,
    state.selectedProductIds?.length
      ? `已确认纳入后续对比或报告的产品：${state.selectedProductIds.join("、")}`
      : null,
    state.confirmedKnowledgeSourceIds?.length
      ? "已确认本次核验资料来源，后续引用只使用这些来源。"
      : null,
    state.selectedReportType ? "已确认报告类型，生成时直接使用，不要再列出类型清单。" : null,
    state.reportContextSnapshotId ? "已有确认后的报告材料，生成时直接使用，不要再问是否确认。" : null,
    state.lastReferenceLookup
      ? formatLastReferenceLookupContext(state.lastReferenceLookup)
      : null,
    state.pendingSelection
      ? "用户正在界面中勾选。确认后直接继续，不要把选项写成编号列表，也不要在聊天里复述全部历史结论。"
      : null,
    "不要把滚动摘要或猜测覆盖上述已确认选择。"
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return wrapContextForReasoning("当前已确认条件", lines.join("\n"));
}

/**
 * 任务判定优先级：
 * 1. 用户明确 UI 动作
 * 2. 当前 ConversationTaskState
 * 3. 当前 Project / Conversation Context
 * 4. 最后才是自然语言 intent
 */
export function resolveConversationTask(input: {
  uiAction?: ConversationUiAction | null;
  currentState?: ConversationTaskState | null;
  message?: string | null;
  selectedProductIds?: string[] | null;
  optionIds?: string[] | null;
  selectedIds?: string[] | null;
  confirmAction?: "GENERATE_REPORT" | "CONTINUE" | null;
  waitingType?: string | null;
  selectionKind?: "KNOWLEDGE_SOURCE" | "REPORT_TYPE" | "PRODUCT" | "GENERIC" | null;
}): ConversationTaskDecision {
  const current = input.currentState ?? { taskType: "GENERAL" as const };
  const selectedFromUi = uniqueIds([
    ...(input.selectedProductIds ?? []),
    ...(input.optionIds ?? []),
    ...(input.selectedIds ?? [])
  ]);
  const message = input.message?.trim() ?? "";
  const selectionKind = input.selectionKind
    ?? (input.waitingType === "COMPARISON_SELECTION" ? "PRODUCT" : undefined);
  const waitingUserSelection = input.waitingType === "USER_SELECTION" || input.waitingType === "COMPARISON_SELECTION";

  if (input.uiAction === "SELECT_KNOWLEDGE_SOURCES" || (waitingUserSelection && selectionKind === "KNOWLEDGE_SOURCE" && selectedFromUi.length > 0)) {
    return {
      state: mergeConversationTaskState(current, {
        confirmedKnowledgeSourceIds: selectedFromUi,
        pendingSelection: undefined
      }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "UI_ACTION"
    };
  }

  if (waitingUserSelection && selectionKind === "REPORT_TYPE" && selectedFromUi.length > 0) {
    return {
      state: mergeConversationTaskState(current, {
        taskType: "REPORT_GENERATION",
        selectedReportType: selectedFromUi[0],
        pendingSelection: undefined
      }),
      generateReportNow: true,
      skipToolLoop: true,
      source: "UI_ACTION"
    };
  }

  if (input.uiAction === "GENERATE_REPORT" || input.confirmAction === "GENERATE_REPORT") {
    const selectedProductIds = selectionKind === "REPORT_TYPE"
      ? current.selectedProductIds
      : (selectedFromUi.length > 0 ? selectedFromUi : current.selectedProductIds);
    return {
      state: mergeConversationTaskState(current, {
        taskType: "REPORT_GENERATION",
        selectedProductIds,
        selectedReportType: selectionKind === "REPORT_TYPE" ? selectedFromUi[0] : current.selectedReportType,
        pendingSelection: undefined
      }),
      generateReportNow: true,
      skipToolLoop: true,
      source: "UI_ACTION"
    };
  }

  if (input.uiAction === "SELECT_PRODUCTS" || (selectedFromUi.length > 0 && selectionKind !== "REPORT_TYPE" && selectionKind !== "KNOWLEDGE_SOURCE")) {
    const waitingConfirm = input.waitingType === "COMPARISON_SELECTION"
      || (input.waitingType === "USER_SELECTION" && selectionKind === "PRODUCT");
    return {
      state: mergeConversationTaskState(current, {
        taskType: waitingConfirm ? "REPORT_PREPARATION" : "COMPARISON",
        selectedProductIds: selectedFromUi.length > 0 ? selectedFromUi : current.selectedProductIds,
        pendingSelection: waitingConfirm
          ? { type: "COMPARISON_SELECTION", selectionKind: "PRODUCT", multiple: true, optionIds: selectedFromUi }
          : undefined
      }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "UI_ACTION"
    };
  }

  if (current.taskType === "REPORT_GENERATION" && current.reportContextSnapshotId) {
    return {
      state: current,
      generateReportNow: false,
      skipToolLoop: false,
      source: "TASK_STATE"
    };
  }

  if (current.taskType === "COMPARISON" || current.taskType === "REPORT_PREPARATION" || current.pendingSelection) {
    return {
      state: current,
      generateReportNow: false,
      skipToolLoop: false,
      source: "TASK_STATE"
    };
  }

  if (current.selectedProductIds && current.selectedProductIds.length >= 2 && COMPARISON_INTENT_PATTERN.test(message)) {
    return {
      state: mergeConversationTaskState(current, { taskType: "COMPARISON" }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "CONTEXT"
    };
  }

  if (!message || GREETING_PATTERN.test(message)) {
    return {
      state: current,
      generateReportNow: false,
      skipToolLoop: true,
      source: "INTENT"
    };
  }

  if (REPORT_INTENT_PATTERN.test(message) && (current.selectedProductIds?.length || current.comparisonContext)) {
    return {
      state: mergeConversationTaskState(current, { taskType: "REPORT_PREPARATION" }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "INTENT"
    };
  }

  if (COMPARISON_INTENT_PATTERN.test(message)) {
    return {
      state: mergeConversationTaskState(current, { taskType: "COMPARISON", userGoal: current.userGoal ?? message }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "INTENT"
    };
  }

  if (PRODUCT_CONSULTATION_PATTERN.test(message)) {
    return {
      state: mergeConversationTaskState(current, { taskType: "PRODUCT_CONSULTATION" }),
      generateReportNow: false,
      skipToolLoop: false,
      source: "INTENT"
    };
  }

  return {
    state: current,
    generateReportNow: false,
    skipToolLoop: false,
    source: "INTENT"
  };
}
