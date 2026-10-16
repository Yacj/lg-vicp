import { expect, it } from "vitest";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const state = { taskType: "GENERAL", lastReferenceLookup: { query: { thicknessMm: 45 }, candidateQueryRevision: 7, candidates: [] } } as any;
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
