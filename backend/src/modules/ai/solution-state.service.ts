import { publishedConstructionLayersStillCurrent } from "./published-construction-layers.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, isNull } from "drizzle-orm";
import { aiConversationStates, aiConversations, projects, solutionStates, solutionSnapshots, thermalCalcRecords, constructionSchemes, insulationSystems, catalogProducts, productSpecs } from "../../db/schema.js";
import { parseConversationTaskState, type LastReferenceLookup, type ConversationTaskState } from "./conversation-task.js";
import type { DbExecutor } from "../../db/client.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { clientAppForClient } from "../../shared/client-guard.js";
import { NotFoundError } from "../../shared/errors.js";
import { canViewProject } from "../../shared/permissions.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { queryThermalCandidates } from "../thermal/thermal-candidate.service.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { compactCandidateResult } from "./tools/thermal-lookup.js";
import { emitReferencePages } from "./tools/thermal-calculate.tool.js";
import { readConsumableReferencePages } from "./ai-reference-pages.service.js";
import { readableRenderModel, sameFrozenPageFacts } from "../../shared/readable-page-render.js";
import { visiblePageLabel } from "../../shared/page-label.js";
import { hasPublishedReferenceSource, samePublishedReferenceSource } from "./published-reference-source.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { matchConfirmedPageOptions } from "../knowledge/knowledge-test-reference.js";
import type { ThermalQueryState } from "../thermal/thermal-query-state.js";
import { emptySolution, refreshSolution, applySolutionAction, compareSelectedSolution, referenceSolutionCandidate, solutionCards,
  solutionError, solutionCandidateSchema, resolveActionCandidateIds, validateFinalSolution, type SolutionAction, type SolutionCandidateSnapshot, type SolutionStage } from "./solution-workflow.js";

