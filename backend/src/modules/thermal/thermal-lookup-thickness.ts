import { inferThermalLookupMode, THERMAL_LOOKUP_METRIC_PATTERN } from "./thermal-lookup-mode.js";

const THERMAL_PREFIX_CONDITION = new RegExp(`(?:${THERMAL_LOOKUP_METRIC_PATTERN.source}).*?[0-9]+(?:\\.[0-9]+)?(?:左右|以上|以下|以内|附近)?`, "gi");

export interface LookupThickness {
  thicknessMm?: number;
  thicknessMin?: number;
  thicknessMax?: number;
  preferThinner?: boolean;
}

/** 厚度独立解析，避免 mm 的比较词和数字进入 K/R 条件。无数字的薄厚偏好不生成范围。 */
export function parseThermalThicknessMessage(message: string, previous: LookupThickness = {}) {
  const text = message.normalize("NFKC").replace(/(?<=\d)\s+(?=\d)/g, ",").replace(/\s+/g, "");
  const cancelWord = /取消|不限制|不用限制|不考虑|先不看|去掉|不限|无所谓/;
  const removeMin = /(?:取消|去掉|不限制)厚度下限|厚度下限(?:取消|不限)/.test(text);
  const removeMax = /(?:取消|去掉|不限制)厚度上限|厚度上限(?:取消|不限)/.test(text);
  const remove = !removeMin && !removeMax && /(?:取消|不限制|不用限制|不考虑|先不看|去掉)(?:保温)?厚度(?:限制|条件)?|厚度(?:限制|条件)?(?:取消|不限制|不用限制|先不看|去掉|不限|无所谓)/.test(text);
  const preferThinner = /薄一点|薄一些|尽量薄|越薄越好/.test(text);
  const query: LookupThickness = {};
  if (removeMin || removeMax) Object.assign(query, previous, { ...(removeMin ? { thicknessMin: undefined } : {}), ...(removeMax ? { thicknessMax: undefined } : {}) });
  let changed = remove || removeMin || removeMax;
  let needsClarification = false;
  for (const clause of text.split(/[,，;；。]/)) {
    if ((remove || removeMin || removeMax) && cancelWord.test(clause)) continue;
    // 单位或「厚度」是厚度数字的定位依据，不能从热工目标猜厚度。
    const range = /([0-9]+(?:\.[0-9]+)?)(?:mm|毫米)?(?:～|~|-|到|至)([0-9]+(?:\.[0-9]+)?)(mm|毫米)?/i.exec(clause);
    if (range && (range[3] || /厚度/.test(clause.slice(0, range.index)))) {
      query.thicknessMm = undefined;
      query.thicknessMin = Number(range[1]);
      query.thicknessMax = Number(range[2]);
      changed = true;
      continue;
    }
    const unitNumber = /([0-9]+(?:\.[0-9]+)?)(?:mm|毫米)/i.exec(clause);
    const thicknessNumber = /厚度(?:从[0-9]+(?:\.[0-9]+)?(?:mm|毫米)?)?(?:控制在|控制到|放宽到|收紧到|调整到|调整为|提高到|降到|改到|调到|改成|改为|换成|变成|要求|需要|目标是|目标|为|在|到|不超过|不低于|最多|至少|≤|≥|<=|>=|=)*([0-9]+(?:\.[0-9]+)?)/i.exec(clause);
    const implicitChange = /(?:(?:最大|最小)?(?:放宽到|收紧到|调整到|调整为|调到|改到|改成|改为|换成|提高到|降到))([0-9]+(?:\.[0-9]+)?)|([0-9]+(?:\.[0-9]+)?)(?=以内|以上|以下)/.exec(clause);
    const hasPrevious = previous.thicknessMm !== undefined || previous.thicknessMin !== undefined || previous.thicknessMax !== undefined;
    const number = thicknessNumber ?? unitNumber ?? (hasPrevious && !new RegExp(THERMAL_LOOKUP_METRIC_PATTERN.source, "i").test(text) && !/传热|热阻/i.test(text) ? implicitChange : null);
    if (!number) continue;
    const digits = number[1] ?? number[2]!;
    const target = Number(digits);
    const prefix = clause.slice(0, number.index + number[0].lastIndexOf(digits));
    // 只读厚度数字前后的局部语义，K/R 片段的比较词不影响厚度。
    const modePrefix = prefix.replace(THERMAL_PREFIX_CONDITION, "");
    const suffix = clause.slice(number.index + number[0].length).split(/K|传热|热阻|总R|产品R|且|和/i)[0] ?? "";
    const mode = inferThermalLookupMode(modePrefix.replace(/厚度/g, "") + suffix);
    const implicit = /放宽到|收紧到|调整到|调整为|调到|改到|改成|改为|换成|提高到|降到/.test(prefix) && mode === null;
    query.thicknessMm = undefined; query.thicknessMin = undefined; query.thicknessMax = undefined;
    if (mode === "MAX_LIMIT" || implicit && previous.thicknessMax !== undefined && previous.thicknessMin === undefined) {
      query.thicknessMax = target;
    } else if (mode === "MIN_LIMIT" || implicit && previous.thicknessMin !== undefined && previous.thicknessMax === undefined) {
      query.thicknessMin = target;
    } else if (implicit && previous.thicknessMin !== undefined && previous.thicknessMax !== undefined) {
      needsClarification = true; // 原区间有两端，不能猜本轮改的是哪端。
    } else {
      query.thicknessMm = target;
    }
    changed = true;
  }
  const values = [query.thicknessMm, query.thicknessMin, query.thicknessMax].filter((value) => value !== undefined);
  needsClarification ||= changed && /或者|或|\bor\b/i.test(text) || values.some((value) => value <= 0 || value > 1000)
    || query.thicknessMin !== undefined && query.thicknessMax !== undefined && query.thicknessMin > query.thicknessMax;
  return { query, changed, remove, preferThinner: remove ? false : preferThinner, needsClarification };
}

export function formatLookupThickness(query: LookupThickness): string | undefined {
  if (query.thicknessMm !== undefined) return `厚度 ${query.thicknessMm}mm`;
  if (query.thicknessMin !== undefined && query.thicknessMax !== undefined) return `厚度 ${query.thicknessMin}～${query.thicknessMax}mm`;
  if (query.thicknessMax !== undefined) return `厚度不超过 ${query.thicknessMax}mm`;
  if (query.thicknessMin !== undefined) return `厚度不低于 ${query.thicknessMin}mm`;
  return undefined;
}
