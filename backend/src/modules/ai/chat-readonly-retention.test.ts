import "dotenv/config";
import { expect, it } from "vitest";
import { groundSolutionAction, type ChatReadOnlyReference } from "./solution-action-semantic.js";
import { applySolutionAction, emptySolution, refreshSolution, referenceSolutionCandidate } from "./solution-workflow.js";
import { specThicknessConflict } from "../../shared/reference-data-conflict.js";
const state = () => refreshSolution(emptySolution(), {}, [referenceSolutionCandidate({ id: "valid", schemeCode: "APPROVED", thicknessMm: 28 })]);
const reference: ChatReadOnlyReference = { fingerprint: "source-fingerprint", label: "分层参考构造", code: "SOURCE", thicknessMm: 42,
  conflict: specThicknessConflict({ rowThicknessMm: 42, specThicknessMm: 28, specCode: "SPEC-28", schemeName: "分层参考构造", evidenceSource: "已审核表", setVersion: 2 }) };
const message = "28mm定为最终方案，分层参考构造留在对话中核对";
const proposal = () => ({ type: "SET_FINAL", references: [{ type: "THICKNESS", value: 28, evidence: "28mm" }],
  readOnlyReferences: [{ label: reference.label, evidence: "分层参考构造", thicknessEvidence: null }],
  comparisonReferences: [], selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "CURRENT", evidence: message, confidence: .96, unresolved: [] });
it("有效Final与只读冲突资料分开绑定；只有真实正式候选进入方案payload", () => {
  const before = state(), parsed = groundSolutionAction(message, proposal(), before, before.candidateSetRevision, undefined,
    { queryRevision: before.candidateSetRevision, references: [reference] });
  expect(parsed).toMatchObject({ action: "SET_FINAL", candidateIds: ["valid"], chatReferenceRetention: { references: [reference] } });
  expect(parsed?.comparisonCandidateIds).toBeUndefined();
  const changed = applySolutionAction(before, { action: parsed!.action, candidateIds: parsed!.candidateIds, expectedVersion: before.version });
  expect(changed.finalCandidateIds).toEqual(["valid"]);
  expect(JSON.stringify(changed)).not.toContain(reference.fingerprint);
  expect(changed.candidates.map(item => item.candidate.candidateId)).toEqual(["valid"]);
});
it.each(["withdrawn", "old-revision", "ambiguous", "invented-label", "bad-evidence", "invented-thickness", "wrong-operation", "old-list"])("%s不能部分执行Final，也不把只读身份变为正式候选", variant => {
  const before = state(), raw = proposal();
  if (variant === "invented-label") raw.readOnlyReferences[0]!.label = "未授权名称";
  if (variant === "bad-evidence") raw.readOnlyReferences[0]!.evidence = "用户没说的内容";
  if (variant === "invented-thickness") Object.assign(raw.readOnlyReferences[0]!, { thicknessMm: 42, thicknessEvidence: "42mm" });
  if (variant === "wrong-operation") raw.type = "ADD";
  if (variant === "old-list") raw.temporalScope = "PREVIOUS";
  const catalog = variant === "withdrawn" ? undefined : { queryRevision: before.candidateSetRevision + (variant === "old-revision" ? 1 : 0),
    references: variant === "ambiguous" ? [reference, { ...reference, fingerprint: "other-source" }] : [reference] };
  expect(groundSolutionAction(message, raw, before, before.candidateSetRevision, undefined, catalog)).toHaveProperty("clarification");
  expect(before.selectedCandidateIds).toEqual([]);
});
it("正式备选请求继续按正式池校验，不能因存在只读资料而降格执行", () => {
  const before = state(), raw = proposal();raw.comparisonReferences = [{ type: "CANDIDATE_LABEL", value: reference.label, evidence: "分层参考构造", thicknessMm: null, thicknessEvidence: null }] as any;raw.readOnlyReferences = [];
  expect(groundSolutionAction(message, raw, before, before.candidateSetRevision, undefined,
    { queryRevision: before.candidateSetRevision, references: [reference] })).toHaveProperty("clarification");
  expect(before.finalCandidateIds).toEqual([]);
});
