import type { ReferenceLookupCandidate } from "./conversation-task.js";
import { normalizeThermalLookupQuery } from "../thermal/thermal-lookup-mode.js";
import { formatLookupThickness } from "../thermal/thermal-lookup-thickness.js";
import { validateCandidateAgainstQueryState, type ThermalQueryState } from "../thermal/thermal-query-state.js";
import type { ThermalCalculationPresentation } from "../thermal/thermal-calc-presentation.js";
import { answerHasForbiddenClaim, segmentAnswer, type SemanticFact, type SemanticMetric } from "./thermal-answer-semantics.js";
import { normalizeSystemName, normalizeSystemFamily, normalizeEntityText } from "../thermal/thermal-query-state.js";

/**
 * 本次热工计算的可核验结果（REFERENCE_TABLE / 计算模式）。
 * 计算回答没有「候选行」，但有 K / R / λ / α / 标准限值 / 合规判定这些原子事实，
 * 因此单独冻结一份，交给同一套语义事实校验。
 */
export interface CalculationFacts {
  schemeId?: string | null;
  schemeCode?: string | null;
  productSpecId?: string | null;
  specCode?: string | null;
  thicknessMm?: number | null;
  kValue?: number | null;
  totalResistance?: number | null;
  productThermalResistance?: number | null;
  /** 各构造层的 λ / α（逐层冻结，避免把 A 层的 λ 拼到 B 层的厚度上） */
  layers?: ReadonlyArray<{ materialName?: string; thicknessMm?: number; lambda?: number | null; correctionFactor?: number | null }>;
  sourcePageLabel?: string | null;
  systemName?: string;
  /** 已确认的标准限值 K */
  standardLimitK?: number | null;
  /** 只有调用方已证明全部适用范围时才置 true，否则不允许出现「符合/达标」结论 */
  complianceAuthorized?: boolean;
  compliant?: boolean | null;
  standardNames?: string[];
}

export interface AllowedAnswerFacts {
  query: ThermalQueryState;
  /** 正式命中候选（原子事实，逐条冻结） */
  candidates: ReadonlyArray<Readonly<ReferenceLookupCandidate>>;
  /** 未完全满足硬条件、仅作「最接近」说明的候选；数值真实但不得称为命中 */
  nearbyCandidates?: ReadonlyArray<Readonly<ReferenceLookupCandidate>>;
  /** 允许引用的来源页（只认印刷页码 pageLabel） */
  sourcePages?: ReadonlyArray<{ sourcePageLabel?: string | null; pageLabel?: string | null }>;
  /** 本次热工计算的冻结结果（与 candidates 互不影响） */
  calculation?: CalculationFacts;
  matchedCount?: number;
  /** 确定性 fallback 文本：LLM 生成失败或事实校验连续失败时使用 */
  canonicalAnswers: string[];
}

export interface BuildAllowedFactsOptions {
  nearbyCandidates?: ReferenceLookupCandidate[];
  sourcePages?: Array<{ sourcePageLabel?: string | null; pageLabel?: string | null }>;
}

function describeQuery(query: ThermalQueryState) {
  const lookup = normalizeThermalLookupQuery(query);
  return [query.systemHint, query.specClass ? `${query.specClass}型` : undefined, formatLookupThickness(query),
    ...lookup.filters.map(filter => `${filter.metric === "K" ? "K" : filter.metric === "PRODUCT_R" ? "产品层热阻 R" : "总热阻 R₀"}${filter.mode === "MAX_LIMIT" ? "≤" : filter.mode === "MIN_LIMIT" ? "≥" : filter.mode === "EXACT" ? "=" : "≈"}${filter.targetValue}`)
  ].filter(Boolean).join("，");
}

