import { resolveComparisonSelectionFromInput } from "./agent-choice.js";
import type { LastReferenceLookup } from "./conversation-task.js";

/** 复用现有序号/多选解析，只把用户选择映射到本轮冻结记录，不查询业务库。 */
export function selectFrozenReferenceCandidateIds(last: LastReferenceLookup | undefined, message: string): string[] | undefined {
  if (!last) return undefined;
  const selected = resolveComparisonSelectionFromInput({ type: "COMPARISON_SELECTION", minSelections: 2,
    options: last.candidates.map(candidate => ({ id: candidate.id, label: candidate.schemeCode ?? candidate.id, summary: "" }))
  }, { content: message });
  return selected?.optionIds ?? last.selectedCandidateIds;
}
