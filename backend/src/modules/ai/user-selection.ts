/**
 * 统一 USER_SELECTION 人机选择协议。
 * 图集/知识来源、报告类型、产品/方案多选都走这一套 WAITING JSON，不再为每种业务另造等待结构。
 * 旧 CHOICE / COMPARISON_SELECTION 仍可解析，Resume 时归一到 selectedIds。
 */
export const USER_SELECTION_KINDS = [
  "KNOWLEDGE_SOURCE",
  "REPORT_TYPE",
  "PRODUCT",
  "GENERIC"
] as const;

export type UserSelectionKind = (typeof USER_SELECTION_KINDS)[number];

export const USER_SELECTION_CONFIRM_ACTIONS = ["CONTINUE", "GENERATE_REPORT"] as const;
export type UserSelectionConfirmActionType = (typeof USER_SELECTION_CONFIRM_ACTIONS)[number];

export type UserSelectionOption = {
  id: string;
  title: string;
  description?: string;
  meta?: Record<string, unknown>;
};

export type UserSelectionConfirmAction = {
  type: UserSelectionConfirmActionType;
  label: string;
};

export type UserSelectionRequest = {
  type: "USER_SELECTION";
  selectionKind: UserSelectionKind;
  title: string;
  description?: string;
  multiple: boolean;
  minSelections: number;
  maxSelections?: number;
  autoSelectWhenSingle: boolean;
  options: UserSelectionOption[];
  confirmAction: UserSelectionConfirmAction;
};

export type UserSelectionResumeInput = {
  runId?: string;
  selectionKind?: UserSelectionKind | null;
  selectedIds?: string[] | null;
  /** 兼容旧单选 */
  optionId?: string | null;
  /** 兼容旧多选 */
  optionIds?: string[] | null;
  content?: string | null;
  confirmAction?: UserSelectionConfirmActionType | null;
};

export type UserSelectionResult = {
  selectionKind: UserSelectionKind;
  selectedIds: string[];
  options: UserSelectionOption[];
  confirmAction?: UserSelectionConfirmActionType;
};

export type UserSelectionErrorCode = "SELECTION_INVALID" | "SELECTION_KIND_MISMATCH" | "SELECTION_COUNT";

export class UserSelectionError extends Error {
  readonly code: UserSelectionErrorCode;

  constructor(code: UserSelectionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "UserSelectionError";
  }
}

export function isUserSelectionKind(value: unknown): value is UserSelectionKind {
  return typeof value === "string" && (USER_SELECTION_KINDS as readonly string[]).includes(value);
}

export function uniqueSelectedIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.map((item) => item?.trim() ?? "").filter(Boolean))];
}

export function collectResumeSelectedIds(input: UserSelectionResumeInput): string[] {
  return uniqueSelectedIds([
    ...(input.selectedIds ?? []),
    ...(input.optionIds ?? []),
    input.optionId
  ]);
}

export function buildUserSelectionRequest(input: {
  selectionKind: UserSelectionKind;
  title: string;
  description?: string;
  options: UserSelectionOption[];
  multiple?: boolean;
  minSelections?: number;
  maxSelections?: number;
  autoSelectWhenSingle?: boolean;
  confirmAction?: UserSelectionConfirmAction;
}): UserSelectionRequest {
  const multiple = input.multiple ?? false;
  const minSelections = input.minSelections ?? 1;
  return {
    type: "USER_SELECTION",
    selectionKind: input.selectionKind,
    title: input.title,
    description: input.description,
    multiple,
    minSelections,
    maxSelections: input.maxSelections ?? (multiple ? undefined : 1),
    autoSelectWhenSingle: input.autoSelectWhenSingle ?? true,
    options: input.options,
    confirmAction: input.confirmAction ?? {
      type: "CONTINUE",
      label: "确认"
    }
  };
}

/**
 * 单来源自动选中：不进入 WAITING。调用方直接使用返回的 selectedIds 继续执行。
 */
export function autoSelectWhenSingleOption(request: UserSelectionRequest): string[] | null {
  if (!request.autoSelectWhenSingle) return null;
  if (request.options.length !== 1) return null;
  const onlyId = request.options[0]?.id?.trim();
  if (!onlyId) return null;
  if (request.minSelections > 1) return null;
  return [onlyId];
}

