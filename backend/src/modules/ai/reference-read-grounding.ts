import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import { extractSemanticFacts } from "./thermal-answer-semantics.js";
import { constructionCodes } from "./reference-candidate-selection.js";

/** SM-READ-FORMAT-01：仅提取本轮工程格式；不分类意图、不从历史补编号、不转换序号。 */
export function groundReadReferenceFormats(message: string, semantic: DomainTurnSemantic): DomainTurnSemantic {
  if (semantic.intent !== "REFERENCE_VIEW" || semantic.requestedEffect !== "READ_ONLY"
    || semantic.reference.items.some(item => item.type === "POSITION")) return semantic;
  const codes = constructionCodes(message);
  const thicknesses = [...new Set(extractSemanticFacts(message).flatMap(fact => fact.kind === "thickness" ? [fact.value] : []))];
  if (!codes.length && !thicknesses.length) return semantic;
  // 值仍需Policy核验原话；重复格式不改变引用范围。
  return { ...semantic, reference: { ...semantic.reference, items: [
    ...codes.map(value => ({ type: "CONSTRUCTION_CODE" as const, value, evidence: message })),
    ...thicknesses.map(value => ({ type: "THICKNESS" as const, value, evidence: message }))
  ] } };
}
