/**
 * PDF 书签大纲质量评估：CAD/制图软件会为每页写入「图纸和视图 / 模型」导航树，
 * 不能仅因 outline.length > 0 就当作正式 TOC。
 */

export interface PdfOutlineQualityInputItem {
  title: string;
  level: number;
  pageNumber: number | null;
}

export interface PdfOutlineQualityMetrics {
  outlineCount: number;
  uniqueTitleCount: number;
  uniqueTitleRatio: number;
  duplicateTitleRatio: number;
  pageCoverage: number;
  missingPageRatio: number;
  depthDistribution: Record<number, number>;
  repeatedTreePattern: boolean;
  softwareNavRatio: number;
}

export interface PdfOutlineQuality {
  valid: boolean;
  score: number;
  reasons: string[];
  metrics: PdfOutlineQualityMetrics;
}

const SOFTWARE_NAV_TITLES = new Set([
  "图纸和视图",
  "图纸和視圖",
  "模型",
  "model",
  "models",
  "view",
  "views",
  "sheet",
  "sheets",
  "layout",
  "layouts",
  "paper space",
  "model space",
  "图纸",
  "布局"
]);

function normalizeTitle(title: string): string {
  return title.normalize("NFKC").replace(/\s+/g, "").trim().toLowerCase();
}

function isSoftwareNavTitle(title: string): boolean {
  return SOFTWARE_NAV_TITLES.has(normalizeTitle(title));
}

/** 检测书签是否按固定短周期重复（每页同一棵 CAD 导航树）。 */
export function detectRepeatedTreePattern(titles: readonly string[]): boolean {
  if (titles.length < 8) return false;
  const normalized = titles.map(normalizeTitle);
  const maxPeriod = Math.min(8, Math.floor(normalized.length / 8));
  for (let period = 1; period <= maxPeriod; period++) {
    const pattern = normalized.slice(0, period);
    if (pattern.some((title) => !title)) continue;
    let repeats = 0;
    for (let index = 0; index + period <= normalized.length; index += period) {
      const slice = normalized.slice(index, index + period);
      if (slice.every((title, offset) => title === pattern[offset])) repeats += 1;
      else break;
    }
    if (repeats >= 8 && repeats * period >= normalized.length * 0.8) return true;
  }
  return false;
}

export function validatePdfOutline(
  outline: ReadonlyArray<PdfOutlineQualityInputItem>,
  pageCount: number
): PdfOutlineQuality {
  const reasons: string[] = [];
  const outlineCount = outline.length;
  const uniqueTitles = new Set(outline.map((item) => normalizeTitle(item.title)).filter(Boolean));
  const uniqueTitleCount = uniqueTitles.size;
  const uniqueTitleRatio = outlineCount === 0 ? 0 : uniqueTitleCount / outlineCount;
  const duplicateTitleRatio = 1 - uniqueTitleRatio;
  const missingPage = outline.filter((item) => item.pageNumber == null || item.pageNumber < 1).length;
  const missingPageRatio = outlineCount === 0 ? 0 : missingPage / outlineCount;
  const coveredPages = new Set(
    outline
      .map((item) => item.pageNumber)
      .filter((page): page is number => page != null && page >= 1 && (pageCount <= 0 || page <= pageCount))
  );
  const pageCoverage = pageCount > 0 ? coveredPages.size / pageCount : 0;
  const depthDistribution: Record<number, number> = {};
  for (const item of outline) {
    const level = Math.max(1, item.level);
    depthDistribution[level] = (depthDistribution[level] ?? 0) + 1;
  }
  const softwareNavCount = outline.filter((item) => isSoftwareNavTitle(item.title)).length;
  const softwareNavRatio = outlineCount === 0 ? 0 : softwareNavCount / outlineCount;
  const titles = outline.map((item) => item.title);
  const repeatedTreePattern = detectRepeatedTreePattern(titles);

  if (outlineCount === 0) {
    return {
      valid: false,
      score: 0,
      reasons: ["EMPTY_OUTLINE"],
      metrics: {
        outlineCount,
        uniqueTitleCount,
        uniqueTitleRatio,
        duplicateTitleRatio,
        pageCoverage,
        missingPageRatio,
        depthDistribution,
        repeatedTreePattern,
        softwareNavRatio
      }
    };
  }

  let score = 1;
  if (uniqueTitleRatio < 0.08) {
    score -= 0.45;
    reasons.push("UNIQUE_TITLE_RATIO_VERY_LOW");
  } else if (uniqueTitleRatio < 0.25) {
    score -= 0.25;
    reasons.push("UNIQUE_TITLE_RATIO_LOW");
  }
  if (duplicateTitleRatio > 0.75) {
    score -= 0.2;
    reasons.push("DUPLICATE_TITLE_RATIO_HIGH");
  }
  if (repeatedTreePattern) {
    score -= 0.25;
    reasons.push("REPEATED_TREE_PATTERN");
  }
  if (pageCount > 0 && outlineCount >= pageCount * 1.6 && uniqueTitleCount <= 8) {
    score -= 0.15;
    reasons.push("OUTLINE_COUNT_NEAR_PAGE_MULTIPLE");
  }
  if (missingPageRatio > 0.4) {
    score -= 0.12;
    reasons.push("MISSING_PAGE_RATIO_HIGH");
  }
  if (softwareNavRatio > 0.4) {
    score -= 0.2;
    reasons.push("SOFTWARE_NAV_TITLES");
  }
  if (pageCoverage < 0.15 && uniqueTitleRatio < 0.3) {
    score -= 0.08;
    reasons.push("PAGE_COVERAGE_LOW");
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(3))));
  const valid = score >= 0.55
    && uniqueTitleRatio >= 0.2
    && !repeatedTreePattern
    && softwareNavRatio < 0.5;

  if (!valid && reasons.length === 0) reasons.push("OUTLINE_QUALITY_BELOW_THRESHOLD");
  return {
    valid,
    score,
    reasons,
    metrics: {
      outlineCount,
      uniqueTitleCount,
      uniqueTitleRatio,
      duplicateTitleRatio,
      pageCoverage,
      missingPageRatio,
      depthDistribution,
      repeatedTreePattern,
      softwareNavRatio
    }
  };
}
