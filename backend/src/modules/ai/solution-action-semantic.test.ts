import { expect, it } from "vitest";
import { parseSolutionActionFastPath, groundSolutionAction } from "./solution-action-semantic.js";
import { emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
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
