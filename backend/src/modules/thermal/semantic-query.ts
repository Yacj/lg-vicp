import { z } from "zod";
import { QUERY_LIFECYCLE_MODES } from "./thermal-query-lifecycle.js";
import { normalizeThermalLookupQuery, parseThermalLookupMessage } from "./thermal-lookup-mode.js";
import { entityFields, traceQueryState, type ThermalQueryState } from "./thermal-query-state.js";
import { resolveQueryEntities, type QueryAlias, type QueryEntity } from "./thermal-entity-resolver.js";
import { parseThermalThicknessMessage } from "./thermal-lookup-thickness.js";
import { groundedPageAttribute, pageAttributeFields, confirmedPageReadFieldSchema } from "../../shared/confirmed-page-query.js";

const metricSchema = z.enum(["K", "TOTAL_R", "PRODUCT_R"]);
const operatorSchema = z.enum(["EXACT", "APPROX", "MAX_LIMIT", "MIN_LIMIT"]);
// 单一对象，便于兼容结构化输出网关；null 表示不适用，不允许额外事实字段。
export const semanticConstraintSchema = z.object({
  type: z.enum(["ENTITY", "METRIC", "THICKNESS"]),
  operation: z.enum(["SET", "REMOVE", "APPEND", "EXCLUDE", "REPLACE"]),
  field: z.enum([...entityFields, ...pageAttributeFields, "substrateThickness"]).nullable(),
  entityText: z.string().nullable(),
  resolvedText: z.string().nullable(),
  metric: metricSchema.nullable(), operator: operatorSchema.nullable(), value: z.number().nullable(),
  evidence: z.string().min(1), hard: z.literal(true), confidence: z.number().min(0).max(1)
}).strict();
export const semanticQuerySchema = z.object({
  readFields: z.array(confirmedPageReadFieldSchema).max(7).optional(),
  queryMode: z.enum(QUERY_LIFECYCLE_MODES),
  intent: z.enum(["REFERENCE_LOOKUP", "THERMAL", "COMPLIANCE", "COMPARISON"]),
  constraints: z.array(semanticConstraintSchema).max(24),
  preferences: z.array(z.object({ field: z.enum(["preferThinner", "preferThicker", "preferLowerK", "preferHigherR"]), enabled: z.boolean(), evidence: z.string().min(1) }).strict()).max(8),
  unresolved: z.array(z.object({ field: z.string(), reason: z.string() }).strict()).max(12),
  confidence: z.number().min(0).max(1)
}).strict();
export type SemanticQuery = z.infer<typeof semanticQuerySchema>;
export type SemanticDictionary = { entities: QueryEntity[]; aliases: QueryAlias[] };

/** 只归一格式，不选择指标、模式或业务实体。 */
export function normalizeSemanticText(message: string): string {
  return message.normalize("NFKC").replace(/R₀/gi, "R0").replace(/㎡/g, "m²")
    .replace(/m2/g, "m²").replace(/[⋅・]/g, "·").replace(/[，；：]/g, ch => ({ "，": ",", "；": ";", "：": ":" })[ch]!)
    .replace(/\s+/g, " ").trim();
}

export function describeNumberRoles(message: string) {
  const text = normalizeSemanticText(message);
  return [...text.matchAll(/\d+(?:\.\d+)?/g)].map(match => ({ raw: match[0], index: match.index,
    role: semanticNumberRole(text, match[0], match.index) }));
}

function semanticNumberRole(text: string, raw: string, index: number): string {
  const before = text.slice(0, index), after = text.slice(index + raw.length);
  if (/^\s*(?:mm|cm|毫米|厘米|公分)\b/i.test(after) || /^\s*(?:毫米|厘米|公分|厚)/.test(after)) return "THICKNESS";
  if (/(?:第|page|p\.)\s*$/i.test(before)) return "PAGE_NUMBER";
  if (/(?:\bK|PRODUCT_R|TOTAL_R|R0)\s*$/i.test(before)) return "THERMAL_TARGET";
  if (/(?:[a-z][a-z0-9_-]*|[-_/])$/i.test(before)) return "SCHEME_CODE_PART";
  if (/^(?:19|20)\d{2}$/.test(raw)) return "YEAR";
  if (/^\s*(?:个|条|款|种|组|张|块|元)/.test(after)) return "COUNT";
  return "UNKNOWN";
}

