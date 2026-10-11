import { interpretThermalQuestion } from "../thermal-answer-facts.js";
import { resolveQueryEntities, type QueryEntity, type QueryAlias } from "../../thermal/thermal-entity-resolver.js";
import { validateCandidateAgainstQueryState, normalizeSystemName, traceQueryState, entityFields, type ThermalQueryState } from "../../thermal/thermal-query-state.js";
import type {
  LastReferenceLookup,
  ReferenceLookupCandidate,
  ReferenceLookupSpecClass
} from "../conversation-task.js";
import type { CandidateResult } from "../../thermal/thermal-candidate-matcher.js";
import { parseThermalThicknessMessage, type LookupThickness } from "../../thermal/thermal-lookup-thickness.js";
import { classifyQueryLifecycle } from "../../thermal/thermal-query-lifecycle.js";
import {
  normalizeThermalLookupQuery,
  getCandidateMetricValue,
  matchesMetric,
  parseThermalLookupMessage,
  resolveConversationLookupMode,
  inferThermalLookupMode,
  normalizeThermalLookupFilter,
  type ThermalLookupQuery
} from "../../thermal/thermal-lookup-mode.js";

export const LOOKUP_LIMIT = 12;

export function parseSpecClassHint(value: string | null | undefined): ReferenceLookupSpecClass | undefined {
  const text = (value ?? "").replace(/\s+/g, "");
  if (!text) return undefined;
  if (/(?:III|Ⅲ|ⅲ|3|三)型/i.test(text)) return "III";
  if (/(?:II|Ⅱ|ⅱ|2|二)型/i.test(text)) return "II";
  if (/(?:I|Ⅰ|ⅰ|1|一)型/i.test(text)) return "I";
  return undefined;
}

export function sanitizeSystemHint(value: string | null | undefined): string | undefined {
  const hint = (value ?? "").trim().replace(/[%_\\]/g, "").slice(0, 80);
  return hint || undefined;
}

/** 查询语义参数（跨轮继承 + 复用过滤共用） */
export interface LookupQueryShape extends ThermalLookupQuery, LookupThickness, Omit<ThermalQueryState, "filters"> {
  systemId?: string;
  schemeId?: string;
  schemeCode?: string;
  productSpecId?: string;
  catalogProductId?: string;
  targetK?: number;
  targetR?: number;
  thicknessMm?: number;
  systemHint?: string;
  specClass?: ReferenceLookupSpecClass;
}

