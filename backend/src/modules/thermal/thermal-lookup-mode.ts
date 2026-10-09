/**
 * 热工参考查询指标/语义/容差的单一事实源（不涉及 Thermal Engine）。
 *
 * 业务上「K≈0.3」和「K≤0.3」是两种完全不同的查询语义，不能用同一个 targetK 表达：
 * - APPROX：0.303、0.302、0.294 都可能命中，按 |kValue - targetK| 升序；
 * - MAX_LIMIT：只保留 kValue <= targetK，0.303 必须被排除；
 * - MIN_LIMIT：只保留指标值 >= 目标；R 查询使用正式双 R 字段，不由 K 反推；
 * - EXACT：按允许的数值精度做近似相等（数据库精确档位）。
 *
 * 容差集中在本文件配置：可测试、确定性，禁止在各 Service 各写一份。
 * 本文件不包含任何产品参数 / 图集 K 值 / 标准限值默认值。
 */

export const THERMAL_LOOKUP_MODES = ["APPROX", "MAX_LIMIT", "MIN_LIMIT", "EXACT"] as const;

export type ThermalLookupMode = (typeof THERMAL_LOOKUP_MODES)[number];

/**
 * APPROX 绝对容差（W/(m²·K)）。
 * 依据当前图集数据分布：K 档位步长约 0.001~0.01，目标值多在 0.2~0.6 区间，
 * ±0.02 足以覆盖「0.3 左右」的真实档位（0.294 / 0.302 / 0.303 / 0.305），
 * 同时把 0.55 这类明显无关的档位排除。
 */
export const DEFAULT_K_APPROX_TOLERANCE = 0.02;

/** EXACT 数值精度容差（W/(m²·K)）：吸收浮点误差，只接受数值上相等的档位。 */
export const DEFAULT_K_EXACT_EPSILON = 0.0005;

/** 默认查询模式：未显式给出语义时，沿用历史「K ≤ 目标」口径（B 端 API 兼容）。 */
export const DEFAULT_K_LOOKUP_MODE: ThermalLookupMode = "MAX_LIMIT";

/**
 * 否定式下限语义：不低于 / 不小于 / 不少于 / 大于等于 / 至少 / 下限 / ≥。
 * 必须先于上限与普通比较词判定，否则「不低于」里的「低于」会被误判成上限。
 */
const MIN_LIMIT_NEG_PATTERN = /(?:不应|不得|不能|不)(?:低于|小于|少于)|大于等于|以上|至少|最低|下限|≥|>=/;

/** 否定式上限 / 达标语义：不超过、不高于、以内、最大、上限、限值、≤、达标 等明确约束词。 */
const MAX_LIMIT_NEG_PATTERN = /(?:不应|不得|不能|不要|别|不)(?:超过|高于|大于)|小于等于|以内|以下|最大|上限|至多|最多|≤|<=|达标|限值|满足.{0,6}(?:要求|限值|标准)/;

/** 普通下限语义（肯定式）：高于 / 大于。 */
// 工程筛选口径（方案 B）：普通「大于 / >」「小于 / <」均包含边界，分别按 ≥ / ≤ 筛选。
const MIN_LIMIT_PLAIN_PATTERN = /高于|大于|>/;

/** 普通上限语义（肯定式）：低于 / 小于。 */
const MAX_LIMIT_PLAIN_PATTERN = /低于|小于|</;

/** 精确相等语义：严格等于 / 刚好等于 / 精确等于。 */
const EXACT_PATTERN = /精确|恰好|等于|正好是|就是|(?<![<>≤≥])=(?!=)/;

/** 近似语义：左右、接近、约、大概、附近 等。 */
const APPROX_PATTERN = /左右|接近|靠近|约|大概|大约|差不多|附近|上下|近似|大约为|约为|≈|±/;

export function isThermalLookupMode(value: unknown): value is ThermalLookupMode {
  return typeof value === "string" && (THERMAL_LOOKUP_MODES as readonly string[]).includes(value);
}

