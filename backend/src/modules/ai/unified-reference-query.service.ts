import { loadPublishedKnowledgeReferences } from "./ai-reference-pages.service.js";
import { confirmedReferenceQuery } from "./structured-reference-query.js";
import { querySolutionCandidates } from "./solution-candidate-query.service.js";
import type { SolutionContext } from "./solution-state.service.js";
import type { WikiHit } from "../knowledge/knowledge.service.js";
import type { ThermalQueryState } from "../thermal/thermal-query-state.js";

/** 只消费上游已经验证的结构化查询；普通知识问答仍按原检索范围读取，不新增语言路由。 */
export async function loadUnifiedReferencePages(ctx: SolutionContext, hits: readonly WikiHit[], message: string, input?: ThermalQueryState) {
  const normalized = confirmedReferenceQuery(message, input);
  if (!normalized.authoritative) return loadPublishedKnowledgeReferences(ctx.app, hits, ctx.conversation.projectId, message, input);
  const query = { ...normalized.query, intent: "REFERENCE_LOOKUP" as const };
  return (await querySolutionCandidates(ctx, query)).readOnlyReferences;
}
