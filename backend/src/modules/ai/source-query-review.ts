import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import type { DomainTurnSemantic } from "./ai-domain-semantic.js";
import type { SemanticDictionary } from "../thermal/semantic-query.js";
import type { SemanticQuery } from "../thermal/semantic-query.js";
import type { ThermalQueryState } from "../thermal/thermal-query-state.js";
import { languageModelSamplingOptions } from "../ai-config/ai-task-runtime-policy.js";
const schema = z.object({ faithfulQuery: z.boolean(), confidence: z.number().min(0).max(1), evidence: z.string().min(1),
  sourceLabels: z.array(z.string().min(1)).min(1).max(8) }).strict();
const missingSourceSchema = z.object({ sourceReferenced: z.boolean(), faithfulQuery: z.boolean(),
  confidence: z.number().min(0).max(1), evidence: z.string().nullable(), sourceLabels: z.array(z.string().min(1)).max(8) }).strict();
const sourceDeltaSchema = z.object({ operation: z.enum(["KEEP", "SET", "CURRENT", "UNCERTAIN"]),
  evidence: z.string().min(1).nullable(), confidence: z.number().min(0).max(1) }).strict();
const sourceReviewReason = "这次提到的资料范围还没核对清楚，请确认具体资料名称；已经给出的基层和参数条件会保留。";
function sourceReviewState(original: SemanticQuery) {
  const remaining = original.unresolved.filter(issue => issue.field !== "sourceScope" || issue.reason !== sourceReviewReason);
  return {
    passed: () => remaining.length === original.unresolved.length ? original : { ...original, unresolved: remaining },
    pending: () => ({ ...original, unresolved: [...remaining, { field: "sourceScope", reason: sourceReviewReason }] })
  };
}
function hasExplicitSourceReference(message: string, sources: NonNullable<SemanticDictionary["sourceSets"]>) {
  return /\b(?:pdf|docx?|xlsx?|excel|word|csv|dwg|dxf|png|jpe?g|tiff?)\b/i.test(message)
    || sources.some(source => [source.name, source.code, source.source, source.reference].some(label => !!label && message.includes(label)));
}
/** 同轮上游只改置信度或来源提案形状，不应重新解释已经核验的同一来源。工程条件变更仍重新核验。 */
export function sourceReviewCacheKey(message: string, query: SemanticQuery) {
  const { confidence: _confidence, sourceScope: _scope, ...fields } = query;
  return JSON.stringify([message, { ...fields, unresolved: query.unresolved.filter(issue => issue.field !== "sourceScope" || issue.reason !== sourceReviewReason) }]);
}
export function bindMissingQuerySource(raw: unknown, message: string, original: SemanticQuery, sources: NonNullable<SemanticDictionary["sourceSets"]>): SemanticQuery {
  const parsed = missingSourceSchema.safeParse(raw);
  // 同一字段的新复核通过才撤销该门禁先前产生的诊断；其他语义缺项和来源歧义不能清除。
  const { passed, pending } = sourceReviewState(original);
  if (!parsed.success || !parsed.data.faithfulQuery || parsed.data.confidence < .9) return pending();
  const value = parsed.data;
  const explicitSourceSignal = hasExplicitSourceReference(message, sources);
  if (!value.sourceReferenced) {
    // 只校验“不存在来源限制”的否定提案；封闭文件格式/当前正式名称不用于选来源或判断业务意图。
    if (value.sourceLabels.length || explicitSourceSignal && (!value.evidence || !message.includes(value.evidence))) return pending();
    // 否定提案通过后移除模型自行补出的来源；REFINE仍由执行层继承后台原有来源。
    // 未明确来源不能因目录恰好只有一个参考集就只查该集。
    const verified = passed();
    return verified.sourceScope ? { ...verified, sourceScope: null } : verified;
  }
  if (!value.evidence || !message.includes(value.evidence) || !value.sourceLabels.length) return pending();
  // 工程条件不能充当文件来源证据；没有可核验的文件/正式名称时，整句查询或同一工程字段不足以限定来源。
  if (!explicitSourceSignal && original.constraints.length && (value.evidence === message
    || original.constraints.some(condition => value.evidence === condition.evidence || value.evidence === condition.entityText))) return pending();
  const ids: string[] = [];
  for (const label of value.sourceLabels) {
    const selected = sources.filter(source => source.name === label);
    if (selected.length !== 1 || ids.includes(selected[0]!.id)) return pending();
    ids.push(selected[0]!.id);
  }
  return { ...passed(), confidence: value.confidence, sourceScope: { kind: "REFERENCE_SET", ids, evidence: value.evidence } };
}
/** 主/备用解析均独立核对来源是否真的由用户限定，不能因已有提案或高置信度跳过。 */
export async function reviewMissingQuerySource(model: LanguageModel, message: string, original: SemanticQuery,
  sources: NonNullable<SemanticDictionary["sourceSets"]>, abortSignal: AbortSignal, previousQuery?: ThermalQueryState) {
  const { passed, pending } = sourceReviewState(original);
  const hasPreviousSource = Boolean(previousQuery?.referenceSetIds?.length || previousQuery?.documentIds?.length || previousQuery?.knowledgeVersionIds?.length);
  // 来源存在性不接收来源目录或上游提案，避免把“有这份资料”误判为“用户限定了这份资料”。
  const presenceResult = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `你只解释本轮对资料来源的变更提案，不重建业务状态、不匹配工程对象、不判断查询忠实度或数据库能否命中，也不选择资料。输出JSON：${JSON.stringify(z.toJSONSchema(sourceDeltaSchema))}。没有新增资料来源要求用KEEP、evidence=null；KEEP表示后台原来源保持，不表示来源不存在。只继续、重复或修改整组工程查询条件时也用KEEP，无需知道旧条件的内容；不能把工程条件的继续当作来源意思不明。体系、型号、基层、厚度、指标及数据发布状态不代表资料来源。明确指定文件/表名或来源范围（含明确不限来源）用SET；仅明确指此前资料本身才用CURRENT；确实存在无法理解的来源变更要求才用UNCERTAIN。非KEEP的evidence仅取来源变更原话，不用整句工程条件代替，不输出身份或工程数值。未知资料名仍是SET，不能忽略。置信度只评价语言变更，不包含旧状态、资料是否存在或身份能否绑定的未知；这些由Backend核对。不能为了执行提高confidence。`,
    prompt: JSON.stringify({ message }) });
  const presence = sourceDeltaSchema.safeParse(presenceResult.object);
  if (!presence.success || presence.data.confidence < .9 || presence.data.operation === "UNCERTAIN") return pending();
  if (presence.data.operation === "KEEP") {
    if (presence.data.evidence != null) return pending();
    if (!hasExplicitSourceReference(message, sources)) {
      const verified = passed();
      return verified.sourceScope ? { ...verified, sourceScope: null } : verified;
    }
    // 已有封闭文件格式或正式名称与KEEP矛盾：触发完整来源/查询复核，不据词直接选择来源或放宽范围。
  }
  const sourceMention = presence.data.evidence;
  if (presence.data.operation !== "KEEP" && (!sourceMention || !message.includes(sourceMention))) return pending();
  if (presence.data.operation === "CURRENT") {
    if (!hasPreviousSource || original.queryMode !== "REFINE_QUERY"
      || previousQuery?.referenceSetIds?.some(id => !sources.some(source => source.id === id))) return pending();
    // 当前来源由Backend有效历史继承，不让模型重新从目录猜一个身份。
    const verified = passed();
    return verified.sourceScope ? { ...verified, sourceScope: null } : verified;
  }
  const inheritedConditions = previousQuery ? { systemHint: previousQuery.systemHint, schemeCode: previousQuery.schemeCode,
    specClass: previousQuery.specClass, substrateMaterial: previousQuery.substrateMaterial, substrateThickness: previousQuery.substrateThickness,
    thicknessMm: previousQuery.thicknessMm, thicknessMin: previousQuery.thicknessMin, thicknessMax: previousQuery.thicknessMax,
    thicknessMinExclusive: previousQuery.thicknessMinExclusive, thicknessMaxExclusive: previousQuery.thicknessMaxExclusive,
    filters: previousQuery.filters, sourceLabels: sources.filter(source => previousQuery.referenceSetIds?.includes(source.id)).map(source => source.name),
    hasSpecifiedSource: Boolean(previousQuery.referenceSetIds?.length || previousQuery.documentIds?.length || previousQuery.knowledgeVersionIds?.length) } : null;
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `复核同一个只读查询的条件是否忠实，并核对用户是否限定资料来源。输出JSON：${JSON.stringify(z.toJSONSchema(missingSourceSchema))}。sourceReferenced只在用户限定资料时为true；未提来源时为false、sourceLabels=[]、evidence=null；用户明确撤销或不限定来源时为false、sourceLabels=[]、evidence逐字引用其不限定来源的原话。不能把不知道资料身份误判成未提来源。若限定，只可从提供的当前来源显示名中原样选择；evidence必须是用户对该资料的连续原话，不生成ID。不能唯一对应时sourceReferenced=true、sourceLabels=[]，不猜测。inheritedConditions是Backend已保存的有效查询条件。续问只提交本轮变更，空constraints可表示原条件重查，不要求模型重新填写历史条件；已保存范围继续保留，不把引用刚才条件误当成未知资料。NEW_QUERY不自动继承。faithfulQuery核对其余体系、基层、厚度、指标及数值有无遗漏/改义，不因尚未知道命中结果降低置信度，也不能为了执行提高置信度。一般参考建议所需的资料读取是只读查询，不授权选择、计算、确认或报告。资料名称不是体系名称，未给出的可选筛选字段不用补齐。`,
    // 来源复核独立评价原话与条件；不把上游目标分类的confidence传给另一职责让模型照抄。
    // 与已有来源绑定复核保持一致，阈值、字段grounding和权限均不变。
    prompt: JSON.stringify({ message, verifiedSourceMention: sourceMention, inheritedConditions, query: { intent: original.intent, queryMode: original.queryMode,
      readFields: original.readFields, preferences: original.preferences,
      constraints: original.constraints.map(({ confidence: _confidence, ...condition }) => condition), unresolved: passed().unresolved }, sourceLabels: sources.map(source => ({ label: source.name,
      code: source.code, source: source.source, reference: source.reference })) }) });
  const binding = missingSourceSchema.safeParse(result.object);
  if (!binding.success || !binding.data.evidence || sourceMention
    && !binding.data.evidence.includes(sourceMention) && !sourceMention.includes(binding.data.evidence)) return pending();
  const boundEvidence = sourceMention && sourceMention.length < binding.data.evidence.length ? sourceMention : binding.data.evidence;
  return bindMissingQuerySource({ ...binding.data, evidence: boundEvidence }, message, original, sources);
}
/** 来源复核只解释同一只读查询；模型选当前来源显示名，Backend绑定身份，不产生来源/操作授权。 */
export async function reviewSourceQuery(model: LanguageModel, message: string, original: DomainTurnSemantic,
  sources: NonNullable<SemanticDictionary["sourceSets"]>, abortSignal: AbortSignal) {
  const scope = original.pageQuery?.sourceScope;
  if (original.requestedEffect !== "QUERY" || !["REFERENCE_QUERY", "REFERENCE_REFINE"].includes(original.intent)
    || !scope || !message.includes(scope.evidence) || scope.ids.some(id => !sources.some(source => source.id === id))) return undefined;
  const result = await generateObject({ model, output: "no-schema", maxRetries: 0, abortSignal,
    ...languageModelSamplingOptions("SEMANTIC_QUERY"),
    system: `仅复核同一个只读查询的来源引用和条件是否忠实于用户原话。输出JSON：${JSON.stringify(z.toJSONSchema(schema))}。faithfulQuery只评价原话意图及给定条件，不因尚未查询或未知是否命中降低置信度，不能为了执行而提高置信度。用户要选择/计算/确认/报告或原条件有遗漏/改写时为false。来源只选当前sourceLabels原样显示名，不能生成ID或名称；存在歧义或缺证保持false或低置信。evidence逐字取用户的来源称呼。不得删除或更改任何指标、比较符、数值、体系、基层、厚度或来源限制。`,
    prompt: JSON.stringify({ message, query: { intent: original.pageQuery!.intent, queryMode: original.pageQuery!.queryMode,
      readFields: original.pageQuery!.readFields, sourceScope: { evidence: scope.evidence },
      constraints: original.pageQuery!.constraints.map(({ confidence: _confidence, ...condition }) => condition) },
      sourceLabels: sources.map(source => ({ label: source.name, code: source.code, source: source.source, reference: source.reference })) }) });
  const parsed = schema.safeParse(result.object);
  if (!parsed.success || !parsed.data.faithfulQuery || parsed.data.confidence < .9 || !message.includes(parsed.data.evidence)) return undefined;
  const ids: string[] = [];
  for (const label of parsed.data.sourceLabels) {
    const matches = sources.filter(source => source.name === label);
    if (matches.length !== 1 || ids.includes(matches[0]!.id)) return undefined;
    ids.push(matches[0]!.id);
  }
  if (ids.length !== new Set(scope.ids).size || ids.some(id => !scope.ids.includes(id))) return undefined;
  return { ...original, confidence: parsed.data.confidence, pageQuery: { ...original.pageQuery!, confidence: parsed.data.confidence,
    sourceScope: { ...scope, ids, evidence: parsed.data.evidence } } };
}
