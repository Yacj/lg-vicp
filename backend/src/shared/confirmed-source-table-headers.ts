import { createHash } from "node:crypto";
import auditData from "./source-table-header-audits.json" with { type: "json" };
import { pageRecognitionResultSchema, type PageRecognitionResult } from "./page-recognition.js";

/** 显示专用的原始表头核对表。按整个确认内容的指纹绑定，不按页码、标题或数值猜来源。 */
export function confirmedHeaderFingerprint(data: PageRecognitionResult): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(pageRecognitionResultSchema.parse(data)))).digest("hex");
}
type SourceColumn = NonNullable<PageRecognitionResult["systems"][number]["sourceColumns"]>[number];
interface HeaderProfile {
  id: string;
  tableHeaders: { identifier: string; diagram: string; layers: string };
  columns: SourceColumn[];
}
interface HeaderAudit { profiles: HeaderProfile[]; snapshots: { fingerprint: string; profileId: string; table: number }[] }

export function auditedSourceTableHeaders(data: PageRecognitionResult) {
  const audit = auditData as HeaderAudit;
  const match = audit.snapshots.find(item => item.fingerprint === confirmedHeaderFingerprint(data));
  return match ? audit.profiles.find(profile => profile.id === match.profileId) : undefined;
}
