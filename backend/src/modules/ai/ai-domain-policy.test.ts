import { expect, it } from "vitest";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { customerDomainClarification } from "./domain-clarification.js";

it("唯一未定角色的数字直接澄清其含义，数量/已定指标及多个数字不作任意字段猜测",()=>{
  const semantic=domainSemanticFixture('材料参数待确认','CLARIFY',{clarificationTarget:'OTHER'});
  const answer=customerDomainClarification(semantic,'有保温17.6的材料吗');
  expect(answer).toContain('17.6');expect(answer).not.toContain('导热系数');expect(answer).not.toContain('热阻');
  for(const text of ['介绍4种保温材料','查K<0.27','0.2和0.3分别是什么'])
    expect(customerDomainClarification(semantic,text)).not.toContain('具体指哪项条件或参数');
});

it("产品参数原页属于同产品只读来源，不能顺带开放构造层或其他页面字段", () => {
  const text = "看这个板的参数原页", semantic = domainSemanticFixture(text, "PRODUCT_DETAIL", {
    productQuery: { scope: "IDENTITY", entityText: "这个板", granularity: "PRODUCT", evidence: text },
    referenceReadFields: ["originalPage"], reference: { scope: "NONE", revision: null, items: [] } });
  expect(applyDomainPolicy(text, semantic).intent).toBe("PRODUCT_DETAIL");
  expect(applyDomainPolicy(text, { ...semantic, referenceReadFields: ["layers"] }).policyReason).toBe("PAGE_QUERY_SCOPE_INVALID");
  expect(applyDomainPolicy(text, { ...semantic, requestedEffect: "STATE_MUTATION" }).intent).toBe("CLARIFY");
  expect(applyDomainPolicy(text, { ...semantic, productQuery: { ...semantic.productQuery!, entityText: "编造身份" } }).intent).toBe("CLARIFY");
});
import { domainTurnSemanticSchema, normalizeCurrentComparison } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const state = { taskType: "GENERAL", lastReferenceLookup: { query: { thicknessMm: 45 }, candidateQueryRevision: 7, candidates: [] } } as any;
function comparisonQuery(metric: "K" | "TOTAL_R" | "PRODUCT_R", direction: "MIN" | "MAX") {
  const message = "按当前这组记录比较所问指标";
  return domainTurnSemanticSchema.parse(domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", referenceTime: "CURRENT", effectRequest: null,
    reference: { scope: "LAST_VISIBLE_CANDIDATES", revision: 7, items: [] },
    comparison: { metric, direction, evidence: message },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, constraints: [], preferences: [], unresolved: [], readFields: ["kValue", "baseMaterial"] } }));
}
it.each(["K", "TOTAL_R", "PRODUCT_R"] as const)("当前集合%s的无条件极值提案归一为只读，不发布候选", metric => {
  for (const direction of ["MIN", "MAX"] as const) {
    const original = comparisonQuery(metric, direction), before = structuredClone(original);
    const normalized = normalizeCurrentComparison(original);
    expect(normalized).toMatchObject({ intent: "COMPARE_CANDIDATES", relation: "CONTINUE", requestedEffect: "READ_ONLY", pageQuery: null,
      comparison: { metric, direction, evidence: original.evidence }, reference: original.reference });
    expect(applyDomainPolicy(original.evidence, normalized, state)).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE" });
    expect(original).toEqual(before);
  }
});
it("归一不消除证据、Revision及低置信门禁", () => {
  const original = comparisonQuery("K", "MIN"), valid = normalizeCurrentComparison(original);
  expect(applyDomainPolicy("其他原话", valid, state).intent).toBe("CLARIFY");
  expect(applyDomainPolicy(original.evidence, { ...valid, reference: { ...valid.reference, revision: 8 } }, state).policyReason).toBe("REVISION_CHANGED");
  const low = { ...original, confidence: .7 };
  expect(normalizeCurrentComparison(low)).toBe(low);
});
it("已是只读比较但仍标REFINE时，同样归一当前来源关系，普通比较不补极值", () => {
  const query = comparisonQuery("K", "MIN");
  const read = { ...query, intent: "COMPARE_CANDIDATES" as const, requestedEffect: "READ_ONLY" as const, pageQuery: null, comparison: null };
  const normalized = normalizeCurrentComparison(read);
  expect(normalized).toMatchObject({ relation: "CONTINUE", comparison: null, requestedEffect: "READ_ONLY", reference: read.reference });
  expect(applyDomainPolicy(read.evidence, normalized, state)).toMatchObject({ intent: "COMPARE_CANDIDATES", mutation: "NONE" });
});
it.each([["K", "MIN", "preferLowerK"], ["PRODUCT_R", "MAX", "preferHigherR"], ["TOTAL_R", "MAX", "preferHigherR"]] as const)("%s/%s与%s同方向同证据时，只去掉重复排名声明", (metric,direction,field) => {
  const original = comparisonQuery(metric,direction);
  original.pageQuery!.preferences=[{field,enabled:true,evidence:original.comparison!.evidence}];
  const normalized=normalizeCurrentComparison(original);
  expect(normalized).toMatchObject({intent:"COMPARE_CANDIDATES",relation:"CONTINUE",pageQuery:null,comparison:original.comparison});
  expect(applyDomainPolicy(original.evidence,normalized,state)).toMatchObject({mutation:"NONE"});
});
it("不同偏好、禁用偏好或不同证据不能当成重复声明丢掉",()=>{
  const original=comparisonQuery("K","MIN");
  for(const preference of [{field:"preferThinner" as const,enabled:true,evidence:original.evidence},
    {field:"preferHigherR" as const,enabled:true,evidence:original.evidence},
    {field:"preferLowerK" as const,enabled:false,evidence:original.evidence},
    {field:"preferLowerK" as const,enabled:true,evidence:"另外的排名要求"}]){
    const changed={...original,pageQuery:{...original.pageQuery!,preferences:[preference]}};
    expect(normalizeCurrentComparison(changed)).toBe(changed);
  }
});
it("新增筛选/来源/项目条件或副作用不属于纯当前集合读取，不能清掉条件强行归一", () => {
  const original = comparisonQuery("K", "MIN");
  const proposals = [
    { ...original, queryContext: "CLARIFICATION_REPLY" as const },
    { ...original, pageQuery: { ...original.pageQuery!, constraints: [{ type: "ENTITY", field: "specClass", entityText: "II型", evidence: "II型" } as any] } },
    { ...original, pageQuery: { ...original.pageQuery!, unresolved: ["待核对来源"] } },
    { ...original, pageQuery: { ...original.pageQuery!, readFields: ["layers" as const] } },
    { ...original, constraintPatch: [{ field: "thicknessMm", op: "SET", value: 30, evidence: "30mm" } as const] },
    { ...original, referenceTime: "EARLIER" as const },
    { ...original, requestedEffect: "STATE_MUTATION" as const },
    { ...original, pageQuery: { ...original.pageQuery!, queryMode: "NEW_QUERY" as const } },
    { ...original, effectRequest: { direct: true, polarity: "AFFIRMATIVE", speechAct: "REQUEST", evidence: original.evidence } as const }
  ];
  for (const proposal of proposals) expect(normalizeCurrentComparison(proposal)).toBe(proposal);
});
it.each(["45厚的3型那种外墙，不同砖墙K差多少？", "查III型45mm的K", "比较不同基层", "按原条件改35mm", "继续刚才35mm对比"])("只读查询%s不需要正式副作用授权", message => {
  const before = structuredClone(state);
  const semantic = domainSemanticFixture(message, "REFERENCE_QUERY", { effectRequest: null });
  expect(applyDomainPolicy(message, semantic, state)).toMatchObject({ mutation: "QUERY", policyReason: "READ_ONLY_QUERY" });
  expect(state).toEqual(before);
  expect(applyDomainPolicy(message, { ...semantic, confidence: .5 }, state).intent).toBe("CLARIFY");
});
it("事实核对不视为旧序号；真正旧序号与正式报告不共享只读例外", () => {
  const message = "帮我确认一下K=0.294对不对";
  const semantic = domainSemanticFixture(message, "REFERENCE_DETAIL", { referenceTime: "EARLIER", factRead: { mode: "VERIFY", metric: "K", historyClaim: false, evidence: message } });
  expect(applyDomainPolicy(message, semantic, state)).toMatchObject({ intent: "REFERENCE_DETAIL", mutation: "NONE" });
  expect(applyDomainPolicy(message, { ...semantic, reference: { ...semantic.reference, items: [{ type: "POSITION", value: 2, evidence: message }] } }, state).intent).toBe("CLARIFY");
  const report = domainSemanticFixture("确认最终方案并生成正式PDF", "REPORT_REQUEST", { effectRequest: null });
  expect(applyDomainPolicy("确认最终方案并生成正式PDF", report, state)).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
});
it("旧序号时间指代不能复用更新后列表，即使序号存在也只澄清", () => {
  const message = "刚才那第二个还在吗？";
  const proposal = domainSemanticFixture(message, "REFERENCE_VIEW", { referenceTime: "EARLIER" });
  expect(applyDomainPolicy(message, proposal, state)).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "REFERENCE_TIME_UNRESOLVED" });
});
it("真实UAT-06厚度范围与精确档独立grounding，不把20以内当20mm档", () => {
  const message = "只看20mm以内呢？";
  const proposal = domainSemanticFixture(message, "REFERENCE_REFINE", { constraintPatch: [{ field: "thicknessMax", op: "SET", value: 20, evidence: "20mm以内" }] });
  expect(applyDomainPolicy(message, proposal, state)).toMatchObject({ intent: "REFERENCE_REFINE", mutation: "QUERY" });
  proposal.constraintPatch[0]!.field = "thicknessMm";
  expect(applyDomainPolicy(message, proposal, state).policyReason).toBe("THICKNESS_EVIDENCE_INVALID");
  proposal.constraintPatch[0]!.field = "thicknessMax"; proposal.constraintPatch[0]!.value = 30;
  expect(applyDomainPolicy(message, proposal, state).intent).toBe("CLARIFY");
});
it.each(["SOLUTION_ACTION", "REPORT_REQUEST", "THERMAL_CALCULATE", "REFERENCE_QUERY"] as const)("%s 语义只提案，低置信/否定/引用/假设/证据伪造均无副作用", intent => {
  const message = "完整本轮原话";
  const valid = domainSemanticFixture(message, intent);
  for (const proposal of [{ ...valid, confidence: .2 }, { ...valid, evidence: "伪造" }, { ...valid, requestedEffect: "READ_ONLY" as const },
    ...(["NEGATED", "QUOTED", "HYPOTHETICAL", "EXPLANATION"] as const).map(value => ({ ...valid, effectRequest: { ...valid.effectRequest!,
      polarity: value === "NEGATED" ? "NEGATED" as const : "AFFIRMATIVE" as const, speechAct: value === "NEGATED" ? "REQUEST" as const : value } }))])
    expect(applyDomainPolicy(message, proposal, state)).toMatchObject({ intent: "CLARIFY", mutation: "NONE" });
});
it("澄清回执只给单指标低置信时，问具体口径而不是泛化拒绝", () => {
  const message = "保温热阻0.3的材料";
  const proposal = domainSemanticFixture(message, "REFERENCE_QUERY", { queryContext: "CLARIFICATION_REPLY", relation: "CONTINUE", confidence: .72,
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "NEW_QUERY", confidence: .72, unresolved: [], preferences: [],
      constraints: [{ type: "METRIC", field: null, operation: "SET", value: .3, metric: "PRODUCT_R", operator: "EXACT", evidence: "热阻0.3", entityText: null, resolvedText: null, hard: true, confidence: .7 }] } });
  const decision = applyDomainPolicy(message, proposal, state);
  expect(decision.intent).toBe("CLARIFY");
  expect(decision.unresolved?.[0]).toContain("产品层热阻");
  expect(decision.unresolved?.[0]).toContain("0.3");
});
it("条件与目标正交：原45mm无需刷新，40mm须查表；伪造40mm值拒绝", () => {
  for (const thickness of [45, 40]) {
    const message = `给我${thickness}mm的初步方案，顺便比较基层`;
    const proposal = domainSemanticFixture(message, "SOLUTION_ADVICE", { constraintPatch: [{ field: "thicknessMm", op: "SET", value: thickness, evidence: `${thickness}mm` }] });
    expect(applyDomainPolicy(message, proposal, state)).toMatchObject({ intent: "SOLUTION_ADVICE", mutation: "NONE", requiresCandidateQuery: thickness !== 45 });
    proposal.constraintPatch[0]!.value = 55;
    expect(applyDomainPolicy(message, proposal, state).mutation).toBe("NONE"); expect(applyDomainPolicy(message, proposal, state).intent).toBe("CLARIFY");
  }
});
it("地区排除仅本次Advice视图，不改项目/Query；CLEAR范围和跨revision拒绝", () => {
  const message = "不要考虑地区和建筑类型，先给参考方案";
  const proposal = domainSemanticFixture(message, "SOLUTION_ADVICE", { constraintPatch: [{ field: "region", op: "EXCLUDE_FROM_THIS_ADVICE", value: null, evidence: "不要考虑地区和建筑类型" }] });
  const before = structuredClone(state);
  expect(applyDomainPolicy(message, proposal, state).intent).toBe("SOLUTION_ADVICE"); expect(state).toEqual(before);
  proposal.constraintPatch[0]!.op = "CLEAR"; expect(applyDomainPolicy(message, proposal, state).intent).toBe("CLARIFY");
  proposal.constraintPatch = []; proposal.reference.revision = 6; expect(applyDomainPolicy(message, proposal, state).policyReason).toBe("REVISION_CHANGED");
});
it("模型不得输出正式ID/Confirm/任意patch字段", () => {
  const proposal = domainSemanticFixture("方案", "SOLUTION_ADVICE");
  for (const invalid of [{ ...proposal, candidateId: "fake" }, { ...proposal, intent: "CONFIRM" }, { ...proposal, constraintPatch: [{ field: "selectedIds", op: "SET", value: "fake", evidence: "方案" }] }])
    expect(domainTurnSemanticSchema.safeParse(invalid).success).toBe(false);
});
it("真实UAT编号不能填POSITION，序号和厚度不能填字符串，复用Grounding的强类型引用", () => {
  const proposal = domainSemanticFixture("把 A3-2 的原页给我看一下", "REFERENCE_VIEW");
  for (const item of [{ type: "POSITION", value: "A3-2", evidence: "A3-2" },
    { type: "POSITION", value: "2", evidence: "2" }, { type: "THICKNESS", value: "45", evidence: "45" }])
    expect(domainTurnSemanticSchema.safeParse({ ...proposal, reference: { ...proposal.reference, items: [item] } }).success).toBe(false);
  expect(domainTurnSemanticSchema.safeParse({ ...proposal, reference: { ...proposal.reference,
    items: [{ type: "CONSTRUCTION_CODE", value: "A3-2", evidence: "A3-2" }] } }).success).toBe(true);
});
it("真实UAT复杂操作置信度0.86保持门禁，说明未确认的操作而不是伪称缺体系或基层", () => {
  const message = "把上面 A3-2 和 A3-4 的45mm方案加入方案对比";
  const before = structuredClone(state);
  const decision = applyDomainPolicy(message, domainSemanticFixture(message, "SOLUTION_ACTION", { confidence: .86 }), state);
  expect(decision).toMatchObject({ intent: "CLARIFY", mutation: "NONE", policyReason: "EFFECT_NOT_AUTHORIZED" });
  expect(decision.unresolved?.[0]).toContain("方案操作尚未可靠确认");
  expect(state).toEqual(before);
});

