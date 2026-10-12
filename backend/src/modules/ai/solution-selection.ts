import type { SolutionPayload } from "./solution-workflow.js";
import { parseSolutionActionFastPath } from "./solution-action-semantic.js";
/** 兼容旧内部符号，仅保留按钮式 Fast Path；Runtime 使用异步 Semantic Parser。 */
export function parseSolutionSelection(message: string, _state?: SolutionPayload) { return parseSolutionActionFastPath(message); }

export function solutionComparisonText(comparison: { candidates: Array<{ systemName?: string; constructionCode?: string; thicknessMm?: number; productThermalResistance?: number; totalThermalResistance?: number; kValue?: number; sourcePageLabel?: string | null; conflicts: unknown[] }> }) {
  return "已选方案对比：\n\n|体系 / 构造|厚度 mm|产品 R|总 R|K|来源页|当前条件|\n|---|---:|---:|---:|---:|---|---|\n"
    + comparison.candidates.map(candidate => `|${[candidate.systemName, candidate.constructionCode].filter(Boolean).join(" / ")}|${candidate.thicknessMm ?? "—"}|${candidate.productThermalResistance ?? "—"}|${candidate.totalThermalResistance ?? "—"}|${candidate.kValue ?? "—"}|${candidate.sourcePageLabel ?? "未核验"}|${candidate.conflicts.length ? "存在冲突" : "满足"}|`).join("\n");
}