/** 仅完整、无剩余语言的符号表达直接跳过模型。口语交给分类模型。 */
export function parseSemanticFastPath(message: string): SemanticQuery | null {
  const text = normalizeSemanticText(message);
  if (!/^(?:(?:K|TOTAL_R|PRODUCT_R|R0)\s*(?:<=|>=|<|>|=|≈|≤|≥)\s*\d+(?:\.\d+)?\s*)(?:[,;]\s*(?:K|TOTAL_R|PRODUCT_R|R0)\s*(?:<=|>=|<|>|=|≈|≤|≥)\s*\d+(?:\.\d+)?\s*)*$/i.test(text)) return null;
  const constraints: SemanticQuery["constraints"] = [];
  for (const match of text.matchAll(/(K|TOTAL_R|PRODUCT_R|R0)\s*(<=|>=|<|>|=|≈|≤|≥)\s*(\d+(?:\.\d+)?)/gi)) {
    const token = match[1]!.toUpperCase();
    constraints.push({ type: "METRIC", operation: "SET", field: null, entityText: null, resolvedText: null,
      metric: token === "R0" ? "TOTAL_R" : token as "K" | "TOTAL_R" | "PRODUCT_R",
      operator: /^(?:<|≤)/.test(match[2]!) ? "MAX_LIMIT" : /^(?:>|≥)/.test(match[2]!) ? "MIN_LIMIT" : match[2] === "=" ? "EXACT" : "APPROX",
      value: Number(match[3]), evidence: match[0], hard: true, confidence: 1 });
  }
  return { queryMode: "NEW_QUERY", intent: "REFERENCE_LOOKUP", constraints, preferences: [], unresolved: [], confidence: 1 };
}

/** 数字必须来自用户证据，不能把页码/年份/构造编号当指标。允许确定性的 cm→mm。 */
function groundedValue(constraint: SemanticQuery["constraints"][number]): boolean {
  const numbers = [...constraint.evidence.matchAll(/\d+(?:\.\d+)?/g)].filter(match => {
    const role = semanticNumberRole(constraint.evidence, match[0], match.index);
    return !["PAGE_NUMBER", "SCHEME_CODE_PART", "YEAR", "COUNT"].includes(role)
      && (constraint.type !== "METRIC" || role !== "THICKNESS");
  });
  return numbers.some(match => Number(match[0]) * (constraint.type === "THICKNESS" && /^\s*(?:cm|厘米|公分)/i.test(constraint.evidence.slice(match.index + match[0].length)) ? 10 : 1) === constraint.value);
}

