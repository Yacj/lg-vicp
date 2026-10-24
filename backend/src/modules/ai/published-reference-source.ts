import { createHash } from "node:crypto";
import { z } from "zod";

/** 正式选用表本身也是发布来源；无关联文件/页图时不伪造文档或optionId。 */
export const publishedReferenceSourceSchema = z.object({
  kind: z.literal("PUBLISHED_REFERENCE_ROW"), rowId: z.string().min(1), setId: z.string().min(1),
  setVersion: z.number().int().positive(), schemeVersion: z.number().int().positive(), specVersion: z.number().int().positive(),
  source: z.string().min(1), reference: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/)
}).strict();
type SourceCandidate = { id: string; setId?: string; setVersion?: number; schemeVersion?: number; specVersion?: number;
  schemeId?: string; productSpecId?: string; systemId?: string; catalogProductId?: string | null;
  systemCode?: string | null; systemName?: string; schemeCode?: string; specCode?: string; setCode?: string;
  thicknessMm?: number; kValue?: number; productThermalResistance?: number; totalThermalResistance?: number;
  substrateMaterial?: string; substrateThickness?: number | null; evidenceSource?: string; evidenceRef?: string;
  sourceDocumentId?: string | null; sourcePageId?: string | null; sourceVersionId?: string | null };

/** 只能用于经过当前发布关系查询的正式行。冻结前仍须重新查询并逐项比对，不信任客户端此对象。 */
export function publishedReferenceSource(candidate: SourceCandidate) {
  if (candidate.sourcePageId || candidate.sourceDocumentId || !candidate.setId || !candidate.schemeId || !candidate.productSpecId
    || !candidate.systemId || !candidate.evidenceSource?.trim() || !candidate.evidenceRef?.trim()
    || ![candidate.setVersion, candidate.schemeVersion, candidate.specVersion].every(value => value != null && Number.isInteger(value) && value > 0)) return undefined;
  const fields: (keyof SourceCandidate)[] = ["id", "setId", "setVersion", "schemeId", "schemeVersion", "productSpecId", "specVersion", "systemId", "catalogProductId",
    "systemCode", "systemName", "schemeCode", "specCode", "setCode", "thicknessMm", "kValue", "productThermalResistance", "totalThermalResistance", "substrateMaterial", "substrateThickness", "evidenceSource", "evidenceRef"];
  const contentHash = createHash("sha256").update(JSON.stringify(fields.map(field => [field, candidate[field] ?? null]))).digest("hex");
  return publishedReferenceSourceSchema.parse({ kind: "PUBLISHED_REFERENCE_ROW", rowId: candidate.id, setId: candidate.setId,
    setVersion: candidate.setVersion, schemeVersion: candidate.schemeVersion, specVersion: candidate.specVersion,
    source: candidate.evidenceSource, reference: candidate.evidenceRef, contentHash });
}

export function hasPublishedReferenceSource(candidate: SourceCandidate & { publishedReferenceSource?: unknown }) {
  const parsed = publishedReferenceSourceSchema.safeParse(candidate.publishedReferenceSource);
  const expected = publishedReferenceSource(candidate);
  return parsed.success && !!expected && JSON.stringify(parsed.data) === JSON.stringify(expected);
}

/** JSONB不保留属性顺序；逐字段完整比较来源合同，不能把序列化顺序当版本变化。 */
export function samePublishedReferenceSource(left: unknown, right: unknown) {
  const a = publishedReferenceSourceSchema.safeParse(left), b = publishedReferenceSourceSchema.safeParse(right);
  return a.success && b.success && (Object.keys(a.data) as (keyof typeof a.data)[]).every(key => a.data[key] === b.data[key]);
}
