import { expect, it } from "vitest";
import { parseSolutionActionFastPath, groundSolutionAction } from "./solution-action-semantic.js";
import { applySolutionAction, emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
it("当前这套仅绑定实际焦点与授权池的唯一交集，不能回落旧候选", () => {
  const state = refreshSolution(emptySolution(), {}, [referenceSolutionCandidate({ id: "a", thicknessMm: 28 }), referenceSolutionCandidate({ id: "b", thicknessMm: 46 })]);
  const message = "采用当前这套作为最终方案";
  const raw = { type: "SET_FINAL", references: [{ type: "CURRENT_REFERENCE", evidence: "当前这套" }], evidence: message,
    confidence: .98, unresolved: [], referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", selectionMode: "INCLUDE" };
  expect(groundSolutionAction(message, raw, state, state.candidateSetRevision, ["b"])?.candidateIds).toEqual(["b"]);
  for (const focus of [[], ["a", "b"], ["invented"]]) expect(groundSolutionAction(message, raw, state, state.candidateSetRevision, focus)?.clarification).toBeTruthy();
  expect(groundSolutionAction(message, raw, state, state.candidateSetRevision + 1, ["b"])?.clarification).toBeTruthy();
  expect(groundSolutionAction(message, { ...raw, references: [{ type: "CURRENT_REFERENCE", evidence: "并未说过" }] }, state, state.candidateSetRevision, ["b"])?.clarification).toBeTruthy();
});
it("真实UAT外墙编号前缀仅作格式归一；多档同编号仍拒绝歧义", () => {
  const message = "把 A3-2 和 A3-4 加入方案对比";
  const candidates = [referenceSolutionCandidate({ id: "two", schemeCode: "A3-2", thicknessMm: 45 }),
    referenceSolutionCandidate({ id: "four", schemeCode: "外墙A3-4", thicknessMm: 45 })];
  const state = refreshSolution(emptySolution(), {}, candidates);
  const raw = { type: "ADD", references: [{ type: "CONSTRUCTION_CODE", value: "A3-2", evidence: "A3-2" },
    { type: "CONSTRUCTION_CODE", value: "A3-4", evidence: "A3-4" }], evidence: message,
    confidence: .99, unresolved: [], referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", selectionMode: "INCLUDE" };
  expect(groundSolutionAction(message, raw, state, state.candidateSetRevision)).toMatchObject({ candidateIds: ["two", "four"] });
  const ambiguous = refreshSolution(emptySolution(), {}, [...candidates, { ...candidates[1]!, id: "other", candidateId: "other", thicknessMm: 18 }]);
  expect(groundSolutionAction(message, raw, ambiguous, ambiguous.candidateSetRevision)?.clarification).toBeTruthy();
});
it.each(["确认生成方案", "确认最终方案", "确认提交", "开始做方案", "重新做一套方案"])("SM-CLOSED-01 既有完整命令 %s", message => expect(parseSolutionActionFastPath(message)).toBeTruthy());
it.each(["确认一下A3-2的K", "确认一下参数", "确认最终方案以后怎么修改", "开始做方案会怎样", "仅给我方案提纲"])("SM-CLOSED-01 相似反例 %s", message => expect(parseSolutionActionFastPath(message)).toBeNull());
it.each(["不要确认最终方案", "他说‘确认提交’", "假设开始做方案", "暂不确认，先给建议", "第一套设为Final，确认提交"])("SM-CLOSED-01 否定/引用/复合禁止越级 %s", message => expect(parseSolutionActionFastPath(message)).toBeNull());
it.each(["确认最终方案！", " 开始做方案 "])("SM-FORMAT-01 只允许末尾标点及首尾空白 %s", message => expect(parseSolutionActionFastPath(message)).toBeTruthy());
it("SM-NUMBER/EVIDENCE/ID引用必须来自原话且属于当前revision", () => {
  const state = refreshSolution(emptySolution(), {}, [referenceSolutionCandidate({ id: "real", schemeCode: "A3-2", thicknessMm: 45 })]);
  const raw = { type: "SELECT", references: [{ type: "POSITION", value: 1, evidence: "第一个" }], evidence: "第一个留下",
    confidence: .99, unresolved: [], referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", selectionMode: "INCLUDE" };
  expect(groundSolutionAction("第一个留下", raw, state, state.candidateSetRevision)).toMatchObject({ candidateIds: ["real"] });
  for (const proposal of [{ ...raw, evidence: "不存在的原话" }, { ...raw, references: [{ type: "POSITION", value: 2, evidence: "第一个" }] },
    { ...raw, references: [{ type: "THICKNESS", value: 30, evidence: "第一个" }] }, { ...raw, candidateId: "fake" }])
    expect(groundSolutionAction("第一个留下", proposal, state, state.candidateSetRevision)?.clarification).toBeTruthy();
  expect(groundSolutionAction("第一个留下", raw, state, state.candidateSetRevision + 1)?.clarification).toBeTruthy();
});
it("自然名称仅从当前授权名称集合唯一绑定，不接受模型补ID/编码或消除歧义", () => {
  const candidates = [referenceSolutionCandidate({ id: "one", schemeCode: "REAL-1", schemeName: "薄层构造", thicknessMm: 32 }),
    referenceSolutionCandidate({ id: "two", schemeCode: "REAL-2", schemeName: "厚层构造", thicknessMm: 48 })];
  const state = refreshSolution(emptySolution(), {}, candidates);
  const message = "采用较薄的32mm那套";
  const raw = { type: "SET_FINAL", references: [{ type: "CANDIDATE_LABEL", value: "薄层构造", evidence: "较薄的32mm那套", thicknessMm: 32, thicknessEvidence: "32mm" }], evidence: message,
    confidence: .99, unresolved: [], referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", selectionMode: "INCLUDE" };
  expect(groundSolutionAction(message, raw, state, state.candidateSetRevision)).toMatchObject({ action: "SET_FINAL", candidateIds: ["one"] });
  const duplicate = refreshSolution(emptySolution(), {}, [...candidates, referenceSolutionCandidate({ id: "three", schemeCode: "REAL-3", schemeName: "薄层构造", thicknessMm: 32 })]);
  expect(groundSolutionAction(message, raw, duplicate, duplicate.candidateSetRevision)?.clarification).toBeTruthy();
  for (const ref of [{ ...raw.references[0], value: "REAL-1" }, { ...raw.references[0], value: "未知构造" },
    { ...raw.references[0], thicknessMm: 48 }, { ...raw.references[0], candidateId: "one" }, { type: "CONSTRUCTION_CODE", value: "REAL-1", evidence: "较薄的32mm那套" }])
    expect(groundSolutionAction(message, { ...raw, references: [ref] }, state, state.candidateSetRevision)?.clarification).toBeTruthy();
  expect(groundSolutionAction(message, raw, state, state.candidateSetRevision + 1)?.clarification).toBeTruthy();
});
it("Final与明确保留的参考分别绑定，未授权ID不能进入冻结备选集合", () => {
  const state = refreshSolution(emptySolution(), {}, [referenceSolutionCandidate({ id: "A", schemeCode: "CODE-A", schemeName: "方案甲", thicknessMm: 32 }),
    referenceSolutionCandidate({ id: "B", schemeCode: "CODE-B", schemeName: "方案乙", thicknessMm: 48 })]);
  const message = "采用甲的32mm作最终方案，乙的48mm仅作参考，先不确认";
  const raw = { type: "SET_FINAL", references: [{ type: "CANDIDATE_LABEL", value: "方案甲", evidence: "甲的32mm", thicknessMm: 32, thicknessEvidence: "32mm" }],
    comparisonReferences: [{ type: "CANDIDATE_LABEL", value: "方案乙", evidence: "乙的48mm仅作参考", thicknessMm: 48, thicknessEvidence: "48mm" }],
    evidence: message, confidence: .99, unresolved: [], referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", selectionMode: "INCLUDE" };
  const parsed = groundSolutionAction(message, raw, state, state.candidateSetRevision)!;
  expect(parsed).toMatchObject({ action: "SET_FINAL", candidateIds: ["A"], comparisonCandidateIds: ["B"] });
  const result = applySolutionAction(state, { action: "SET_FINAL", candidateIds: parsed.candidateIds, comparisonCandidateIds: parsed.comparisonCandidateIds, expectedVersion: 1 });
  expect(result.finalCandidateIds).toEqual(["A"]); expect(result.selectedCandidateIds).toEqual(["A", "B"]);
  expect(() => applySolutionAction(state, { action: "SET_FINAL", candidateIds: ["A"], comparisonCandidateIds: ["invented"], expectedVersion: 1 })).toThrow();
  expect(() => applySolutionAction(state, { action: "ADD", candidateIds: ["A"], comparisonCandidateIds: ["B"], expectedVersion: 1 })).toThrow();
});
