/**
 * 图集 / 知识来源选择。
 * 与会话级 insulationSystemId（保温体系）彻底区分：体系只影响 Prompt/检索加权/热工 systemId，
 * 不是图集文档 ID，也不能代替用户对资料来源的确认。
 */
import {
  autoSelectWhenSingleOption,
  buildUserSelectionRequest,
  type UserSelectionOption,
  type UserSelectionRequest
} from "./user-selection.js";

export const KNOWLEDGE_SOURCE_KINDS = [
  "atlas",
  "standard",
  "technical_manual",
  "approved_document"
] as const;

export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

export type KnowledgeSourceSelection = {
  sourceIds: string[];
};

export type KnowledgeSourceCandidate = {
  id: string;
  title: string;
  description?: string;
  kind: KnowledgeSourceKind;
  docType?: string;
  meta?: Record<string, unknown>;
};

export type KnowledgeSourceDecision =
  | { action: "NONE"; selectedIds: []; reason: "EMPTY" }
  | { action: "AUTO"; selectedIds: [string]; reason: "SINGLE" }
  | { action: "REUSE"; selectedIds: string[]; reason: "CONFIRMED" }
  | { action: "WAIT"; selectedIds: []; request: UserSelectionRequest; reason: "MULTIPLE" };

const SOURCE_KIND_LABEL: Record<KnowledgeSourceKind, string> = {
  atlas: "图集",
  standard: "标准规范",
  technical_manual: "技术手册",
  approved_document: "已发布资料"
};

export function knowledgeSourceKindFromDocType(docType: string | null | undefined): KnowledgeSourceKind {
  if (docType === "DETAIL_ATLAS") return "atlas";
  if (docType === "STANDARD") return "standard";
  if (docType === "SPECIFICATION" || docType === "APPLICATION_GUIDE") return "technical_manual";
  return "approved_document";
}

export function knowledgeSourceKindFromScope(scope: "ALL" | "ATLAS" | "STANDARD" | string | null | undefined): KnowledgeSourceKind {
  if (scope === "ATLAS") return "atlas";
  if (scope === "STANDARD") return "standard";
  return "approved_document";
}

export function candidatesFromHits(
  hits: Array<{ documentId: string; sourceTitle?: string | null; docType?: string | null }>,
  fallbackKind: KnowledgeSourceKind = "approved_document"
): KnowledgeSourceCandidate[] {
  const seen = new Set<string>();
  const candidates: KnowledgeSourceCandidate[] = [];
  for (const hit of hits) {
    const id = hit.documentId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const kind = hit.docType ? knowledgeSourceKindFromDocType(hit.docType) : fallbackKind;
    candidates.push({
      id,
      title: hit.sourceTitle?.trim() || "未命名资料",
      description: SOURCE_KIND_LABEL[kind],
      kind,
      docType: hit.docType ?? undefined,
      meta: { kind, docType: hit.docType ?? null }
    });
  }
  return candidates;
}

export function candidateSetChangedSignificantly(
  previousIds: string[] | null | undefined,
  current: KnowledgeSourceCandidate[]
): boolean {
  const previous = [...new Set((previousIds ?? []).filter(Boolean))];
  if (previous.length === 0) return false;
  const currentIds = new Set(current.map((item) => item.id));
  if (currentIds.size === 0) return true;
  const intersection = previous.filter((id) => currentIds.has(id)).length;
  const union = new Set([...previous, ...currentIds]).size;
  if (union === 0) return false;
  return intersection / union < 0.5;
}