/**
 * 从自然语言推断 K 查询模式（确定性、可测试）。
 *
 * 无本轮比较语义返回 null，由调用方继承历史；新的裸 K 目标按 APPROX。
 *
 * 关键业务规则：像「传热系数0.3的方案有么」这种**没有**「不超过 / 以内 / ≤ / 最大 / 上限 / 达标 / 限值」
 * 等明确约束词的问法，必须按 APPROX 处理，不能默认当成 MAX_LIMIT，否则 K=0.303 会被错误排除。
 */
export function inferThermalLookupMode(message: string | null | undefined): ThermalLookupMode | null {
  const text = (message ?? "").replace(/\s+/g, "");
  if (!text) return null;
  if (MIN_LIMIT_NEG_PATTERN.test(text)) return "MIN_LIMIT";
  if (MAX_LIMIT_NEG_PATTERN.test(text)) return "MAX_LIMIT";
  if (APPROX_PATTERN.test(text)) return "APPROX";
  if (EXACT_PATTERN.test(text)) return "EXACT";
  if (MIN_LIMIT_PLAIN_PATTERN.test(text)) return "MIN_LIMIT";
  if (MAX_LIMIT_PLAIN_PATTERN.test(text)) return "MAX_LIMIT";
  if (/(?:传热系数|k值?|总热阻|总r|r[0₀]|主断面传热阻|产品层?热阻|保温板热阻|vicp热阻|产品r)[:：]?\d+(?:\.\d+)?|\d+(?:\.\d+)?的方案/i.test(text)) return "APPROX";
  return null;
}

/** 用户明确语义 > Tool 参数 > 历史查询 > 首轮缺省 APPROX。 */
export function resolveConversationLookupMode(
  message: string | null | undefined,
  toolMode?: ThermalLookupMode,
  previousMode?: ThermalLookupMode
): { mode: ThermalLookupMode; conflict: boolean } {
  const explicit = inferThermalLookupMode(message);
  return {
    mode: explicit ?? toolMode ?? previousMode ?? "APPROX",
    conflict: explicit != null && toolMode != null && explicit !== toolMode
  };
}

/**
 * 解析 K 维度容差：
 * - APPROX / EXACT 需要容差窗口（未显式指定时使用集中默认值，不让 LLM 自由猜）；
 * - MAX_LIMIT / MIN_LIMIT 是单边约束，不使用容差窗口。
 */
export function resolveKTolerance(
  mode: ThermalLookupMode,
  explicit?: number | null
): number | undefined {
  return resolveMetricTolerance("K", mode, explicit);
}

export const THERMAL_LOOKUP_METRICS = ["K", "TOTAL_R", "PRODUCT_R"] as const;
export type ThermalLookupMetric = (typeof THERMAL_LOOKUP_METRICS)[number];

/** 图集保留三位小数；R 默认窗口覆盖 3.297≈3.3 和 2.880≈2.9。 */
export const THERMAL_LOOKUP_RULES = {
  K: { approximate: DEFAULT_K_APPROX_TOLERANCE, maximum: 0.05, epsilon: DEFAULT_K_EXACT_EPSILON },
  TOTAL_R: { approximate: 0.05, maximum: 0.2, epsilon: 0.0005 },
  PRODUCT_R: { approximate: 0.05, maximum: 0.2, epsilon: 0.0005 }
} as const;

export interface ThermalLookupQuery {
  /** 多条件默认 AND；提供 filters 时它是权威条件，单指标字段仅作兼容摘要。 */
  filters?: ThermalLookupFilter[];
  metric?: ThermalLookupMetric;
  targetValue?: number;
  mode?: ThermalLookupMode;
  tolerance?: number;
  toleranceSource?: "USER" | "DEFAULT";
  requestedTolerance?: number;
  /** @deprecated 兼容旧 API */
  targetK?: number;
  /** @deprecated 兼容旧 API（总热阻下限） */
  targetResistance?: number;
  /** @deprecated 兼容旧 Tool */
  targetR?: number;
  /** @deprecated 兼容旧 API */
  kMode?: ThermalLookupMode;
  /** @deprecated 兼容旧 API */
  kTolerance?: number;
}

