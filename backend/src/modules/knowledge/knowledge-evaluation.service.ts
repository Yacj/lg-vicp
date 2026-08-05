import type { FastifyInstance, FastifyRequest } from "fastify";
import { count, desc, eq } from "drizzle-orm";
import { knowledgeSearchEvaluations } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { NotFoundError } from "../../shared/errors.js";
import { normalizeSearchText } from "./knowledge.normalize.js";
import { runSearch } from "./knowledge.service.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";

/**
 * 检索评测服务：提交测试问题 → 立即执行检索并保存实际结果 → 人工判定。
 * 与生产检索共用 runSearch 管线（PUBLISHED + ACTIVE），评测本身不写检索日志。
 */

export type EvaluationJudgement = "PENDING" | "APPROVED" | "REJECTED" | "PARTIAL";

export interface CreateEvaluationInput {
  query: string;
  expectedDocumentId?: string;
  expectedPage?: number;
}

export async function createEvaluation(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: CreateEvaluationInput
) {
  const normalizedQuery = normalizeSearchText(input.query).slice(0, 500);
  if (!normalizedQuery) throw new NotFoundError("检索词不能为空");
  const results = await runSearch(app, input.query, {
    projectId: null,
    limit: 10
  });
  const parsedKeywords = normalizedQuery.split(" ").filter(Boolean).slice(0, 20);
  const actualTopResults = results.map((item) => ({
    chunkId: item.chunkId,
    documentId: item.documentId,
    sourceTitle: item.sourceTitle,
    sourcePage: item.sourcePage,
    sourceSection: item.sourceSection,
    score: item.score,
    rankScore: item.rankScore,
    hitReason: item.hitReason,
    matchReasons: item.matchReasons,
    snippet: item.snippet,
    evidenceLevel: item.evidenceLevel,
    region: item.region
  }));
  const [created] = await app.db.insert(knowledgeSearchEvaluations).values({
    query: input.query,
    normalizedQuery,
    parsedKeywords,
    expectedDocumentId: input.expectedDocumentId,
    expectedPage: input.expectedPage,
    actualTopResults,
    judgement: "PENDING",
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_EVALUATION_CREATED, targetType: "knowledge_search_evaluation", targetId: created!.id,
    afterJson: { query: input.query, normalizedQuery, resultCount: actualTopResults.length }
  });
  return created!;
}

export interface ListEvaluationsQuery {
  page: number;
  pageSize: number;
  judgement?: string;
}

export async function listEvaluations(app: FastifyInstance, query: ListEvaluationsQuery) {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(100, Math.max(1, query.pageSize));
  const where = query.judgement && query.judgement !== "ALL"
    ? eq(knowledgeSearchEvaluations.judgement, query.judgement as EvaluationJudgement)
    : undefined;
  const [items, [totalRow]] = await Promise.all([
    app.db.select().from(knowledgeSearchEvaluations)
      .where(where)
      .orderBy(desc(knowledgeSearchEvaluations.createdAt))
      .offset((page - 1) * pageSize)
      .limit(pageSize),
    app.db.select({ value: count() }).from(knowledgeSearchEvaluations).where(where)
  ]);
  return { items, total: totalRow?.value ?? 0, page, pageSize };
}

export interface JudgeEvaluationInput {
  judgement: Exclude<EvaluationJudgement, "PENDING">;
  note?: string;
}

export async function judgeEvaluation(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: JudgeEvaluationInput
) {
  const [existing] = await app.db.select().from(knowledgeSearchEvaluations).where(eq(knowledgeSearchEvaluations.id, id)).limit(1);
  if (!existing) throw new NotFoundError("评测记录不存在");
  const [updated] = await app.db.update(knowledgeSearchEvaluations).set({
    judgement: input.judgement,
    note: input.note ?? existing.note,
    judgedById: actor.id,
    judgedAt: new Date(),
    updatedAt: new Date()
  }).where(eq(knowledgeSearchEvaluations.id, id)).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_EVALUATION_JUDGED, targetType: "knowledge_search_evaluation", targetId: id,
    beforeJson: { judgement: existing.judgement },
    afterJson: { judgement: updated!.judgement, note: updated!.note }
  });
  return updated!;
}

/** 供测试与统计使用：按判定状态统计数量 */
export async function countEvaluationsByJudgement(app: FastifyInstance): Promise<Record<string, number>> {
  const rows = await app.db.select({ judgement: knowledgeSearchEvaluations.judgement })
    .from(knowledgeSearchEvaluations);
  const counts: Record<string, number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, PARTIAL: 0 };
  for (const row of rows) counts[row.judgement] = (counts[row.judgement] ?? 0) + 1;
  return counts;
}