/**
 * Human-in-the-Loop 等待结构。
 * 统一协议为 USER_SELECTION（图集来源 / 报告类型 / 产品多选 / 其它）。
 * COMPARISON_SELECTION / CHOICE 作为兼容别名保留；APPROVAL 仅用于不可逆操作。
 * 用户已多选并点击「确认并生成报告」后不得再二次询问是否确认。
 */
import type { ComparisonResult } from "./compare-solution.js";
import type { ProductComparisonResult } from "./compare-product.js";
import {
  buildUserSelectionRequest,
  collectResumeSelectedIds,
  formatUserSelectionResumeMessage,
  parseUserSelectionRequest,
  validateUserSelection,
  UserSelectionError,
  type UserSelectionKind,
  type UserSelectionRequest,
  type UserSelectionResumeInput,
  type UserSelectionResult
} from "./user-selection.js";

export const AGENT_WAIT_TYPES = ["USER_SELECTION", "CHOICE", "APPROVAL", "COMPARISON_SELECTION"] as const;
export type AgentWaitType = (typeof AGENT_WAIT_TYPES)[number];

export type AgentChoiceOption = {
  id: string;
  label: string;
  summary: string;
  data?: Record<string, unknown>;
};

export type AgentConfirmAction = {
  type: "CONTINUE" | "GENERATE_REPORT";
  label: string;
};

export type AgentWaitState = {
  type: AgentWaitType;
  selectionKind?: UserSelectionKind;
  title: string;
  prompt: string;
  options: AgentChoiceOption[];
  multiple?: boolean;
  minSelections?: number;
  maxSelections?: number;
  autoSelectWhenSingle?: boolean;
  confirmAction?: AgentConfirmAction;
  request?: UserSelectionRequest;
  comparisonResult?: ComparisonResult | ProductComparisonResult;
  sourceToolCallId?: string;
  /** 兼容旧 waiting.reason */
  reason?: string;
};

export type SelectedUserSelection = UserSelectionResult;

export type SelectedChoice = {
  optionId: string;
  option: AgentChoiceOption;
  comparisonResult?: ComparisonResult | ProductComparisonResult;
  sourceToolCallId?: string;
};

export type SelectedComparison = {
  optionIds: string[];
  options: AgentChoiceOption[];
  confirmAction?: "GENERATE_REPORT";
  comparisonResult?: ComparisonResult | ProductComparisonResult;
  sourceToolCallId?: string;
};

const CN_ORDINALS: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 拾: 10
};

const EN_ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10
};

function parseOrdinalToken(token: string): number | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const value = Number(trimmed);
    return value >= 1 ? value : null;
  }
  if (trimmed.length === 1 && CN_ORDINALS[trimmed]) return CN_ORDINALS[trimmed]!;
  const en = EN_ORDINALS[trimmed.toLowerCase()];
  return en ?? null;
}

function normalizeChoiceText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, "").toLowerCase();
}

function optionIdentity(option: AgentChoiceOption): string {
  const data = option.data ?? {};
  const record = option as unknown as Record<string, unknown>;
  return option.id
    || (typeof data.candidateId === "string" ? data.candidateId : "")
    || (typeof data.schemeId === "string" ? data.schemeId : "")
    || (typeof data.id === "string" ? data.id : "")
    || (typeof record.candidateId === "string" ? record.candidateId : "")
    || (typeof record.schemeId === "string" ? record.schemeId : "");
}

function findOption(
  options: AgentChoiceOption[],
  token: string
): AgentChoiceOption | undefined {
  const byId = options.find((item) => optionIdentity(item) === token);
  if (byId) return byId;
  const normalized = normalizeChoiceText(token);
  const byLabel = options.find((item) => normalizeChoiceText(item.label) === normalized);
  if (byLabel) return byLabel;
  const contained = options.filter((item) => {
    const label = normalizeChoiceText(item.label);
    return Boolean(label) && (normalized.includes(label) || label.includes(normalized));
  });
  return contained.length === 1 ? contained[0] : undefined;
}