function renderCandidate(candidate: Readonly<ReferenceLookupCandidate>, detailed: boolean) {
  const values = [candidate.systemName, candidate.schemeCode ? `方案 ${candidate.schemeCode}` : undefined,
    candidate.specCode ? `规格 ${candidate.specCode}` : candidate.specClass ? `${candidate.specClass}型` : undefined,
    candidate.thicknessMm != null ? `厚度 ${candidate.thicknessMm} mm` : undefined,
    candidate.productThermalResistance != null ? `产品层热阻 R=${candidate.productThermalResistance} m²·K/W` : undefined,
    candidate.totalThermalResistance != null ? `总热阻 R₀=${candidate.totalThermalResistance} m²·K/W` : undefined,
    candidate.kValue != null ? `K=${candidate.kValue} W/(m²·K)` : undefined,
    detailed && candidate.lambda != null ? `λ=${candidate.lambda} W/(m·K)` : undefined,
    detailed && candidate.alpha != null ? `α=${candidate.alpha}` : undefined
  ].filter(Boolean);
  const source = candidate.sourcePageLabel?.trim() ? `印刷页码 ${candidate.sourcePageLabel.trim()}` : "可查看原始来源页面（未记录印刷页码）";
  return `${values.join("；")}。\n来源：${candidate.evidenceSource || "正式参考资料"}，${source}。`;
}

/**
 * 澄清文案：reason 字段只存「缺什么」的名词短语，这里统一渲染成自然的短问句。
 * 即使某个 reason 仍带「请确认 / 请补充」这类内部引导词，也先剥掉再拼接，
 * 避免出现「想确认一下：请确认……」这种重复前缀。
 */
export function renderClarification(query: ThermalQueryState, message = ""): string {
  const unresolved = query.unresolved ?? [];
  if (!unresolved.length) return "";
  const metric = unresolved.find(item => item.field === "metric");
  if (metric) {
    const number = /(\d+(?:\.\d+)?)/.exec(message)?.[1];
    return number
      ? `你这里的「${number}」是指保温板自身热阻 R，还是整墙总热阻 R₀？（如果指传热系数 K 请说明）`
      : "你要找的是保温板自身热阻 R、整墙总热阻 R₀，还是传热系数 K？";
  }
  if (unresolved.some(item => item.field === "relationship")) {
    return "这几个条件是都要同时满足（AND），还是满足其中一个就行？目前只支持同时满足。";
  }
  const phrases = unresolved.map(item => stripLeadIn(item.reason)).filter(Boolean);
  if (phrases.length) return `想确认一下：${phrases.join("；")}。`;
  return "想确认一下你这次要查的具体条件。";
}

/** 去掉 reason 里可能残留的内部引导前缀，只保留「缺什么」的短语。 */
function stripLeadIn(reason: string | undefined): string {
  return (reason ?? "").trim().replace(/^(?:请(?:确认|补充|说明|明确|提供)|需要(?:确认|补充|说明))[：:，,]?\s*/, "").replace(/[。；;]+$/, "");
}

/** 事实快照按记录冻结；模板只读正式数值，不插值、不拼候选、不把物理页序当页标签。 */
export function buildAllowedAnswerFacts(
  query: ThermalQueryState,
  candidates: ReferenceLookupCandidate[],
  message = "",
  matchedCount?: number,
  options: BuildAllowedFactsOptions = {}
): AllowedAnswerFacts {
  const facts = candidates.filter(candidate => validateCandidateAgainstQueryState(candidate, query).passed)
    .map(candidate => Object.freeze(structuredClone(candidate)));
  const nearby = (options.nearbyCandidates ?? []).map(candidate => Object.freeze(structuredClone(candidate)));
  const detail = /详细|参数|怎么算|计算过程|技术字段/.test(message);
  const scope = describeQuery(query);
  let answer: string;
  if (query.unresolved?.length) answer = renderClarification(query, message);
  else if (!facts.length) answer = `当前已发布参考表中没有找到同时满足${scope ? `「${scope}」` : "当前条件"}的正式方案。\n如需，我可以继续查图集原文或按你指定的新条件筛选。`;
  else {
    const number = /第([一二三四五六七八九十]|\d+)个/.exec(message);
    const selectedIndex = number ? (Number(number[1]) || "一二三四五六七八九十".indexOf(number[1]!) + 1) - 1 : /第二个/.test(message) ? 1 : 0;
    if (number && !facts[selectedIndex]) return { query: structuredClone(query), candidates: Object.freeze(facts), nearbyCandidates: Object.freeze(nearby), matchedCount,
      canonicalAnswers: ["当前已核验候选中没有这个序号，请确认要查看的方案。"] };
    const selected = /全部|列出来|对比|这三个/.test(message) ? facts.slice(0, 3) : [facts[selectedIndex]!];
    const approx = normalizeThermalLookupQuery(query).filters.some(filter => filter.mode === "APPROX");
    answer = `${approx ? "有接近目标且满足当前筛选条件的正式参考方案。" : "有满足当前筛选条件的正式参考方案。"}\n${selected.map(candidate => renderCandidate(candidate, detail)).join("\n")}\n可继续按厚度或热工指标筛选。`;
  }
  return { query: structuredClone(query), candidates: Object.freeze(facts), nearbyCandidates: Object.freeze(nearby),
    sourcePages: options.sourcePages, matchedCount, canonicalAnswers: [answer] };
}

