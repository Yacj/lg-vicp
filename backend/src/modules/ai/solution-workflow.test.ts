import { describe, expect, it } from "vitest";
import { applySolutionAction, emptySolution, refreshSolution, referenceSolutionCandidate, compareSelectedSolution, validateFinalSolution, solutionConstraintFingerprint } from "./solution-workflow.js";
import { parseSolutionSelection } from "./solution-selection.js";
import { groundSolutionAction, type ParsedSolutionAction } from "./solution-action-semantic.js";
const candidate = (id: string, thicknessMm = 18) => referenceSolutionCandidate({ id, systemId: "sys", systemName: "薄抹灰",
  schemeId: `scheme-${id}`, schemeCode: `A1-${id}`, catalogProductId: "product", productSpecId: "spec", thicknessMm,
  kValue: .3, productThermalResistance: 2.8, totalThermalResistance: 3.3, sourceDocumentId: "doc", sourcePageId: "page", sourcePageLabel: "22", optionId: "confirmed-option" });
const initial = () => refreshSolution(emptySolution(), { metric: "K", targetValue: .3, mode: "APPROX" }, [candidate("A"), candidate("B", 30), candidate("C", 20)]);
const action = (state: ReturnType<typeof initial>, type: "ADD" | "REMOVE" | "SET_FINAL" | "KEEP_FOR_COMPARISON", ids: string[]) =>
  applySolutionAction(state, { action: type, expectedVersion: 1, candidateIds: ids });