/**
 * 从持久化 options 解析用户选择：optionId、标签、序号（第二个 / 2 / 二）。
 * 解析失败返回 null，不得猜测成 recommendedOrder[0]。
 */
export function resolveChoiceFromInput(
  waiting: Pick<AgentWaitState, "type" | "options"> | null | undefined,
  input: { content?: string | null; optionId?: string | null }
): SelectedChoice | null {
  if (!waiting || waiting.options.length === 0) return null;
  if (waiting.type === "COMPARISON_SELECTION" || waiting.type === "USER_SELECTION") {
    const selected = resolveComparisonSelectionFromInput(waiting, input);
    const first = selected?.options[0];
    if (!first) return null;
    return { optionId: first.id, option: first };
  }
  if (waiting.type !== "CHOICE") return null;
  const options = waiting.options;

  if (input.optionId) {
    const byId = findOption(options, input.optionId);
    if (byId) return { optionId: optionIdentity(byId) || byId.id, option: { ...byId, id: optionIdentity(byId) || byId.id } };
  }

  const content = input.content?.trim() ?? "";
  if (!content) return null;

  const direct = findOption(options, content);
  if (direct) return { optionId: optionIdentity(direct) || direct.id, option: { ...direct, id: optionIdentity(direct) || direct.id } };

  const ordinalMatch = content.match(/第\s*([一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾\d]+)\s*个?/)
    ?? content.match(/^\s*(?:选(?:择)?|方案|选项)?\s*([一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾\d]+|[A-Ja-j]|first|second|third|fourth|fifth)\s*$/i);
  if (ordinalMatch?.[1]) {
    const token = ordinalMatch[1];
    if (/^[A-Ja-j]$/.test(token) && options.length <= 10) {
      const index = token.toUpperCase().charCodeAt(0) - 64;
      const option = options[index - 1];
      if (option) {
        const id = optionIdentity(option) || option.id;
        return { optionId: id, option: { ...option, id } };
      }
    }
    const ordinal = parseOrdinalToken(token);
    if (ordinal != null) {
      const option = options[ordinal - 1];
      if (option) {
        const id = optionIdentity(option) || option.id;
        return { optionId: id, option: { ...option, id } };
      }
    }
  }

  return null;
}

export function resolveComparisonSelectionFromInput(
  waiting: Pick<AgentWaitState, "type" | "options" | "minSelections"> | null | undefined,
  input: {
    content?: string | null;
    optionId?: string | null;
    optionIds?: string[] | null;
    selectedIds?: string[] | null;
    confirmAction?: "CONTINUE" | "GENERATE_REPORT" | null;
  }
): SelectedComparison | null {
  if (!waiting || waiting.options.length === 0) return null;
  const options = waiting.options;
  const collected: AgentChoiceOption[] = [];

  const pushOption = (option: AgentChoiceOption | undefined) => {
    if (!option) return;
    const id = optionIdentity(option) || option.id;
    if (!id || collected.some((item) => (optionIdentity(item) || item.id) === id)) return;
    collected.push({ ...option, id });
  };

  for (const id of [...(input.selectedIds ?? []), ...(input.optionIds ?? [])]) {
    pushOption(findOption(options, id));
  }
  if (input.optionId) pushOption(findOption(options, input.optionId));

  const content = input.content?.trim() ?? "";
  if (content && collected.length === 0) {
    if (/全选|都要|全部/.test(content)) {
      options.forEach((item) => pushOption(item));
    } else {
      const parts = content.split(/[,，、和与及\s]+/).map((item) => item.trim()).filter(Boolean);
      for (const part of parts) {
        const ordinal = part.match(/第?\s*([一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾\d]+)\s*个?/);
        if (ordinal?.[1]) {
          const index = parseOrdinalToken(ordinal[1]);
          if (index != null) pushOption(options[index - 1]);
        }
        pushOption(findOption(options, part));
      }
    }
  }

  const minSelections = waiting.minSelections ?? 1;
  if (collected.length < minSelections) return null;
  return {
    optionIds: collected.map((item) => item.id),
    options: collected,
    confirmAction: input.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" : undefined
  };
}