/**
 * 写入本轮热工回答的 Allowed Fact Set，并同步确定性 fallback 文案。
 * 事实门禁做语义事实校验，允许模型自然表达；事实集缺省时生成文本不能被核验。
 * 入参用结构化类型（不依赖 ToolRuntimeContext），避免与 tool-runtime 形成循环依赖。
 */
export function setThermalAnswerFacts(
  ctx: { thermalAllowedFacts?: AllowedAnswerFacts; thermalCanonicalAnswers?: string[] },
  facts: AllowedAnswerFacts
): string[] {
  ctx.thermalAllowedFacts = facts;
  ctx.thermalCanonicalAnswers = facts.canonicalAnswers;
  return facts.canonicalAnswers;
}

/** 单条候选的紧凑事实行（给模型看的原子事实，不含任何推理）。 */
function factLine(candidate: Readonly<ReferenceLookupCandidate>, detailed: boolean) {
  return [candidate.systemName,
    candidate.schemeCode ? `方案编码 ${candidate.schemeCode}` : undefined,
    candidate.specCode ? `规格编码 ${candidate.specCode}` : candidate.specClass ? `规格分类 ${candidate.specClass}` : undefined,
    candidate.thicknessMm != null ? `厚度 ${candidate.thicknessMm} mm` : undefined,
    candidate.substrateThickness != null ? `基层厚度 ${candidate.substrateThickness} mm` : undefined,
    candidate.productThermalResistance != null ? `产品层热阻 R=${candidate.productThermalResistance}` : undefined,
    candidate.totalThermalResistance != null ? `整墙总热阻 R₀=${candidate.totalThermalResistance}` : undefined,
    candidate.kValue != null ? `传热系数 K=${candidate.kValue}` : undefined,
    detailed && candidate.lambda != null ? `导热系数 λ=${candidate.lambda}` : undefined,
    detailed && candidate.alpha != null ? `修正系数 α=${candidate.alpha}` : undefined,
    candidate.sourcePageLabel?.trim() ? `印刷页码 ${candidate.sourcePageLabel.trim()}` : "印刷页码 未记录"
  ].filter(Boolean).join("；");
}

/**
 * 把 Allowed Fact Set 渲染成「给模型的事实清单」。
 * 模型只能基于这些原子事实做自然语言表达；事实清单本身不含推荐、排名或合规判断。
 */
