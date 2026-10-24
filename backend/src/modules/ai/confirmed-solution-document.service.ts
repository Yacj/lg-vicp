import type { SolutionContext } from "./solution-state.service.js";
import { assertSolutionAccess, loadActiveSolution, getSolutionSnapshot } from "./solution-state.service.js";
import { toSolutionDocumentModel } from "./solution-document-model.js";
import { emptySolution, solutionCandidateSchema, validateFinalSolution } from "./solution-workflow.js";
import { solutionReportError } from "./report-authorization.js";
import { and, eq, isNull } from "drizzle-orm";
import { projects } from "../../db/schema.js";
import { canManageProject } from "../../shared/permissions.js";
import { NotFoundError } from "../../shared/errors.js";

/** 只读服务端确认快照；不重查候选、产品值或计算引擎。调用方持有会话事务锁。 */
export async function loadConfirmedSolutionDocument(ctx: SolutionContext, expectedSnapshotId?: string) {
  const conversation = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (conversation.projectId !== ctx.conversation.projectId)
    solutionReportError("SOLUTION_PROJECT_CHANGED", "会话项目已变化，请刷新后生成报告。");
  const active = await loadActiveSolution(ctx);
  if (!active || active.stage !== "CONFIRMED" || !active.confirmedSnapshotId || active.projectId !== conversation.projectId
    || active.userId !== ctx.user.id || active.conversationId !== conversation.id)
    solutionReportError("SOLUTION_SNAPSHOT_REQUIRED", active?.stage === "READY_TO_CONFIRM"
      ? "这套最终方案已经整理好了。请核对下方参数并点击“确认生成方案”，再点“生成技术方案 PDF”，报告就会按你确认的版本生成。规范适用性仍需另行核对。"
      : "请先在下方选定最终方案，核对参数后点击“确认生成方案”，再生成PDF；还没确认的参考记录不能直接作为方案报告。规范适用性仍需另行核对。");
  if (expectedSnapshotId && expectedSnapshotId !== active.confirmedSnapshotId)
    solutionReportError("SOLUTION_SNAPSHOT_CHANGED", "当前确认方案已变化，请使用当前方案快照生成报告。");
  // 与报告REST一致：项目可见性不等于报告生成/管理权限；该读取只用于权限，不覆盖冻结项目事实。
  if (conversation.projectId) {
    const [project] = await ctx.app.db.select().from(projects).where(and(eq(projects.id, conversation.projectId), isNull(projects.deletedAt))).limit(1);
    if (!project || !canManageProject(ctx.user, project)) throw new NotFoundError("项目不存在或无权生成报告");
  }
  const snapshot = await getSolutionSnapshot(ctx, active.confirmedSnapshotId);
  if (snapshot.id !== active.confirmedSnapshotId || snapshot.solutionStateId !== active.id
    || snapshot.userId !== ctx.user.id || snapshot.conversationId !== conversation.id || snapshot.projectId !== conversation.projectId)
    solutionReportError("SOLUTION_SNAPSHOT_INVALID", "确认方案快照不属于当前用户、会话或项目。");
  const payload = snapshot.payload;
  if (!payload.finalCandidateIds?.length || new Set(payload.finalCandidateIds).size !== payload.finalCandidateIds.length
    || payload.candidates.length !== payload.finalCandidateIds.length
    || payload.finalCandidateIds.some(id => !payload.selectedCandidateIds.includes(id))
    || payload.alternatives.some(candidate => payload.finalCandidateIds.includes(candidate.candidateId)))
    solutionReportError("SOLUTION_FINAL_REQUIRED", "方案快照没有完整、独立的最终方案，请重新确认。");
  validateFinalSolution({ ...emptySolution(), finalCandidateIds: payload.finalCandidateIds,
    selectedCandidateIds: payload.selectedCandidateIds, candidates: payload.candidates.map(candidate => ({
      candidate: solutionCandidateSchema.parse(candidate), sourceRevision: 0, status: "FINAL" as const })) });
  const model = toSolutionDocumentModel(snapshot);
  const readableImages = new Set(snapshot.referenceImages.filter(page => page.imageUrl).map(page => page.sourcePageId));
  model.referencePages = model.referencePages.map(page => ({ ...page, pageId: page.sourcePageId,
    pageImageObjectKey: readableImages.has(page.sourcePageId as string) && typeof page.objectKey === "string" ? page.objectKey : null }));
  return model;
}
