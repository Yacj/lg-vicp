import { resolveCandidateMaterialReference } from "./reference-candidate-selection.js";
import { parseSolutionActionFastPath } from "./solution-action-semantic.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { parseThermalThicknessMessage } from "../thermal/thermal-lookup-thickness.js";
import type { LastReferenceLookup } from "./conversation-task.js";

export const DOMAIN_INTENTS = ["GENERAL", "KNOWLEDGE_EXPLAIN", "PRODUCT_DISCOVERY", "PRODUCT_DETAIL",
  "REFERENCE_QUERY", "REFERENCE_REFINE", "REFERENCE_VIEW", "REFERENCE_DETAIL", "THERMAL_CALCULATE",
  "COMPLIANCE_CHECK", "MATERIAL_COMPARE", "COMPARE_CANDIDATES", "SOLUTION_ACTION", "REPORT_REQUEST", "CLARIFY"] as const;
export type DomainIntent = typeof DOMAIN_INTENTS[number];
export interface DomainTurnDecision {
  intent: DomainIntent;
  mutation: "NONE" | "QUERY" | "SOLUTION" | "CALCULATE" | "REPORT";
  referenceScope?: "LATEST_VISIBLE" | "CURRENT_SELECTED";
  evidenceSpans: string[];
  parserSource?: "FAST_PATH" | "LLM" | "UNAVAILABLE";
  unresolved?: string[];
}
export function domainDecision(intent: DomainIntent, evidence: string): DomainTurnDecision {
  return { intent, mutation: intent === "SOLUTION_ACTION" ? "SOLUTION"
    : intent === "THERMAL_CALCULATE" ? "CALCULATE" : intent === "REPORT_REQUEST" ? "REPORT"
    : intent === "REFERENCE_QUERY" || intent === "REFERENCE_REFINE" ? "QUERY" : "NONE",
    evidenceSpans: evidence ? [evidence] : [], parserSource: "FAST_PATH",
    ...(["REFERENCE_VIEW", "REFERENCE_DETAIL", "COMPARE_CANDIDATES"].includes(intent)
      ? { referenceScope: /已选|选中的|保留的/.test(evidence) ? "CURRENT_SELECTED" as const : "LATEST_VISIBLE" as const } : {}) };
}
/** 仅识别完整目标表达；单独领域名词不授权查询、计算或方案写入。开放表达由受控分类器处理。 */
export function decideDomainTurn(message: string, last?: Pick<LastReferenceLookup, "query" | "candidates"> | null): DomainTurnDecision {
  const text = message.normalize("NFKC").trim();
  const hasReference = /第[一二三四五六七八九十\d]+个|[A-Z]\d+-\d+|这个(?:方案|数据|数值|参数|做法|K)|这些|那个|已选|选中的|刚才/i.test(text);
  if (parseSolutionActionFastPath(text)) return domainDecision("SOLUTION_ACTION", text);
  if (/什么意思|是什么意思|是什么|怎么理解|如何理解|计算原理|怎么算|怎么(?:把|加入|保留|选择)|如何(?:加入|保留|选择)/.test(text) && !/重新算|帮我算|算一下/.test(text))
    return domainDecision(hasReference && last ? "REFERENCE_DETAIL" : "KNOWLEDGE_EXPLAIN", text);
  if (/(?:K值?|R[0₀]?|传热系数|热阻).*(?:越.*(?:好|差)|一定.*(?:省钱|更好))/i.test(text) && !/查|找|筛选|给我|推荐/.test(text)) return domainDecision("KNOWLEDGE_EXPLAIN", text);
  const metric = parseThermalLookupMessage(text);
  const thickness = parseThermalThicknessMessage(text, last?.query);
  // 指标之间的概念关系先于缺数值查询；候选对象仍由引用Resolver区分。
  const comparative = /比较|对比|区别|差别|差在哪|不同|哪个好|哪种更好|哪个更好/.test(text);
  if (comparative && metric.metric && !hasReference && !metric.filters.length
    && !resolveCandidateMaterialReference(last?.candidates ?? [], text) && !/同(?:一|样)|相同/.test(text)) return domainDecision("KNOWLEDGE_EXPLAIN", text);

  if (last && metric.removedMetrics.length) return domainDecision("REFERENCE_REFINE", text);
  if (last && /条件|限制/.test(text) && (thickness.changed || metric.removedMetrics.length || /保留|不限制/.test(text))) return domainDecision("REFERENCE_REFINE", text);
  if (last && thickness.changed && /改为|改成|放宽|收紧|取消|去掉|调到/.test(text) && !/重新算|再算|帮我算/.test(text)) return domainDecision("REFERENCE_REFINE", text);
  const solution = /(?:留下|留着|保留|选定|选中|加入(?:方案)?|添加到方案|加进|做方案|移除|撤掉|不要了|删除.*方案|设为最终|作为最终|最终选|最终.*要|确认一下|确认最终方案|确认方案|开始(?:新)?方案|重新开始方案|修订(?:方案)?)/.test(text);
  if (solution && /(?:比较|对比)/.test(text) && !/保留.*冲突|冲突.*保留/.test(text))
    return { ...domainDecision("CLARIFY", text), unresolved: ["这轮要先比较，还是修改已选方案？"] };
  if (solution) return domainDecision("SOLUTION_ACTION", text);
  if (/^(?:你好|您好|嗨|哈喽|在吗|hello|hi)[！!。.?？\s]*$/i.test(text)) return domainDecision("GENERAL", text);
  if (/(?:什么意思|是什么意思|是什么|怎么理解|如何理解|计算原理|怎么算)/.test(text) && !/重新算|帮我算|算一下/.test(text))
    return domainDecision(hasReference && last ? "REFERENCE_DETAIL" : "KNOWLEDGE_EXPLAIN", text);
  if (/(?:达标|合规|是否符合|是否满足|符合哪个标准|满足要求|符合.*(?:标准|规范|要求)|能不能用|可以用吗|够不够|(?:送审|审图|验收).*(?:能不能过|能否通过|可以通过))/.test(text)) return domainDecision("COMPLIANCE_CHECK", text);
  if (/(?:重新(?:算|计算)|再算|帮我(?:算|计算)|算一下|请计算|计算一下|执行计算|如果厚度改为)/.test(text)) return domainDecision("THERMAL_CALCULATE", text);

  if (comparative && (hasReference || last && /方案|这两个|同(?:一|样)|相同/.test(text))) return domainDecision("COMPARE_CANDIDATES", text);
  if (!hasReference && !metric.filters.length && /节点|施工|热桥|计算表|(?:洞口|阴阳角|节点).*?(?:处理|做法|怎么)/.test(text)) return domainDecision("KNOWLEDGE_EXPLAIN", text);
  if (metric.filters.length && /有哪些|有没有|给我几|几套|几种|几条|找.*(?:做法|方案)/.test(text)) return domainDecision("REFERENCE_QUERY", text);
  if (!last && /[A-Z]\d+-\d+/i.test(text) && /参数|原表|原页|传热系数|K值|热阻/i.test(text)) return domainDecision("REFERENCE_QUERY", text);
  if (/(?:原(?:页|表)|完整(?:参数|热工)?(?:表格|表)|来源.*(?:哪|页)|(?:哪|那)(?:一)?页|从哪里来|数据出处)/.test(text) && (hasReference || last)) return domainDecision("REFERENCE_VIEW", text);
  if (/(?:参数|详细数据|导热系数|修正系数|K和总R是多少)/.test(text) && hasReference && last) return domainDecision("REFERENCE_DETAIL", text);
  if (last?.candidates.length && !metric.filters.length && !/改|取消|放宽|筛选|有哪些/.test(text) && resolveCandidateMaterialReference(last.candidates, text)) return domainDecision("REFERENCE_DETAIL", text);
  if (hasReference && last && !metric.filters.length && !thickness.changed && /传热系数|热阻|[kr]值?|厚度|导热|修正系数/i.test(text)) return domainDecision("REFERENCE_DETAIL", text);
  if (last && metric.metric && metric.targetValue == null && !metric.filters.length && !metric.removedMetrics.length && !metric.retainedMetrics.length
    && !thickness.changed) return { ...domainDecision("CLARIFY", text), unresolved: ["你想设置新的热工指标目标值，还是查看当前候选的该项参数？"] };
  if (last && (thickness.changed || thickness.preferThinner || metric.removedMetrics.length || /再薄一点|刷新方案|两个(?:条件)?都要|同时满足/.test(text))) return domainDecision("REFERENCE_REFINE", text);
  if (last && /(?:改为|改成|放宽|收紧|调到|取消|去掉)|(?:那|只要).*\d+\s*(?:mm|毫米|以内|以上)/i.test(text)) return domainDecision("REFERENCE_REFINE", text);
  if (/(?:生成|出一份|制作).*报告/.test(text)) return domainDecision("REPORT_REQUEST", text);
  if (metric.filters.length || metric.needsClarification || /(?:传热|保温板|热阻|总R|产品R|K值)[^。？]{0,20}\d/i.test(text)
    || !last && /[A-Z]\d+-\d+[^。？]{0,15}\d+\s*(?:mm|毫米)/i.test(text)) return domainDecision("REFERENCE_QUERY", text);
  if (last && /(?:换|改|那).*(?:规格|型号|体系|系统)|^[I]{1,3}型|\d+\s*(?:mm|毫米)的/i.test(text)) return domainDecision("REFERENCE_REFINE", text);
  if (/查已有参考档位|刷新方案/.test(text)) return domainDecision(last ? "REFERENCE_REFINE" : "REFERENCE_QUERY", text);
  if (/(?:有哪些|有什么|找|筛选|推荐|选用表|参考表)/.test(text) && /(?:\d|保温方案|构造|档位)/.test(text)
    || /(?:K|R[0₀]?|传热系数|热阻)\s*[=≈≥≤]?\s*\d/i.test(text)) return domainDecision("REFERENCE_QUERY", text);
  if (/(?:有哪些|都有什么|有什么(?:产品|板|类型|型号))/.test(text) && /产品|保温板|[IⅢⅡⅠ]+型/i.test(text)) return domainDecision("PRODUCT_DISCOVERY", text);
  if (/(?:有没有|给我|能给我).*(?:几个|几套|方案)|(?:几个|几套).*做法.*选/.test(text)) return domainDecision("REFERENCE_QUERY", text);
  if (/节点|做法|施工|热桥|图集|计算表/.test(text)) return domainDecision("KNOWLEDGE_EXPLAIN", text);
  return domainDecision("GENERAL", text);
}
export const isReferenceRead = (decision: DomainTurnDecision) => decision.intent === "REFERENCE_VIEW" || decision.intent === "REFERENCE_DETAIL";