export function waitStateToUserSelectionRequest(waiting: AgentWaitState): UserSelectionRequest {
  if (waiting.request?.type === "USER_SELECTION") return waiting.request;
  const selectionKind: UserSelectionKind = waiting.selectionKind
    ?? (waiting.type === "COMPARISON_SELECTION" ? "PRODUCT" : "GENERIC");
  return buildUserSelectionRequest({
    selectionKind,
    title: waiting.title,
    description: waiting.prompt,
    options: waiting.options.map((item) => ({
      id: optionIdentity(item) || item.id,
      title: item.label,
      description: item.summary,
      meta: item.data
    })),
    multiple: waiting.multiple ?? waiting.type === "COMPARISON_SELECTION",
    minSelections: waiting.minSelections ?? 1,
    maxSelections: waiting.maxSelections,
    autoSelectWhenSingle: waiting.autoSelectWhenSingle ?? true,
    confirmAction: waiting.confirmAction ?? (
      waiting.type === "COMPARISON_SELECTION"
        ? { type: "GENERATE_REPORT", label: "确认并生成报告" }
        : { type: "CONTINUE", label: "确认" }
    )
  });
}

export function resolveUserSelectionFromInput(
  waiting: AgentWaitState | null | undefined,
  input: UserSelectionResumeInput
): SelectedUserSelection | null {
  if (!waiting) return null;
  if (waiting.type === "APPROVAL") return null;
  const request = waitStateToUserSelectionRequest(waiting);
  const collected = collectResumeSelectedIds(input);
  if (collected.length === 0 && !input.content?.trim()) return null;
  try {
    return validateUserSelection(request, {
      ...input,
      selectedIds: collected.length > 0 ? collected : undefined
    });
  } catch (error) {
    if (error instanceof UserSelectionError && collected.length > 0) {
      throw error;
    }
    if (collected.length === 0 && input.content?.trim()) {
      const comparison = resolveComparisonSelectionFromInput(waiting, {
        content: input.content,
        optionId: input.optionId,
        optionIds: input.optionIds,
        selectedIds: input.selectedIds,
        confirmAction: input.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" : undefined
      });
      if (!comparison) return null;
      return {
        selectionKind: request.selectionKind,
        selectedIds: comparison.optionIds,
        options: comparison.options.map((item) => ({
          id: item.id,
          title: item.label,
          description: item.summary,
          meta: item.data
        })),
        confirmAction: comparison.confirmAction
      };
    }
    return null;
  }
}

export function attachUserSelectionRequest(waiting: AgentWaitState): AgentWaitState {
  const request = waitStateToUserSelectionRequest(waiting);
  return {
    ...waiting,
    selectionKind: waiting.selectionKind ?? request.selectionKind,
    request,
    multiple: request.multiple,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    autoSelectWhenSingle: request.autoSelectWhenSingle,
    confirmAction: waiting.confirmAction ?? request.confirmAction
  };
}

export function formatChoiceResumeMessage(choice: SelectedChoice, rawContent?: string): string {
  const data = choice.option.data ?? {};
  const kValue = data.kValue ?? data.K;
  const thickness = data.thickness ?? data.thicknessMm;
  return [
    `用户已选择方案：${choice.option.label}（optionId=${choice.optionId}）。`,
    rawContent ? `原始输入：${rawContent}` : null,
    choice.option.summary ? `方案摘要：${choice.option.summary}` : null,
    kValue != null ? `系统给出的 K=${String(kValue)}` : null,
    thickness != null ? `系统给出的厚度=${String(thickness)}` : null,
    "请基于系统 ComparisonResult 解释差异与适用条件，不得修改数值、编造评分或把未选方案当作最终方案。",
    "尚未要求生成正式报告前，不要调用 generate_report。"
  ].filter(Boolean).join("\n");
}

