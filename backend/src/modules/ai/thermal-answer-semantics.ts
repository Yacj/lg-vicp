/**
 * 回答语义事实抽取（确定性、无 IO、无 LLM）。
 *
 * 事实门禁不能退化成「整段自然语言严格相等」——那会把「模型不准乱说」修成「模型不准说话」。
 * 本文件只做一件事：从自然语言回答里把**真正出现的工程事实**（带语义标签的数值、页码、方案/规格编码）
 * 抽取成结构化事实；随后由调用方把这些事实与 Allowed Fact Set 比对。
 *
 * 关键原则：
 * - 只校验带语义标签的事实；没有标签的裸数字（目标值、行号、百分比等）不参与事实判定。
 * - 事实按「候选片段」分组：出现方案/规格编码时切段，段内事实必须能由**同一条候选**同时满足，
 *   防止跨候选拼字段（把 A 的厚度拼到 B 的热阻上）。
 * - 本文件不含任何产品参数、图集 K 值或标准限值默认值。
 */

export type SemanticMetric = "K" | "PRODUCT_R" | "TOTAL_R" | "LAMBDA" | "ALPHA";

export type SemanticFact =
  | { kind: "metric"; metric: SemanticMetric; value: number }
  | { kind: "thickness"; value: number }
  | { kind: "page"; label: string }
  | { kind: "code"; code: string }
  | { kind: "entity"; field: "systemName"; name: string }
  | { kind: "standardLimit"; value: number }
  | { kind: "compliance"; compliant: boolean }
  | { kind: "standardIdentity"; name: string };

export interface AnswerSegment {
  /** 该片段归属的方案/规格/体系编码；缺省表示无编码前缀的说明性片段 */
  code?: string;
  text: string;
  facts: SemanticFact[];
  role?: "QUERY" | "CANDIDATE";
}

interface MetricLabel {
  metric: SemanticMetric;
  pattern: string;
}

/** 指标标签：只认明确语义词，裸「热阻」不认（属于歧义表达）。长词在前，避免短词抢先命中。 */
const METRIC_LABELS: MetricLabel[] = [
  { metric: "PRODUCT_R", pattern: "产品层热阻|产品层R|产品热阻|产品R|板自身热阻|板自身R|板自身|板子热阻|板子R|板子|保温板自身热阻|保温板热阻|保温板R|product_r|PRODUCT_R|(?<![A-Za-z0-9])R(?![0₀A-Za-z])" },
  { metric: "TOTAL_R", pattern: "外墙主断面总热阻|主断面总热阻|主断面传热阻|主断面热阻|整墙总热阻|整墙热阻|整墙R₀?|总热阻R₀?|总热阻|总R₀?|total_r|TOTAL_R|R₀|(?<![A-Za-z0-9])R0(?![A-Za-z0-9])" },
  { metric: "K", pattern: "传热系数K值?|传热系数|K值|k值|(?<![A-Za-z])K(?![A-Za-z])|(?<![A-Za-z])k(?![A-Za-z])" },
  { metric: "LAMBDA", pattern: "导热系数|λ" },
  { metric: "ALPHA", pattern: "修正系数|α" }
];

/** 指标标签与数字之间的连接（允许 R / R₀ / = / 约 等冗余修饰）。 */
const METRIC_NUMBER = /^\s*(?:R[0₀]?|r[0₀]?)?\s*(?:(?:是|为|等于|约为|大约|约|[:：=≈≤≥<>])\s*)*(-?\d+(?:\.\d+)?)/;

