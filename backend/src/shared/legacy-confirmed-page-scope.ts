/** SM-LEGACY-PAGE-SCOPE-01：仅已确认旧表的封闭正式表名；不解析用户意图或改写源JSON。 */
export function legacyConfirmedPagePart(pageTitle: string | null | undefined) {
  const title = pageTitle?.normalize("NFKC").replace(/\s/g, "");
  const match = title ? /^建筑(外墙|屋面)热工计算参考选用表(?:\([^()]+\))?$/.exec(title) : undefined;
  return match?.[1] === "外墙" ? "EXTERNAL_WALL" as const : match?.[1] === "屋面" ? "ROOF" as const : undefined;
}

/** 只读正式表标题的单一型号；不解析用户输入，不补写确认快照或用于正式候选准入。 */
export function confirmedTableTitleSpecClass(pageTitle: string | null | undefined) {
  const title = pageTitle?.normalize("NFKC").replace(/\s/g, "");
  const match = title ? /^建筑(?:外墙|屋面)热工计算参考选用表\((I|II|III)型VICP[^()]*\)$/.exec(title) : undefined;
  return match && [...title!.matchAll(/(?:III|II|I)型VICP/g)].length === 1 ? match[1] as "I" | "II" | "III" : undefined;
}