export function formatComparisonSelectionResumeMessage(
  selection: SelectedComparison,
  rawContent?: string
): string {
  return formatUserSelectionResumeMessage({
    selectionKind: "PRODUCT",
    selectedIds: selection.optionIds,
    options: selection.options.map((item) => ({
      id: item.id,
      title: item.label,
      description: item.summary,
      meta: item.data
    })),
    confirmAction: selection.confirmAction
  }, rawContent);
}

export function buildChoiceWaitState(input: {
  comparison: ComparisonResult;
  sourceToolCallId?: string;
}): AgentWaitState {
  const passing = input.comparison.candidates.filter((item) => item.passed);
  const options: AgentChoiceOption[] = passing.map((item, index) => ({
    id: item.id,
    label: item.name,
    summary: [
      `第${index + 1}个`,
      item.kValue != null ? `K=${item.kValue}` : null,
      item.thickness != null ? `${item.thickness}mm` : null,
      item.rank != null ? `排序第${item.rank}` : null
    ].filter(Boolean).join("，"),
    data: {
      id: item.id,
      name: item.name,
      kValue: item.kValue,
      thickness: item.thickness,
      passed: item.passed,
      rank: item.rank,
      reasons: item.reasons,
      sourceRefs: item.sourceRefs
    }
  }));
  return attachUserSelectionRequest({
    type: "CHOICE",
    selectionKind: "GENERIC",
    title: "请选择一个方案继续",
    prompt: "以下方案均满足当前项目要求，请选择后续采用的方案。",
    options,
    multiple: false,
    minSelections: 1,
    maxSelections: 1,
    autoSelectWhenSingle: true,
    confirmAction: { type: "CONTINUE", label: "确认选择" },
    comparisonResult: input.comparison,
    sourceToolCallId: input.sourceToolCallId,
    reason: "USER_CHOICE"
  });
}

export function buildComparisonSelectionWaitState(input: {
  products: Array<{ id: string; name: string; summary?: string | null }>;
  comparisonResult: ProductComparisonResult | ComparisonResult;
  sourceToolCallId?: string;
}): AgentWaitState {
  const options: AgentChoiceOption[] = input.products.map((item, index) => ({
    id: item.id,
    label: item.name,
    summary: item.summary?.trim() || `第${index + 1}个可选产品/方案`,
    data: {
      id: item.id,
      name: item.name,
      summary: item.summary ?? null
    }
  }));
  return attachUserSelectionRequest({
    type: "COMPARISON_SELECTION",
    selectionKind: "PRODUCT",
    title: "请选择需要纳入报告的产品/方案",
    prompt: "可选择一个或多个，确认后系统将自动生成对比报告。",
    options,
    multiple: true,
    minSelections: 1,
    autoSelectWhenSingle: true,
    confirmAction: {
      type: "GENERATE_REPORT",
      label: "确认并生成报告"
    },
    comparisonResult: input.comparisonResult,
    sourceToolCallId: input.sourceToolCallId,
    reason: "COMPARISON_SELECTION"
  });
}

export function buildUserSelectionWaitState(input: {
  request: UserSelectionRequest;
  comparisonResult?: ComparisonResult | ProductComparisonResult;
  sourceToolCallId?: string;
}): AgentWaitState {
  const request = input.request;
  const legacyType: AgentWaitType = request.selectionKind === "PRODUCT"
    ? "COMPARISON_SELECTION"
    : "USER_SELECTION";
  return {
    type: "USER_SELECTION",
    selectionKind: request.selectionKind,
    title: request.title,
    prompt: request.description ?? request.title,
    options: request.options.map((item) => ({
      id: item.id,
      label: item.title,
      summary: item.description ?? "",
      data: item.meta
    })),
    multiple: request.multiple,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    autoSelectWhenSingle: request.autoSelectWhenSingle,
    confirmAction: request.confirmAction,
    request,
    comparisonResult: input.comparisonResult,
    sourceToolCallId: input.sourceToolCallId,
    reason: request.selectionKind === "PRODUCT" ? "COMPARISON_SELECTION" : legacyType
  };
}

