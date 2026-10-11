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
const EXACT_PATTERN = /精确|恰好|正好|等于|就是|(?<![<>≤≥])=(?!=)/;

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

/** 指标词优先级：产品层 R > 总 R > K，避免「总传热系数」被 bare K 抢先。 */
export const THERMAL_LOOKUP_METRIC_PATTERN = /product_r|产品层?热阻|产品r|保温板(?:自身|本身)?热阻|板(?:子|材)?(?:自身|本身)?的?(?:热阻|r)(?![a-z])|自身(?:热阻|r)(?![a-z])|vicp热阻|total_r|整墙(?:总)?热阻|总热阻(?:r[0₀]?)?|总r|r[0₀]|(?:外墙)?主断面(?:传)?热阻|传热系数(?:k值?)?|传热(?:做到|是|为|大概|约|左右)|k值|k(?![a-z])/gi;

/** 模糊「系数」只在没有任何其他明确指标时兜底解析为 K（禁止据此猜 R）。 */
export const THERMAL_LOOKUP_FALLBACK_METRIC_PATTERN = /系数(?=\d|做到|是|为|大概|左右|约|能)/g;

function metricFromWord(word: string): ThermalLookupMetric {
  // 顺序敏感：「总传热系数」等含「总」的 K 词不能先落进 TOTAL_R；产品层 R 优先级最高。
  if (/product_r|产品层?|保温板|板自身|板子|板材|自身热阻|自身r|vicp/i.test(word)) return "PRODUCT_R";
  if (/total_r|整墙|主断面|总热阻|总r|r[0₀]/i.test(word)) return "TOTAL_R";
  return "K";
}

/**
 * 数字角色分类（Number Role Classification）。
 * 每个候选数字先判定它「可能是什么」，只有 THERMAL_TARGET 才允许绑定到已解析指标。
 * 严格排除厚度 / 页码 / 型号编号 / 年份 / 数量 / 金额，避免「只要句里有数字就绑给 metric」。
 */
export type NumberRole =
  | "THERMAL_TARGET"
  | "THICKNESS"
  | "PAGE_NUMBER"
  | "MODEL_CODE_PART"
  | "YEAR"
  | "COUNT"
  | "UNKNOWN";

export interface NumberCandidate {
  raw: string;
  index: number;
  role: NumberRole;
}

const THICKNESS_UNIT = /(?:mm|毫米|cm|厘米|公分)/i;
const PAGE_PREFIX = /(?:第|p\.?|page|页)\s*$/i;
/** 数字前 4 字符内出现拉丁字母或编码分隔符（A1、XPS-3、/2）→ 属于型号/规格编码。 */
const MODEL_TOKEN_BEFORE = /(?:[a-z][-_/]?\d*|[-_/])$/i;
const YEAR_PATTERN = /^(?:19|20)\d{2}$/;
const COUNT_SUFFIX = /^(?:\s*)(?:个|条|款|种|组|页|张|块|mm|毫米)/;
const MONEY_SUFFIX = /^(?:\s*)(?:元|块|万元|亿元|rmb|人民币)/i;

/** 判定单个数字在句中的角色；纯确定性、无外部依赖。 */
export function classifyNumberRole(text: string, raw: string, index: number): NumberRole {
  const end = index + raw.length;
  const before = text.slice(Math.max(0, index - 4), index);
  const after = text.slice(end);
  if (THICKNESS_UNIT.test(after)) return "THICKNESS";
  if (PAGE_PREFIX.test(before)) return "PAGE_NUMBER";
  if (MONEY_SUFFIX.test(after)) return "COUNT";
  if (COUNT_SUFFIX.test(after)) return "COUNT";
  // 型号编码：前有拉丁字母（A1、K2）或编码分隔符（A1-3 的 3、XPS/2 的 2）。
  if (MODEL_TOKEN_BEFORE.test(before)) return "MODEL_CODE_PART";
  if (YEAR_PATTERN.test(raw) && !/(?:热阻|传热|系数|k值?|r0|r₀)/i.test(before)) return "YEAR";
  return "UNKNOWN";
}

