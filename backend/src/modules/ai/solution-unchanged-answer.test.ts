import { expect, it } from "vitest";
import { solutionUnchangedAnswer } from "./solution-unchanged-answer.js";

it("空动作不把候选或空集合说成已设Final或待确认", () => {
  for (const state of [null, { stage: "DRAFT", selectedCount: 0, finalCount: 0, confirmedSnapshotId: null },
    { stage: "DRAFT", selectedCount: 1, finalCount: 0, confirmedSnapshotId: null }])
    expect(solutionUnchangedAnswer(state)).toContain("尚未形成待确认的最终方案");
});
it("待确认和已确认均须真实状态，旧快照不能当作本轮执行成功", () => {
  expect(solutionUnchangedAnswer({ stage: "READY_TO_CONFIRM", selectedCount: 1, finalCount: 1, confirmedSnapshotId: null })).toContain("当前最终候选尚待确认");
  expect(solutionUnchangedAnswer({ stage: "CONFIRMED", selectedCount: 1, finalCount: 1, confirmedSnapshotId: "snapshot" })).toContain("原快照保留");
  expect(solutionUnchangedAnswer({ stage: "READY_TO_CONFIRM", selectedCount: 0, finalCount: 0, confirmedSnapshotId: null })).toContain("尚未形成");
});