export type SolutionContext = { app: FastifyInstance; request: FastifyRequest; user: AuthUser; conversation: { id: string; projectId: string | null } };
export type SolutionStateRow = typeof solutionStates.$inferSelect;
export function solutionDto(row: SolutionStateRow) {
  return { ...row, ...row.payload, payload: undefined, candidateCards: solutionCards(row.payload),
    debug: { solutionStateId: row.id, stage: row.stage, candidateSetRevision: row.candidateSetRevision,
      candidateCount: row.payload.candidates.length, selectedIds: row.payload.selectedCandidateIds, rejectedIds: row.payload.rejectedCandidateIds,
      finalIds: row.payload.finalCandidateIds, conflicts: row.payload.conflicts, confirmedSnapshotId: row.confirmedSnapshotId } };
}
/** 不接受调用方声称的归属；每次都重新校验会话、客户端与项目。 */
export async function assertSolutionAccess(db: DbExecutor, user: AuthUser, conversationId: string) {
  const [conversation] = await db.select().from(aiConversations).where(and(eq(aiConversations.id, conversationId),
    eq(aiConversations.userId, user.id), eq(aiConversations.status, "active"), isNull(aiConversations.deletedAt))).limit(1);
  if (!conversation || conversation.clientApp !== clientAppForClient(user.clientType)) throw new NotFoundError("AI 会话不存在或无权访问");
  if (conversation.projectId) {
    const [project] = await db.select().from(projects).where(and(eq(projects.id, conversation.projectId), isNull(projects.deletedAt))).limit(1);
    if (!project || !canViewProject(user, project)) throw new NotFoundError("项目不存在或无权访问");
  }
  return conversation;
}
export async function loadActiveSolution(ctx: SolutionContext, db: DbExecutor = ctx.app.db) {
  await assertSolutionAccess(db, ctx.user, ctx.conversation.id);
  const [state] = await db.select().from(solutionStates).where(and(eq(solutionStates.conversationId, ctx.conversation.id), eq(solutionStates.active, true))).limit(1);
  if (state) await assertBoundProject(db, ctx.user, state.projectId);
  return state ?? null;
}
async function assertBoundProject(db: DbExecutor, user: AuthUser, projectId: string | null) {
  if (!projectId) return;
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), isNull(projects.deletedAt))).limit(1);
  if (!project || !canViewProject(user, project)) throw new NotFoundError("方案所属项目不存在或无权访问");
}
async function audit(ctx: SolutionContext, db: DbExecutor, state: SolutionStateRow, action: string) {
  await writeAuditLog({ db, request: ctx.request, actor: ctx.user, projectId: state.projectId ?? undefined, action: `ai.solution.${action}`,
    targetType: "solution_state", targetId: state.id, afterJson: solutionDto(state).debug });
}
async function createState(ctx: SolutionContext, db: DbExecutor, previous?: SolutionStateRow | null, clone = false) {
  const conversation = await assertSolutionAccess(db, ctx.user, ctx.conversation.id);
  if (previous) await db.update(solutionStates).set({ active: false, updatedAt: new Date() }).where(eq(solutionStates.id, previous.id));
  const payload = clone && previous ? { ...structuredClone(previous.payload), finalCandidateIds: [] } : emptySolution();
  const [state] = await db.insert(solutionStates).values({ conversationId: conversation.id, userId: ctx.user.id, projectId: conversation.projectId,
    payload, candidateSetRevision: payload.candidateSetRevision, stage: payload.candidates.length ? "CANDIDATE_SELECTION" : "COLLECTING_REQUIREMENTS" }).returning();
  await audit(ctx, db, state!, "created");
  return state!;
}
async function lockConversation(ctx: SolutionContext, db: DbExecutor) {
  await db.select({ id: aiConversations.id }).from(aiConversations).where(eq(aiConversations.id, ctx.conversation.id)).for("update");
}
export async function startSolution(ctx: SolutionContext, expectedVersion?: number) {
  return ctx.app.db.transaction(async tx => {
    await lockConversation(ctx, tx);
    const current = await loadActiveSolution(ctx, tx);
    if (expectedVersion != null && current?.version !== expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "方案已被其他请求修改，请刷新");
    return solutionDto(await createState(ctx, tx, current));
  });
}
export function isEditableSolution(state: SolutionStateRow | null | undefined): state is SolutionStateRow {
  return Boolean(state?.active && !state.confirmedSnapshotId && !["CONFIRMED", "GENERATING", "GENERATED"].includes(state.stage));
}
/** 刷新只消费已有可编辑状态，绝不隐式创建。 */
export function refreshActiveSolutionCandidates(ctx: SolutionContext, query: ThermalQueryState, candidates: SolutionCandidateSnapshot[], expectedVersion: number): Promise<ReturnType<typeof solutionDto>>;
export function refreshActiveSolutionCandidates(ctx: SolutionContext, query: ThermalQueryState, candidates: SolutionCandidateSnapshot[], expectedVersion?: number): Promise<ReturnType<typeof solutionDto> | null>;
export async function refreshActiveSolutionCandidates(ctx: SolutionContext, query: ThermalQueryState, candidates: SolutionCandidateSnapshot[], expectedVersion?: number) {
  return ctx.app.db.transaction(async tx => {
    await lockConversation(ctx, tx);
    const state = await loadActiveSolution(ctx, tx);
    if (expectedVersion != null && state?.version !== expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "查询期间方案已变化，请刷新后重试");
    const conversation = await assertSolutionAccess(tx, ctx.user, ctx.conversation.id);
    if (!isEditableSolution(state) || state.projectId !== conversation.projectId) {
      if (expectedVersion != null) solutionError("SOLUTION_NOT_EDITABLE", "请先开始或调整方案");
      return null;
    }
    return refreshState(ctx, tx, state, query, candidates);
  });
}
async function refreshState(ctx: SolutionContext, tx: DbExecutor, state: SolutionStateRow, query: ThermalQueryState, candidates: SolutionCandidateSnapshot[]) {
  const payload = refreshSolution(state.payload, query, candidates);
  const stage: SolutionStage = query.unresolved?.length ? "COLLECTING_REQUIREMENTS" : payload.selectedCandidateIds.length ? "REFINING"
    : candidates.length ? "CANDIDATE_SELECTION" : "COLLECTING_REQUIREMENTS";
  const [updated] = await tx.update(solutionStates).set({ payload, stage, candidateSetRevision: payload.candidateSetRevision,
    version: state.version + 1, updatedAt: new Date() }).where(and(eq(solutionStates.id, state.id), eq(solutionStates.version, state.version))).returning();
  if (!updated) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
  await audit(ctx, tx, updated, "refreshed");
  return solutionDto(updated);
}
export async function querySolution(ctx: SolutionContext, query: ThermalQueryState, expectedVersion: number) {
  const current = await loadActiveSolution(ctx);
  if (current?.version !== expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
  if (!isEditableSolution(current)) solutionError("SOLUTION_NOT_EDITABLE", "请先开始或调整方案");
  const result = await querySolutionCandidates(ctx, query);
  const recorded = await recordCandidateResult(ctx, { query: result.queryState, candidates: result.matchedCandidates, createdAt: new Date().toISOString() }, false, expectedVersion);
  return recorded.solutionState!;
}
function asSolutionCandidate(candidate: LastReferenceLookup["candidates"][number]) {
  return candidate.sourceType ? solutionCandidateSchema.parse({ ...candidate, candidateId: candidate.id,
    ...(candidate.sourceType === "REFERENCE" ? { thermalReferenceRowId: candidate.id } : {}) }) : referenceSolutionCandidate(candidate);
}
async function readLookupTask(db: DbExecutor, conversationId: string) {
  const [row] = await db.select().from(aiConversationStates).where(eq(aiConversationStates.conversationId, conversationId)).limit(1);
  return { row, task: parseConversationTaskState(row?.taskStateJson) };
}
/** 查询结果与可编辑方案刷新在同一会话锁内保存；revision只属于可见查询结果。 */
export async function recordCandidateResult(ctx: SolutionContext & { taskState?: ConversationTaskState | null }, snapshot: LastReferenceLookup, append = false, expectedVersion?: number, executor?: DbExecutor) {
  const persist = async (tx: DbExecutor) => {
    await lockConversation(ctx, tx);
    const conversation = await assertSolutionAccess(tx, ctx.user, ctx.conversation.id);
    const { row, task } = await readLookupTask(tx, conversation.id);
    const lookup = { ...snapshot, projectId: conversation.projectId,
      candidateQueryRevision: Math.max(task.lastReferenceLookup?.candidateQueryRevision ?? 0, ctx.taskState?.lastReferenceLookup?.candidateQueryRevision ?? 0) + 1 };
    const active = await loadActiveSolution(ctx, tx);
    if (expectedVersion != null && (active?.version !== expectedVersion || !isEditableSolution(active)))
      solutionError("SOLUTION_VERSION_CONFLICT", "查询期间方案已变化，请刷新后重试");
    let solutionState: ReturnType<typeof solutionDto> | null = null;
    if (isEditableSolution(active) && active.projectId === conversation.projectId) {
      const candidates = lookup.candidates.map(asSolutionCandidate);
      const ids = new Set(candidates.map(candidate => candidate.candidateId));
      const retained = append ? active.payload.candidates.filter(item => active.payload.poolCandidateIds.includes(item.candidate.candidateId)
        && !ids.has(item.candidate.candidateId)).map(item => item.candidate) : [];
      solutionState = await refreshState(ctx, tx, active, lookup.query, [...retained, ...candidates]);
      lookup.selectedCandidateIds = solutionState.selectedCandidateIds;
    }
    const state = { ...(ctx.taskState ?? task), lastReferenceLookup: lookup };
    const values = { taskStateJson: state as unknown as Record<string, unknown>, updatedAt: new Date() };
    if (row) await tx.update(aiConversationStates).set(values).where(eq(aiConversationStates.conversationId, conversation.id));
    else await tx.insert(aiConversationStates).values({ conversationId: conversation.id, ...values });
    return { lookup, solutionState };
  };
  return executor ? persist(executor) : ctx.app.db.transaction(persist);
}
export const CANDIDATE_RESULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export function solutionPayloadFromLookup(lookup?: LastReferenceLookup, active?: SolutionStateRow | null) {
  if (lookup?.candidateResultInvalid) return emptySolution();
  if (!lookup?.candidateQueryRevision) return active?.payload ?? emptySolution();
  if (isEditableSolution(active)) {
    const payload = structuredClone(active.payload);
    const ids = new Set(payload.candidates.map(item => item.candidate.candidateId));
    payload.candidates.push(...lookup.candidates.filter(candidate => !ids.has(candidate.id)).map(candidate => ({ candidate: asSolutionCandidate(candidate),
      sourceRevision: lookup.candidateQueryRevision!, status: "AVAILABLE" as const })));
    payload.poolCandidateIds = lookup.candidates.map(candidate => candidate.id);
    payload.candidateSetRevision = lookup.candidateQueryRevision;
    return payload;
  }
  const payload = refreshSolution(emptySolution(), lookup.query, lookup.candidates.map(asSolutionCandidate));
  payload.candidateSetRevision = lookup.candidateQueryRevision;
  return payload;
}
/** 只接收用户动作与正式引用；创建、来源核验、seed、初始mutation、审计一起提交。 */
export async function activateSolutionFromLastLookup(ctx: SolutionContext, candidateQueryRevision: number,
  action: Pick<SolutionAction, "action" | "candidateIds" | "positions" | "comparisonCandidateIds">, expectedVersion?: number, executor?: DbExecutor) {
  const activate = async (tx: DbExecutor) => {
    await lockConversation(ctx, tx);
    const conversation = await assertSolutionAccess(tx, ctx.user, ctx.conversation.id);
    const { task } = await readLookupTask(tx, conversation.id);
    const lookup = task.lastReferenceLookup;
    if (lookup?.candidateResultInvalid) solutionError("SOLUTION_SOURCE_CHANGED", "候选结果无法完整校验，请重新查询");
    if (!lookup?.candidates.length) solutionError("SOLUTION_LOOKUP_REQUIRED", "请先查询或选择一个候选方案");
    if (lookup.candidateQueryRevision !== candidateQueryRevision || !candidateQueryRevision)
      solutionError("SOLUTION_REVISION_CONFLICT", "候选列表已变化，请重新查询或选择当前候选");
    const age = Date.now() - Date.parse(lookup.createdAt);
    if (!Number.isFinite(age) || age < 0 || age > CANDIDATE_RESULT_MAX_AGE_MS || lookup.projectId !== conversation.projectId)
      solutionError("SOLUTION_SOURCE_CHANGED", "候选结果已过期或项目已变化，请重新查询");
    if (!["SELECT", "ADD", "SET_FINAL", "START_NEW"].includes(action.action))
      solutionError("SOLUTION_LOOKUP_REQUIRED", "请先加入或选择候选方案");
    const candidates = lookup.candidates.map(asSolutionCandidate);
    await validateCurrentSources(ctx, tx, candidates, conversation.projectId, lookup.query);
    const current = await loadActiveSolution(ctx, tx);
    if (expectedVersion != null && current?.version !== expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
    const state = action.action !== "START_NEW" && isEditableSolution(current) && current.projectId === conversation.projectId ? current : await createState(ctx, tx, current);
    const seeded = isEditableSolution(current) && state.id === current.id && candidates.every(candidate =>
      current.payload.poolCandidateIds.includes(candidate.candidateId) && current.payload.candidates.some(item =>
        item.candidate.candidateId === candidate.candidateId && JSON.stringify(solutionCandidateSchema.parse(item.candidate)) === JSON.stringify(candidate)))
      ? state.payload : refreshSolution(state.payload, lookup.query, candidates);
    // Query revision已在上面核验；序号只映射此lookup，mutation继续使用既有方案revision。
    const candidateIds = resolveActionCandidateIds(solutionPayloadFromLookup(lookup), { ...action, expectedVersion: state.version,
      candidateSetRevision: lookup.candidateQueryRevision });
    const payload = applySolutionAction(seeded, { action: action.action, candidateIds, comparisonCandidateIds: action.comparisonCandidateIds, expectedVersion: state.version });
    const [updated] = await tx.update(solutionStates).set({ payload, candidateSetRevision: payload.candidateSetRevision,
      stage: payload.finalCandidateIds.length ? "READY_TO_CONFIRM" : payload.selectedCandidateIds.length ? "REFINING" : "CANDIDATE_SELECTION", version: state.version + 1, updatedAt: new Date() })
      .where(and(eq(solutionStates.id, state.id), eq(solutionStates.version, state.version))).returning();
    if (!updated) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
    await audit(ctx, tx, updated, action.action.toLowerCase());
    return { solutionState: solutionDto(updated) };
  };
  return executor ? activate(executor) : ctx.app.db.transaction(activate);
}
/** 冻结前确认正式发布行仍存在且值未变化，原页 optionId 仍来自当前确认快照。 */
async function validateCurrentSources(ctx: SolutionContext, db: DbExecutor, candidates: SolutionCandidateSnapshot[], projectId: string | null, conditions: ThermalQueryState) {
  const txApp = Object.create(ctx.app) as FastifyInstance;
  Object.defineProperty(txApp, "db", { value: db });
  const reference = candidates.filter(candidate => candidate.sourceType === "REFERENCE" && candidate.referenceKind !== "KNOWLEDGE_PAGE");
  if (reference.length) {
    // Confirm仅核验同身份原值，不刷新候选池；全量读取且禁止邻档替代，不能使用展示截断策略。
    const result = await queryThermalCandidates(txApp, ctx.request, ctx.user, { ...conditions, intent: "REFERENCE_LOOKUP", targetResistance: conditions.targetR,
      projectId: projectId ?? undefined, neighborTolerance: 0 });
    const pages = await emitReferencePages({ app: txApp, conversation: { ...ctx.conversation, projectId } },
      result.candidates.filter(row => reference.some(candidate => candidate.candidateId === row.candidateId)).map(compactCandidateResult));
    for (const saved of reference) {
      const fresh = pages.candidates.find(candidate => candidate.id === saved.candidateId);
      const keys = ["systemId", "schemeId", "productSpecId", "catalogProductId", "thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue", "sourceDocumentId", "sourcePageId", "sourceVersionId", "optionId"] as const;
      if (!fresh || keys.some(key => fresh[key] !== saved[key])) solutionError("SOLUTION_SOURCE_CHANGED", "正式候选或确认来源已变化，请重新查询并确认最终方案");
      if (saved.applicationPart != null && (fresh.applicationPart !== saved.applicationPart || fresh.systemType !== saved.systemType || fresh.systemVersion !== saved.systemVersion))
        solutionError("SOLUTION_SOURCE_CHANGED", "这套做法的发布类别或版本已变化，请重新查询后确认");
      if (saved.schemeName != null && saved.schemeName !== fresh.schemeName)
        solutionError("SOLUTION_SOURCE_CHANGED", "候选名称与当前发布构造不一致，请重新查询后选择");
      if (saved.publishedReferenceSource && (!hasPublishedReferenceSource(fresh) || !samePublishedReferenceSource(fresh.publishedReferenceSource, saved.publishedReferenceSource)))
        solutionError("SOLUTION_SOURCE_CHANGED", "正式参考集、行或参数版本已变化，请重新查询并确认最终方案");
      if (!await publishedConstructionLayersStillCurrent(db, saved))
        solutionError("SOLUTION_SOURCE_CHANGED", "这套构造的分层资料已变化，请重新查询并确认最终方案");
    }
  }
  for (const candidate of candidates.filter(item => item.sourceType === "CALCULATED")) {
    const [record] = await db.select().from(thermalCalcRecords).where(and(eq(thermalCalcRecords.id, candidate.calculationId!), eq(thermalCalcRecords.createdById, ctx.user.id))).limit(1);
    if (!record || record.projectId !== projectId) solutionError("SOLUTION_SOURCE_CHANGED", "计算记录不存在或无权访问");
    if (JSON.stringify(record.inputJson) !== JSON.stringify(candidate.inputSnapshot)
      || JSON.stringify(record.resultJson) !== JSON.stringify(candidate.resultSnapshot))
      solutionError("SOLUTION_SOURCE_CHANGED", "计算记录的冻结事实已变化，请重新选取");
  }
  const pages = await readConsumableReferencePages(txApp, candidates.flatMap(candidate => candidate.sourcePageId ? [candidate.sourcePageId] : []), projectId);
  if (candidates.filter(candidate => candidate.sourceType === "REFERENCE" && !hasPublishedReferenceSource(candidate)).some(candidate => !pages.some(({ page }) => page.id === candidate.sourcePageId)))
    solutionError("SOLUTION_SOURCE_CHANGED", "来源页已失效或无权访问");
  const snapshots = pages.flatMap(({ page, document }) => {
    const data = readPageRecognitionMeta(page.metadata).confirmedStructuredData;
    const model = buildKnowledgePageRenderModel(page.id, data);
    return data && model ? [{ page, data, model, systemId: document.insulationSystemId }] : [];
  });
  const knowledge = matchConfirmedPageOptions(snapshots, "", conditions).map(compactCandidateResult);
  for (const saved of candidates.filter(candidate => candidate.referenceKind === "KNOWLEDGE_PAGE")) {
    const fresh = knowledge.find(candidate => candidate.id === saved.candidateId);
    if (!fresh || ["thicknessMm", "productThermalResistance", "totalThermalResistance", "kValue"].some(key => fresh[key as keyof typeof fresh] !== saved[key as keyof typeof saved]))
      solutionError("SOLUTION_SOURCE_CHANGED", "原页确认档位已变化，请重新查询并选择");
  }
  for (const candidate of candidates.filter(candidate => candidate.sourceType === "REFERENCE" && !hasPublishedReferenceSource(candidate))) {
    const page = snapshots.find(snapshot => snapshot.page.id === candidate.sourcePageId);
    if (!page || !page.model.constructions.some(construction => construction.options.some(option => option.optionId === candidate.optionId)))
      solutionError("SOLUTION_SOURCE_CHANGED", "来源确认档位已失效，请重新查询");
  }
  return pages.map(({ page, document }) => ({ sourcePageId: page.id, documentId: document.id, versionId: page.versionId,
    documentTitle: document.title, docNumber: document.docNumber, pageLabel: visiblePageLabel(page), physicalPageNumber: page.physicalPageNumber, objectKey: page.pageImageObjectKey,
    renderModel: readableRenderModel(page.id, page.metadata, visiblePageLabel(page), page.versionId) }));
}
export async function actOnSolution(ctx: SolutionContext, stateId: string, action: SolutionAction) {
  return ctx.app.db.transaction(async tx => {
    await lockConversation(ctx, tx);
    await assertSolutionAccess(tx, ctx.user, ctx.conversation.id);
    const [original] = await tx.select().from(solutionStates).where(and(eq(solutionStates.id, stateId), eq(solutionStates.conversationId, ctx.conversation.id), eq(solutionStates.userId, ctx.user.id))).for("update");
    if (!original || !original.active) throw new NotFoundError("当前方案不存在或已进入历史");
    await assertBoundProject(tx, ctx.user, original.projectId);
    if (action.action === "CONFIRM" && original.confirmedSnapshotId) {
      const [snapshot] = await tx.select().from(solutionSnapshots).where(eq(solutionSnapshots.id, original.confirmedSnapshotId));
      return { solutionState: solutionDto(original), snapshot };
    }
    if (original.version !== action.expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "方案已被其他请求修改，请刷新后重试");
    if (action.action === "START_NEW") return { solutionState: solutionDto(await createState(ctx, tx, original)) };
    if (action.action === "REVISE") return { solutionState: solutionDto(await createState(ctx, tx, original, true)) };
    if (action.action === "COMPARE") return { solutionState: solutionDto(original), comparison: compareSelectedSolution(original.payload) };
    let state = original;
    if (state.confirmedSnapshotId) state = await createState(ctx, tx, state, true);
    const payload = applySolutionAction(state.payload, action);
    let stage: SolutionStage = payload.finalCandidateIds.length ? "READY_TO_CONFIRM" : payload.selectedCandidateIds.length ? "REFINING" : "CANDIDATE_SELECTION";
    let snapshot: typeof solutionSnapshots.$inferSelect | undefined;
    if (action.action === "CONFIRM") {
      const candidates = validateFinalSolution(payload);
      const referencePages = await validateCurrentSources(ctx, tx, candidates, state.projectId, payload.conditions);
      const alternatives = payload.candidates.filter(item => payload.selectedCandidateIds.includes(item.candidate.candidateId)
        && !payload.finalCandidateIds.includes(item.candidate.candidateId)).map(item => item.candidate);
      const txApp = Object.create(ctx.app) as FastifyInstance;
      Object.defineProperty(txApp, "db", { value: tx });
      const alternativePages = await readConsumableReferencePages(txApp, alternatives.flatMap(candidate => candidate.sourcePageId ? [candidate.sourcePageId] : []), state.projectId);
      for (const { page, document } of alternativePages) {
        const model = readableRenderModel(page.id, page.metadata, visiblePageLabel(page), page.versionId);
        if (!model || referencePages.some(saved => saved.sourcePageId === page.id)
          || !alternatives.some(candidate => candidate.sourcePageId === page.id && model.constructions.some(construction => construction.options.some(option => option.optionId === candidate.optionId)))) continue;
        referencePages.push({ sourcePageId: page.id, documentId: document.id, versionId: page.versionId, documentTitle: document.title,
          docNumber: document.docNumber, pageLabel: visiblePageLabel(page), physicalPageNumber: page.physicalPageNumber,
          objectKey: page.pageImageObjectKey, renderModel: model });
      }
      const [project] = state.projectId ? await tx.select().from(projects).where(eq(projects.id, state.projectId)).limit(1) : [];
      [snapshot] = await tx.insert(solutionSnapshots).values({ solutionStateId: state.id, conversationId: state.conversationId,
        userId: state.userId, projectId: state.projectId, confirmedBy: ctx.user.id,
        payload: { schemaVersion: 1, queryStateSnapshot: payload.queryStateSnapshot, conditionsSnapshot: payload.conditions,
          preferencesSnapshot: payload.preferences, candidates, alternatives, referencePages,
          warnings: [...new Set(payload.conflicts.map(conflict => `${conflict.candidateId}：${conflict.message}`)), ...candidates.filter(candidate => candidate.sourcePageId && !candidate.sourcePageLabel).map(() => "来源未提供已核验印刷页码"),
            ...alternatives.filter(candidate => candidate.sourcePageId && !referencePages.some(page => page.sourcePageId === candidate.sourcePageId)).map(candidate => `${candidate.candidateId}：备选来源已失效，保留当时值，无法冻结当前来源表格`)],
          projectSnapshot: project ? structuredClone(project) : null, selectedCandidateIds: payload.selectedCandidateIds,
          finalCandidateIds: payload.finalCandidateIds, recommendedCandidateIds: payload.recommendedCandidateIds } }).returning();
      stage = "CONFIRMED";
    }
    const [updated] = await tx.update(solutionStates).set({ payload, stage, confirmedSnapshotId: snapshot?.id ?? null, version: state.version + 1,
      updatedAt: new Date() }).where(and(eq(solutionStates.id, state.id), eq(solutionStates.version, state.version))).returning();
    if (!updated) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
    await audit(ctx, tx, updated, action.action.toLowerCase());
    return { solutionState: solutionDto(updated), ...(snapshot ? { snapshot } : {}) };
  });
}
export async function getSolutionSnapshot(ctx: SolutionContext, snapshotId: string) {
  await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  const [snapshot] = await ctx.app.db.select().from(solutionSnapshots).where(and(eq(solutionSnapshots.id, snapshotId),
    eq(solutionSnapshots.conversationId, ctx.conversation.id), eq(solutionSnapshots.userId, ctx.user.id))).limit(1);
  if (!snapshot) throw new NotFoundError("方案快照不存在或无权访问");
  await assertBoundProject(ctx.app.db, ctx.user, snapshot.projectId);
  // 值快照可读；图片签名必须重验当前发布与项目权限。
  const readable = await readConsumableReferencePages(ctx.app, snapshot.payload.referencePages.flatMap(page => typeof page.sourcePageId === "string" ? [page.sourcePageId] : []), snapshot.projectId);
  const referenceImages = await Promise.all(snapshot.payload.referencePages.map(async page => {
    const current = readable.find(({ page: source }) => source.id === page.sourcePageId && source.versionId === page.versionId);
    const currentModel = current ? readableRenderModel(current.page.id, current.page.metadata, visiblePageLabel(current.page), current.page.versionId) : null;
    if (!current || current.page.pageImageObjectKey !== page.objectKey || typeof page.objectKey !== "string"
      || !sameFrozenPageFacts(currentModel, page.renderModel)) return { sourcePageId: page.sourcePageId, imageUrl: null };
    try { return { sourcePageId: page.sourcePageId, imageUrl: await ctx.app.storage.createDownloadUrl(page.objectKey, "方案来源.png", 3600) }; }
    catch { return { sourcePageId: page.sourcePageId, imageUrl: null }; }
  }));
  return { ...snapshot, referenceImages };
}
/** 计算候选完整保存同一次确定性引擎记录，不与参考行拼数值。 */
export async function loadCalculatedCandidates(ctx: SolutionContext, calculationId: string, db: DbExecutor = ctx.app.db) {
  const conversation = await assertSolutionAccess(db, ctx.user, ctx.conversation.id);
  const [record] = await db.select().from(thermalCalcRecords).where(and(eq(thermalCalcRecords.id, calculationId), eq(thermalCalcRecords.createdById, ctx.user.id))).limit(1);
  if (!record || record.projectId !== conversation.projectId) throw new NotFoundError("计算记录不存在或无权访问");
  const input = record.inputJson;
  const [scheme] = typeof input.schemeId === "string" ? await db.select().from(constructionSchemes).where(and(eq(constructionSchemes.id, input.schemeId), ...publishedReferenceConditions(constructionSchemes))).limit(1) : [];
  const [system] = scheme ? await db.select().from(insulationSystems).where(eq(insulationSystems.id, scheme.systemId)).limit(1) : [];
  const [spec] = typeof input.productSpecId === "string" ? await db.select().from(productSpecs).where(and(eq(productSpecs.id, input.productSpecId), ...publishedReferenceConditions(productSpecs))).limit(1) : [];
  const results = record.mode === "REFERENCE_TABLE" && Array.isArray(record.resultJson.candidates)
    ? record.resultJson.candidates.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [record.resultJson];
  const calculated: SolutionCandidateSnapshot[] = results.map(result => {
    const candidateId = record.mode === "REFERENCE_TABLE" ? `${record.id}:${String(result.setId)}` : record.id;
    return { id: candidateId, candidateId, sourceType: "CALCULATED", calculationId: record.id,
    calcMode: record.mode, ruleVersion: record.ruleVersion, inputSnapshot: input, resultSnapshot: record.resultJson,
    provenanceSnapshot: { parameters: record.parametersJson, layers: record.layersJson, rule: record.ruleJson, standard: record.standardJson, formula: record.formulaJson, steps: record.stepsJson },
    systemId: system?.id, systemName: system?.name, schemeId: scheme?.id, schemeCode: scheme?.schemeCode, schemeName: scheme?.name, constructionCode: scheme?.schemeCode,
    substrateMaterial: scheme?.substrateMaterial, substrateThickness: scheme?.substrateThickness, schemeVersion: scheme?.version,
    catalogProductId: spec?.catalogProductId, productId: spec?.catalogProductId, specCode: spec?.specCode, specVersion: spec?.version,
    evidenceSource: scheme?.evidenceSource ?? undefined, evidenceRef: scheme?.evidenceRef ?? undefined,
    inputThicknessLayerName: record.mode === "LAYERED" && Array.isArray(record.layersJson)
      ? record.layersJson.flatMap(layer => layer && typeof layer === "object" && "layerType" in layer && layer.layerType === "PRODUCT_LAYER"
        && "layerName" in layer && typeof layer.layerName === "string" ? [layer.layerName] : [])[0] : undefined,
    ...(result.productResistanceScope === "PRODUCT_LAYER_ROWS_ONLY" || result.productResistanceScope === "PRODUCT_EQUIVALENT_TOTAL"
      ? { productThermalResistanceScope: result.productResistanceScope } : {}),
    productSpecId: typeof input.productSpecId === "string" ? input.productSpecId : undefined,
    thicknessMm: typeof input.thicknessMm === "number" ? input.thicknessMm : undefined,
    regionCode: typeof input.regionCode === "string" ? input.regionCode : undefined,
    standardLimitId: typeof input.standardLimitId === "string" ? input.standardLimitId : undefined,
    structureType: typeof input.structureType === "string" ? input.structureType : undefined,
    setBuildingTypes: typeof input.buildingType === "string" ? [input.buildingType] : undefined,
    kValue: typeof result.kValue === "number" ? result.kValue : undefined,
    productThermalResistance: typeof (result.productResistance ?? result.productThermalResistance) === "number" ? (result.productResistance ?? result.productThermalResistance) as number : undefined,
    totalThermalResistance: typeof (result.totalResistance ?? result.totalThermalResistance) === "number" ? (result.totalResistance ?? result.totalThermalResistance) as number : undefined };
  });
  return calculated;
}
/** REST明确加入计算结果：与按钮/聊天共用懒激活与初始ADD。 */
export async function recordCalculatedSolution(ctx: SolutionContext, calculationId: string) {
  return ctx.app.db.transaction(async tx => {
    await lockConversation(ctx, tx);
    const calculated = await loadCalculatedCandidates(ctx, calculationId, tx);
    const active = await loadActiveSolution(ctx, tx);
    const result = await recordCandidateResult(ctx, { query: active?.payload.queryStateSnapshot ?? {}, candidates: calculated, createdAt: new Date().toISOString() }, true, undefined, tx);
    return (await activateSolutionFromLastLookup(ctx, result.lookup.candidateQueryRevision,
      { action: "ADD", candidateIds: calculated.map(candidate => candidate.id) }, undefined, tx)).solutionState;
  });
}

/** 产品目录仅提供其自身正式字段；不与其他构造拼热工数值。缺少构造事实时不能确认。 */
export async function recordProductSolutions(ctx: SolutionContext, productIds: string[], expectedVersion: number) {
  const current = await loadActiveSolution(ctx);
  if (current?.version !== expectedVersion) solutionError("SOLUTION_VERSION_CONFLICT", "方案已变化，请刷新");
  const { inArray } = await import("drizzle-orm");
  const ids = [...new Set(productIds)];
  const products = await ctx.app.db.select().from(catalogProducts).where(and(inArray(catalogProducts.id, ids), eq(catalogProducts.status, "ACTIVE")));
  if (products.length !== ids.length) solutionError("SOLUTION_PRODUCT_INVALID", "产品不存在或已停用");
  const candidates: SolutionCandidateSnapshot[] = products.map(product => ({ id: product.id, candidateId: product.id, sourceType: "PRODUCT",
    productId: product.id, catalogProductId: product.id, productName: product.name, specClass: product.specClass ?? undefined,
    lambda: product.thermalConductivity ?? undefined, alpha: product.correctionFactor ?? undefined,
    provenanceSnapshot: { product: structuredClone(product) } }));
  const retained = current.payload.candidates.filter(item => current.payload.poolCandidateIds.includes(item.candidate.candidateId) && !ids.includes(item.candidate.candidateId)).map(item => item.candidate);
  return refreshActiveSolutionCandidates(ctx, current.payload.queryStateSnapshot, [...retained, ...candidates], expectedVersion);
}
