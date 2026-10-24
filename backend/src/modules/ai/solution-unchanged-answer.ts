/** An empty action result conveys no execution success; state comes only from Backend. */
export function solutionUnchangedAnswer(state?: { stage: string; selectedCount: number; finalCount: number; confirmedSnapshotId: string | null } | null) {
  const prefix = "本轮没有执行方案操作，也没有生成新的快照或报告。";
  if (state?.stage === "CONFIRMED" && state.confirmedSnapshotId)
    return prefix + "当前方案已确认，原快照保留。";
  if (state?.stage === "READY_TO_CONFIRM" && state.finalCount > 0)
    return prefix + "当前最终候选尚待确认，核对参数后可点击确认入口。";
  if (state?.selectedCount)
    return prefix + `当前已选用${state.selectedCount}个候选，尚未形成待确认的最终方案。`;
  return prefix + "当前尚未形成待确认的最终方案，可以先选用候选，再设为最终方案。";
}
