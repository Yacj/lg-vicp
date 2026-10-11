import { isDeepStrictEqual } from "node:util";
import type { Check, Observation, UatExpect, FailureType } from "../schema.js";
import type { LastReferenceLookup, ReferenceLookupCandidate } from "../../../src/modules/ai/conversation-task.js";
import { REFERENCE_FACTS } from "../fixtures/facts.js";
import { THERMAL_LOOKUP_RULES } from "../../../src/modules/thermal/thermal-lookup-mode.js";

/** USER_SELECTION属于真实用户可见回答，不能将正确的结构化澄清误判为空文字。 */
export function visibleAnswer(actual: Observation): string {
  const waiting = actual.events.find(event => event.event === "waiting_user_input");
  return [actual.message.content, waiting?.data.title, waiting?.data.prompt].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n");
}

export function matchesPartial(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => matchesPartial(actual[index], value));
  if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected).every(([key, value]) => matchesPartial((actual as Record<string, unknown>)[key], value));
  return isDeepStrictEqual(actual, expected);
}
const metricValue = (row: Partial<ReferenceLookupCandidate>, metric: "K" | "TOTAL_R" | "PRODUCT_R") => metric === "K" ? row.kValue : metric === "TOTAL_R" ? row.totalThermalResistance : row.productThermalResistance;
export function satisfies(row: Partial<ReferenceLookupCandidate>, query: LastReferenceLookup["query"]): boolean {
  if (query.thicknessMm !== undefined && row.thicknessMm !== query.thicknessMm) return false;
  if (query.thicknessMin !== undefined && (row.thicknessMm === undefined || row.thicknessMm < query.thicknessMin)) return false;
  if (query.thicknessMax !== undefined && (row.thicknessMm === undefined || row.thicknessMm > query.thicknessMax)) return false;
  if (query.specClass && row.specClass !== query.specClass) return false;
  for (const key of ["systemId", "schemeId", "schemeCode", "productSpecId", "catalogProductId"] as const) if (query[key] && query[key] !== row[key]) return false;
  return (query.filters ?? []).every(filter => {
    const value = metricValue(row, filter.metric);
    if (value === undefined) return false;
    if (filter.mode === "MAX_LIMIT") return value <= filter.targetValue;
    if (filter.mode === "MIN_LIMIT") return value >= filter.targetValue;
    const tolerance = filter.mode === "EXACT" ? THERMAL_LOOKUP_RULES[filter.metric].epsilon
      : filter.toleranceSource === "USER" ? Math.min(filter.requestedTolerance ?? THERMAL_LOOKUP_RULES[filter.metric].approximate, THERMAL_LOOKUP_RULES[filter.metric].maximum) : THERMAL_LOOKUP_RULES[filter.metric].approximate;
    return Math.abs(value - filter.targetValue) <= tolerance + Number.EPSILON;
  });
}