export interface ThermalLookupFilter {
  metric: ThermalLookupMetric;
  targetValue: number;
  mode?: ThermalLookupMode;
  tolerance?: number;
  toleranceSource?: "USER" | "DEFAULT";
  requestedTolerance?: number;
  effectiveTolerance?: number;
  toleranceAdjusted?: boolean;
}

export function normalizeThermalLookupFilter(filter: ThermalLookupFilter) {
  const mode = filter.mode ?? "APPROX";
  // 已归一的默认窗口不是用户请求；重复归一必须保留原始授权来源和 requested 值。
  const requestedTolerance = filter.requestedTolerance
    ?? (filter.toleranceSource === "DEFAULT" || filter.effectiveTolerance !== undefined ? undefined : filter.tolerance);
  const effectiveTolerance = resolveMetricTolerance(filter.metric, mode, requestedTolerance);
  return { ...filter, mode, tolerance: effectiveTolerance, requestedTolerance, effectiveTolerance,
    toleranceAdjusted: requestedTolerance !== undefined && effectiveTolerance !== undefined && requestedTolerance !== effectiveTolerance };
}

export const TOLERANCE_ADJUSTED_NOTE = "您给出的查询范围较大，系统已按允许的最大范围进行筛选。";

export function resolveMetricTolerance(metric: ThermalLookupMetric, mode: ThermalLookupMode, explicit?: number | null): number | undefined {
  const rule = THERMAL_LOOKUP_RULES[metric];
  if (mode === "EXACT") return rule.epsilon;
  if (mode !== "APPROX") return undefined;
  return explicit != null && Number.isFinite(explicit) && explicit > 0
    ? Math.min(explicit, rule.maximum)
    : rule.approximate;
}

/** 新字段优先；旧 K 默认上限、旧 R 默认下限，保留 API 历史行为。 */
export function normalizeThermalLookupQuery(input: ThermalLookupQuery) {
  const metric = input.metric ?? (input.targetK != null ? "K" : input.targetResistance != null || input.targetR != null ? "TOTAL_R" : undefined);
  const targetValue = input.targetValue ?? (metric === "K" ? input.targetK : metric === "TOTAL_R" ? input.targetResistance ?? input.targetR : undefined);
  const mode = input.mode ?? (metric === "K" ? input.kMode : undefined)
    ?? (input.metric ? "APPROX" : metric === "TOTAL_R" ? "MIN_LIMIT" : DEFAULT_K_LOOKUP_MODE);
  const filters = input.filters !== undefined ? input.filters.map(normalizeThermalLookupFilter) : [
    ...(metric && targetValue !== undefined ? [normalizeThermalLookupFilter({ metric, targetValue, mode,
      tolerance: input.tolerance ?? input.kTolerance, requestedTolerance: input.requestedTolerance, toleranceSource: input.toleranceSource })] : []),
    // 旧协议同时给 K / 总 R 时，不能丢失第二个硬条件；新单指标协议保持原有优先级。
    ...(metric === "K" && (input.targetResistance ?? input.targetR) !== undefined ? [normalizeThermalLookupFilter({
      metric: "TOTAL_R", targetValue: (input.targetResistance ?? input.targetR)!, mode: "MIN_LIMIT"
    })] : [])
  ];
  const first = filters[0];
  return { metric: first?.metric ?? (input.filters === undefined ? metric : undefined), targetValue: first?.targetValue ?? (input.filters === undefined ? targetValue : undefined), mode: first?.mode ?? mode,
    tolerance: first?.tolerance, requestedTolerance: first?.requestedTolerance, effectiveTolerance: first?.effectiveTolerance,
    toleranceAdjusted: filters.some((filter) => filter.toleranceAdjusted), filters };
}