export function validateUserSelection(
  request: UserSelectionRequest,
  input: UserSelectionResumeInput
): UserSelectionResult {
  if (input.selectionKind && input.selectionKind !== request.selectionKind) {
    throw new UserSelectionError("SELECTION_KIND_MISMATCH", "当前等待的选择类型与提交不一致");
  }
  const optionById = new Map(request.options.map((item) => [item.id, item]));
  const selectedIds = collectResumeSelectedIds(input);
  const unknown = selectedIds.filter((id) => !optionById.has(id));
  if (unknown.length > 0) {
    throw new UserSelectionError("SELECTION_INVALID", "所选项目不在当前可选项中");
  }
  if (selectedIds.length < request.minSelections) {
    throw new UserSelectionError(
      "SELECTION_COUNT",
      request.minSelections <= 1 ? "请至少选择一项" : `请至少选择 ${request.minSelections} 项`
    );
  }
  if (request.maxSelections != null && selectedIds.length > request.maxSelections) {
    throw new UserSelectionError("SELECTION_COUNT", `最多只能选择 ${request.maxSelections} 项`);
  }
  if (!request.multiple && selectedIds.length > 1) {
    throw new UserSelectionError("SELECTION_COUNT", "当前选择只能单选");
  }
  return {
    selectionKind: request.selectionKind,
    selectedIds,
    options: selectedIds.map((id) => optionById.get(id)!),
    confirmAction: input.confirmAction === "GENERATE_REPORT" || input.confirmAction === "CONTINUE"
      ? input.confirmAction
      : undefined
  };
}

export function parseUserSelectionRequest(raw: unknown): UserSelectionRequest | null {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!value) return null;
  const requestRecord = value.request && typeof value.request === "object"
    ? value.request as Record<string, unknown>
    : value.type === "USER_SELECTION" ? value : null;
  if (!requestRecord || requestRecord.type !== "USER_SELECTION") return null;
  if (!isUserSelectionKind(requestRecord.selectionKind)) return null;
  if (typeof requestRecord.title !== "string" || !Array.isArray(requestRecord.options)) return null;
  const confirm = requestRecord.confirmAction && typeof requestRecord.confirmAction === "object"
    ? requestRecord.confirmAction as Record<string, unknown>
    : null;
  const options: UserSelectionOption[] = requestRecord.options.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id : "";
    const title = typeof row.title === "string"
      ? row.title
      : typeof row.label === "string" ? row.label : "";
    if (!id || !title) return [];
    return [{
      id,
      title,
      description: typeof row.description === "string"
        ? row.description
        : typeof row.summary === "string" ? row.summary : undefined,
      meta: row.meta && typeof row.meta === "object"
        ? row.meta as Record<string, unknown>
        : row.data && typeof row.data === "object"
          ? row.data as Record<string, unknown>
          : undefined
    }];
  });
  return {
    type: "USER_SELECTION",
    selectionKind: requestRecord.selectionKind,
    title: requestRecord.title,
    description: typeof requestRecord.description === "string"
      ? requestRecord.description
      : typeof requestRecord.prompt === "string" ? requestRecord.prompt : undefined,
    multiple: Boolean(requestRecord.multiple),
    minSelections: typeof requestRecord.minSelections === "number" ? requestRecord.minSelections : 1,
    maxSelections: typeof requestRecord.maxSelections === "number" ? requestRecord.maxSelections : undefined,
    autoSelectWhenSingle: requestRecord.autoSelectWhenSingle !== false,
    options,
    confirmAction: {
      type: confirm?.type === "GENERATE_REPORT" ? "GENERATE_REPORT" : "CONTINUE",
      label: typeof confirm?.label === "string" ? confirm.label : (confirm?.type === "GENERATE_REPORT" ? "确认并生成报告" : "确认")
    }
  };
}

export function formatUserSelectionResumeMessage(result: UserSelectionResult, rawContent?: string): string {
  const names = result.options.map((item) => item.title).join("、");
  const ids = result.selectedIds.join(",");
  if (result.selectionKind === "KNOWLEDGE_SOURCE") {
    return [
      `用户已确认知识/图集来源：${names}（sourceIds=${ids}）。`,
      rawContent ? `原始输入：${rawContent}` : null,
      "后续检索与引用只使用这些已确认来源，不要再让用户用文字回复编号。"
    ].filter(Boolean).join("\n");
  }
  if (result.selectionKind === "REPORT_TYPE") {
    return [
      `用户已选择报告类型：${names}（reportType=${ids}）。`,
      rawContent ? `原始输入：${rawContent}` : null,
      result.confirmAction === "GENERATE_REPORT"
        ? "这已经是明确的人在回路确认。不要再次询问报告类型，也不要把类型列表写成 Markdown 编号。"
        : "请按该报告类型继续，不要再列出类型清单。"
    ].filter(Boolean).join("\n");
  }
  if (result.confirmAction === "GENERATE_REPORT") {
    return [
      `用户已勾选并确认生成报告，选中：${names}（selectedIds=${ids}）。`,
      rawContent ? `原始输入：${rawContent}` : null,
      "这已经是明确的人在回路确认。不要再次询问是否生成报告。系统将基于已固化的 Report Context Snapshot 生成报告。"
    ].filter(Boolean).join("\n");
  }
  return [
    `用户已选择：${names}（selectedIds=${ids}）。`,
    rawContent ? `原始输入：${rawContent}` : null,
    "请基于已确认选择继续，不要再把选项写成编号列表让用户回复数字。"
  ].filter(Boolean).join("\n");
}