export function inheritLookupQuery(
  input: LookupQueryShape,
  last?: LastReferenceLookup | null
): LookupQueryShape {
  const previous = last?.query;
  const systemChanged = input.systemId !== undefined && input.systemId !== previous?.systemId
    || input.systemHint !== undefined && normalizeSystemHint(input.systemHint) !== normalizeSystemHint(previous?.systemHint);
  const schemeChanged = systemChanged || input.schemeId !== undefined && input.schemeId !== previous?.schemeId
    || input.schemeCode !== undefined && input.schemeCode !== previous?.schemeCode;
  const productChanged = input.specClass !== undefined && input.specClass !== previous?.specClass
    || input.catalogProductId !== undefined && input.catalogProductId !== previous?.catalogProductId;
  const specChanged = input.productSpecId !== undefined && input.productSpecId !== previous?.productSpecId;
  const inputMetric = input.metric ?? (input.targetK !== undefined ? "K" : input.targetR !== undefined ? "TOTAL_R" : undefined);
  const previousMetric = normalizeThermalLookupQuery(previous ?? {}).metric;
  const metricChanged = inputMetric !== undefined && inputMetric !== previousMetric;
  const fresh = (value: string | undefined, old: string | undefined, changed: boolean) =>
    value !== undefined && (!changed || value !== old) ? value : changed ? undefined : old;
  return {
    ...previous, ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)),
    filters: input.filters ?? (inputMetric !== undefined || input.targetValue !== undefined ? undefined : previous?.filters),
    metric: input.metric ?? (metricChanged ? undefined : previous?.metric),
    targetValue: input.targetValue ?? (previous?.metric ? input.targetK ?? input.targetR : undefined) ?? (metricChanged ? undefined : previous?.targetValue),
    systemId: fresh(input.systemId, previous?.systemId, systemChanged),
    schemeId: fresh(input.schemeId, previous?.schemeId, schemeChanged),
    schemeCode: fresh(input.schemeCode, previous?.schemeCode, schemeChanged),
    // 换方案时清除继承规格，重新从正式 scheme/product 数据匹配，避免非法组合。
    productSpecId: fresh(input.productSpecId, previous?.productSpecId, schemeChanged || productChanged),
    catalogProductId: fresh(input.catalogProductId, previous?.catalogProductId, schemeChanged || productChanged || specChanged),
    targetK: input.targetK ?? (metricChanged ? undefined : previous?.targetK),
    targetR: input.targetR ?? (metricChanged ? undefined : previous?.targetR),
    thicknessMm: input.thicknessMm ?? last?.query.thicknessMm,
    thicknessMin: input.thicknessMin ?? last?.query.thicknessMin,
    thicknessMax: input.thicknessMax ?? last?.query.thicknessMax,
    preferThinner: input.preferThinner ?? last?.query.preferThinner,
    systemHint: sanitizeSystemHint(input.systemHint) ?? (systemChanged ? undefined : previous?.systemHint),
    // 族/类别集合约束随体系切换一起失效；未换体系时沿用历史族约束。
    systemIds: input.systemIds ?? (systemChanged ? undefined : previous?.systemIds),
    specClass: input.specClass ?? (specChanged ? undefined : last?.query.specClass),
    mode: input.mode ?? last?.query.mode,
    tolerance: input.tolerance ?? (metricChanged || input.mode && input.mode !== previous?.mode ? undefined : previous?.tolerance),
    requestedTolerance: input.requestedTolerance ?? (metricChanged || input.mode && input.mode !== previous?.mode ? undefined : previous?.requestedTolerance)
  };
}

/** 候选行是否满足当前 K 查询语义（与 matcher 同源，禁止在 AI 层另写一套） */
export function candidateMatchesK(
  candidate: ReferenceLookupCandidate,
  query: LookupQueryShape
): boolean {
  const lookup = normalizeThermalLookupQuery(query);
  return lookup.filters.every((filter) => matchesMetric(getCandidateMetricValue(candidate, filter.metric), filter.targetValue, filter.mode, filter.tolerance));
}

/**
 * 仅纯参数/原页指代可复用历史候选：
 * - 任一正式查询条件变化时不再复用（返回 null，触发重新查询）；
 * - K / 热阻 / 厚度 / 型号按当前查询语义过滤；体系提示用严格匹配（不做静默回退）；
 * - 过滤后为空则返回 null，由调用方重新查库，而不是把不相关候选当命中结果。
 */
export function filterReusableCandidates(
  last: LastReferenceLookup | null | undefined,
  query: LookupQueryShape
): ReferenceLookupCandidate[] | null {
  if (!last?.candidates.length) return null;
  if (lookupQuerySignature(query) !== lookupQuerySignature(last.query)) return null;
  const hint = sanitizeSystemHint(query.systemHint);
  const filtered = last.candidates.filter(item => validateCandidateAgainstQueryState(item, query).passed);
  const hinted = filterCandidatesBySystemHint(filtered, hint);
  return hinted.length > 0 ? hinted.slice(0, LOOKUP_LIMIT) : null;
}

/**
 * 体系名收窄（严格匹配）：一个都对不上就返回空数组。
 * 禁止静默回退到其他体系的候选——那会让用户误以为「屋面」结果就是「薄抹灰」结果。
 * 需要二级回退时由调用方显式使用全量候选并标注 isFallback / matchedSystemHint=false。
 */
export function filterCandidatesBySystemHint(
  candidates: ReferenceLookupCandidate[],
  hint: string | undefined
): ReferenceLookupCandidate[] {
  const normalized = normalizeSystemHint(hint);
  if (!normalized || candidates.length === 0) return candidates;
  return candidates.filter((item) => normalizeSystemHint(item.systemName)?.includes(normalized));
}

