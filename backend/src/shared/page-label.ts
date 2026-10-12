/** 印刷页码与物理定位分离；空值不能被标为已核验。 */
export function uploadedPageLabel(label: string | null | undefined, fallback: string) {
  const explicit = label?.trim();
  return { pageLabel: explicit || fallback, pageLabelSource: explicit ? "MANUAL" as const : "FALLBACK" as const, pageLabelVerified: Boolean(explicit) };
}

export function visiblePageLabel(page: { pageLabel?: string | null; pageLabelSource?: string; pageLabelVerified?: boolean }): string | null {
  if (page.pageLabelSource === "FALLBACK" || page.pageLabelVerified === false) return null;
  return page.pageLabel?.trim() || null;
}