export function getCandidateMetricValue(candidate: { kValue?: number; totalThermalResistance?: number; productThermalResistance?: number }, metric: ThermalLookupMetric): number | undefined {
  return metric === "K" ? candidate.kValue : metric === "TOTAL_R" ? candidate.totalThermalResistance : candidate.productThermalResistance;
}

export function matchesMetric(value: number | undefined, target: number, mode: ThermalLookupMode, tolerance?: number): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  if (mode === "MAX_LIMIT") return value <= target;
  if (mode === "MIN_LIMIT") return value >= target;
  return Math.abs(value - target) <= (tolerance ?? DEFAULT_K_EXACT_EPSILON) + Number.EPSILON * Math.max(1, Math.abs(target));
}

export function metricRankingGap(value: number, target: number, mode: ThermalLookupMode): number {
  return mode === "MAX_LIMIT" ? target - value : mode === "MIN_LIMIT" ? value - target : Math.abs(value - target);
}

export const THERMAL_LOOKUP_METRIC_PATTERN = /product_r|产品层?热阻|保温板热阻|vicp热阻|产品r|total_r|总热阻(?:r[0₀]?)?|总r|r[0₀]|(?:外墙)?主断面传热阻|传热系数(?:k值?)?|k(?:值)?/gi;

function metricFromWord(word: string): ThermalLookupMetric {
  if (/product_r|产品|保温板|vicp/i.test(word)) return "PRODUCT_R";
  if (/total_r|总|r[0₀]|主断面/i.test(word)) return "TOTAL_R";
  return "K";
}

// 连接词只负责连接指标和数字；比较语义仍由 inferThermalLookupMode 独立判断。
const TARGET_BRIDGE = /^(?:(?:[:：=≈<>≤≥])|(?:不应|不得|不能|不要|别|不)(?:低于|小于|少于|超过|高于|大于)|(?:大于等于|小于等于|至少|至多|最多|最大|最小|最低|上限|下限|限值|高于|低于|大于|小于|以内)|(?:控制|调整|提高|降低|放宽|收紧)(?:在|到)?|(?:改|换)(?:成|为)|降到|变成|(?:希望|尽量|最好|要求|需要|目标|要|达到|做到|大概|大约|约|接近|正好|等于|就是|严格|精确|恰好|为|是|在|到|左右|附近))*$/;
const REMOVE_CONDITION = /取消|不限制|不用限制|先不看|去掉/;
const KEEP_CONDITION = /条件保留|保留|不变|照旧/;