export function compactCandidateResult(row: CandidateResult & { compliant?: boolean | null }): ReferenceLookupCandidate {
  return {
    id: row.candidateId,
    catalogProductId: row.catalogProductId ?? null,
    systemId: row.system.id,
    systemCode: row.system.code,
    schemeVersion: row.scheme.version,
    substrateMaterial: row.scheme.substrateMaterial,
    substrateThickness: row.scheme.substrateThickness,
    specCode: row.productSpec.specCode,
    specVersion: row.productSpec.specVersion,
    setId: row.set.id,
    setCode: row.set.code,
    setVersion: row.set.version,
    setPriority: row.set.priority,
    setBuildingTypes: row.set.buildingTypes,
    matchType: row.matchType,
    neighborGap: row.neighborGap,
    matchedConditions: row.matchedConditions,
    unmatchedConditions: row.unmatchedConditions,
    missingConditions: row.missingConditions,
    ranking: row.ranking,
    compliant: row.compliant,
    constraintMatch: row.constraintMatch,
    structureType: row.structureType, regionCode: row.regionCode, standardLimitId: row.standardLimitId, sourceVersionId: row.sourceVersionId,
    specClass: row.productSpec.specClass ?? undefined,
    thicknessMm: row.result.thicknessMm,
    kValue: row.result.kValue,
    systemName: row.system.name ?? undefined,
    atlasPage: row.scheme.atlasPage,
    schemeId: row.scheme.id,
    productSpecId: row.productSpec.id,
    evidenceSource: row.evidence.source,
    evidenceRef: row.evidence.ref,
    schemeCode: row.scheme.code,
    productThermalResistance: row.result.productThermalResistance,
    totalThermalResistance: row.result.totalThermalResistance,
    sourceDocumentId: row.sourceDocumentId ?? null,
    sourcePageId: row.sourcePageId ?? null,
    sourcePageLabel: row.sourcePageLabel ?? null
  };
}

/** 全半角、空白、品牌及通用后缀归一；保留材料和型号，避免跨材料误匹配。 */
export function normalizeSystemHint(value: string | null | undefined): string | undefined {
  return value ? normalizeSystemName(value) || undefined : undefined;
}

/** 查询签名仅在运行时比较；旧 top N 不能替代条件变化后的正式查询。 */
export function lookupQuerySignature(query: LookupQueryShape): string {
  const lookup = normalizeThermalLookupQuery(query);
  return JSON.stringify([
    query.systemId ?? null, normalizeSystemHint(query.systemHint) ?? null, query.systemIds ?? null,
    query.schemeId ?? null, query.schemeCode ?? null, query.productSpecId ?? null, query.catalogProductId ?? null,
    query.specClass ?? null, query.thicknessMm ?? null, query.thicknessMin ?? null, query.thicknessMax ?? null, query.preferThinner ?? false,
    query.substrateMaterial ?? null, query.substrateThickness ?? null, query.regionCode ?? null, query.standardLimitId ?? null, query.buildingType ?? null, query.structureType ?? null,
    query.documentIds ?? null, query.knowledgeVersionIds ?? null, query.exclusions ?? null, query.preferences ?? null, query.unresolved ?? null, query.removedFields ?? null, query.removedMetrics ?? null,
    lookup.filters.map((filter) => [filter.metric, filter.targetValue, filter.mode, filter.tolerance ?? null])
  ]);
}

/** 用户语义优先；模型容差无授权时忽略。历史容差只在同指标/模式下继承。 */
function thicknessContext(last?: LastReferenceLookup) {
  const query = last?.query;
  if (!query || query.thicknessMm !== undefined || query.thicknessMin !== undefined || query.thicknessMax !== undefined) return query;
  // 已展示的正式候选提供厚度语义焦点；只供省略解析，不将候选厚度写成查询硬条件。
  const focused = last.candidates?.find(candidate => candidate.thicknessMm != null);
  return focused ? { ...query, thicknessMm: focused.thicknessMm } : query;
}

