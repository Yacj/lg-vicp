import auditData from "./confirmed-page-source-audits.json" with { type: "json" };
import { confirmedHeaderFingerprint } from "./confirmed-source-table-headers.js";
import { pageRecognitionResultSchema } from "./page-recognition.js";

/** 只给当前版本的可核验定位候选；调用者仍须读取原行并通过完整内容指纹校验。 */
export function auditedPrintedPageIds(versionId: string, pageLabel: string) {
  return auditData.records.filter(record => record.versionId === versionId && record.printedLabel === pageLabel).map(record => record.pageId);
}

/** 仅显示核验元数据；绝不修改来源快照、页序或工程参数。 */
export function confirmedPageSourceAudit(page: { id?: string; pageId?: string; versionId?: string; metadata?: unknown }) {
  const record = auditData.records.find(item => item.pageId === (page.id ?? page.pageId) && item.versionId === page.versionId);
  if (!record) return undefined;
  const metadata = page.metadata as { confirmedStructuredData?: unknown } | null;
  const parsed = pageRecognitionResultSchema.safeParse(metadata?.confirmedStructuredData);
  if (!parsed.success || confirmedHeaderFingerprint(parsed.data) !== record.fingerprint) return { printedLabel: null, recordedLabel: record.recordedLabel,
    issues: ["该页确认内容已变化，原印刷页码核验不再适用，请重新核对原图。"] };
  return { printedLabel: record.printedLabel, recordedLabel: record.recordedLabel, issues: record.issues };
}
