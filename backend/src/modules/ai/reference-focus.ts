import type { LastReferenceLookup } from "./conversation-task.js";

type Scope = { id: string; userId: string; clientApp: string; projectId: string | null };
/** 已读对象的身份线索，不是选择授权。新的只读查询不能把“这套”偷偷绑回旧候选。 */
export function currentReferenceFocus(rows: readonly { createdAt: Date; metadata: unknown }[], scope: Scope, lookup?: LastReferenceLookup, now = Date.now()) {
  if (!scope.id || !scope.userId || !scope.clientApp || !lookup || lookup.candidateResultInvalid || lookup.projectId !== scope.projectId || !lookup.candidateQueryRevision
    || !Number.isFinite(Date.parse(lookup.createdAt)) || now < Date.parse(lookup.createdAt) || now - Date.parse(lookup.createdAt) > 24 * 3600_000) return [];
  const poolIds = lookup.candidates.map(candidate => candidate.id);
  for (const row of rows) {
    const meta = row.metadata as { queryScope?: Scope; backendDecision?: { domainIntent?: string; relation?: string;
      referenceQueryRevisionBefore?: number; referenceQueryRevisionAfter?: number; referenceRevision?: number;
      queryChanged?: boolean; queryResultMode?: string; candidateIdList?: string[]; referencePageIds?: string[]; factValidationCode?: string } } | null;
    const b = meta?.backendDecision, s = meta?.queryScope, age = now - row.createdAt.getTime();
    if (!s || s.id !== scope.id || s.userId !== scope.userId || s.clientApp !== scope.clientApp || s.projectId !== scope.projectId
      || !Number.isFinite(age) || age < 0 || age > 24 * 3600_000 || !b) return [];
    if (b.domainIntent === "REFERENCE_QUERY" || b.domainIntent === "REFERENCE_REFINE") {
      return b.referenceQueryRevisionAfter === lookup.candidateQueryRevision
        && b.referenceQueryRevisionBefore !== b.referenceQueryRevisionAfter
        ? b.queryResultMode === "FACTS_ONLY" ? b.candidateIdList?.filter(id => poolIds.includes(id)) ?? [] : poolIds : [];
    }
    if (b.domainIntent === "REFERENCE_VIEW" || b.domainIntent === "REFERENCE_DETAIL" || b.domainIntent === "KNOWLEDGE_EXPLAIN") {
      if (b.referenceRevision != null && b.referenceRevision !== lookup.candidateQueryRevision) return [];
      if (b.candidateIdList?.length) return b.candidateIdList.filter(id => poolIds.includes(id));
      if (b.referencePageIds?.length) return [];
    }
    if (b.relation !== "CONTINUE" && b.relation !== "REFINE") return [];
  }
  return rows.length ? [] : poolIds;
}