export function renderAllowedFactsForModel(facts: AllowedAnswerFacts, detailed = true): string {
  const query = facts.query;
  const lines: string[] = ["【本次已核验事实（唯一可用信息源）】",
    `查询条件：${describeQuery(query) || "（未给出明确的热工条件）"}`];
  if (query.unresolved?.length) {
    lines.push("状态：需要先向用户澄清，不要给出任何方案或数值：");
    for (const item of query.unresolved) lines.push(`- ${item.reason}`);
  }
  if (facts.candidates.length) {
    lines.push(`命中候选（共 ${facts.candidates.length} 条，只可引用以下事实）：`);
    facts.candidates.forEach((candidate, index) => lines.push(`${index + 1}. ${factLine(candidate, detailed)}`));
  } else if (!query.unresolved?.length) {
    lines.push("命中候选：无。当前已发布参考表中没有同时满足上述条件的正式方案。");
  }
  if (facts.nearbyCandidates?.length) {
    lines.push("相邻但未完全满足条件的候选（必须明确说未满足，不得称为命中）：");
    facts.nearbyCandidates.forEach((candidate, index) => lines.push(`${index + 1}. ${factLine(candidate, detailed)}；未满足条件：${validateCandidateAgainstQueryState(candidate, query).failed.join("、")}`));
  }
  if (facts.calculation) {
    const calculation = facts.calculation;
    lines.push("本次正式计算的冻结结果：");
    for (const candidate of calculationAsCandidates(calculation)) lines.push(factLine(candidate, detailed));
    if (calculation.standardLimitK != null) lines.push(`已选标准限值 K≤${calculation.standardLimitK}`);
    if (calculation.standardNames?.length) lines.push(`标准依据：${calculation.standardNames.join("、")}`);
    if (calculation.complianceAuthorized && calculation.compliant != null)
      lines.push(`已核验适用范围及所选标准，判定：${calculation.compliant ? "符合" : "不符合"}该标准限值。`);
    else lines.push("尚未证明标准全部适用条件，不能给出合规结论。");
  }
  const pages = [...new Set([...facts.candidates, ...(facts.nearbyCandidates ?? [])]
    .map(candidate => candidate.sourcePageLabel?.trim()).filter((item): item is string => Boolean(item)))];
  lines.push(`可引用的印刷页码：${pages.length ? pages.join("、") : "无"}`);
  return lines.join("\n");
}

/**
 * REFERENCE_LOOKUP 最终表达的 System Prompt。
 * 事实正确性由 Allowed Fact Set + validateAnswerFacts 保证，这里只负责把「表达自由」还给模型。
 */
export const REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT = [
  "你是蓝格智配的热工参考查询助手，回答用户关于已发布图集 / 参考表中保温构造方案的提问。",
  "只能用【本次已核验事实】作答：不得新增、改写、换算或推算任何数值、厚度、页码、方案编码，也不得引入事实清单之外的方案。查询目标与候选实值要分别表述。",
  "允许自然、口语化的中文表达。同一批事实可以有多种说法，例如「60mm 双层方案，板自身热阻 8.000，整墙总热阻 8.313，K≈0.120」或「60mm，产品层热阻 8.000，总热阻 8.313」都可以，但数值必须与事实清单完全一致。",
  "不得出现「最高 / 最低 / 最大 / 最小 / 唯一 / 全部 / 所有 / 没有其他 / 仅此」，也不得说「达标 / 合规 / 符合标准或规范限值」——除非事实清单里明确给出该结论。",
  "事实清单标注「需要先向用户澄清」时，只用一句话自然地问清歧义，不要给出任何方案。",
  "命中候选为空时，如实说明当前已发布参考表没有同时满足条件的正式方案，可建议继续查图集原文或更换条件。",
  "用户只问了某个指标时，就只回答该指标相关事实，不必把清单里的每一项都念一遍。默认3～8行，一个主方案，可补充最多两条相关方案；详细追问才展开参数。",
  "不要输出内部字段名，不要用 Markdown 重写整张构造表，不要展开热工公式，不要加标题。"
].join("\n");

export function buildCalculationAnswer(presentation: ThermalCalculationPresentation, detailed = false, complianceAuthorized = false): string {
  const lines = [presentation.resultK != null ? `正式热工结果：K=${presentation.resultK} W/(m²·K)。` : "本次热工计算未形成可核验结果。",
    presentation.totalResistance != null ? `总热阻 R₀=${presentation.totalResistance} m²·K/W。` : undefined];
  // 只有调用方已证明全部适用范围时，才允许透传冻结判定。
  if (complianceAuthorized && presentation.limitKValue != null) lines.push(`已确认标准限值：K≤${presentation.limitKValue} W/(m²·K)。`);
  if (complianceAuthorized && presentation.compliant != null) lines.push(presentation.compliant ? "按已确认地区、建筑类型及所选标准判定：符合该标准限值。" : "按已确认地区、建筑类型及所选标准判定：不符合该标准限值。");
  if (!complianceAuthorized && presentation.limitKValue != null) lines.push(`已选标准限值 K≤${presentation.limitKValue} W/(m²·K)；需核对地区、建筑类型及标准适用范围后判断合规。`);
  if (detailed) for (const step of presentation.steps) if (step.value != null && step.key !== "judgment") lines.push(`${step.label}：${step.value}${step.unit ? ` ${step.unit}` : ""}。`);
  return lines.filter(Boolean).join("\n");
}

