import type { LastReferenceLookup } from "./conversation-task.js";
import { normalizeConversationLookupQuery, parseSpecClassHint, type LookupQueryShape } from "./tools/thermal-lookup.js";
import { parseThermalLookupMessage, type ThermalLookupMetric } from "../thermal/thermal-lookup-mode.js";
import { parseThermalThicknessMessage } from "../thermal/thermal-lookup-thickness.js";
import { traceQueryState } from "../thermal/thermal-query-state.js";

/** 参考数据查询规格；不产生目录ID、事实或SQL，不改变数值Parser/Matcher。 */
export function resolveStructuredReferenceQuery(message: string, last?: Pick<LastReferenceLookup, "query" | "candidates"> | null, input: LookupQueryShape = {}) {
  const text = message.normalize("NFKC").trim();
  if (/什么意思|是什么|怎么理解|如何理解|怎么算|计算原理|计算表|重新算|再算|帮我(?:算|计算)|算一下|请计算|计算一下|执行计算|达标|合规|确认方案|加入方案|设为最终/.test(text.replace(/基层是什么/g, ""))) return null;
  // 序号和当前集合比较必须交回只读Resolver，不授权扩页。
  if (/第[一二三四五六七八九十\d]+个|这两个|这些(?:方案|候选)|已选|选中的|保留的/.test(text)) return null;
  const metric = parseThermalLookupMessage(text);
  const comparison = /不同(?:的)?(?:基层|构造)|各(?:种|个)(?:基层|构造)|哪(?:种|个)基层|不同.*(?:基层|构造)/.test(text)
    && /比较|对比|区别|差别|不同|最低|最高|多少/.test(text);
  const codes = text.match(/[A-Z]\d+\s*-\s*\d+/gi) ?? [];
  const sameThickness = /同(?:一|样)(?:的)?厚度|相同厚度/.test(text);
  if (comparison && !metric.metric && !/热工|参数/.test(text) && input.intent !== "REFERENCE_LOOKUP"
    && !(sameThickness && last?.query)) return null;
  const thickness = parseThermalThicknessMessage(text, last?.query);
  const explicitSpec = parseSpecClassHint(text);
  if (!comparison && (metric.filters.length || codes.length > 1 || !codes.length && !explicitSpec && !/系统|体系/.test(text)
    || input.intent !== "REFERENCE_LOOKUP" && !/多少|参数|传热系数|热阻|\bK\b|R[0₀]/i.test(text))) return null;
  if (!thickness.changed && !sameThickness) return null;
  // 名称只是确认结构的文本约束，不以名称推导正式体系ID。
  const head = text.split(/[,，;；。]|(?:外墙)?[A-Z]\d+\s*-\s*\d+|\d+(?:\.\d+)?\s*(?:mm|毫米|厚)/i)[0]!
    .replace(/^(?:请|帮我|查询|查一下|查|同样|相同)\s*/, "").trim();
  const systemHint = /系统|体系/.test(head) || explicitSpec && /型.+/.test(head)
    ? head.replace(/(?:，|的|厚度|构造)\s*$/, "").trim() : undefined;
  const continues = !/新话题|新问题|另一个问题|换个问题/.test(text)
    && (sameThickness || !systemHint && (!explicitSpec || explicitSpec === last?.query.specClass));
  const scope = continues ? last?.query : undefined;
  const queryInput: LookupQueryShape = {
    ...input,
    systemId: input.systemId ?? scope?.systemId, systemIds: input.systemIds ?? scope?.systemIds,
    systemHint: systemHint || input.systemHint || scope?.systemHint,
    specClass: explicitSpec ?? input.specClass ?? scope?.specClass,
    documentIds: input.documentIds ?? scope?.documentIds, knowledgeVersionIds: input.knowledgeVersionIds ?? scope?.knowledgeVersionIds,
    schemeCode: comparison ? undefined : codes[0]?.replace(/\s/g, "").toUpperCase(),
    ...(comparison ? { schemeId: undefined, productSpecId: undefined, catalogProductId: undefined,
      substrateMaterial: undefined, substrateThickness: undefined } : {}),
    filters: metric.filters, metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined,
    thicknessMm: thickness.changed ? thickness.query.thicknessMm : input.thicknessMm ?? scope?.thicknessMm,
    thicknessMin: thickness.changed ? thickness.query.thicknessMin : input.thicknessMin ?? scope?.thicknessMin,
    thicknessMax: thickness.changed ? thickness.query.thicknessMax : input.thicknessMax ?? scope?.thicknessMax
  };
  const bounded = queryInput.thicknessMm != null || queryInput.thicknessMin != null || queryInput.thicknessMax != null;
  if (!bounded) return null;
  // 无目标的指标在此表示读取列；使用已解析厚度，避免“缺目标”与读参数混淆。
  const query = traceQueryState({ ...queryInput, intent: "REFERENCE_LOOKUP", queryMode: continues ? "CONTINUE_QUERY" : "NEW_QUERY", parserSource: "FAST_PATH" });
  const compareMetric: ThermalLookupMetric = /产品(?:层)?热阻|产品R|板自身/i.test(text) ? "PRODUCT_R"
    : /总热阻|总R|R[0₀]|热阻/i.test(text) && !/传热系数|\bK\b/i.test(text) ? "TOTAL_R" : "K";
  const needsClarification = thickness.needsClarification || Boolean(query.unresolved?.length) || /或者|\bor\b/i.test(text)
    || (text.match(/\d+(?:\.\d+)?\s*(?:mm|毫米)/gi)?.length ?? 0) > 1 && query.thicknessMin == null && query.thicknessMax == null
    || comparison && !query.systemId && !query.systemIds?.length && !query.systemHint && !query.specClass;
  return { queryKind: comparison ? "REFERENCE_COMPARISON" as const : "REFERENCE_PARAMETERS" as const,
    compareMetric, order: /最低|最小/.test(text) ? "ASC" as const : /最高|最大/.test(text) ? "DESC" as const : undefined,
    query, needsClarification };
}