/** 语义只改变查询条件，实体必须再次验证目录；模型不输出正式 ID 或业务数值。 */
export function applySemanticQuery(message: string, semanticInput: unknown, dictionary: SemanticDictionary, previous?: ThermalQueryState): ThermalQueryState {
  const semantic = semanticQuerySchema.parse(semanticInput);
  const text = normalizeSemanticText(message);
  let query: ThermalQueryState = semantic.queryMode === "NEW_QUERY" ? {} : { ...previous };
  query = { ...query, intent: semantic.intent, unresolved: [...semantic.unresolved],
    readFields: semantic.readFields?.length ? semantic.readFields : semantic.queryMode === "NEW_QUERY" ? undefined : previous?.readFields };
  const reject = (field: string, reason: string) => { query.unresolved = [...(query.unresolved ?? []), { field, reason }]; };
  if (semantic.confidence < 0.75) reject("query", "这句话有不同理解，请确认查询条件。");
  const updatedMetrics = new Set<string>();
  let changedSpec: string | undefined;
  let changedCode: string | undefined;
  const changedPageAttributes = new Map<string, string>();
  // 先定位体系，再在体系内消解重复构造编号，不能依赖模型数组顺序。
  const constraints = [...semantic.constraints].sort((a, b) => Number(b.type === "ENTITY" && b.field === "systemId") - Number(a.type === "ENTITY" && a.field === "systemId")
    || Number((a.field === "schemeCode" || a.field === "specClass" || a.field === "placement") && a.operation === "APPEND") - Number((b.field === "schemeCode" || b.field === "specClass" || b.field === "placement") && b.operation === "APPEND"));
  for (const constraint of constraints) {
    const evidence = normalizeSemanticText(constraint.evidence);
    if (!text.includes(evidence) || constraint.confidence < 0.75) { reject("query", "部分条件的语义或依据不明确，请确认。"); continue; }
    if (constraint.type === "ENTITY") {
      if (constraint.field && (pageAttributeFields as readonly string[]).includes(constraint.field)) {
        const field = constraint.field as typeof pageAttributeFields[number];
        const literal = constraint.entityText;
        if (!literal || !evidence.includes(normalizeSemanticText(literal))) { reject(field, "构造属性缺少原话依据。"); continue; }
        const value = groundedPageAttribute(field, literal);
        if (!value) { reject(field, "构造属性或印刷页码未能核验，请明确原文。"); continue; }
        if (field === "placement" && constraint.operation === "APPEND") {
          query.placements = [...new Set([...(query.placements ?? []), ...(query.placement ? [query.placement] : []), value as "UPRIGHT" | "INVERTED"])];
          query.placement = undefined;
          continue;
        }
        if (constraint.operation === "REMOVE") {
          Object.assign(query, { [field]: undefined });
          if (field === "placement") query.placements = undefined;
        }
        else if (constraint.operation === "SET") {
          if (changedPageAttributes.has(field) && changedPageAttributes.get(field) !== value) reject(field, "多个不同属性不能互相覆盖，请明确分别查询或保留全部对象。");
          else { changedPageAttributes.set(field, value); Object.assign(query, { [field]: value }); if (field === "placement") query.placements = undefined; }
        }
        else reject(field, "多个不同构造属性不能收窄为任意一个值，请分别查询或保留全部对象。");
        continue;
      }
      if (constraint.field === "substrateThickness") { reject("substrateThickness", "基层厚度应作为数值条件解析。"); continue; }
      if (!constraint.field || !constraint.entityText || !evidence.includes(normalizeSemanticText(constraint.entityText))) { reject("entity", "指定对象缺少原话依据。"); continue; }
      const term = constraint.resolvedText ?? constraint.entityText;
      // 自然描述可映射到目录名称，但不能凭空建立新的名称/ID。
      const resolved = resolveQueryEntities(term, {}, dictionary.entities.filter(entity => entity.field === constraint.field), dictionary.aliases, query);
      const field = constraint.field as typeof entityFields[number];
      if (constraint.operation === "REMOVE") {
        Object.assign(query, { [field]: undefined });
        query.removedFields = [...new Set([...(query.removedFields ?? []), field])];
        if (field === "specClass") query.specClasses = undefined;
        if (field === "schemeCode") query.constructionCodes = undefined;
        if (field === "systemId") { query.systemIds = undefined; query.systemHint = undefined; }
        continue;
      }
      // 名称提示及强格式编码只是硬筛选条件，不签发正式目录ID；事实仍从确认来源匹配。
      if (constraint.operation === "SET" && field === "systemHint") {
        query.systemHint = constraint.entityText;
        const named = resolveQueryEntities(constraint.entityText, {}, dictionary.entities, dictionary.aliases);
        query.systemId = named.systemId; query.systemIds = named.systemIds;
        continue;
      }
      if (constraint.operation === "SET" && field === "schemeCode" && /^[A-Z]{1,4}\d+(?:-\d+)+$/i.test(constraint.entityText)) {
        if (changedCode && changedCode !== constraint.entityText.toUpperCase()) { reject("schemeCode", "多个构造编码须明确并列，不能用后一个覆盖前一个。"); continue; }
        changedCode = constraint.entityText.toUpperCase();
        query.schemeCode = constraint.entityText.toUpperCase(); query.schemeId = undefined;
        query.constructionCodes = undefined;
        continue;
      }
      if (constraint.operation === "APPEND" && field === "schemeCode" && /^[A-Z]{1,4}\d+(?:-\d+)+$/i.test(constraint.entityText)) {
        query.constructionCodes = [...new Set([...(query.constructionCodes ?? []), ...(query.schemeCode ? [query.schemeCode] : []), constraint.entityText.toUpperCase()])];
        query.schemeCode = undefined; query.schemeId = undefined;
        continue;
      }
      if ((constraint.operation === "SET" || constraint.operation === "APPEND") && field === "specClass") {
        const token = normalizeSemanticText(constraint.entityText).replace(/\s/g, "").replace(/型$/, "").toUpperCase();
        const classes: Partial<Record<string, "I" | "II" | "III">> = { I: "I", II: "II", III: "III", "1": "I", "2": "II", "3": "III", 一: "I", 二: "II", 三: "III" };
        const specClass = classes[token];
        if (specClass) {
          if (constraint.operation === "APPEND") {
            query.specClasses = [...new Set([...(query.specClasses ?? []), ...(query.specClass ? [query.specClass] : []), specClass])];
            query.specClass = undefined; query.productSpecId = undefined; query.catalogProductId = undefined;
            continue;
          }
          if (changedSpec && changedSpec !== specClass) { reject("specClass", "多个型号须明确并列，不能用后一个覆盖前一个。"); continue; }
          changedSpec = specClass;
          query.specClasses = undefined;
          if (query.specClass !== specClass) { query.productSpecId = undefined; query.catalogProductId = undefined; }
          query.specClass = specClass;
          continue;
        }
      }
      const value = resolved[field];
      if (field === "catalogProductId" && constraint.operation === "SET") {
        const named = resolveQueryEntities(constraint.entityText, {}, dictionary.entities.filter(entity => entity.field === field), dictionary.aliases);
        if (named.catalogProductId !== value) { reject(field, "产品目录身份须由原话正式名称或已配置别名定位，不能以泛称收窄图集型号范围。"); continue; }
      }
      if ((!value && !resolved.systemIds?.length) || resolved.unresolved?.length) { reject(field, "指定对象对应多个记录或未匹配正式目录，请确认具体对象。"); continue; }
      if (constraint.operation === "EXCLUDE") {
        query.exclusions = [...(query.exclusions ?? []), ...(resolved.systemIds ?? (value ? [value] : [])).map(id => ({ field, value: id }))];
      } else {
        query = { ...query, ...resolved, unresolved: query.unresolved };
        query.removedFields = query.removedFields?.filter(item => item !== field);
      }
      continue;
    }
    if (constraint.type === "METRIC" && constraint.metric) {
      if (constraint.operation === "REMOVE") {
        query.filters = normalizeThermalLookupQuery(query).filters.filter(filter => filter.metric !== constraint.metric);
        query.removedMetrics = [...new Set([...(query.removedMetrics ?? []), constraint.metric])];
      } else if (constraint.operator && constraint.value != null && groundedValue(constraint)
        && constraint.value > 0 && constraint.value <= (constraint.metric === "K" ? 10 : 100)) {
        if (constraint.operation === "REPLACE") {
          query.filters = query.filters?.filter(filter => updatedMetrics.has(filter.metric)) ?? [];
          query.metric = undefined; query.targetValue = undefined; query.targetK = undefined; query.targetR = undefined;
        }
        const filters = normalizeThermalLookupQuery(query).filters;
        query.filters = filters.filter(filter => constraint.operation === "APPEND" || updatedMetrics.has(constraint.metric!) || filter.metric !== constraint.metric);
        // 明确符号比较优先于模型分类；容差仍只从原话规则提取。
        const symbolic = [...evidence.matchAll(/(K|TOTAL_R|PRODUCT_R|R0)\s*(<=|>=|<|>|=|≈|≤|≥)\s*(\d+(?:\.\d+)?)/gi)]
          .flatMap(match => parseSemanticFastPath(match[0])?.constraints ?? []).find(item => item.metric === constraint.metric && item.value === constraint.value);
        const mode = symbolic?.operator ?? constraint.operator;
        const previousTolerance = filters.find(item => item.metric === constraint.metric && item.mode === mode && item.toleranceSource === "USER");
        const tolerance = parseThermalLookupMessage(evidence).filters.find(item => item.metric === constraint.metric)?.tolerance ?? previousTolerance?.tolerance;
        query.filters.push({ metric: constraint.metric, targetValue: constraint.value, mode, tolerance,
          toleranceSource: tolerance === undefined ? "DEFAULT" : "USER" });
        query.removedMetrics = query.removedMetrics?.filter(metric => metric !== constraint.metric);
        updatedMetrics.add(constraint.metric);
      } else reject("metric", "指标目标值缺少可靠依据，请确认。");
      query.metric = undefined; query.targetValue = undefined; query.targetK = undefined; query.targetR = undefined;
      continue;
    }
    if (constraint.type === "THICKNESS") {
      if (constraint.field === "substrateThickness") {
        if (constraint.operation === "REMOVE") query.substrateThickness = undefined;
        else if (constraint.operator === "EXACT" && constraint.value != null && constraint.value > 0 && constraint.value <= 2000 && groundedValue(constraint)) query.substrateThickness = constraint.value;
        else reject("substrateThickness", "请确认明确的基层厚度，基层厚度不能作为保温厚度范围。");
        continue;
      }
      if (constraint.operation === "REMOVE") {
        if (constraint.operator === "MAX_LIMIT") query.thicknessMax = undefined;
        else if (constraint.operator === "MIN_LIMIT") query.thicknessMin = undefined;
        else if (constraint.operator === "EXACT") query.thicknessMm = undefined;
        else {
          query.thicknessMm = undefined; query.thicknessMin = undefined; query.thicknessMax = undefined;
          query.preferThinner = undefined; query.preferences = { ...query.preferences, preferThinner: undefined, preferThicker: undefined };
        }
        continue;
      }
      if (constraint.value == null || constraint.value <= 0 || constraint.value > 1000 || !groundedValue(constraint)) { reject("thickness", "厚度缺少可靠依据，请确认。"); continue; }
      if (constraint.operator === "MAX_LIMIT") { query.thicknessMm = undefined; query.thicknessMax = constraint.value; }
      else if (constraint.operator === "MIN_LIMIT") { query.thicknessMm = undefined; query.thicknessMin = constraint.value; }
      else if (constraint.operator === "EXACT") { query.thicknessMm = constraint.value; query.thicknessMin = undefined; query.thicknessMax = undefined; }
      else reject("thickness", "请选择明确的厚度档或厚度范围。");
      continue;
    }
    reject("query", "条件类型与字段不一致，请确认。");
  }
  for (const preference of semantic.preferences) {
    if (!text.includes(normalizeSemanticText(preference.evidence))) { reject("preference", "偏好缺少原话依据。"); continue; }
    query.preferences = { ...query.preferences, [preference.field]: preference.enabled };
    if (preference.field === "preferThinner") query.preferThinner = preference.enabled;
  }
  if (/或者|\bor\b/i.test(text)) reject("relationship", "请确认多个条件是否需要同时满足，当前不支持OR查询。");
  // 目录中明确命中的硬实体不能被模型省略或收窄为任意一条记录。
  // 已由原话连续证据核验的体系文本是只读硬筛选条件；目录没有该体系不等于不能查确认页。
  // 不让旧的局部族名建议再把完整systemHint改为“未映射”，也不据此签发目录ID。
  const explicitEntities = resolveQueryEntities(text, query.systemHint ? { systemHint: query.systemHint } : {}, dictionary.entities, dictionary.aliases);
  for (const unresolved of explicitEntities.unresolved ?? []) reject(unresolved.field, unresolved.reason);
  for (const field of entityFields) {
    const expected = explicitEntities[field];
    if (field === "specClass" && expected && query.specClasses?.some(value => value === expected)) continue;
    if (expected !== undefined && query[field] !== expected) reject(field, "明确指定的对象未被完整保留，请确认。");
  }
  if (explicitEntities.systemIds?.length) {
    // 无型号的族查询不得被模型收窄；明确型号允许同族的具体体系定位。
    const specific = query.systemId && explicitEntities.systemIds.includes(query.systemId)
      && explicitEntities.specClass !== undefined && query.specClass === explicitEntities.specClass;
    if (!specific && (query.systemIds?.length !== explicitEntities.systemIds.length || !explicitEntities.systemIds.every(id => query.systemIds?.includes(id))))
      reject("systemId", "指定体系族未被完整保留，请确认。");
  }
  for (const exclusion of explicitEntities.exclusions ?? []) {
    if (!query.exclusions?.some(item => item.field === exclusion.field && item.value === exclusion.value))
      reject(`exclude:${exclusion.field}`, "明确排除的对象未被保留，请确认。");
  }
  const explicitThickness = parseThermalThicknessMessage(text, previous);
  if (explicitThickness.changed && !explicitThickness.remove && !explicitThickness.needsClarification) {
    for (const field of ["thicknessMm", "thicknessMin", "thicknessMax"] as const) {
      if (explicitThickness.query[field] !== undefined && query[field] !== explicitThickness.query[field]) reject(field, "明确的厚度条件未被完整保留，请确认。");
    }
  }
  // 可确定绑定的原话条件不能被分类模型漏掉。
  for (const filter of parseThermalLookupMessage(text).filters) {
    if (!semantic.constraints.some(item => item.type === "METRIC" && item.metric === filter.metric && item.value === filter.targetValue))
      reject("metric", "部分明确指标条件未被完整解析，请确认。");
  }
  return traceQueryState({ ...query, ...normalizeThermalLookupQuery(query), queryMode: semantic.queryMode, semanticConfidence: semantic.confidence }, semantic.queryMode === "NEW_QUERY" ? undefined : previous);
}