// 查询容差决定候选集合，回答校验只忽略浮点表示误差；不允许把0.303改写成0.300。
const FACT_EPSILON = 1e-9;

const candidateMetricValue = (candidate: Readonly<ReferenceLookupCandidate>, metric: SemanticMetric): number | undefined =>
  metric === "K" ? candidate.kValue
    : metric === "PRODUCT_R" ? candidate.productThermalResistance
      : metric === "TOTAL_R" ? candidate.totalThermalResistance
        : metric === "LAMBDA" ? candidate.lambda : candidate.alpha;

function metricClose(value: number, target: number, _metric: SemanticMetric): boolean {
  return Math.abs(value - target) <= FACT_EPSILON;
}

const closeTo = (a: number, b: number, epsilon: number) => Math.abs(a - b) <= epsilon;

/**
 * 把冻结的计算结果展开成若干「伪候选」，使 K / R / λ / α / 厚度 / 页码 / 编码 走同一套事实匹配：
 * - 一条汇总候选承载方案编码、规格编码、厚度、K、R₀、产品层 R、页码；
 * - 每条构造层单独一条，承载该层自己的厚度 / λ / α，避免跨层拼参数。
 */
function calculationAsCandidates(calculation: CalculationFacts): Array<Readonly<ReferenceLookupCandidate>> {
  const shared = {
    systemName: calculation.systemName,
    schemeId: calculation.schemeId ?? undefined,
    schemeCode: calculation.schemeCode ?? undefined,
    productSpecId: calculation.productSpecId ?? undefined,
    specCode: calculation.specCode ?? undefined,
    sourcePageLabel: calculation.sourcePageLabel ?? undefined
  };
  return [
    Object.freeze({
      id: "__calculation__", ...shared,
      thicknessMm: calculation.thicknessMm ?? undefined,
      kValue: calculation.kValue ?? undefined,
      totalThermalResistance: calculation.totalResistance ?? undefined,
      productThermalResistance: calculation.productThermalResistance ?? undefined
    } as unknown as Readonly<ReferenceLookupCandidate>),
    ...(calculation.layers ?? []).map((layer, index) => Object.freeze({
      id: `__calculation_layer_${index}__`, ...shared,
      thicknessMm: layer.thicknessMm,
      lambda: layer.lambda ?? undefined,
      alpha: layer.correctionFactor ?? undefined
    } as unknown as Readonly<ReferenceLookupCandidate>))
  ];
}

function metricAllowed(value: number, metric: SemanticMetric, pool: ReadonlyArray<Readonly<ReferenceLookupCandidate>>, query: ThermalQueryState): boolean {
  return pool.some(candidate => {
    const own = candidateMetricValue(candidate, metric);
    return own != null && metricClose(value, own, metric);
  });
}

function thicknessAllowed(value: number, pool: ReadonlyArray<Readonly<ReferenceLookupCandidate>>, query: ThermalQueryState): boolean {
  return pool.some(candidate => candidate.thicknessMm != null && closeTo(value, candidate.thicknessMm, FACT_EPSILON)
    || candidate.substrateThickness != null && closeTo(value, candidate.substrateThickness, FACT_EPSILON));
}

const normalizePage = (value: string) => value.replace(/\s+/g, "").toLowerCase();

function pageAllowed(label: string, pool: ReadonlyArray<Readonly<ReferenceLookupCandidate>>, allowed: AllowedAnswerFacts): boolean {
  const labels = [
    ...pool.map(candidate => candidate.sourcePageLabel),
    ...(pool.length ? [] : (allowed.sourcePages ?? []).map(page => page.sourcePageLabel ?? page.pageLabel))
  ].filter((item): item is string => Boolean(item && item.trim())).map(normalizePage);
  return labels.includes(normalizePage(label));
}

