import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { professionalReviews } from "../../db/schema.js";

/**
 * 统一审核记录 upsert（每 entityType+entityId 一行）：
 * 由各域审核状态机（md-workflow / standard / 报告审核）在数据变更同一事务内调用，
 * 审核中心队列直接读取本表，保证"单一写入点、无审核分叉"。
 * - submit -> status=PENDING_REVIEW，写 submittedById/At；
 * - approve/reject -> status=APPROVED/REJECTED，写 reviewedById/At 与 comment（审核意见/驳回原因）。
 */

export type ProfessionalReviewStatus = "PENDING_REVIEW" | "APPROVED" | "REJECTED";

export interface ProfessionalReviewInput {
  db: DbExecutor;
  /** 复用审计 targetType（md_product_spec / construction_scheme / thermal_reference_set / standard.document / report 等） */
  entityType: string;
  entityId: string;
  entityVersion?: number | null;
  status: ProfessionalReviewStatus;
  /** 审核意见（approve）或驳回原因（reject）；submit 时可为空 */
  comment?: string | null;
  actorUserId?: string | null;
  projectId?: string | null;
  requestId?: string | null;
}

export async function upsertProfessionalReview(input: ProfessionalReviewInput) {
  const now = new Date();
  const isPending = input.status === "PENDING_REVIEW";
  const [existing] = await input.db.select({ id: professionalReviews.id })
    .from(professionalReviews)
    .where(and(
      eq(professionalReviews.entityType, input.entityType),
      eq(professionalReviews.entityId, input.entityId)
    ))
    .limit(1);

  if (existing) {
    await input.db.update(professionalReviews).set({
      entityVersion: input.entityVersion ?? undefined,
      status: input.status,
      comment: input.comment ?? null,
      projectId: input.projectId ?? undefined,
      submittedById: isPending ? (input.actorUserId ?? undefined) : undefined,
      submittedAt: isPending ? now : undefined,
      reviewedById: isPending ? undefined : (input.actorUserId ?? undefined),
      reviewedAt: isPending ? undefined : now,
      requestId: input.requestId ?? undefined,
      updatedAt: now
    }).where(eq(professionalReviews.id, existing.id));
    return existing.id;
  }

  const [created] = await input.db.insert(professionalReviews).values({
    entityType: input.entityType,
    entityId: input.entityId,
    entityVersion: input.entityVersion ?? null,
    status: input.status,
    comment: input.comment ?? null,
    projectId: input.projectId ?? null,
    submittedById: isPending ? (input.actorUserId ?? null) : null,
    submittedAt: isPending ? now : null,
    reviewedById: isPending ? null : (input.actorUserId ?? null),
    reviewedAt: isPending ? null : now,
    requestId: input.requestId ?? null
  }).returning();
  return created!.id;
}