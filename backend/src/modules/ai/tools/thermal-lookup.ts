import type {
  LastReferenceLookup,
  ReferenceLookupCandidate,
  ReferenceLookupSpecClass
} from "../conversation-task.js";
import type { CandidateResult } from "../../thermal/thermal-candidate-matcher.js";

const LOOKUP_LIMIT = 12;

export function parseSpecClassHint(value: string | null | undefined): ReferenceLookupSpecClass | undefined {
  const text = (value ?? "").replace(/\s+/g, "");
  if (!text) return undefined;
  if (/III|Ⅲ|ⅲ|3型|三型/i.test(text)) return "III";
  if (/II|Ⅱ|ⅱ|2型|二型/i.test(text)) return "II";
  if (/I|Ⅰ|ⅰ|1型|一型/i.test(text)) return "I";
  return undefined;
}

export function sanitizeSystemHint(value: string | null | undefined): string | undefined {
  const hint = (value ?? "").trim().replace(/[%_\\]/g, "").slice(0, 80);
  return hint || undefined;
}

export function inheritLookupQuery(
  input: { targetK?: number; targetR?: number; thicknessMm?: number; systemHint?: string; specClass?: ReferenceLookupSpecClass },
  last?: LastReferenceLookup | null
): { targetK?: number; targetR?: number; thicknessMm?: number; systemHint?: string; specClass?: ReferenceLookupSpecClass } {
  return {
    targetK: input.targetK ?? last?.query.targetK,
    targetR: input.targetR ?? last?.query.targetR,
    thicknessMm: input.thicknessMm ?? last?.query.thicknessMm,
    systemHint: sanitizeSystemHint(input.systemHint) ?? last?.query.systemHint,
    specClass: input.specClass ?? last?.query.specClass
  };
}

export function filterReusableCandidates(
  last: LastReferenceLookup | null | undefined,
  query: { targetK?: number; targetR?: number; thicknessMm?: number; specClass?: ReferenceLookupSpecClass; systemHint?: string }
): ReferenceLookupCandidate[] | null {
  if (!last?.candidates.length) return null;
  const hint = sanitizeSystemHint(query.systemHint);
  const lastHint = sanitizeSystemHint(last.query.systemHint);
  if (hint && lastHint && hint !== lastHint && !lastHint.includes(hint) && !hint.includes(lastHint)) {
    return null;
  }
  const filtered = last.candidates.filter((item) => {
    if (query.specClass && item.specClass && item.specClass !== query.specClass) return false;
    if (query.specClass && !item.specClass) return false;
    if (query.targetK !== undefined && item.kValue !== undefined && item.kValue > query.targetK) return false;
    if (query.targetR !== undefined && item.totalThermalResistance !== undefined && item.totalThermalResistance < query.targetR) return false;
    if (query.thicknessMm !== undefined && item.thicknessMm !== undefined && item.thicknessMm !== query.thicknessMm) return false;
    return true;
  });
  const hinted = filterCandidatesBySystemHint(filtered, hint);
  return hinted.length > 0 ? hinted.slice(0, LOOKUP_LIMIT) : null;
}

/** 体系名包含提示时收窄；一个都对不上则保留原列表，避免把「薄抹灰」猜成错误 UUID 后查空。 */
export function filterCandidatesBySystemHint(
  candidates: ReferenceLookupCandidate[],
  hint: string | undefined
): ReferenceLookupCandidate[] {
  const normalized = sanitizeSystemHint(hint);
  if (!normalized || candidates.length === 0) return candidates;
  const matched = candidates.filter((item) => (item.systemName ?? "").includes(normalized));
  return matched.length > 0 ? matched : candidates;
}

export function compactCandidateResult(row: CandidateResult): ReferenceLookupCandidate {
  return {
    id: row.candidateId,
    specClass: row.productSpec.specClass ?? undefined,
    thicknessMm: row.result.thicknessMm,
    kValue: row.result.kValue,
    systemName: row.system.name ?? undefined,
    atlasPage: row.scheme.atlasPage,
    schemeId: row.scheme.id,
    productSpecId: row.productSpec.id,
    evidenceSource: row.evidence.source,
    evidenceRef: row.evidence.ref,
    schemeCode: row.scheme.code,
    productThermalResistance: row.result.productThermalResistance,
    totalThermalResistance: row.result.totalThermalResistance,
    sourceDocumentId: row.sourceDocumentId ?? null,
    sourcePageId: row.sourcePageId ?? null,
    sourcePageLabel: row.sourcePageLabel ?? null
  };
}

export function compactCandidateResults(rows: CandidateResult[]): ReferenceLookupCandidate[] {
  return rows.slice(0, LOOKUP_LIMIT).map(compactCandidateResult);
}