function codeMatchesCandidate(code: string, candidate: Readonly<ReferenceLookupCandidate>): boolean {
  const target = code.toLowerCase();
  return [candidate.schemeCode, candidate.specCode, candidate.schemeId, candidate.productSpecId, candidate.systemCode]
    .some(value => typeof value === "string" && value.trim().toLowerCase() === target);
}

function factMatches(fact: SemanticFact, candidate: Readonly<ReferenceLookupCandidate>, query: ThermalQueryState, allowed: AllowedAnswerFacts): boolean {
  switch (fact.kind) {
    case "metric": return metricAllowed(fact.value, fact.metric, [candidate], query);
    case "thickness": return thicknessAllowed(fact.value, [candidate], query);
    case "page": return pageAllowed(fact.label, [candidate], allowed);
    case "code": return codeMatchesCandidate(fact.code, candidate);
    case "entity": return normalizeSystemName(fact.name) === normalizeSystemName(candidate.systemName ?? "")
      || normalizeSystemName(fact.name) === normalizeSystemFamily(candidate.systemName ?? "");
    case "standardLimit": return allowed.calculation?.standardLimitK != null && closeTo(fact.value, allowed.calculation.standardLimitK, FACT_EPSILON);
    case "compliance": return allowed.calculation?.complianceAuthorized === true && allowed.calculation.compliant === fact.compliant;
    case "standardIdentity": return allowed.calculation?.standardNames?.some(name => normalizeEntityText(name) === normalizeEntityText(fact.name)) === true;
  }
}

/**
 * 事实匹配（语义，不是全文相等）：
 * 1. 必须提供结构化事实集；fallback 不作为校验依据；
 * 2. 出现未授权断言（最高/唯一/全部；未授权时的达标/合规…）→ 拒绝；
 * 3. 逐片段校验真正出现的工程事实：带编码的片段必须由同一条候选同时满足（禁止跨候选拼字段），
 *    无编码片段的事实须由候选池中任意一条满足；越界数字、被改写的指标、编造页码一律拒绝。
 * 只校验带语义标签的事实；没有标签的裸数字不参与判定，因此自然表达不同也能通过。
 */