const THICKNESS_LABEL = /厚度\s*(?:(?:是|为|约为|[:：=≈约])\s*)*(-?\d+(?:\.\d+)?)/gi;
const THICKNESS_UNIT = /(-?\d+(?:\.\d+)?)\s*(?:mm|毫米|㎜)/gi;
const PAGE_LABEL = /(?:印刷)?页码?\s*[:：]?\s*([A-Za-z]?-?\d+(?:[-–—]\d+)?)/gi;
const PAGE_CN = /第\s*([A-Za-z]?-?\d+)\s*页/g;
const CODE_LABEL = /(?:方案|构造|规格|产品规格)\s*[:：]?\s*([A-Za-z][A-Za-z0-9\-_.]{0,24})/gi;
/** 裸编码：必须带数字与连字符（如 A4-1 / A1-3），避免把 K0 / R0 误当编码。 */
const CODE_BARE = /(?<![A-Za-z0-9])([A-Z]{1,4}\d+(?:[-–—]\d+)+)(?![A-Za-z0-9])/gi;

const PAGE_NORMALIZE = (value: string) => value.replace(/\s+/g, "").toLowerCase();

/** 抽取一段文本内的全部语义事实（顺序保留，便于调试）。 */
export function extractSemanticFacts(text: string): SemanticFact[] {
  if (!text) return [];
  const facts: SemanticFact[] = [];
  for (const label of METRIC_LABELS) {
    const re = new RegExp(label.pattern, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const number = METRIC_NUMBER.exec(text.slice(match.index + match[0].length));
      if (number) {
        const prefix = text.slice(0, match.index).split(/[。；;，,]/).at(-1) ?? "";
        facts.push(label.metric === "K" && /(?:标准|规范|已选|已确认).*限值|标准限值/.test(prefix)
          ? { kind: "standardLimit", value: Number(number[1]) }
          : { kind: "metric", metric: label.metric, value: Number(number[1]) });
      }
      // 零宽或空匹配保护
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  for (const pattern of [THICKNESS_LABEL, THICKNESS_UNIT]) {
    const re = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      facts.push({ kind: "thickness", value: Number(match[1]) });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  for (const pattern of [PAGE_LABEL, PAGE_CN]) {
    const re = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      facts.push({ kind: "page", label: PAGE_NORMALIZE(match[1]!) });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  for (const match of text.matchAll(/(?:系统|体系)\s*(?:[:：]|是|为)\s*([^，,；;。\n]+)/g)) {
    facts.push({ kind: "entity", field: "systemName", name: match[1]!.trim() });
  }
  for (const match of text.matchAll(/(?:标准依据|所选标准)\s*[:：]\s*([^，,；;。\n]+)/g)) {
    facts.push({ kind: "standardIdentity", name: match[1]!.trim() });
  }
  for (const match of text.matchAll(/(不符合|未满足|符合|满足)\s*([^。，,\s；;]{1,30}(?:标准|规范))(?:限值|要求)?/g)) {
    facts.push({ kind: "compliance", compliant: !/不|未/.test(match[1]!) });
    if (!/^(?:该|所选|已确认)(?:标准|规范)$/.test(match[2]!)) facts.push({ kind: "standardIdentity", name: match[2]! });
  }
  for (const match of text.matchAll(/(?:不符合|未满足|符合|满足)(?:该|所选|已确认)?(?:标准|规范)限值|(?:未达标|不达标|达标|不合规|合规)/g)) {
    const clause = text.slice(0, match.index).split(/[，,。；;\n]/).at(-1) ?? "";
    if (isComplianceDisclaimer(clause + match[0])) continue;
    facts.push({ kind: "compliance", compliant: !/不|未/.test(match[0]) });
  }
  return facts;
}

/** 找出文本中的方案/规格编码及其位置（带标签优先，其次裸编码）。 */
export function findCodes(text: string): Array<{ code: string; index: number; end: number }> {
  const found: Array<{ code: string; index: number; end: number }> = [];
  for (const pattern of [CODE_LABEL, CODE_BARE]) {
    const re = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const code = match[1]!;
      const index = match.index + match[0].lastIndexOf(code);
      found.push({ code, index, end: index + code.length });
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }
  found.sort((a, b) => a.index - b.index);
  // 去掉被更长编码完全覆盖的重复命中
  return found.filter((hit, index) => !found.some((other, otherIndex) => otherIndex !== index
    && other.index <= hit.index && other.end >= hit.end && (other.end - other.index > hit.end - hit.index || otherIndex < index && other.index === hit.index && other.end === hit.end)));
}

/**
 * 把回答切成「候选片段」：
 * - 出现方案/规格编码即切段，段内事实只能由同一条候选满足（跨候选拼接会被判失败）；
 * - 编码之前的说明性文本单独成段，其事实需由候选池中任意一条满足。
 */
export function segmentAnswer(answer: string, schemeCodes?: ReadonlyArray<string>): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let activeCode: string | undefined;
  for (const rawLine of answer.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const allCodes = findCodes(line);
    // 同一句的规格编码只是该方案的另一个事实，不能通过切段换掉候选归属。
    const codes = allCodes.filter(hit => schemeCodes === undefined || schemeCodes.includes(hit.code.toLowerCase())
      || !/规格\s*[:：]?\s*$/.test(line.slice(0, hit.index)));
    if (codes.length === 0) {
      const role = /^(?:你(?:要|问|说|给出)|按你的|查询条件|目标|要求)/.test(line) ? "QUERY" : "CANDIDATE";
      const code = role === "QUERY" ? undefined : activeCode;
      segments.push({ code, role, text: line, facts: [...(code ? [{ kind: "code" as const, code }] : []),
        ...allCodes.map(hit => ({ kind: "code" as const, code: hit.code })), ...extractSemanticFacts(line)] });
      continue;
    }
    if (codes[0]!.index > 0) {
      const preamble = line.slice(0, codes[0]!.index);
      segments.push({ text: preamble, facts: extractSemanticFacts(preamble) });
    }
    codes.forEach((hit, index) => {
      const start = hit.index;
      const end = index + 1 < codes.length ? codes[index + 1]!.index : line.length;
      const slice = line.slice(start, end);
      // 编码本身也是可校验事实（决定该片段归属哪条候选），必须先登记。
      activeCode = hit.code;
      segments.push({ code: hit.code, role: "CANDIDATE", text: slice, facts: [
        { kind: "code", code: hit.code },
        ...findCodes(slice).map(item => ({ kind: "code" as const, code: item.code })), ...extractSemanticFacts(slice)] });
    });
  }
  return segments;
}

/**
 * 未授权断言：把当前命中范围说成全量统计，或把筛选说成规范达标/合规。
 * 只有后端能证明的范围统计与合规结论才允许出现这些词；默认一律拒绝。
 */
const OVERREACH_PATTERN = /最高|最低|最大|最小|唯一|全部|所有|没有其他|仅此|绝无|排名第一/;
const COMPLIANCE_PATTERN = /达标|合规|符合[^。！？\n]{0,12}(?:标准|规范|限值)|满足[^。！？\n]{0,10}(?:标准|规范|限值)/;
const isComplianceDisclaimer = (clause: string) => /(?:不能|无法|尚未|暂不能|还需|需核对|需确认).*(?:判断|确认|证明|给出)|(?:不能|禁止)宣称/.test(clause);

/**
 * @param options.complianceAuthorized 只有后端已证明全部适用范围（地区 / 建筑类型 / 标准版本）时才允许
 *   出现「达标 / 合规 / 符合标准限值」这类结论；默认 false，一律拒绝。
 */
export function answerHasForbiddenClaim(answer: string, options: { complianceAuthorized?: boolean } = {}): boolean {
  // 「满足全部条件」描述AND筛选，不是在宣称覆盖全库。
  if (OVERREACH_PATTERN.test(answer.replace(/(?:全部|所有)(?:硬)?(?:条件|要求)/g, ""))) return true;
  if (options.complianceAuthorized) return false;
  return answer.split(/[，,。；;\n]/).some(clause => !isComplianceDisclaimer(clause) && COMPLIANCE_PATTERN.test(clause));
}
