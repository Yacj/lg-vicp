/**
 * 报告类型由 Backend 推断，禁止把 availableTypes 交给模型写成 Markdown 编号清单。
 * 优先级：显式 UI Action → 已确认对比上下文 → Conversation Task State → 自然语言 → 最后才 USER_SELECTION。
 */
import {
  buildUserSelectionRequest,
  type UserSelectionRequest
} from "./user-selection.js";
import type { ConversationTaskState, ConversationUiAction } from "./conversation-task.js";
import {
  listPublicReportTypes,
  tryResolveReportType,
  type PublicReportType
} from "../reports/report-types.js";

export type ReportTypeInferenceSource =
  | "UI_ACTION"
  | "COMPARISON_CONTEXT"
  | "TASK_STATE"
  | "NATURAL_LANGUAGE"
  | "USER_SELECTION";

export type ReportTypeInference =
  | { status: "RESOLVED"; reportType: string; source: ReportTypeInferenceSource }
  | { status: "NEEDS_SELECTION"; request: UserSelectionRequest; source: "USER_SELECTION" };

const REPORT_TYPE_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /材料对比|产品对比|竞品对比|对比报告/, code: "material_compare" },
  { pattern: /综合技术|技术方案报告|完整(的)?技术报告/, code: "technical_scheme" },
  { pattern: /项目(方案)?简报|简报/, code: "project_brief" },
  { pattern: /对话整理|会话整理|聊天整理/, code: "ai_conversation" }
];

export function normalizeReportTypeCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code === "PRODUCT_COMPARISON") return "material_compare";
  const found = tryResolveReportType(code);
  return found?.code ?? null;
}

export function hasConfirmedComparisonContext(state: ConversationTaskState | null | undefined): boolean {
  if (!state) return false;
  if ((state.selectedProductIds?.length ?? 0) >= 1 && state.comparisonContext) return true;
  if (state.reportContextSnapshotId) return true;
  return false;
}

export function buildReportTypeSelectionRequest(
  types: PublicReportType[] = listPublicReportTypes()
): UserSelectionRequest {
  return buildUserSelectionRequest({
    selectionKind: "REPORT_TYPE",
    title: "请选择要生成的报告类型",
    description: "请在界面中选择一种报告类型。不要在对话里回复数字编号。",
    options: types.map((item) => ({
      id: item.code,
      title: item.name,
      description: item.description,
      meta: { requiresProject: item.requiresProject, enabled: item.enabled }
    })),
    multiple: false,
    minSelections: 1,
    maxSelections: 1,
    autoSelectWhenSingle: true,
    confirmAction: { type: "GENERATE_REPORT", label: "确认并生成报告" }
  });
}

export function inferReportType(input: {
  explicitReportType?: string | null;
  uiAction?: ConversationUiAction | null;
  confirmAction?: "GENERATE_REPORT" | null;
  selectedReportType?: string | null;
  currentState?: ConversationTaskState | null;
  message?: string | null;
}): ReportTypeInference {
  const explicit = normalizeReportTypeCode(input.explicitReportType)
    ?? normalizeReportTypeCode(input.selectedReportType)
    ?? normalizeReportTypeCode(input.currentState?.selectedReportType);
  if (explicit) {
    return { status: "RESOLVED", reportType: explicit, source: input.explicitReportType ? "UI_ACTION" : "TASK_STATE" };
  }

  const comparisonReady = hasConfirmedComparisonContext(input.currentState);
  if (
    comparisonReady
    && (
      input.uiAction === "GENERATE_REPORT"
      || input.confirmAction === "GENERATE_REPORT"
      || input.currentState?.taskType === "REPORT_GENERATION"
      || input.currentState?.taskType === "REPORT_PREPARATION"
      || input.currentState?.taskType === "COMPARISON"
      || /报告/.test(input.message ?? "")
    )
  ) {
    return { status: "RESOLVED", reportType: "material_compare", source: "COMPARISON_CONTEXT" };
  }

  if (input.currentState?.taskType === "COMPARISON" && comparisonReady) {
    return { status: "RESOLVED", reportType: "material_compare", source: "TASK_STATE" };
  }

  const message = input.message?.trim() ?? "";
  if (message) {
    for (const item of REPORT_TYPE_PATTERNS) {
      if (item.pattern.test(message)) {
        return { status: "RESOLVED", reportType: item.code, source: "NATURAL_LANGUAGE" };
      }
    }
  }

  const listed = listPublicReportTypes();
  if (listed.length === 1 && listed[0]) {
    return { status: "RESOLVED", reportType: listed[0].code, source: "TASK_STATE" };
  }
  return {
    status: "NEEDS_SELECTION",
    request: buildReportTypeSelectionRequest(listed),
    source: "USER_SELECTION"
  };
}