export function validateAnswerFacts(answer: string, allowedFacts: Pick<AllowedAnswerFacts, "canonicalAnswers"> & Partial<Pick<AllowedAnswerFacts, "candidates" | "nearbyCandidates" | "sourcePages" | "query" | "calculation">>) {
  // 没有事实集时无法核验任何生成文本，调用方直接使用已构造的fallback。
  const hasFactContext = allowedFacts.query !== undefined || allowedFacts.candidates !== undefined
    || allowedFacts.nearbyCandidates !== undefined || allowedFacts.sourcePages !== undefined
    || allowedFacts.calculation !== undefined;
  if (!hasFactContext || !answer.trim()) return { passed: false, code: "INVALID_FACT" as const };
  if (answerHasForbiddenClaim(answer, { complianceAuthorized: allowedFacts.calculation?.complianceAuthorized === true })) {
    return { passed: false, code: "INVALID_FACT" as const };
  }

  const query = allowedFacts.query ?? {};
  const pool = [...(allowedFacts.candidates ?? []), ...(allowedFacts.nearbyCandidates ?? []),
    ...(allowedFacts.calculation ? calculationAsCandidates(allowedFacts.calculation) : [])];
  const allowed: AllowedAnswerFacts = {
    query, candidates: allowedFacts.candidates ?? [], nearbyCandidates: allowedFacts.nearbyCandidates,
    sourcePages: allowedFacts.sourcePages, calculation: allowedFacts.calculation, canonicalAnswers: allowedFacts.canonicalAnswers
  };
  const assertion = answer.replace(/(?:没有|未|不)(?:完全|同时)?(?:满足|命中|符合)[^。\n]*[。]?/g, "");
  if (!allowed.candidates.length && !allowed.calculation && /有[^。\n]{0,25}(?:满足|命中|符合)(?:当前|这些|全部|筛选)?(?:条件|要求)|找到[^。\n]{0,20}满足|^(?:有[，,。]|有(?:一个|几个|几条|一条).*方案)/.test(assertion.trim())) {
    return { passed: false, code: "INVALID_FACT" as const };
  }
  const queryFactMatches = (fact: SemanticFact) => fact.kind === "metric"
    ? normalizeThermalLookupQuery(query).filters.some(filter => filter.metric === fact.metric && closeTo(fact.value, filter.targetValue, FACT_EPSILON))
    : fact.kind === "thickness" && [query.thicknessMm, query.thicknessMin, query.thicknessMax].some(bound => bound != null && closeTo(fact.value, bound, FACT_EPSILON));

  let sawFact = false;
  for (const segment of segmentAnswer(answer, pool.map(candidate => candidate.schemeCode?.toLowerCase()).filter((code): code is string => Boolean(code)))) {
    // 自然句中出现正式体系全名时同样绑定候选，不要求用户或模型添加「系统：」标签。
    const names = [...new Set(pool.map(candidate => candidate.systemName).filter((name): name is string => Boolean(name)))];
    const mentions = names.flatMap(name => [...segment.text.matchAll(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))]
      .map(match => ({ name, index: match.index, end: match.index + name.length })));
    for (const hit of mentions.filter(hit => !mentions.some(other => other.name.length > hit.name.length && other.index <= hit.index && other.end >= hit.end))) {
      if (!segment.facts.some(fact => fact.kind === "entity" && fact.name === hit.name))
        segment.facts.push({ kind: "entity", field: "systemName", name: hit.name });
    }
    if (segment.facts.length === 0) continue;
    sawFact = true;
    if (segment.role === "QUERY") {
      if (!segment.facts.every(queryFactMatches)) return { passed: false, code: "INVALID_FACT" as const };
      continue;
    }
    const matching = pool.filter(candidate => segment.facts.every(fact => factMatches(fact, candidate, query, allowed)));
    if (segment.code) {
      if (!matching.length) {
        return { passed: false, code: "INVALID_FACT" as const };
      }
    } else if (!matching.length) {
      // 无编码片段：任一候选能同时满足即可；候选池为空时只允许复述查询目标值/厚度条件。
      if (pool.length > 0 || !segment.facts.every(queryFactMatches)) {
        return { passed: false, code: "INVALID_FACT" as const };
      }
    }
    if (matching.length && !matching.some(candidate => allowed.candidates.includes(candidate)) && !allowed.calculation) {
      const localAssertion = segment.text.replace(/(?:没有|未|不)(?:完全|同时)?(?:满足|命中|符合)[^。\n]*[。]?/g, "");
      if (/(?:满足|符合)(?:全部|所有|当前|这些|筛选)?(?:条件|要求|上限|下限)|完全命中|正式命中/.test(localAssertion)
        || !/(?:相邻|未完全满足|不满足|未满足|不符合|不算命中)/.test(segment.text + answer.slice(0, answer.indexOf(segment.text)))) {
        return { passed: false, code: "INVALID_FACT" as const };
      }
    }
  }
  // 有候选可谈时，回答必须至少引用一条可核验事实；纯空话无法证明事实边界。
  if (!sawFact && pool.length > 0) return { passed: false, code: "INVALID_FACT" as const };
  return { passed: true, code: "VALID_FACTS" as const };
}

export async function validateOrRepairThermalAnswer(answer: string, canonicalAnswers: string[], retry: (canonical: string) => Promise<string>,
  allowedFacts?: Partial<Pick<AllowedAnswerFacts, "candidates" | "nearbyCandidates" | "sourcePages" | "query" | "calculation">>) {
  const allowed = { canonicalAnswers, ...allowedFacts };
  if (!allowedFacts) return { text: canonicalAnswers[0]!, repaired: false, fallback: true };
  if (validateAnswerFacts(answer, allowed).passed) return { text: answer.trim(), repaired: false, fallback: false };
  const canonical = canonicalAnswers[0]!;
  try {
    const regenerated = await retry(canonical);
    if (validateAnswerFacts(regenerated, allowed).passed) return { text: regenerated.trim(), repaired: true, fallback: false };
  } catch { /* 模型重试失败不突破事实门禁。 */ }
  return { text: canonical, repaired: true, fallback: true };
}
