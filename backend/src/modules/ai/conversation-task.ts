/**
 * Conversation Runtime 任务状态。
 * TaskType 只存在于 Backend Runtime，不是独立 Agent，也不是 C 端 Scene 选择器。
 */
import { wrapContextForReasoning } from "../../shared/ai-response-policy.js";
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

export type ReferenceLookupCandidate = {
  id: string;
  specClass?: ReferenceLookupSpecClass;
  thicknessMm?: number;
  kValue?: number;
  systemName?: string;
  atlasPage?: string | null;
  schemeId?: string;
  productSpecId?: string;
  evidenceSource?: string;
  evidenceRef?: string;
  schemeCode?: string;
  productThermalResistance?: number;
  totalThermalResistance?: number;
  sourceDocumentId?: string | null;
  sourcePageId?: string | null;
  sourcePageLabel?: string | null;
};

export type LastReferenceLookup = {
  query: {
    targetK?: number;
    targetR?: number;
    thicknessMm?: number;
    systemHint?: string;
    specClass?: ReferenceLookupSpecClass;
    systemId?: string;
  };
  candidates: ReferenceLookupCandidate[];
  createdAt: string;
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

const SPEC_CLASSES: ReferenceLookupSpecClass[] = ["I", "II", "III"];

function parseSpecClassValue(raw: unknown): ReferenceLookupSpecClass | undefined {
  return SPEC_CLASSES.includes(raw as ReferenceLookupSpecClass) ? raw as ReferenceLookupSpecClass : undefined;
}

function parseLastReferenceLookup(raw: unknown): LastReferenceLookup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Record<string, unknown>;
  const queryRaw = value.query && typeof value.query === "object" ? value.query as Record<string, unknown> : {};
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || !row.id.trim()) return [];
      return [{
        id: row.id,
        specClass: parseSpecClassValue(row.specClass),
        thicknessMm: typeof row.thicknessMm === "number" ? row.thicknessMm : undefined,
        kValue: typeof row.kValue === "number" ? row.kValue : undefined,
        systemName: typeof row.systemName === "string" ? row.systemName : undefined,
        atlasPage: typeof row.atlasPage === "string" || row.atlasPage === null ? row.atlasPage : undefined,
        schemeId: typeof row.schemeId === "string" ? row.schemeId : undefined,
        productSpecId: typeof row.productSpecId === "string" ? row.productSpecId : undefined,
        evidenceSource: typeof row.evidenceSource === "string" ? row.evidenceSource : undefined,
        evidenceRef: typeof row.evidenceRef === "string" ? row.evidenceRef : undefined
      } satisfies ReferenceLookupCandidate];
    })
    : [];
  if (candidates.length === 0 && typeof value.createdAt !== "string") return undefined;
  return {
    query: {
      targetK: typeof queryRaw.targetK === "number" ? queryRaw.targetK : undefined,
      systemHint: typeof queryRaw.systemHint === "string" ? queryRaw.systemHint : undefined,
      specClass: parseSpecClassValue(queryRaw.specClass),
      systemId: typeof queryRaw.systemId === "string" ? queryRaw.systemId : undefined
    },
    candidates,
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
  const queryBits = [
    lookup.query.targetK !== undefined ? `目标传热系数 ${lookup.query.targetK}` : null,
    lookup.query.systemHint ? `体系 ${lookup.query.systemHint}` : null,
    lookup.query.specClass ? `${lookup.query.specClass}型` : null
  ].filter(Boolean);
  const candidateLines = lookup.candidates.slice(0, 12).map((item) => {
    const bits = [
      item.specClass ? `${item.specClass}型` : null,
      item.kValue !== undefined ? `K=${item.kValue}` : null,
      item.thicknessMm !== undefined ? `厚度 ${item.thicknessMm}mm` : null,
      item.systemName ?? null,
      item.schemeId ? `schemeId=${item.schemeId}` : null,
      item.productSpecId ? `productSpecId=${item.productSpecId}` : null,
      item.atlasPage || item.evidenceSource || item.evidenceRef
        ? `出处：${[item.evidenceSource, item.atlasPage, item.evidenceRef].filter(Boolean).join(" / ")}`
        : null
    ].filter(Boolean);
    return `- ${bits.join("，")}`;
  });
  return [
    "已查询的参考档位（结构化结果，优先于知识检索片段）：",
    queryBits.length > 0 ? `查询：${queryBits.join("；")}` : null,
    ...candidateLines,
    "后续追问优先使用以上结果。不要用知识检索片段覆盖这些已确认的 K 值、厚度或档位，除非用户更换了图集或保温体系。"
  ].filter(Boolean).join("\n");
}

export function formatConversationTaskContext(state: ConversationTaskState | null | undefined): string | null {
  if (!state || state.taskType === "GENERAL"
    && !state.selectedProductIds?.length
    && !state.reportContextSnapshotId
    && !state.confirmedKnowledgeSourceIds?.length
    && !state.selectedReportType
    && !state.lastReferenceLookup?.candidates.length) {
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
    state.lastReferenceLookup?.candidates.length
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