export function isApprovalWait(waiting: AgentWaitState | null | undefined): boolean {
  return waiting?.type === "APPROVAL";
}

export function isComparisonSelectionWait(waiting: AgentWaitState | null | undefined): boolean {
  return waiting?.type === "COMPARISON_SELECTION"
    || (waiting?.type === "USER_SELECTION" && waiting.selectionKind === "PRODUCT");
}

export function isUserSelectionWait(waiting: AgentWaitState | null | undefined): boolean {
  return waiting?.type === "USER_SELECTION" || waiting?.type === "COMPARISON_SELECTION" || waiting?.type === "CHOICE";
}

export function parseAgentWaitState(raw: unknown): AgentWaitState | undefined {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!value) return undefined;
  const waitingRecord = value.waiting && typeof value.waiting === "object"
    ? value.waiting as Record<string, unknown>
    : value.prompt != null ? value : null;
  if (!waitingRecord) {
    if (typeof value.waitingPrompt === "string") {
      return {
        type: "CHOICE",
        title: "请选择",
        prompt: value.waitingPrompt,
        options: Array.isArray(value.waitingOptions) ? value.waitingOptions as AgentChoiceOption[] : [],
        reason: "USER_CHOICE"
      };
    }
    return undefined;
  }
  const parsedRequest = parseUserSelectionRequest(waitingRecord) ?? parseUserSelectionRequest(value);
  const rawType = waitingRecord.type;
  const type: AgentWaitType = rawType === "APPROVAL"
    ? "APPROVAL"
    : rawType === "USER_SELECTION"
      ? "USER_SELECTION"
      : rawType === "COMPARISON_SELECTION"
        ? "COMPARISON_SELECTION"
        : parsedRequest ? "USER_SELECTION" : "CHOICE";
  if (typeof waitingRecord.prompt !== "string" && !parsedRequest) return undefined;
  const confirm = waitingRecord.confirmAction && typeof waitingRecord.confirmAction === "object"
    ? waitingRecord.confirmAction as Record<string, unknown>
    : parsedRequest?.confirmAction ?? null;
  const prompt = typeof waitingRecord.prompt === "string"
    ? waitingRecord.prompt
    : parsedRequest?.description ?? parsedRequest?.title ?? "";
  const options = Array.isArray(waitingRecord.options)
    ? waitingRecord.options as AgentChoiceOption[]
    : (parsedRequest?.options ?? []).map((item) => ({
      id: item.id,
      label: item.title,
      summary: item.description ?? "",
      data: item.meta
    }));
  const selectionKind = parsedRequest?.selectionKind
    ?? (typeof waitingRecord.selectionKind === "string" ? waitingRecord.selectionKind as UserSelectionKind : undefined)
    ?? (type === "COMPARISON_SELECTION" ? "PRODUCT" : type === "USER_SELECTION" ? "GENERIC" : undefined);
  const waiting: AgentWaitState = {
    type,
    selectionKind,
    title: typeof waitingRecord.title === "string"
      ? waitingRecord.title
      : parsedRequest?.title
        ?? (type === "COMPARISON_SELECTION"
          ? "请选择需要纳入报告的产品/方案"
          : type === "CHOICE" ? "请选择一个方案继续" : type === "USER_SELECTION" ? "请选择" : "请确认是否继续"),
    prompt,
    options,
    multiple: parsedRequest?.multiple
      ?? (type === "COMPARISON_SELECTION" ? true : Boolean(waitingRecord.multiple)),
    minSelections: parsedRequest?.minSelections
      ?? (typeof waitingRecord.minSelections === "number" ? waitingRecord.minSelections : (type === "COMPARISON_SELECTION" ? 1 : undefined)),
    maxSelections: parsedRequest?.maxSelections
      ?? (typeof waitingRecord.maxSelections === "number" ? waitingRecord.maxSelections : undefined),
    autoSelectWhenSingle: parsedRequest?.autoSelectWhenSingle
      ?? waitingRecord.autoSelectWhenSingle !== false,
    confirmAction: confirm && (confirm.type === "GENERATE_REPORT" || confirm.type === "CONTINUE")
      ? { type: confirm.type, label: typeof confirm.label === "string" ? confirm.label : (confirm.type === "GENERATE_REPORT" ? "确认并生成报告" : "确认") }
      : type === "COMPARISON_SELECTION"
        ? { type: "GENERATE_REPORT", label: "确认并生成报告" }
        : undefined,
    request: parsedRequest ?? undefined,
    comparisonResult: waitingRecord.comparisonResult && typeof waitingRecord.comparisonResult === "object"
      ? waitingRecord.comparisonResult as AgentWaitState["comparisonResult"]
      : undefined,
    sourceToolCallId: typeof waitingRecord.sourceToolCallId === "string" ? waitingRecord.sourceToolCallId : undefined,
    reason: typeof waitingRecord.reason === "string"
      ? waitingRecord.reason
      : type === "COMPARISON_SELECTION"
        ? "COMPARISON_SELECTION"
        : type === "CHOICE" ? "USER_CHOICE" : type === "USER_SELECTION" ? "USER_SELECTION" : "USER_APPROVAL"
  };
  if (type !== "APPROVAL" && !waiting.request) {
    return attachUserSelectionRequest(waiting);
  }
  return waiting;
}