import { normalizeCurrentProjection } from "./ai-domain-semantic.js";
it.each(["current", "new-thickness", "range", "new-source", "no-read-goal", "no-current-source"])("重复已核验当前条件的原页读取：%s不扩大范围", variant => {
  const message = "看原来33mm那档的原页";
  const semantic = domainSemanticFixture(message, "REFERENCE_REFINE", { relation: "REFINE", requestedEffect: "QUERY", effectRequest: null,
    referenceReadFields: variant === "no-read-goal" ? null : ["originalPage"], referenceTime: null,
    reference: { scope: "NONE", revision: null, items: [] }, queryBasis: { scope: "CURRENT_REFERENCE", evidence: message },
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, preferences: [], unresolved: [], readFields: ["originalPage"],
      sourceScope: variant === "new-source" ? { kind: "REFERENCE_SET", ids: ["aa5bdc32-2464-44bf-8b96-f64ff6db7664"], evidence: message } : null,
      constraints: [{ type: "THICKNESS", field: null, operation: "SET", entityText: null, resolvedText: null, metric: null,
        operator: variant === "range" ? "LT" : "EXACT", value: variant === "new-thickness" ? 47 : 33, evidence: "33mm", hard: true, confidence: .95 }] } });
  const result = normalizeCurrentProjection(semantic, { queryScopeCurrent: variant !== "no-current-source", thicknesses: [33] });
  if (variant === "current") expect(result).toMatchObject({ intent: "REFERENCE_VIEW", requestedEffect: "READ_ONLY", pageQuery: null,
    queryBasis: null, referenceTime: "CURRENT", reference: { scope: "LAST_VISIBLE_CANDIDATES", items: [{ type: "THICKNESS", value: 33 }] } });
  else expect(result).toEqual(semantic);
});

