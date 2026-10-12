import { buildKnowledgePageRenderModel } from "./knowledge-page-render.js";
import { readPageRecognitionMeta } from "./page-recognition.js";

/** 保留确认快照计算的 optionId；只投影展示页码，不改快照身份。 */
export function readableRenderModel(pageId: string, metadata: Record<string, unknown> | null, pageLabel: string | null) {
  const model = buildKnowledgePageRenderModel(pageId, readPageRecognitionMeta(metadata).confirmedStructuredData);
  return model ? { ...model, pageLabel } : null;
}