export function confirmedSourcesStillValid(input: {
  confirmedIds?: string[] | null;
  candidates: KnowledgeSourceCandidate[];
  confirmedKind?: KnowledgeSourceKind | null;
  neededKind?: KnowledgeSourceKind | null;
}): { valid: boolean; selectedIds: string[] } {
  const confirmed = [...new Set((input.confirmedIds ?? []).filter(Boolean))];
  if (confirmed.length === 0) return { valid: false, selectedIds: [] };
  const candidateIds = new Set(input.candidates.map((item) => item.id));
  const stillPresent = confirmed.filter((id) => candidateIds.has(id));
  if (stillPresent.length === 0) return { valid: false, selectedIds: [] };
  if (sourceClassChanged(input.confirmedKind, input.neededKind)) {
    return { valid: false, selectedIds: [] };
  }
  return { valid: true, selectedIds: stillPresent };
}

export function sourceClassChanged(
  confirmedKind: KnowledgeSourceKind | null | undefined,
  neededKind: KnowledgeSourceKind | null | undefined
): boolean {
  if (!confirmedKind || !neededKind) return false;
  if (neededKind === "approved_document" || confirmedKind === "approved_document") return false;
  return confirmedKind !== neededKind;
}

export function shouldForceReselectKnowledgeSource(message: string | null | undefined): boolean {
  const text = message?.trim() ?? "";
  if (!text) return false;
  return /换(一个|一批|一份)?(图集|来源|资料)|更换(图集|来源|资料)|重新选(择)?(图集|来源)/.test(text);
}

export function buildKnowledgeSourceSelectionRequest(
  candidates: KnowledgeSourceCandidate[]
): UserSelectionRequest {
  const options: UserSelectionOption[] = candidates.map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description ?? SOURCE_KIND_LABEL[item.kind],
    meta: { kind: item.kind, docType: item.docType ?? null, ...(item.meta ?? {}) }
  }));
  return buildUserSelectionRequest({
    selectionKind: "KNOWLEDGE_SOURCE",
    title: "请选择本次要核验的资料来源",
    description: "可以选择多个图集或已发布资料。确认后后续回答将只引用这些来源。",
    options,
    multiple: true,
    minSelections: 1,
    autoSelectWhenSingle: true,
    confirmAction: { type: "CONTINUE", label: "确认来源" }
  });
}

/**
 * 0 个候选：不进入选择 UI。
 * 1 个候选：自动选中，不打断用户。
 * 已确认且仍有效：继续使用。
 * 2 个及以上：USER_SELECTION 多选。
 */
export function resolveKnowledgeSourceDecision(input: {
  candidates: KnowledgeSourceCandidate[];
  confirmedIds?: string[] | null;
  confirmedKind?: KnowledgeSourceKind | null;
  neededKind?: KnowledgeSourceKind | null;
  forceReselect?: boolean;
  previousCandidateIds?: string[] | null;
}): KnowledgeSourceDecision {
  const candidates = input.candidates.filter((item) => item.id);
  if (candidates.length === 0) {
    return { action: "NONE", selectedIds: [], reason: "EMPTY" };
  }

  if (!input.forceReselect) {
    const reused = confirmedSourcesStillValid({
      confirmedIds: input.confirmedIds,
      candidates,
      confirmedKind: input.confirmedKind,
      neededKind: input.neededKind
    });
    if (reused.valid && !candidateSetChangedSignificantly(input.previousCandidateIds ?? input.confirmedIds, candidates)) {
      return { action: "REUSE", selectedIds: reused.selectedIds, reason: "CONFIRMED" };
    }
  }

  const request = buildKnowledgeSourceSelectionRequest(candidates);
  const auto = autoSelectWhenSingleOption(request);
  if (auto && auto[0]) {
    return { action: "AUTO", selectedIds: [auto[0]], reason: "SINGLE" };
  }
  return { action: "WAIT", selectedIds: [], request, reason: "MULTIPLE" };
}

export function knowledgeSourceKindOf(ids: string[], candidates: KnowledgeSourceCandidate[]): KnowledgeSourceKind | undefined {
  const selected = new Set(ids);
  const kinds = [...new Set(candidates.filter((item) => selected.has(item.id)).map((item) => item.kind))];
  if (kinds.length === 1) return kinds[0];
  if (kinds.length > 1) return "approved_document";
  return undefined;
}
