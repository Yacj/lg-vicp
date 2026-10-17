import type { ReferenceLookupCandidate } from "./conversation-task.js";

/** 编号与数值都不是跨来源身份证据。相同来源档位，或同页同版本明确正式映射，才可关联。 */
type SourceRecord = Readonly<ReferenceLookupCandidate> & { applicationPart?: string; roofForm?: string; placement?: string; waterproofGrade?: string };
export function sameReferenceConstruction(a: SourceRecord, b: SourceRecord): boolean {
  if (!a.sourceDocumentId || a.sourceDocumentId !== b.sourceDocumentId || !a.sourceVersionId || a.sourceVersionId !== b.sourceVersionId
    || !a.sourcePageId || a.sourcePageId !== b.sourcePageId || a.thicknessMm == null || a.thicknessMm !== b.thicknessMm) return false;
  // 已有相反身份即拒绝；optional字段不补齐、不按名称猜测。
  for (const field of ["systemId", "schemeId", "productSpecId", "catalogProductId", "specClass", "substrateMaterial", "substrateThickness"] as const)
    if (a[field] != null && b[field] != null && a[field] !== b[field]) return false;
  for (const field of ["applicationPart", "roofForm", "placement", "waterproofGrade"] as const)
    if (a[field] != null && b[field] != null && a[field] !== b[field]) return false;
  if (a.optionId && b.optionId) return a.optionId === b.optionId;
  return Boolean(a.systemId && a.systemId === b.systemId && a.schemeId && a.schemeId === b.schemeId
    && a.productSpecId && a.productSpecId === b.productSpecId);
}