describe("Human-in-the-loop 方案完整生命周期", () => {
  it("部位、构造类别和原表编号均是硬范围；变化后不能沿用旧冲突保留确认", () => {
    for (const query of [{ applicationPart: "ROOF" as const }, { roofForm: "FLAT" as const }, { placements: ["UPRIGHT" as const] },
      { specClasses: ["III" as const] }, { constructionCodes: ["SOURCE-A"] }, { pageLabel: "18" }])
      expect(solutionConstraintFingerprint(query)).not.toBe(solutionConstraintFingerprint({}));
    expect(solutionConstraintFingerprint({ constructionCodes: ["B", "A"], placements: ["INVERTED", "UPRIGHT"] }))
      .toBe(solutionConstraintFingerprint({ constructionCodes: ["A", "B"], placements: ["UPRIGHT", "INVERTED"] }));
  });
  it("多选→偏好重查→硬条件冲突→移除→比较→Final→冻结值", () => {
    let state = initial();
    state = applySolutionAction(state, { action: "SELECT", expectedVersion: 1, positions: [1, 3], candidateSetRevision: state.candidateSetRevision });
    expect(state.selectedCandidateIds).toEqual(["A", "C"]);
    state = action(state, "ADD", ["B"]);
    state = refreshSolution(state, { ...state.queryStateSnapshot, preferences: { preferThinner: true } }, [candidate("D", 10)]);
    expect(state.candidateSetRevision).toBe(2); expect(state.selectedCandidateIds).toEqual(["A", "C", "B"]);
    expect(state.conflicts).toEqual([]);
    state = refreshSolution(state, { ...state.queryStateSnapshot, thicknessMax: 20 }, [candidate("D", 10)]);
    expect(state.candidates.find(item => item.candidate.candidateId === "B")?.status).toBe("CONFLICT");
    expect(state.conflicts[0]?.code).toBe("THICKNESS_MISMATCH");
    state = action(state, "REMOVE", ["B"]);
    expect(compareSelectedSolution(state).candidates.map(item => item.candidateId)).toEqual(["A", "C"]);
    state = action(state, "SET_FINAL", state.selectedCandidateIds);
    const values = validateFinalSolution(state);
    state.candidates[0]!.candidate.kValue = 99;
    expect(values[0]?.kValue).toBe(.3);
  });
  it("幂等加入/移除及拒绝后恢复", () => {
    let state = action(initial(), "ADD", ["A", "A"]);
    state = action(state, "ADD", ["A"]); expect(state.selectedCandidateIds).toEqual(["A"]);
    state = action(state, "REMOVE", ["A"]); state = action(state, "REMOVE", ["A"]);
    expect(state.rejectedCandidateIds).toEqual(["A"]);
    state = action(state, "ADD", ["A"]); expect(state.rejectedCandidateIds).toEqual([]);
  });
  it("旧列表序号、非法 ID 与范围不能写入", () => {
    const state = initial();
    expect(() => applySolutionAction(state, { action: "ADD", expectedVersion: 1, positions: [1], candidateSetRevision: 0 })).toThrow("候选列表已变化");
    expect(() => action(state, "ADD", ["invented"])).toThrow("不属于");
    expect(() => applySolutionAction(state, { action: "ADD", expectedVersion: 1, positions: [9], candidateSetRevision: 1 })).toThrow("超出");
  });
  it("冲突可保留比较，但不能成为确认方案", () => {
    let state = action(initial(), "ADD", ["A", "B"]);
    state = refreshSolution(state, { thicknessMax: 20 }, [candidate("A")]);
    state = action(state, "KEEP_FOR_COMPARISON", ["B"]);
    expect(compareSelectedSolution(state).candidates[1]?.conflicts[0]?.keptForComparison).toBe(true);
    state = action(state, "SET_FINAL", ["B"]); expect(() => validateFinalSolution(state)).toThrow("硬条件冲突");
  });
  it("少于两个已选时不补全池；推荐不会设 Final", () => {
    const state = action(initial(), "ADD", ["A"]);
    expect(() => compareSelectedSolution(state)).toThrow("至少选择两个");
    expect(state.recommendedCandidateIds).toEqual(["A"]); expect(state.finalCandidateIds).toEqual([]);
  });
  it.each(["行", "可以", "帮我确认一下", "确认生成方案，然后改成30"]) ("歧义文本 %s 不冻结", text => {
    expect(parseSolutionSelection(text, initial())?.action).not.toBe("CONFIRM");
  });
  it.each(["确认生成方案", "确认最终方案"]) ("明确确认 %s", text => {
    expect(parseSolutionSelection(text, initial())?.action).toBe("CONFIRM");
  });
  it("Final 缺事实/来源必须拒绝", () => {
    const state = action(initial(), "SET_FINAL", ["A"]);
    state.candidates[0]!.candidate.sourcePageId = null;
    expect(() => validateFinalSolution(state)).toThrow("可追溯");
    state.candidates[0]!.candidate.kValue = undefined;
    expect(() => validateFinalSolution(state)).toThrow("关键正式事实");
  });
  it("未处理备选冲突必须先移除或明确保留比较", () => {
    let state = action(initial(), "ADD", ["A", "B"]);
    state = refreshSolution(state, { thicknessMax: 20 }, [candidate("A")]);
    state = action(state, "SET_FINAL", ["A"]);
    expect(() => validateFinalSolution(state)).toThrow("未处理冲突");
    state = action(state, "KEEP_FOR_COMPARISON", ["B"]);
    expect(validateFinalSolution(state).map(candidate => candidate.candidateId)).toEqual(["A"]);
  });
  it("Hard Constraint实质变化后旧THICKNESS确认不能接受新SYSTEM冲突", () => {
    let state = action(initial(), "ADD", ["A", "B"]);
    state = refreshSolution(state, { thicknessMax: 20 }, [candidate("A")]);
    state = action(state, "KEEP_FOR_COMPARISON", ["B"]);
    expect(state.conflicts.find(item => item.candidateId === "B")?.keptForComparison).toBe(true);
    state = refreshSolution(state, { systemId: "another-system" }, []);
    expect(state.conflicts.find(item => item.candidateId === "B")?.code).toBe("SYSTEM_MISMATCH");
    expect(state.conflicts.find(item => item.candidateId === "B")?.keptForComparison).toBe(false);
    expect(state.keptForComparisonIds).toEqual([]);
    expect(state.selectedCandidateIds).toEqual(["A", "B"]);
  });
  it("仅偏好/查询追踪变化保留旧确认，刷新同条件和filters顺序不误清除", () => {
    let state = action(initial(), "ADD", ["A", "B"]);
    const filters = [{ metric: "K" as const, mode: "MAX_LIMIT" as const, targetValue: .35 },
      { metric: "TOTAL_R" as const, mode: "MIN_LIMIT" as const, targetValue: 3 }];
    state = refreshSolution(state, { thicknessMax: 20, filters }, [candidate("A")]);
    state = action(state, "KEEP_FOR_COMPARISON", ["B"]);
    state = refreshSolution(state, { thicknessMax: 20, filters: [...filters].reverse(), preferences: { preferThinner: true },
      queryMode: "REFINE_QUERY", semanticConfidence: .99 }, [candidate("A")]);
    expect(state.conflicts.find(item => item.candidateId === "B")?.keptForComparison).toBe(true);
  });
  it("取消厚度交还查询Parser，旧序号不能猜新列表，确认后修订为独立动作", () => {
    expect(parseSolutionSelection("去掉厚度限制", initial())).toBeNull();
    const state = refreshSolution(initial(), {}, [candidate("D")]);
    const semantic: ParsedSolutionAction = { type: "ADD", references: [{ type: "POSITION", value: 2, evidence: "第二个" }],
      selectionMode: "INCLUDE", referenceScope: "CURRENT_POOL", temporalScope: "PREVIOUS", evidence: "重新加回来", confidence: .95, unresolved: [] };
    expect(groundSolutionAction("刚才第二个重新加回来", semantic, state, state.candidateSetRevision)?.clarification).toBeTruthy();
    expect(parseSolutionSelection("我又想改成另一个", state)?.action).toBe("REVISE");
  });
});