/** 只有明确结构化查询才扩页；普通解释和引用追问仍只读命中页。 */
export function confirmedReferenceQuery(message: string, input?: LookupQueryShape) {
  // 已经通过语义/工程字段校验的SSOT不得被旧同步口语路径重新覆盖。
  if (input?.parserSource === "LLM" || input?.applicationPart || input?.roofForm || input?.placement || input?.placements?.length || input?.pageLabel || input?.waterproofGrade || input?.constructionCodes?.length || input?.specClasses?.length || input?.unresolved?.length)
    return { query: input, needsClarification: Boolean(input.unresolved?.length), structured: null,
      authoritative: !input.unresolved?.length && input.intent === "REFERENCE_LOOKUP" && Boolean(input.filters?.length || input.applicationPart || input.roofForm || input.placement || input.placements?.length || input.pageLabel || input.waterproofGrade || input.constructionCodes?.length || input.specClasses?.length || input.schemeCode || input.specClass || input.thicknessMm != null || input.thicknessMin != null || input.thicknessMax != null) };
  const structured = resolveStructuredReferenceQuery(message, undefined, input);
  const normalized = structured ?? (input ? { query: input, needsClarification: Boolean(input.unresolved?.length) } : normalizeConversationLookupQuery({}, message));
  return { ...normalized, structured, authoritative: !normalized.needsClarification
    && (Boolean(structured) || (normalized.query.filters?.length ?? 0) > 0
      || (normalized.query.thicknessMm != null || normalized.query.thicknessMin != null || normalized.query.thicknessMax != null)
        && Boolean(normalized.query.systemHint || normalized.query.systemId || normalized.query.systemIds?.length || normalized.query.specClass || normalized.query.schemeCode || normalized.query.schemeId)) };
}
