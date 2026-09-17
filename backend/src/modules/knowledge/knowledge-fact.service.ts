import { and, desc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { knowledgeFacts, type KnowledgeFact } from "../../db/schema.js";

export type KnowledgeFactType =
  | "MATERIAL"
  | "PRODUCT_SPEC"
  | "CONSTRUCTION"
  | "THERMAL_PARAMETER"
  | "STANDARD_LIMIT"
  | "NODE_REFERENCE";

export type KnowledgeFactStatus = "DRAFT" | "VERIFIED";

export interface KnowledgeFactInput {
  factType: KnowledgeFactType;
  subject: string;
  data: Record<string, unknown>;
  sourceDocumentId: string;
  sourceVersionId?: string | null;
  sourceSectionId?: string | null;
  sourcePageLabel?: string | null;
  sourcePhysicalPageNumber?: number | null;
  status?: KnowledgeFactStatus;
}

/** 内部写入 Structured Knowledge；必须带 sourceDocumentId，禁止做成无来源产品中心 */
export async function upsertKnowledgeFact(db: DbExecutor, input: KnowledgeFactInput): Promise<KnowledgeFact> {
  const [created] = await db.insert(knowledgeFacts).values({
    factType: input.factType,
    subject: input.subject,
    data: input.data,
    sourceDocumentId: input.sourceDocumentId,
    sourceVersionId: input.sourceVersionId ?? null,
    sourceSectionId: input.sourceSectionId ?? null,
    sourcePageLabel: input.sourcePageLabel ?? null,
    sourcePhysicalPageNumber: input.sourcePhysicalPageNumber ?? null,
    status: input.status ?? "DRAFT"
  }).returning();
  return created!;
}

export async function listVerifiedKnowledgeFacts(
  db: DbExecutor,
  query: { factType: KnowledgeFactType; subject?: string }
): Promise<KnowledgeFact[]> {
  return db.select().from(knowledgeFacts).where(and(
    eq(knowledgeFacts.status, "VERIFIED"),
    eq(knowledgeFacts.factType, query.factType),
    query.subject ? eq(knowledgeFacts.subject, query.subject) : undefined
  )).orderBy(desc(knowledgeFacts.updatedAt));
}

export function factHasSource(fact: Pick<KnowledgeFact, "sourceDocumentId">): boolean {
  return Boolean(fact.sourceDocumentId);
}
