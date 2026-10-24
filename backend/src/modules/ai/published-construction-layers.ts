import { isDeepStrictEqual } from "node:util";
import type { DbExecutor } from "../../db/client.js";
import { getPublishedConstructionSchemeDetail } from "../construction/construction-read.service.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { hasPublishedReferenceSource } from "./published-reference-source.js";

/** 仅从同一发布构造/版本和来源读取分层配置，不推算厚度、参数或原图。 */
export async function readPublishedConstructionLayers(db: DbExecutor, candidate: ReferenceLookupCandidate) {
  if (!hasPublishedReferenceSource(candidate) || !candidate.schemeId) return undefined;
  try {
    const scheme = await getPublishedConstructionSchemeDetail(db, candidate.schemeId);
    if (scheme.version !== candidate.schemeVersion || scheme.systemId !== candidate.systemId || !scheme.layers.length
      || !scheme.productOptions.some(option => option.productSpecId === candidate.productSpecId
        && candidate.thicknessMm != null && candidate.thicknessMm >= option.minThickness && candidate.thicknessMm <= option.maxThickness)
      || scheme.layers.some(layer => layer.evidenceSource !== candidate.evidenceSource || layer.evidenceRef !== candidate.evidenceRef)) return undefined;
    return scheme.layers.map(layer => ({ order: layer.layerOrder, name: layer.layerName, thicknessMm: layer.thickness }));
  } catch { return undefined; }
}

/** 旧候选没有此可选信息；一旦附带分层，读取和Confirm都必须重验完整原值。 */
export async function publishedConstructionLayersStillCurrent(db: DbExecutor, candidate: ReferenceLookupCandidate) {
  return !hasPublishedReferenceSource(candidate) || candidate.layers == null
    || isDeepStrictEqual(candidate.layers, await readPublishedConstructionLayers(db, candidate));
}
