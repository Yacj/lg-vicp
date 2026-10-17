/** SM-LEGACY-PAGE-SCOPE-01：仅已确认旧表的封闭正式表名；不解析用户意图或改写源JSON。 */
export function legacyConfirmedPagePart(pageTitle: string | null | undefined) {
  const title = pageTitle?.normalize("NFKC").replace(/\s/g, "");
  const match = title ? /^建筑(外墙|屋面)热工计算参考选用表(?:\([^()]+\))?$/.exec(title) : undefined;
  return match?.[1] === "外墙" ? "EXTERNAL_WALL" as const : match?.[1] === "屋面" ? "ROOF" as const : undefined;
}
