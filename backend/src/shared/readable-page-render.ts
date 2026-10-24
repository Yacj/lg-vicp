import { buildKnowledgePageRenderModel } from "./knowledge-page-render.js";
import { readPageRecognitionMeta } from "./page-recognition.js";
import { confirmedPageSourceAudit } from "./confirmed-page-source-audit.js";
import { isDeepStrictEqual } from "node:util";

/** 保留确认快照计算的 optionId；只投影展示页码，不改快照身份。 */
export function readableRenderModel(pageId: string, metadata: Record<string, unknown> | null, pageLabel: string | null, versionId?: string) {
  const model = buildKnowledgePageRenderModel(pageId, readPageRecognitionMeta(metadata).confirmedStructuredData);
  if (!model) return null;
  const audit = confirmedPageSourceAudit({ pageId, versionId, metadata });
  return { ...model, pageLabel, ...(audit ? { warnings: [...new Set([...(model.warnings ?? []), ...audit.issues,
    ...(audit.recordedLabel !== audit.printedLabel ? [`资料原标页码${audit.recordedLabel}；${audit.printedLabel ? `本次按原图核验印刷页码${audit.printedLabel}` : "原图页次为空，印刷页码未核实"}。`] : [])])] } : {}) };
}

/** 显示核验不改变冻结事实；身份/revision/层与档位仍逐项相等。 */
export function sameFrozenPageFacts(current: unknown, frozen: unknown) {
  const facts = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(facts);
    return Object.fromEntries(Object.entries(value).filter(([key]) => !["pageLabel", "warnings", "sourceDisplayColumns", "sourceTableHeaders", "sourceTableLayout"].includes(key))
      .map(([key, field]) => [key, facts(field)]));
  };
  return isDeepStrictEqual(facts(current), facts(frozen));
}
