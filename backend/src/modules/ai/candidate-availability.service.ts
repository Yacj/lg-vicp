import { z } from "zod";
import { createHash } from "node:crypto";
import type { ChatReadOnlyReference } from "./solution-action-semantic.js";
import { assertSolutionAccess } from "./solution-state.service.js";
import { readReferenceFactHistory } from "./reference-fact-history.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";
import type { LastReferenceLookup } from "./conversation-task.js";
import type { ReferenceReadContext } from "./reference-candidate-resolver.service.js";
import { referenceDataConflictsSchema, renderReferenceDataConflict, specThicknessConflict } from "../../shared/reference-data-conflict.js";

const mismatchSchema = z.array(z.object({ rowThicknessMm: z.number().positive(), specCode: z.string().nullable(), specThicknessMm: z.number().positive(),
  schemeName: z.string().nullable().optional(), schemeCode: z.string().nullable().optional() })).max(100);
type Conversation = { id: string; userId: string; projectId: string | null; clientApp: string };
/** 历史诊断只提供分类线索，不授予候选身份；真正回答前仍重新读取当前发布资料。 */
export function previousCandidateAvailability(rows: readonly { id: string; createdAt: Date; metadata: unknown }[], conversation: Conversation,
  lookup: LastReferenceLookup | undefined, now = Date.now()) {
  if (!lookup || lookup.candidateResultInvalid || lookup.projectId !== conversation.projectId || !lookup.candidateQueryRevision
    || !Number.isFinite(Date.parse(lookup.createdAt)) || now < Date.parse(lookup.createdAt) || now - Date.parse(lookup.createdAt) > 24 * 3600_000) return undefined;
  for (const row of rows.slice(0, 12)) {
    const m = row.metadata as { queryScope?: Conversation; backendDecision?: { domainIntent?: string; referenceQueryRevisionAfter?: number;
      relation?: string; referenceQueryDiagnostics?: { specThicknessMismatches?: unknown; dataConflicts?: unknown } } } | null;
    const s = m?.queryScope, d = m?.backendDecision;
    if (s?.id !== conversation.id || s.userId !== conversation.userId || s.projectId !== conversation.projectId || s.clientApp !== conversation.clientApp
      || !Number.isFinite(row.createdAt.getTime()) || row.createdAt.getTime() > now || now - row.createdAt.getTime() > 24 * 3600_000
      || !d?.domainIntent || !["REFERENCE_QUERY", "REFERENCE_REFINE", "COMPARE_CANDIDATES", "REFERENCE_VIEW", "REFERENCE_DETAIL", "CLARIFY", "SOLUTION_ACTION", "KNOWLEDGE_EXPLAIN", "SOLUTION_ADVICE"].includes(d.domainIntent)
      || (d.domainIntent === "KNOWLEDGE_EXPLAIN" || d.domainIntent === "SOLUTION_ADVICE") && d.relation !== "CONTINUE") return undefined;
    if (d.referenceQueryRevisionAfter !== lookup.candidateQueryRevision) return undefined;
    if (d.domainIntent !== "REFERENCE_QUERY" && d.domainIntent !== "REFERENCE_REFINE") continue;
    const parsed = mismatchSchema.safeParse(d.referenceQueryDiagnostics?.specThicknessMismatches ?? []);
    const conflicts = referenceDataConflictsSchema.safeParse(d.referenceQueryDiagnostics?.dataConflicts ?? []);
    return parsed.success && conflicts.success && (parsed.data.length || conflicts.data.length) ? { messageId: row.id, revision: lookup.candidateQueryRevision,
      candidateCount: lookup.candidates.length, specThicknessMismatches: parsed.data } : undefined;
  }
  return undefined;
}

/** 无执行权限的事实说明：不发布新候选、不部分执行组合指令，也不更新Final。 */
export async function explainCandidateAvailability(ctx: ReferenceReadContext, purpose: "COMPARE" | "ACTION" | "CLARIFY" | "READ") {
  if (!ctx.conversation.userId || !ctx.conversation.clientApp || !ctx.taskState?.lastReferenceLookup?.candidateQueryRevision) return undefined;
  const session = await assertSolutionAccess(ctx.app.db, ctx.user, ctx.conversation.id);
  if (session.projectId !== ctx.conversation.projectId) return undefined;
  const lookup = ctx.taskState?.lastReferenceLookup;
  if (ctx.candidateQueryRevision != null && ctx.candidateQueryRevision !== lookup?.candidateQueryRevision) return undefined;
  const history = previousCandidateAvailability(await readReferenceFactHistory(ctx.app, ctx.conversation.id), ctx.conversation, lookup);
  if (!history || !lookup || lookup.query.unresolved?.length) return undefined;
  const current = await querySolutionCandidates(ctx, lookup.query);
  const available = current.pages.candidates.filter(row => lookup.candidates.some(old => old.id === row.id));
  if (available.length !== lookup.candidates.length
    || !await referenceRowsStillCurrent(ctx.app.db, available, { userId: ctx.user.id, projectId: session.projectId })) return undefined;
  const mismatches = mismatchSchema.safeParse(current.queryDiagnostics.specThicknessMismatches ?? []);
  const disclosed = referenceDataConflictsSchema.safeParse(current.queryDiagnostics.dataConflicts ?? []);
  if (!mismatches.success || !disclosed.success || !mismatches.data.length && !disclosed.data.length) return undefined;
  const names = available.map(row => `${row.schemeCode ?? row.schemeName ?? "当前参考方案"}${row.thicknessMm == null ? "" : `（${row.thicknessMm}mm）`}`).join("、");
  const conflicts = disclosed.success && disclosed.data.length ? disclosed.data : mismatches.data.map(specThicknessConflict);
  const answer = [purpose === "READ" ? "这条记录的厚度与关联规格不一致，暂不能直接选用；这不等于产品本身不能用。" : purpose === "ACTION" ? "这次方案操作还没有执行。" : available.length < 2 ? "目前还不能完成这两套方案的比较。" : "当前参考资料有一项需要先核对。",
    ...conflicts.map(renderReferenceDataConflict),
    available.length ? `目前可用的是${names}。可以先点这条候选卡片查看或选用；若要继续比较，需要另一条规格、来源一致的有效候选。` : "目前没有可用的正式候选，可以换一条构造或来源继续查。"].join("\n");
  const references: ChatReadOnlyReference[] = conflicts.map(conflict => {
    const sourceRow = current.outcome?.specThicknessMismatchRows?.find(item => item.schemeCode === conflict.subject || item.schemeName === conflict.subject);
    const row = sourceRow ?? mismatches.data.find(item => item.schemeCode === conflict.subject || item.schemeName === conflict.subject);
    return { fingerprint: createHash("sha256").update(JSON.stringify({ rowId: sourceRow?.rowId ?? null, conflict })).digest("hex"), label: row?.schemeName ?? "待核对的参考记录",
      code: row?.schemeCode, thicknessMm: row?.rowThicknessMm, conflict };
  });
  return { answer, queryRevision: history.revision, readOnlyCatalog: { queryRevision: history.revision, references },
    diagnostics: { specThicknessMismatches: mismatches.data, dataConflicts: conflicts }, validationCode: "CANDIDATE_AVAILABILITY_REVALIDATED" as const };
}