export function normalizeConversationLookupQuery(input: LookupQueryShape, message: string, lastInput?: LastReferenceLookup, dictionary?: { entities: QueryEntity[]; aliases: QueryAlias[] }) {
  // 生命周期：独立新问题不继承上一轮条件；追问/局部改条件才继承。
  const historyLookup = normalizeThermalLookupQuery(lastInput?.query ?? {});
  const historyMetric = new Set(historyLookup.filters.map((filter) => filter.metric)).size <= 1 ? historyLookup.metric : undefined;
  // 生命周期只看本轮明确指标，不能先用历史补出指标再据此判定新问题。
  const preliminary = parseThermalLookupMessage(message);
  const freshEntities = dictionary ? resolveQueryEntities(message, {}, dictionary.entities, dictionary.aliases) : undefined;
  const signalThickness = parseThermalThicknessMessage(message, thicknessContext(lastInput));
  const lifecycle = classifyQueryLifecycle({
    message,
    hasPrevious: Boolean(lastInput?.query),
    hasNewMetricTarget: preliminary.filters.length > 0,
    hasNewEntity: !!freshEntities && (entityFields.some(field => freshEntities[field] !== undefined) || !!freshEntities.systemIds?.length),
    hasNewCondition: signalThickness.changed || signalThickness.preferThinner,
    hasPreferenceUpdate: signalThickness.preferThinner,
    hasRemoval: preliminary.removedMetrics.length > 0 || signalThickness.remove || /取消|不限制|不用限制|先不看|去掉/.test(message)
  });
  const last = lifecycle === "NEW_QUERY" ? undefined : lastInput;
  if (!last && lastInput) {
    // 模型可能重复旧摘要；NEW_QUERY只重置与旧状态相同的继承值，再由本轮正式名称/原话恢复。
    input = { ...input };
    for (const field of [...entityFields, "systemIds", "thicknessMm", "thicknessMin", "thicknessMax", "preferThinner",
      "preferences", "exclusions", "removedFields", "removedMetrics", "unresolved", "documentIds", "knowledgeVersionIds",
      "filters", "metric", "targetValue", "targetK", "targetR", "mode", "tolerance", "toleranceSource", "requestedTolerance", "effectiveTolerance", "toleranceAdjusted", "conditionTrace"] as const) {
      if (JSON.stringify(input[field]) === JSON.stringify(lastInput.query[field])) Object.assign(input, { [field]: undefined });
    }
  }
  input = dictionary ? resolveQueryEntities(message, input, dictionary.entities, dictionary.aliases, last?.query) : input;
  const suppliedMode = input.mode;
  const previousLookup = normalizeThermalLookupQuery(last?.query ?? {});
  const previousMetric = last ? historyMetric : undefined;
  const thickness = parseThermalThicknessMessage(message, thicknessContext(last));
  // 无数值的热工偏好属于排序；先剥离偏好短语，避免被数值指标 Parser 当成缺目标。
  let metricMessage = message.replace(/(?:K(?:值)?|传热系数)(?:低一点(?:更好)?|越低越好)|(?:产品层?热阻|板自身R|产品R|总热阻|整墙热阻|总R|热阻)(?:高一点(?:更好)?|越高越好)/gi, "");
  const interpretation = interpretThermalQuestion(message, previousMetric);
  if (previousMetric) metricMessage = metricMessage.replace(/差不多(?=\s*\d)/g, "大概");
  if (previousMetric === "PRODUCT_R" || previousMetric === "TOTAL_R") metricMessage = metricMessage.replace(/(^|[,，;；])\s*R(?=\s*[=:≈]?\s*\d)/gi, `$1${previousMetric}`);
  if (last && !thickness.changed) {
    input = { ...input, thicknessMm: last.query.thicknessMm, thicknessMin: last.query.thicknessMin,
      thicknessMax: last.query.thicknessMax, preferThinner: last.query.preferThinner };
  }
  // 活跃厚度的省略追问只更新厚度，不能被裸数字的指标继承误解析。
  const parsed = parseThermalLookupMessage(thickness.changed && !/传热|热阻|总\s*R|产品\s*R|TOTAL_R|PRODUCT_R|\bK\b|K\s*[=≈<>≤≥\d]/i.test(message) ? "" : metricMessage, previousMetric);
  if (last && !parsed.filters.length && !parsed.removedMetrics.length) input = { ...input,
    filters: previousLookup.filters, metric: previousLookup.metric, targetValue: previousLookup.targetValue,
    targetK: last.query.targetK, targetR: last.query.targetR };
  const removedMetrics = [...new Set([...(last?.query.removedMetrics ?? []), ...parsed.removedMetrics])].filter(metric => !parsed.filters.some(filter => filter.metric === metric));
  if (removedMetrics.length) {
    const suppliedMetric = input.metric ?? (input.targetK !== undefined ? "K" : input.targetR !== undefined ? "TOTAL_R" : undefined);
    input = { ...input, filters: input.filters?.filter(filter => !removedMetrics.includes(filter.metric)),
      ...(suppliedMetric && removedMetrics.includes(suppliedMetric) ? { metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined, mode: undefined } : {}) };
  }
  if (!parsed.filters.length && (thickness.changed || parsed.retainedMetrics.length)) {
    input = { ...input, filters: undefined, metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined, mode: undefined };
  }
  const changedFormalCondition = thickness.changed || thickness.preferThinner || parsed.removedMetrics.length > 0 || ([...entityFields, "substrateThickness", "thicknessMm", "thicknessMin", "thicknessMax", "preferThinner"] as const)
    .some((key) => input[key] !== undefined && input[key] !== last?.query[key]);
  const attributeQuestion = /刚才|上一(?:个|轮)|第[一二三四五六七八九十\d]+个|那(?:个|页)|原页|原始页面/.test(message)
    && !changedFormalCondition && !interpretation.needsClarification
    && ["preferences", "exclusions", "documentIds", "knowledgeVersionIds", "removedFields"].every(key => JSON.stringify(input[key as keyof LookupQueryShape]) === JSON.stringify(last?.query[key as keyof ThermalQueryState]))
    && parsed.targetValue === undefined && parsed.tolerance === undefined && inferThermalLookupMode(parsed.modeMessage) === null
    && !/\d+\s*(?:mm|毫米)|(?:I|Ⅱ|Ⅲ|II|III)型|换|改/.test(message);
  if (attributeQuestion && last) {
    return { query: { ...last.query, ...normalizeThermalLookupQuery(last.query) }, lifecycle, conflict: false, attributeQuestion: true, needsClarification: false };
  }
  const metric = parsed.targetValue !== undefined ? parsed.metric : input.metric;
  const resolution = resolveConversationLookupMode(parsed.modeMessage, suppliedMode, last?.query.mode);
  const preferenceSpec = /(?:优先|最好|尽量).*?(?:[ⅠⅡⅢ]|III|II|I|[一二三123])型/i.test(message) ? parseSpecClassHint(message) : undefined;
  const removeSpec = /(?:取消|不限制|先不看|去掉)(?:型号|规格分类)|(?:型号|规格分类)(?:不限|不限制)/.test(message);
  const specClass = removeSpec ? undefined : preferenceSpec ? last?.query.specClass : parseSpecClassHint(message) ?? (dictionary ? input.specClass : last ? last.query.specClass : input.specClass);
  const systemHint = input.systemHint;
  const inherited = inheritLookupQuery({ ...input,
    filters: parsed.filters.length ? parsed.filters : input.filters,
    metric,
    targetValue: parsed.targetValue ?? input.targetValue,
    targetK: parsed.targetValue !== undefined ? undefined : input.targetK,
    targetR: parsed.targetValue !== undefined ? undefined : input.targetR,
    specClass, systemHint, mode: resolution.mode,
    tolerance: parsed.tolerance,
    requestedTolerance: parsed.tolerance
  }, last);
  const previousFilters = previousLookup.filters.map((filter) => filter.toleranceSource === "USER" ? filter
    : normalizeThermalLookupFilter({ metric: filter.metric, targetValue: filter.targetValue, mode: filter.mode, toleranceSource: "DEFAULT" }));
  if (parsed.filters.length || parsed.removedMetrics.length) {
    const updates = parsed.filters.map((filter, index) => {
      const old = previousFilters.find((item) => item.metric === filter.metric);
      const mode = resolveConversationLookupMode(parsed.modeMessages[index], undefined, old?.mode).mode;
      const previous = old?.mode === mode && old.toleranceSource === "USER" ? old : undefined;
      const tolerance = filter.tolerance ?? previous?.tolerance;
      return { ...filter, mode, tolerance,
        requestedTolerance: filter.tolerance ?? previous?.requestedTolerance,
        toleranceSource: tolerance !== undefined ? "USER" as const : "DEFAULT" as const };
    });
    // 对同 metric 局部更新；只有明确再加范围时允许保留该指标的旧边界。
    inherited.filters = previousFilters.filter((old) => !parsed.removedMetrics.includes(old.metric)
      && (parsed.appendRange || !updates.some((next) => next.metric === old.metric)));
    // 保持历史指标顺序，使兼容摘要稳定；新指标追加。
    for (const metric of [...new Set([...previousFilters.map((filter) => filter.metric), ...updates.map((filter) => filter.metric)])]) {
      const own = updates.filter((filter) => filter.metric === metric && !parsed.removedMetrics.includes(metric));
      if (own.length) {
        const position = previousFilters.findIndex((filter) => filter.metric === metric);
        if (!parsed.appendRange && position >= 0) inherited.filters.splice(Math.min(position, inherited.filters.length), 0, ...own);
        else inherited.filters.push(...own);
      }
    }
    // 防止删除条件后被旧单指标摘要或模型重复值复活。
    inherited.metric = undefined; inherited.targetValue = undefined;
    inherited.targetK = undefined; inherited.targetR = undefined;
  } else if (input.filters?.length && !previousFilters.length) {
    const updates = input.filters.map((filter) => {
      const previous = last?.query.filters?.find((old) => old.metric === filter.metric && old.targetValue === filter.targetValue && old.mode === (filter.mode ?? "APPROX"));
      return { metric: filter.metric, targetValue: filter.targetValue, mode: filter.mode ?? "APPROX",
        ...(previous?.toleranceSource === "USER" ? { tolerance: previous.tolerance, requestedTolerance: previous.requestedTolerance, toleranceSource: "USER" as const } : { toleranceSource: "DEFAULT" as const }) };
    });
    inherited.filters = [...previousFilters.filter((old) => !updates.some((next) => next.metric === old.metric)), ...updates];
  } else if (inherited.filters?.length) {
    // 保留既有「精确一点」对整组目标的精度请求；其他无指向的比较/容差不猜指标。
    const singleMetric = new Set(inherited.filters.map((filter) => filter.metric)).size === 1;
    const explicitMode = inferThermalLookupMode(parsed.modeMessage);
    const nextMode = singleMetric ? explicitMode : explicitMode === "EXACT" ? "EXACT" : undefined;
    inherited.filters = inherited.filters.map((filter) => {
      const retainTolerance = filter.toleranceSource === "USER" && (!nextMode || nextMode === filter.mode);
      return normalizeThermalLookupFilter({ ...filter,
        mode: nextMode ?? filter.mode,
        tolerance: (singleMetric ? parsed.tolerance : undefined) ?? (retainTolerance ? filter.tolerance : undefined),
        requestedTolerance: (singleMetric ? parsed.tolerance : undefined) ?? (retainTolerance ? filter.requestedTolerance : undefined),
        toleranceSource: singleMetric && parsed.tolerance !== undefined || retainTolerance ? "USER" : "DEFAULT"
      });
    });
  }
  if (interpretation.needsClarification) inherited.unresolved = [...(inherited.unresolved ?? []).filter(item => item.field !== "metric"), { field: "metric", reason: "请确认产品层热阻 R、整墙总热阻 R₀ 或传热系数 K。" }];
  if (parsed.needsClarification && /或者|或|\bor\b/i.test(message)) inherited.unresolved = [...(inherited.unresolved ?? []).filter(item => item.field !== "relationship"), { field: "relationship", reason: "请确认多个条件是否需要同时满足（AND），当前不支持 OR 查询。" }];
  if (/同时满足|全部满足|都要满足|条件.*AND/i.test(message)) inherited.unresolved = inherited.unresolved?.filter(item => item.field !== "relationship");
  inherited.removedMetrics = removedMetrics;
  for (const field of inherited.removedFields ?? []) Object.assign(inherited, { [field]: undefined });
  if (inherited.removedFields?.includes("systemId")) inherited.systemIds = undefined;
  if (!parsed.needsClarification && !thickness.needsClarification) inherited.unresolved = inherited.unresolved?.filter(item =>
    !(item.field === "metric" && parsed.filters.length > 0) && !(item.field === "query" && (parsed.filters.length > 0 || thickness.changed)));
  if (removeSpec) inherited.specClass = undefined;
  if (preferenceSpec) {
    inherited.specClass = last?.query.specClass;
    inherited.preferences = { ...inherited.preferences, entities: [...(inherited.preferences?.entities ?? []).filter(item => item.field !== "specClass"), { field: "specClass", value: preferenceSpec }] };
  }
  if (thickness.changed) {
    inherited.thicknessMm = thickness.query.thicknessMm;
    inherited.thicknessMin = thickness.query.thicknessMin;
    inherited.thicknessMax = thickness.query.thicknessMax;
  } else if (input.thicknessMm !== undefined) {
    inherited.thicknessMin = undefined; inherited.thicknessMax = undefined;
  } else if (input.thicknessMin !== undefined || input.thicknessMax !== undefined) {
    inherited.thicknessMm = undefined;
  }
  if (thickness.remove) { inherited.preferThinner = undefined; inherited.preferences = { ...inherited.preferences, preferThinner: undefined, preferThicker: undefined }; }
  else if (thickness.preferThinner) inherited.preferThinner = true;
  if (parsed.tolerance === undefined && last?.query.toleranceSource !== "USER") inherited.tolerance = undefined;
  const lookup = normalizeThermalLookupQuery(inherited);
  const invalidTarget = lookup.filters.some((filter) => !Number.isFinite(filter.targetValue) || filter.targetValue <= 0 || filter.targetValue > (filter.metric === "K" ? 10 : 100));
  return {
    query: traceQueryState({ ...inherited, ...lookup, toleranceSource: lookup.filters[0]?.toleranceSource
      ?? (parsed.tolerance !== undefined && parsed.tolerance > 0 || inherited.tolerance !== undefined ? "USER" as const : "DEFAULT" as const) }, last?.query),
    conflict: resolution.conflict,
    attributeQuestion,
    lifecycle,
    needsClarification: interpretation.needsClarification || parsed.needsClarification || thickness.needsClarification || invalidTarget
      || !parsed.filters.length && new Set(previousFilters.map((filter) => filter.metric)).size > 1
        && (parsed.tolerance !== undefined || inferThermalLookupMode(parsed.modeMessage) !== null && inferThermalLookupMode(parsed.modeMessage) !== "EXACT")
  };
}

/**
 * 候选压缩：先按体系提示过滤，再按业务排序结果截断。
 * 顺序必须是「过滤 → 排序（由 matcher 保证）→ limit」，不能先取全局前 N 条再过滤，
 * 否则真实命中会被提前截掉（例如全局前 12 条都不是薄抹灰）。
 */
export function compactCandidateResults(
  rows: CandidateResult[],
  systemHint?: string,
  limit = LOOKUP_LIMIT
): ReferenceLookupCandidate[] {
  const compacted = rows.map(compactCandidateResult);
  return filterCandidatesBySystemHint(compacted, systemHint).slice(0, limit);
}
