import { expect, it } from "vitest";
import { applyDomainPolicy } from "./ai-domain-policy.js";
import { domainTurnSemanticSchema } from "./ai-domain-semantic.js";
import { domainSemanticFixture } from "./domain-semantic.fixture.js";
const state = { taskType: "GENERAL", lastReferenceLookup: { query: { thicknessMm: 45 }, candidateQueryRevision: 7, candidates: [] } } as any;
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