/** 模糊术语只在已有明确指标上下文时解析，禁止根据数值大小猜工程指标。 */
export function parseThermalLookupMessage(message: string, previousMetric?: ThermalLookupMetric) {
  const text = message.normalize("NFKC").replace(/(?<=\d)\s+(?=\d)/g, ",").replace(/\s+/g, "");
  const mentions = [...text.matchAll(THERMAL_LOOKUP_METRIC_PATTERN)].map((match) => ({ word: match[0], index: match.index, metric: metricFromWord(match[0]) }));
  const ambiguousWord = /传热阻系数|保温系数/.exec(text)?.[0];
  const ambiguous = ambiguousWord !== undefined;
  if (!mentions.length && ambiguousWord && previousMetric) mentions.push({ word: ambiguousWord, index: text.indexOf(ambiguousWord), metric: previousMetric });
  const implicitNumber = !mentions.length && !/厚度|\d+(?:\.\d+)?(?:mm|毫米)/i.test(text) ? /[0-9]+(?:\.[0-9]+)?/.exec(text) : null;
  const implicitTarget = implicitNumber && TARGET_BRIDGE.test(text.slice(0, implicitNumber.index));
  if (implicitTarget && previousMetric) mentions.push({ word: "", index: 0, metric: previousMetric });
  const filters: ThermalLookupFilter[] = [];
  const removedMetrics: ThermalLookupMetric[] = [];
  const retainedMetrics: ThermalLookupMetric[] = [];
  const modeMessages: string[] = [];
  let unresolved = false;
  let firstModeMessage = "";
  for (const [index, mention] of mentions.entries()) {
    // 每个指标只解析自己的片段，不能让另一指标或厚度的比较词/容差污染本指标。
    const suffix = text.slice(mention.index + mention.word.length, mentions[index + 1]?.index ?? text.length)
      .split(/[,，;；]|厚度/)[0]!;
    const before = text.slice(index ? mentions[index - 1]!.index + mentions[index - 1]!.word.length : 0, mention.index);
    const localPrefix = before.split(/[,，;；]/).at(-1) ?? "";
    if (REMOVE_CONDITION.test(localPrefix) || REMOVE_CONDITION.test(suffix) && !/\d/.test(suffix)) {
      removedMetrics.push(mention.metric); continue;
    }
    if (KEEP_CONDITION.test(suffix) && !/\d/.test(suffix)) {
      retainedMetrics.push(mention.metric); continue;
    }
    const rawNumber = /([0-9]+(?:\.[0-9]+)?)/.exec(suffix);
    const number = rawNumber && TARGET_BRIDGE.test(suffix.slice(0, rawNumber.index)) ? rawNumber : null;
    const prefixNumber = /([0-9]+(?:\.[0-9]+)?)(?:左右|附近|的|约|接近)*$/.exec(before);
    const targetValue = number ? Number(number[1]) : prefixNumber ? Number(prefixNumber[1]) : undefined;
    const toleranceMatch = /(?:±|上下|正负|误差(?:不超过|为)?|容差(?:为)?)([0-9]+(?:\.[0-9]+)?)/.exec(suffix);
    const toleranceIsThickness = toleranceMatch && /^(?:mm|毫米)/i.test(suffix.slice(toleranceMatch.index + toleranceMatch[0].length));
    const modePrefix = /(精确(?:查询|查)?|恰好|近似|约|接近)$/.exec(before)?.[0] ?? "";
    // 厚度紧随指标但没有逗号时也不能污染该指标语义（例如 K0.3左右20mm以内）。
    const metricSuffix = number ? suffix.replace(/\d+(?:\.\d+)?(?:mm|毫米).*$/i, "") : suffix;
    const modeMessage = number ? `${modePrefix}${mention.word}${metricSuffix}` : prefixNumber ? `${prefixNumber[0]}${mention.word}` : "";
    if (targetValue === undefined) { unresolved = true; continue; }
    if (!filters.length) firstModeMessage = modeMessage;
    modeMessages.push(modeMessage);
    filters.push({ metric: mention.metric, targetValue, mode: inferThermalLookupMode(modeMessage) ?? "APPROX",
      tolerance: toleranceMatch && !toleranceIsThickness ? Number(toleranceMatch[1]) : undefined });
  }
  // 无指标的纯追问仍可继承模式/用户容差，但厚度容差不授权热工容差。
  const looseTolerance = !mentions.length && !/厚度|\d+(?:\.\d+)?(?:mm|毫米)/i.test(text)
    ? /(?:±|上下|正负|误差(?:不超过|为)?|容差(?:为)?)([0-9]+(?:\.[0-9]+)?)/.exec(text) : null;
  const first = filters[0];
  return {
    metric: first?.metric ?? mentions[0]?.metric,
    targetValue: first?.targetValue,
    tolerance: first?.tolerance ?? (looseTolerance ? Number(looseTolerance[1]) : undefined),
    modeMessage: mentions.length ? firstModeMessage : /厚度|\d+(?:\.\d+)?(?:mm|毫米)/i.test(text) ? "" : text,
    filters,
    modeMessages,
    removedMetrics,
    retainedMetrics,
    appendRange: /再加(?:一个)?范围条件/.test(text),
    needsClarification: ambiguous && !previousMetric || !!implicitTarget && !previousMetric || unresolved || (filters.length > 0 || removedMetrics.length > 0) && /或者|或|\bor\b/i.test(message)
  };
}