/** 只比较真实持久化元数据/候选/计算快照；禁止重新跑Parser代替实际Backend决策。 */
export function assertObservation(expect: UatExpect, actual: Observation, previous?: Observation): Check[] {
  const checks: Check[] = [];
  const add = (group: Check["group"], passed: boolean, type: FailureType, detail: string, hard = false) => checks.push({ group, passed, type, detail, hard });
  const decision = actual.message.metadata?.backendDecision as Record<string, unknown> | undefined;
  add("intent", decision?.intent === expect.intent, "ROUTING", `预期intent=${expect.intent}，实际=${String(decision?.intent)}`);
  if (expect.taskType) add("intent", decision?.taskType === expect.taskType, "ROUTING", "任务类型一致");
  add("intent", actual.tools.every(tool => tool.success && tool.outputJson?.ok !== false), "RETRIEVAL", "本轮工具调用均成功，不能将业务失败当作可用结果");
  if (expect.toolsAny.length) add("intent", actual.tools.some(tool => expect.toolsAny.includes(tool.toolName as never) && tool.success), "ROUTING", `本轮实际工具须包含 ${expect.toolsAny.join(" / ")}`);
  if (expect.operation) add("intent", actual.tools.some(tool => tool.toolName === "thermal" && tool.inputJson?.operation === expect.operation && tool.success), "ROUTING", `热工操作=${expect.operation}`);
  const lookup = actual.task.lastReferenceLookup;
  if (expect.query) add("parameters", matchesPartial(lookup?.query, expect.query), "PARSER", "会话权威条件与预期相同（含明确清除的字段）", true);
  if (expect.inheritPreviousFilters) add("state", matchesPartial(lookup?.query.filters, previous?.task.lastReferenceLookup?.query.filters), "STATE", "未提及的热工条件完整保留", true);
  const lookupDecisions = actual.tools.filter(tool => tool.toolName === "thermal").map(tool => tool.outputJson?.backendDecision as Record<string, unknown> | undefined);
  if (expect.reusePreviousCandidate) add("state", lookupDecisions.some(decision => decision?.reusePreviousCandidate === true) && isDeepStrictEqual(lookup?.candidates.map(row => row.id), previous?.task.lastReferenceLookup?.candidates.map(row => row.id)), "STATE", "原页/参数追问实际沿用上一轮候选");
  if (expect.query && previous && !matchesPartial(previous.task.lastReferenceLookup?.query, expect.query)) add("state", lookupDecisions.some(decision => decision?.reusePreviousCandidate === false), "STATE", "条件变化实际重新查询完整正式数据", true);
  const candidates = lookup?.candidates ?? [];
  if (expect.expectedCandidate) add("facts", candidates.some(row => matchesPartial(row, expect.expectedCandidate)), "RETRIEVAL", "预期正式行存在且数值/规格/来源一致");
  if (expect.candidateCount !== undefined) add("facts", candidates.length === expect.candidateCount, "FILTER", `候选数量=${expect.candidateCount}`);
  for (const row of candidates) {
    const fact = REFERENCE_FACTS.find(item => item.schemeCode === row.schemeCode && item.specClass === row.specClass && item.thicknessMm === row.thicknessMm);
    add("facts", !!fact && matchesPartial(row, fact), "HALLUCINATION", `核验图集真值 ${row.schemeCode} ${row.thicknessMm}mm 双R/K/页码`, true);
    if (expect.intent === "REFERENCE_LOOKUP" && lookup) {
      const active = { ...lookup.query, ...expect.query };
      add("facts", satisfies(row, active), "FILTER", "返回正式候选必须满足全部硬条件", true);
    }
  }
  if (expect.resultType === "CALCULATED") {
    add("facts", actual.calculations.length > 0 && actual.calculations.every(calc => calc.mode !== "REFERENCE_TABLE"), "THERMAL", "本轮改变厚度的真实计算必须有计算模式冻结记录", true);
    for (const calc of actual.calculations) {
      // 独立验算冻结快照，不调用生产计算器；图集模式不能冒充改变厚度的计算。
      if (calc.mode === "REFERENCE_TABLE") continue;
      const result = calc.resultJson;
      const thickness = Number(calc.inputJson.thicknessMm);
      const productR = thickness / 1000 / (0.005 * 1.25);
      const totalR = productR + 0.240 / 0.9 + 0.11 + 0.04;
      add("facts", Math.abs(Number(result.productResistance) - productR) < 0.00001 && Math.abs(Number(result.totalResistance) - totalR) < 0.00001 && Math.abs(Number(result.kValue) - 1 / totalR) < 0.00001, "THERMAL", "独立核验I型A1-3冻结计算记录的双R/K", true);
    }
  }
  const text = visibleAnswer(actual).normalize("NFKC");
  add("quality", text.trim().length > 0 && actual.message.status === "COMPLETED", "ANSWER_CONTRACT", "最终消息已完成且有用户可见回答");
  add("quality", !/REFERENCE_LOOKUP|thermal_reference_rows|\bcandidate\b|sourcePageId|MAX_LIMIT|MIN_LIMIT|APPROX|filters\[\]|querySignature/i.test(text), "UX_COPY", "不暴露内部开发术语");
  for (const fact of expect.answerFacts ?? []) {
    const values = [...text.matchAll(new RegExp(`${fact.pattern}([0-9]+(?:\\.[0-9]+)?)`, "gi"))].map(match => Number(match[1]));
    add("facts", values.some(value => Math.abs(value - fact.value) <= (fact.tolerance ?? 0.00001)), "ANSWER_CONTRACT", `最终文字正确表达预期数值 ${fact.value}`);
  }
  for (const word of expect.answerIncludes ?? []) add("quality", text.includes(word), "ANSWER_CONTRACT", `回答包含必要概念 ${word}`);
  if (expect.clarification) add("quality", /[?？]|需要|缺少|不足|确认|无法|不能确定/.test(text), "ANSWER_CONTRACT", "资料/语义不足时短澄清或说明缺少依据");
  const blocks = actual.events.filter(event => event.event === "reference_pages").flatMap(event => Array.isArray(event.data.referencePages) ? event.data.referencePages as { page: { pageId: string; pageLabel: string; imageUrl?: string }; summary?: Record<string, unknown> }[] : []);
  if (expect.referencePageRequired) add("source", blocks.length > 0, "SOURCE", "本轮SSE真实返回ReferencePage");
  for (const block of blocks) add("source", candidates.some(row => row.sourcePageId === block.page.pageId && row.sourcePageLabel === block.page.pageLabel), "SOURCE", "原页ID/印刷页码与正式行一致", true);
  const evidenceText = JSON.stringify([actual.events.filter(event => event.event === "sources" || event.event === "done").map(event => event.data.sources), blocks, actual.tools.filter(tool => tool.success).map(tool => tool.outputJson)]);
  for (const page of text.matchAll(/(?:第\s*)?(\d+)\s*页/g)) add("source", new RegExp(`(?:pageLabel|sourcePageLabel)"?\\s*:\\s*"${page[1]}"`).test(evidenceText), "HALLUCINATION", `声称第${page[1]}页必须有本轮正式来源`, true);
  // 按句剥离否定/条件/用户要求，避免把「不满足」「不能说达标」误当成肯定宣称。
  // 「不是/并非/不代表/不构成…」同样是免责或否定表述，不能当作肯定结论（例如「不是在判规范限值达标」）。
  const affirmative = text.split(/[。！？\n]/).filter(sentence => !/不满足|未满足|不能|无法|未找到|没有|不符合|不达标|不是|并非|不代表|不构成|不作为|不属于|不算|不用于|不涉及|若|如果|要求|目标|需|是否|假设|尚无|不足/.test(sentence));
  const statesCompliance = affirmative.some(sentence => /达标|符合规范|符合标准/.test(sentence));
  add("facts", !statesCompliance || actual.calculations.some(calc => calc.standardJson && calc.resultJson.compliant === true), "HALLUCINATION", "合规肯定结论必须有正式地区标准快照", true);
  if (expect.resultType === "REFERENCE") add("facts", !affirmative.some(sentence => /(?:0\.303|3\.297|2\.880).{0,20}(?:系统计算值|重新计算值)|(?:系统计算值|重新计算值).{0,20}(?:0\.303|3\.297|2\.880)/.test(sentence)), "ANSWER_CONTRACT", "图集原始行不能说成重新计算值", true);
  if (expect.resultType === "CALCULATED") add("facts", !affirmative.some(sentence => /(?:22mm|0\.254).{0,20}(?:图集原始值|图集参考值)|(?:图集原始值|图集参考值).{0,20}(?:22mm|0\.254)/.test(sentence)), "ANSWER_CONTRACT", "22mm计算结果不能冒充图集原始行", true);
  // 文字中的明确数值绑定核对双R，支持等号、中文逗号和常见Markdown。
  // K 标签必须排除单位记号（W/(m²·K)、m²·K/W 等）：单位里的 K 前有 ·/(/² 或后跟 /)，不能当作 K 值绑定。
  for (const [label, wrong] of [["(?:产品层?热阻|产品R)", [3.297, 0.303]], ["(?:总热阻|总R)", [2.880, 0.303]], ["(?:K值|传热系数|(?<![/·(²])K(?![/)]))", [2.880, 3.297]]] as const) {
    const values = [...text.matchAll(new RegExp(`${label}[^\\d]{0,16}([0-9]+(?:\\.[0-9]+)?)`, "gi"))].map(match => Number(match[1]));
    add("facts", !values.some(value => wrong.some(number => Math.abs(number - value) < 0.00001)), "HALLUCINATION", "最终文字不混淆产品R/总R/K", true);
  }
  // 检查Markdown表格的列绑定，单纯逐字搜索数值无法发现双R列互换。
  let headers: string[] | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) { headers = undefined; continue; }
    const cells = line.split("|").slice(1, -1).map(cell => cell.replaceAll("*", "").trim());
    if (cells.some(cell => /产品.*热阻|产品R|总热阻|总R|传热系数|^K(?:值|$)/i.test(cell)) && cells.every(cell => !/^\d+(?:\.\d+)?$/.test(cell))) { headers = cells; continue; }
    if (!headers || cells.every(cell => /^[:\s-]*$/.test(cell))) continue;
    const code = cells.join(" ").match(/[AB]\d+-\d+/)?.[0];
    const thicknessIndex = headers.findIndex(header => /厚度/.test(header));
    const thickness = thicknessIndex >= 0 ? Number.parseFloat(cells[thicknessIndex] ?? "") : undefined;
    const row = REFERENCE_FACTS.find(fact => (!code || fact.schemeCode === code) && fact.thicknessMm === thickness);
    for (const [index, header] of headers.entries()) {
      const metric = /产品.*热阻|产品R/.test(header) ? "PRODUCT_R" : /总热阻|总R/.test(header) ? "TOTAL_R" : /传热系数|^K(?:值|$)/i.test(header) ? "K" : undefined;
      if (!metric) continue;
      const value = Number.parseFloat(cells[index] ?? "");
      if (!Number.isFinite(value)) continue;
      const allowed = row ? [metricValue(row, metric)] : [...REFERENCE_FACTS.map(fact => metricValue(fact, metric)), ...actual.calculations.map(calc => Number(calc.resultJson[metric === "K" ? "kValueRounded" : metric === "TOTAL_R" ? "totalResistanceRounded" : "productResistanceRounded"]))];
      add("facts", allowed.some(fact => fact !== undefined && Math.abs(fact - value) < 0.0005), "HALLUCINATION", `最终参数表 ${header}=${value} 与确定性事实一致`, true);
    }
  }
  if (lookup && expect.intent === "REFERENCE_LOOKUP") {
    const claimsMatch = affirmative.some(sentence => /满足(?:全部|所有|上述|条件)|符合(?:筛选|条件)|^有[，,。]|^有$/.test(sentence.trim()));
    const active = { ...lookup.query, ...expect.query };
    // 静态事实不携带本次随机库UUID；文字判定只比数值/型号/编码，ID另由Runner核验。
    const disallowedReference = REFERENCE_FACTS.filter(fact => !satisfies(fact, { filters: active.filters, thicknessMm: active.thicknessMm, thicknessMin: active.thicknessMin, thicknessMax: active.thicknessMax, specClass: active.specClass, schemeCode: active.schemeCode }));
    add("facts", !claimsMatch || !disallowedReference.some(row => text.includes(String(row.kValue)) && text.includes(`${row.thicknessMm}mm`) && !/不满足|不符合|超过|高于|仅供参考|不达|不能/.test(text)), "FILTER", "违反热工/厚度硬条件的文字不能宣称满足", true);
  }
  // 各维度均需实际证据。没有专门参数/状态预期的知识追问也核验工具/会话归属。
  if (!checks.some(check => check.group === "parameters")) add("parameters", actual.tools.every(tool => tool.messageId === actual.message.id), "PARSER", "工具参数属于本轮真实消息");
  if (!checks.some(check => check.group === "state")) add("state", actual.tools.every(tool => tool.conversationId === actual.message.conversationId), "STATE", "工具状态属于独立当前会话");
  if (!checks.some(check => check.group === "source")) add("source", !/图集|资料.{0,8}(?:显示|表明)/.test(text) || evidenceText !== "[null,[],[]]" && evidenceText !== "[[],[],[]]", "SOURCE", "来源性宣称须有本轮可追溯证据");
  return checks;
}
