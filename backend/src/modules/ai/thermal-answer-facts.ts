import { pageRecognitionResultSchema, type PageRecognitionMetadata } from "../../shared/page-recognition.js";
import { THERMAL_LOOKUP_METRIC_PATTERN, type ThermalLookupMetric } from "../thermal/thermal-lookup-mode.js";
import type { ReferenceLookupCandidate } from "./conversation-task.js";

export const THERMAL_FACT_RULES = [
  "【热工数据硬规则】",
  "厚度、λ、α、产品层热阻 R、外墙主断面总热阻 R₀、传热系数 K、构造、规格和来源必须来自同一条候选记录；每条候选是不可拆开的原子事实。",
  "禁止跨候选合并字段或把离散厚度、修正系数合成连续区间；多个方案必须逐条说明。缺失字段不得从其他候选或 Chunk 补齐、反算。",
  "已确认结构化候选优先于 Chunk / 页面文字；文字只补充说明。冲突时保留候选主事实并说明需核对，不静默合并。",
  "当前候选仅是本次命中范围，不是全量统计；未经工具完整范围统计证明，禁止宣称最高、最低、最大、全部、唯一、没有其他。",
  "产品层热阻 R 与外墙主断面总热阻 R₀ 必须区分；用户问保温板时优先解释产品层 R，总 R 命中不能称为板自身 R 命中。每个数字必须带语义标签及适当单位。",
  "来源页码只使用 pageLabel / sourcePageLabel；physicalPageNumber、pageNumber 是内部物理定位，不可冒充印刷页码。页码缺失时说「当前来源页未记录印刷页码，可直接查看原始页面」。atlasPage / evidenceRef 不代替 pageLabel。",
  "图集参考值与系统计算值分别说明。纯查询不自动作设计结论或固定附工程免责声明；达标、能不能用、审图必须核对正式标准及适用建筑类型，缺少时澄清。",
  "默认销售回答为3～8行：结论、最多一个典型方案、一句解释、最多一个澄清问题。详细、全部、列出来、对比时才展开；未问怎么算、为什么或计算过程，不展开公式。",
  "「传热8.3」「保温系数8.3」「保温板8.3」或无明确对象的「热阻8.3」有指标歧义。数值只能辅助判断，不能猜指标；先区分产品层R、整墙总R和K。有可靠候选可举一个例子再问，否则直接问一个短问题。",
  "APPROX 说接近，EXACT 说正好等于。精确查询未命中只说明当前正式参考数据未找到该已列档位；相邻档位也必须有真实查询证据，允许误差需用户明确给出。"
].join("\n");

/** 回答层术语守卫，不改 Parser/Matcher 的匹配结构。模型猜测不构成指标授权。 */
export function interpretThermalQuestion(message: string, previousMetric?: ThermalLookupMetric) {
  const text = message.normalize("NFKC").replace(/\s+/g, "");
  const explicit = [...text.matchAll(new RegExp(THERMAL_LOOKUP_METRIC_PATTERN))];
  const vague = /(?:传热(?!系数)|保温系数|保温板|热阻R?)[=:≈]?\d+(?:\.\d+)?(?![\d.]|mm|毫米|cm|厘米|元)/i.test(text)
    || /\d+(?:\.\d+)?的?(?:保温板|热阻)/i.test(text);
  const needsClarification = explicit.length === 0 && vague && (!previousMetric || previousMetric === "K" || /传热|保温系数|保温板/.test(text));
  return { needsClarification, metric: needsClarification ? "AMBIGUOUS" as const : previousMetric };
}

export function thermalMetricClarification() {
  return { answerIntent: "REFERENCE_LOOKUP" as const, interpretation: { metric: "AMBIGUOUS" as const, needsClarification: true },
    needsClarification: true, primaryCandidate: null, alternativeCandidates: [], sourcePages: [], warnings: [],
    instruction: "先简短说明板自身热阻与整墙总热阻不同，再只问：你要找保温板自身的产品层热阻 R，还是整墙总热阻 R₀（如果指传热系数 K 请说明）？不要根据8.3猜指标、列无依据方案或声称最高值。" };
}

/** 仅同一来源页、同一构造、同一档位的人工确认快照可补充 λ/α。 */
export function bindConfirmedPageFacts(candidate: ReferenceLookupCandidate, page: {
  pageId: string; documentId: string; pageLabel?: string | null; metadata?: unknown;
}): { candidate: ReferenceLookupCandidate; warnings: string[] } {
  if (candidate.sourcePageId !== page.pageId || candidate.sourceDocumentId && candidate.sourceDocumentId !== page.documentId) {
    return { candidate, warnings: ["候选与来源文档不一致，未合并页面参数。"] };
  }
  // 页面派生参数在每次读取时重新绑定，不能让历史补充参数跨确认版本复活。
  const bound = { ...candidate, lambda: undefined, alpha: undefined, layers: undefined, sourcePageLabel: page.pageLabel?.trim() || null };
  const warnings: string[] = [];
  if (candidate.sourcePageLabel && candidate.sourcePageLabel !== bound.sourcePageLabel) warnings.push("候选页码与当前来源页标签不一致，已采用来源页印刷页码。");
  const metadata = page.metadata as PageRecognitionMetadata | undefined;
  const parsed = pageRecognitionResultSchema.safeParse(metadata?.confirmedStructuredData);
  if (!parsed.success) return { candidate: bound, warnings };
  const systems = parsed.data.systems.filter((system) => (!system.specClass || !candidate.specClass || system.specClass === candidate.specClass)
    && (system.schemeId ? system.schemeId === candidate.schemeId : !!candidate.schemeCode && system.constructionCode === candidate.schemeCode));
  const matches = systems.flatMap((system) => (system.options ?? []).filter((option) =>
    option.thicknessMm === candidate.thicknessMm
    && (!option.productSpecId || option.productSpecId === candidate.productSpecId)
    && (!option.catalogProductId || option.catalogProductId === candidate.catalogProductId)
  ).map((option) => ({ system, option })));
  if (matches.length !== 1) {
    if (systems.length) warnings.push("来源页无法唯一绑定当前构造档位，未合并页面参数。");
    return { candidate: bound, warnings };
  }
  const { system, option } = matches[0]!;
  const keys = ["productThermalResistance", "totalThermalResistance", "kValue"] as const;
  if (keys.some((key) => option[key] == null || candidate[key] == null || Math.abs(option[key]! - candidate[key]!) > 0.00005)) {
    return { candidate: bound, warnings: [...warnings, "来源页确认参数与正式候选冲突，保留正式候选数值，未合并页面参数。"] };
  }
  const productLayers = (system.layers ?? []).filter((layer) => /VICP|保温板/i.test(layer.name));
  return { candidate: { ...bound, layers: system.layers,
    ...(productLayers.length === 1 ? { lambda: productLayers[0]!.lambda ?? undefined, alpha: productLayers[0]!.alpha ?? undefined } : {}) }, warnings };
}