export function parseSelectedChoice(raw: unknown): SelectedChoice | undefined {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!value) return undefined;
  const selected = value.selectedChoice && typeof value.selectedChoice === "object"
    ? value.selectedChoice as Record<string, unknown>
    : value.optionId ? value : null;
  if (!selected || typeof selected.optionId !== "string") return undefined;
  const option = selected.option && typeof selected.option === "object"
    ? selected.option as AgentChoiceOption
    : undefined;
  if (!option?.id) return undefined;
  return {
    optionId: selected.optionId,
    option,
    comparisonResult: selected.comparisonResult && typeof selected.comparisonResult === "object"
      ? selected.comparisonResult as SelectedChoice["comparisonResult"]
      : undefined,
    sourceToolCallId: typeof selected.sourceToolCallId === "string" ? selected.sourceToolCallId : undefined
  };
}

export function parseSelectedComparison(raw: unknown): SelectedComparison | undefined {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!value) return undefined;
  const selected = value.selectedComparison && typeof value.selectedComparison === "object"
    ? value.selectedComparison as Record<string, unknown>
    : Array.isArray(value.optionIds) ? value : null;
  if (!selected || !Array.isArray(selected.optionIds)) return undefined;
  const optionIds = selected.optionIds.filter((item): item is string => typeof item === "string");
  const options = Array.isArray(selected.options) ? selected.options as AgentChoiceOption[] : [];
  if (optionIds.length === 0) return undefined;
  return {
    optionIds,
    options,
    confirmAction: selected.confirmAction === "GENERATE_REPORT" ? "GENERATE_REPORT" : undefined,
    comparisonResult: selected.comparisonResult && typeof selected.comparisonResult === "object"
      ? selected.comparisonResult as SelectedComparison["comparisonResult"]
      : undefined,
    sourceToolCallId: typeof selected.sourceToolCallId === "string" ? selected.sourceToolCallId : undefined
  };
}
