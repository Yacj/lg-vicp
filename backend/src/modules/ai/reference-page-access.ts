/** 正式引用在签名前再次校验，历史消息也使用相同口径。 */
export function isReferencePageConsumable(row: {
  versionId: string; versionStatus: string; documentStatus: string;
  documentDeletedAt: Date | null; currentVersionId: string | null;
  effectiveDate: string | null; expiryDate: string | null;
  usageMode?: string; projectId?: string | null;
}, today = new Date().toISOString().slice(0, 10), projectId?: string | null): boolean {
  return row.versionStatus === "PUBLISHED" && row.documentStatus === "ACTIVE"
    && row.documentDeletedAt == null && row.currentVersionId === row.versionId
    && (!row.effectiveDate || row.effectiveDate <= today)
    && (!row.expiryDate || row.expiryDate >= today)
    && (row.usageMode === undefined || row.usageMode === "AI_ENABLED")
    && (!row.projectId || row.projectId === projectId);
}
