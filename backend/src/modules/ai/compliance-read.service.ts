import { and, eq } from "drizzle-orm";
import { projects, thermalStandardLimits } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { loadThermalQueryDictionary } from "../thermal/thermal-query-dictionary.service.js";
import { resolveQueryEntities } from "../thermal/thermal-entity-resolver.js";
import { parseThermalLookupMessage } from "../thermal/thermal-lookup-mode.js";
import { resolveScopedThermalStandard } from "../thermal/thermal-standard-scope.service.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { resolveCandidateReference, type ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { buildAllowedAnswerFacts } from "./thermal-answer-validation.js";

/** 合规只读取当前有权项目、正式标准范围与核验参数，绝不调用计算或候选发布。 */
export async function resolveComplianceRead(ctx: ReferenceReadContext) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const reply = (status: "NEEDS_INPUT" | "UNAVAILABLE" | "CHECKED", answer: string, extra: Record<string, unknown> = {}, sources: unknown[] = []) => {
    const facts = buildAllowedAnswerFacts({}, []);
    facts.canonicalAnswers = [answer];
    if (sources.length) ctx.onEvent?.("sources", { sources });
    return { readOnly: true as const, facts, sources, referencePages: [], needsClarification: status === "NEEDS_INPUT", compliance: { status, ...extra } };
  };
  if (conversation.projectId !== ctx.conversation.projectId) return reply("UNAVAILABLE", "会话所属项目已变化，请重新核验。");
  const dictionary = await loadThermalQueryDictionary(ctx.app.db);
  if (dictionary.hasPublishedLimits === false)
    return reply("UNAVAILABLE", "当前没有已发布且生效的正式标准限值，无法核验该方案是否达标，也不能作所有地区通用的合规承诺。技术参考与正式合规结论需要区分。");
  const project = conversation.projectId ? (await ctx.app.db.select().from(projects).where(eq(projects.id, conversation.projectId)).limit(1))[0] : null;
  const lookup = ctx.taskState?.lastReferenceLookup;
  const history = lookup?.projectId === conversation.projectId && !lookup.candidateResultInvalid ? lookup.query : undefined;
  const fromProject = resolveQueryEntities([project?.region, project?.buildingType].filter(Boolean).join(" "), {}, dictionary.entities, dictionary.aliases);
  // 只继承已知适用范围，不把查询 filters 或 targetK 当成真实工程参数。
  const base = { regionCode: fromProject.regionCode ?? history?.regionCode, buildingType: fromProject.buildingType ?? history?.buildingType,
    structureType: history?.structureType, standardLimitId: history?.standardLimitId };
  const explicit = resolveQueryEntities(ctx.userMessage ?? "", {}, dictionary.entities, dictionary.aliases);
  const query = { ...base, ...Object.fromEntries(Object.entries(explicit).filter(([key, value]) => ["regionCode", "buildingType", "structureType", "standardLimitId"].includes(key) && value != null)) };
  const scopeIssue = explicit.unresolved?.find(item => ["regionCode", "buildingType", "structureType", "standardLimitId"].includes(item.field));
  if (scopeIssue) return reply("NEEDS_INPUT", scopeIssue.reason, { field: scopeIssue.field });
  if (explicit.regionCode && explicit.regionCode !== base.regionCode && !explicit.standardLimitId) query.standardLimitId = undefined;
  if (!query.regionCode && project?.region) return reply("UNAVAILABLE", "当前项目地区没有可核验的正式标准地区映射，无法判定合规。");
  if (!query.regionCode) return reply("NEEDS_INPUT", "项目或构造适用哪个地区？", { field: "regionCode" });
  if (!query.buildingType) return reply("NEEDS_INPUT", "该项目是什么建筑类型？", { field: "buildingType" });
  const limits = await ctx.app.db.select().from(thermalStandardLimits).where(and(eq(thermalStandardLimits.regionCode, query.regionCode),
    ...(query.standardLimitId ? [eq(thermalStandardLimits.id, query.standardLimitId)] : []), ...publishedReferenceConditions(thermalStandardLimits)));
  if (!limits.length) return reply("UNAVAILABLE", "当前没有该地区已发布且生效的适用标准限值，无法判定合规。");
  const scoped = await Promise.all(limits.map(limit => resolveScopedThermalStandard(ctx.app.db, { ...query, standardLimitId: limit.id })));
  const applicable = scoped.flatMap(result => result.limit ? [result.limit] : []);
  if (!applicable.length) {
    if (!query.structureType && scoped.some(item => item.reason?.includes("结构类型"))) return reply("NEEDS_INPUT", "该项目是什么结构类型？", { field: "structureType" });
    return reply("UNAVAILABLE", scoped[0]?.reason ?? "没有可证明覆盖当前适用范围的正式标准，无法判定合规。");
  }
  if (applicable.length > 1) return reply("NEEDS_INPUT", `有多份适用标准，请选择本次核验依据：${applicable.map(item => `${item.basisCode}（${item.basisName}）`).join("、")}。`, { field: "standardLimitId" });
  const limit = applicable[0]!;
  const parsed = parseThermalLookupMessage(ctx.userMessage ?? "");
  const kFilters = parsed.filters.filter(filter => filter.metric === "K");
  if (kFilters.length > 1 || parsed.needsClarification) return reply("NEEDS_INPUT", "本次需要核验的构造 K 值是多少？", { field: "parameter" });
  let kValue = kFilters[0]?.targetValue;
  let parameterSource = "USER_INPUT";
  let candidateId: string | undefined;
  if (kValue == null) {
    const reference = await resolveCandidateReference({ ...ctx, domainDecision: { ...ctx.domainDecision!, referenceScope: /已选|选中的/.test(ctx.userMessage ?? "") ? "CURRENT_SELECTED" : "LATEST_VISIBLE" } });
    if (reference.reason || reference.candidates.length !== 1) return reply("NEEDS_INPUT", reference.reason ?? "要核验当前哪一个候选？请指定卡片序号。", { field: "candidate" });
    kValue = reference.candidates[0]!.kValue; candidateId = reference.candidates[0]!.id; parameterSource = "VERIFIED_CANDIDATE";
  }
  if (kValue == null || !Number.isFinite(kValue) || kValue <= 0 || !Number.isFinite(limit.limitKValue) || limit.limitKValue <= 0)
    return reply("UNAVAILABLE", "缺少有效的 K 值或正式限值，无法判定合规。");
  // K 限值是上限；近似查询容差不会放大法规限值。
  const compliant = kValue <= limit.limitKValue;
  const answer = `${parameterSource === "USER_INPUT" ? "按本轮提供的参数作条件核验" : "按当前已核验候选"}：K=${kValue} ${compliant ? "≤" : ">"} ${limit.limitKValue}，${compliant ? "满足" : "不满足"}该标准的 K 限值。\n适用范围：${limit.regionName}、${query.buildingType}${query.structureType ? `、${query.structureType}` : ""}。依据：${limit.basisName}（${limit.basisCode}），${limit.clauseRef}。此结论仅覆盖该项指标，不代表完整工程验收。`;
  return reply("CHECKED", answer, { compliant, kValue, limitKValue: limit.limitKValue, standardLimitId: limit.id, candidateId, parameterSource,
    scope: { regionCode: query.regionCode, buildingType: query.buildingType, structureType: query.structureType } },
    [{ documentId: limit.sourceDocumentId, title: limit.basisName, basisCode: limit.basisCode, clauseRef: limit.clauseRef, version: limit.version }]);
}