import { normalizeQueryReadFields } from "./ai-domain-semantic.js";
it.each(["new-constraint", "empty-query", "read-only"])("查询字段归一：%s保留原条件、来源及读取/副作用权限", variant => {
  const message = "调整至47mm后列出热阻与K";
  const semantic = domainSemanticFixture(message, variant === "read-only" ? "REFERENCE_DETAIL" : "REFERENCE_REFINE", {
    requestedEffect: variant === "read-only" ? "READ_ONLY" : "QUERY", relation: "REFINE", referenceReadFields: ["layers", "kValue"],
    pageQuery: { intent: "REFERENCE_LOOKUP", queryMode: "REFINE_QUERY", confidence: .95, readFields: ["totalThermalResistance"], preferences: [], unresolved: [],
      constraints: variant === "empty-query" ? [] : [{ type: "THICKNESS", field: null, operation: "SET", entityText: null, resolvedText: null,
        metric: null, operator: "EXACT", value: 47, evidence: "47mm", hard: true, confidence: .95 }] } });
  const result = normalizeQueryReadFields(semantic);
  if (variant === "new-constraint") {
    expect(result.referenceReadFields).toBeNull(); expect(result.pageQuery?.readFields).toEqual(["totalThermalResistance", "layers", "kValue"]);
    expect(result.pageQuery?.constraints).toEqual(semantic.pageQuery?.constraints);expect(result.requestedEffect).toBe("QUERY");expect(result.reference).toEqual(semantic.reference);
  } else expect(result).toEqual(semantic);
});