/** 指标词与数字之间允许出现的连接 / 冗余 / 倒装片段（不改变语义，只说明「这个数字属于本指标」）。 */
const METRIC_NUMBER_BRIDGE = /(?:[:：=≈<>≤≥]|不应|不得|不能|不要|别|低于|小于|少于|超过|高于|大于|大于等于|小于等于|至少|至多|最多|最大|最小|最低|上限|下限|限值|以内|以上|以下|控制|调整|提高|降低|放宽|收紧|改成|改为|换成|换到|调到|改到|降到|变成|希望|尽量|最好|要求|需要|目标|达到|做到|大概|大约|接近|靠近|正好|等于|就是|严格|精确|恰好|左右|附近|上下|差不多|约|为|是|在|到|的|有|能|可以|有没有|有么|有吗|吗|么|呢|传热|自身|板子?|热阻|系数|值|对应|那种|这种|哪|哪些|什么|推荐|找|查|看|给|来|一个|个|档|级别|档位|以及|和|与|也|还|就|都|要|能到|可用|符合|满足)+$/;

// 比较语义仍由 inferThermalLookupMode 独立判断；bridge 只负责判定「这个数字是否属于本指标」。
const TARGET_BRIDGE = METRIC_NUMBER_BRIDGE;
const REMOVE_CONDITION = /取消|不限制|不用限制|先不看|去掉/;
const KEEP_CONDITION = /条件保留|保留|不变|照旧/;

/**
 * 判定指标词与数字之间的片段是否允许「该数字属于本指标」。
 * - 纯连接词（K做到0.3 → 「做到」）直接通过；
 * - 包含冗余/倒装词（保温板自身热阻有传热8.3 → 「有传热」）时，只要去掉本指标同义词
 *   （metricWord 中的字）后剩余部分仍全部是连接/冗余词，也通过。
 * 禁止把「18mm」「第21页」「A1-3」这类数字误绑到指标。
 */
export function isMetricBridge(bridge: string, metricWord: string): boolean {
  if (!bridge) return true;
  if (TARGET_BRIDGE.test(bridge)) return true;
  // 把指标同义词中的汉字从 bridge 中剔除，剩余仍需全部是连接词。
  const metricChars = new Set([...metricWord.toLowerCase()].filter((ch) => /[\u4e00-\u9fa5a-z]/.test(ch)));
  const residual = [...bridge].filter((ch) => !metricChars.has(ch)).join("");
  return TARGET_BRIDGE.test(residual);
}

/** 模糊术语只在已有明确指标上下文时解析，禁止根据数值大小猜工程指标。 */
export function parseThermalLookupMessage(message: string, previousMetric?: ThermalLookupMetric) {
  const text = message.normalize("NFKC").replace(/(?<=\d)\s+(?=\d)/g, ",").replace(/\s+/g, "");
  const mentions = [...text.matchAll(THERMAL_LOOKUP_METRIC_PATTERN)].map((match) => ({ word: match[0], index: match.index, metric: metricFromWord(match[0]) }));
  // 模糊「系数」兜底：无其他明确指标、且不是「传热阻系数/保温系数」这类歧义词时才按 K 解析。
  if (!mentions.length && !/传热阻系数|保温系数/.test(text)) {
    const fallback = [...text.matchAll(THERMAL_LOOKUP_FALLBACK_METRIC_PATTERN)];
    if (fallback.length) mentions.push({ word: fallback[0]![0], index: fallback[0]!.index!, metric: "K" });
  }
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
  const numberCandidates: NumberCandidate[] = [];
  let unresolved = false;
  let firstModeMessage = "";
  const boundNumberIndexes = new Set<number>();
  for (const [index, mention] of mentions.entries()) {
    // 每个指标只解析自己的片段，不能让另一指标或厚度的比较词/容差污染本指标。
    // 指标词后紧跟分隔符（如「R0 3.3」被归一成「R0,3.3」）时先剥掉前导分隔符，
    // 否则本指标的目标值会落进被切掉的首个空片段而丢失。
    const clauseEnd = mentions[index + 1]?.index ?? text.length;
    const suffix = text.slice(mention.index + mention.word.length, clauseEnd)
      .replace(/^[,，;；]+/, "").split(/[,，;；]|厚度/)[0]!;
    const before = text.slice(index ? mentions[index - 1]!.index + mentions[index - 1]!.word.length : 0, mention.index);
    const localPrefix = before.split(/[,，;；]/).at(-1) ?? "";
    if (REMOVE_CONDITION.test(localPrefix) || REMOVE_CONDITION.test(suffix) && !/\d/.test(suffix)) {
      removedMetrics.push(mention.metric); continue;
    }
    if (KEEP_CONDITION.test(suffix) && !/\d/.test(suffix)) {
      retainedMetrics.push(mention.metric); continue;
    }
    const rawNumber = /([0-9]+(?:\.[0-9]+)?)/.exec(suffix);
    // 兼容扩展：当 bridge 不是纯连接词（如「有传热8.3」）时，只要 bridge 片段全部由
    // 「允许的连接/冗余/倒装词 + 本指标同义词」组成，仍视为本指标的目标值。
    const number = rawNumber && isMetricBridge(suffix.slice(0, rawNumber.index), mention.word) ? rawNumber : null;
    const prefixNumber = /([0-9]+(?:\.[0-9]+)?)(?:左右|附近|的|约|接近)*$/.exec(before);
    const targetValue = number ? Number(number[1]) : prefixNumber ? Number(prefixNumber[1]) : undefined;
    const toleranceMatch = /(?:±|上下|正负|误差(?:不超过|为)?|容差(?:为)?)([0-9]+(?:\.[0-9]+)?)/.exec(suffix);
    const toleranceIsThickness = toleranceMatch && /^(?:mm|毫米)/i.test(suffix.slice(toleranceMatch.index + toleranceMatch[0].length));
    const modePrefix = /(精确(?:查询|查)?|恰好|近似|约|接近)$/.exec(before)?.[0] ?? "";
    // 厚度紧随指标但没有逗号时也不能污染该指标语义（例如 K0.3左右20mm以内）。
    const metricSuffix = number ? suffix.replace(/\d+(?:\.\d+)?(?:mm|毫米).*$/i, "") : suffix;
    const modeMessage = number ? `${modePrefix}${mention.word}${metricSuffix}` : prefixNumber ? `${prefixNumber[0]}${mention.word}` : "";
    if (targetValue === undefined) { unresolved = true; continue; }
    if (number) boundNumberIndexes.add(mention.index + mention.word.length + number.index);
    if (!filters.length) firstModeMessage = modeMessage;
    modeMessages.push(modeMessage);
    filters.push({ metric: mention.metric, targetValue, mode: inferThermalLookupMode(modeMessage) ?? "APPROX",
      tolerance: toleranceMatch && !toleranceIsThickness ? Number(toleranceMatch[1]) : undefined });
  }
  // 通用 target 绑定（语义层兜底）：只有一个已解析指标、且本句存在唯一尚未归属、
  // 角色为 THERMAL_TARGET/UNKNOWN 的数值时，绑定给它；厚度/页码/型号/年份/数量/金额一律排除。
  // 纯「取消/保留条件」语句（无待绑定目标）不进入兜底，避免把取消条件误判成澄清。
  const actionableMentions = mentions.filter((mention) => !removedMetrics.includes(mention.metric) && !retainedMetrics.includes(mention.metric));
  if (!filters.length && actionableMentions.length && !removedMetrics.length) {
    const soleMetric = new Set(actionableMentions.map((mention) => mention.metric)).size === 1 ? actionableMentions[0]!.metric : undefined;
    if (soleMetric) {
      const numbers = [...text.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)]
        .filter((match) => !boundNumberIndexes.has(match.index!))
        .map((match) => ({ raw: match[1]!, index: match.index!, role: classifyNumberRole(text, match[1]!, match.index!) }))
        // 已被认定为厚度/页码/型号/年份/数量的数值优先排除；UNKNOWN 保留待升格。
        .filter((candidate) => candidate.role === "UNKNOWN" || candidate.role === "THERMAL_TARGET");
      numbers.forEach((candidate) => { if (!numberCandidates.some((item) => item.index === candidate.index)) numberCandidates.push(candidate); });
      if (numbers.length === 1) {
        const only = numbers[0]!;
        const targetValue = Number(only.raw);
        if (Number.isFinite(targetValue) && targetValue > 0) {
          const modeMessage = `${actionableMentions[0]!.word}${text.slice(actionableMentions[0]!.index + actionableMentions[0]!.word.length, only.index)}${only.raw}`;
          firstModeMessage = modeMessage;
          modeMessages.push(modeMessage);
          filters.push({ metric: soleMetric, targetValue, mode: inferThermalLookupMode(modeMessage) ?? "APPROX" });
          // 主循环因 bridge 过严而暂时置 unresolved；语义层兜底已成功绑定，必须清除该澄清。
          unresolved = false;
        } else unresolved = true;
      } else if (numbers.length > 1) {
        // 多个可能数值 → 必须澄清具体值（不能随便第一个）。
        unresolved = true;
      } else {
        unresolved = true;
      }
    }
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
    numberCandidates,
    appendRange: /再加(?:一个)?范围条件/.test(text),
    needsClarification: ambiguous && !previousMetric || !!implicitTarget && !previousMetric || unresolved || (filters.length > 0 || removedMetrics.length > 0) && /或者|或|\bor\b/i.test(message)
  };
}
