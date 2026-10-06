/**
 * 固化 Report Context Snapshot，并据此生成产品对比报告。
 * 不把整段聊天重新交给模型决定产品、关注点或数据。
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { aiMessages, reportContextSnapshots } from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import type { ComparisonContext, ProductComparisonResult } from "./compare-product.js";
import { createReport } from "../reports/report-generation.service.js";
import { normalizeReportTypeCode } from "./report-type-inference.js";
import {
  buildDeterministicReportDraft,
  freezeReportContextSnapshot,
  mergeReferencePages,
  REPORT_CONTEXT_REPORT_TYPE,
  type ReportContextReferencePage,
  type ReportContextSnapshot
} from "./report-context-snapshot.js";

/** 从当前会话已落库的助手消息 metadata.referencePages 恢复，模型不必再传 pageId/objectKey。
 *
 * 显式传入的页面代表用户已经确认/选择的结果，优先使用；没有显式结果时，
 * 只使用最近一条包含有效 referencePages 的助手消息，避免把不同问题的页面混入报告。
 */
export async function collectConversationReferencePages(
  app: FastifyInstance,
  conversationId: string,
  extras: unknown[] = []
): Promise<ReportContextReferencePage[]> {
  const explicitPages = mergeReferencePages(extras);
  if (explicitPages.length > 0) return explicitPages;

  const rows = await app.db.select({
    metadata: aiMessages.metadata,
    role: aiMessages.role
  }).from(aiMessages)
    .where(and(
      eq(aiMessages.conversationId, conversationId),
      eq(aiMessages.role, "ASSISTANT")
    ))
    .orderBy(desc(aiMessages.createdAt));

  for (const row of rows) {
    const metadata = row.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const pages = (metadata as Record<string, unknown>).referencePages;
    if (!Array.isArray(pages)) continue;
    const selectedPages = mergeReferencePages(pages);
    if (selectedPages.length > 0) return selectedPages;
  }
  return [];
}

export async function createReportContextSnapshot(
  app: FastifyInstance,
  input: {
    conversationId: string;
    projectId?: string | null;
    reportType?: string;
    selectedProductIds?: string[];
    selectedKnowledgeSourceIds?: string[];
    userGoal?: string;
    confirmedRequirements?: string[];
    comparisonContext?: ComparisonContext | Record<string, unknown> | null;
    comparisonResult?: ProductComparisonResult | Record<string, unknown> | null;
    referencePages?: ReportContextSnapshot["referencePages"];
    createdById?: string | null;
  }
): Promise<ReportContextSnapshot> {
  const referencePages = input.referencePages?.length
    ? mergeReferencePages(input.referencePages)
    : await collectConversationReferencePages(app, input.conversationId);

  const snapshot = freezeReportContextSnapshot({
    id: randomUUID(),
    conversationId: input.conversationId,
    projectId: input.projectId ?? null,
    reportType: normalizeReportTypeCode(input.reportType) ?? "material_compare",
    selectedProductIds: [...new Set((input.selectedProductIds ?? []).filter(Boolean))],
    selectedKnowledgeSourceIds: [...new Set((input.selectedKnowledgeSourceIds ?? []).filter(Boolean))],
    userGoal: input.userGoal,
    confirmedRequirements: input.confirmedRequirements ?? [],
    comparisonContext: (input.comparisonContext ?? {}) as ComparisonContext,
    comparisonResult: (input.comparisonResult ?? { products: [], dimensions: [], evidenceRefs: [], missingNotes: [], thermal: { status: "NOT_AVAILABLE", results: [] }, ranking: null, scores: null }) as ProductComparisonResult,
    sourceRefs: ((input.comparisonResult as ProductComparisonResult | undefined)?.evidenceRefs ?? []) as ReportContextSnapshot["sourceRefs"],
    thermalResults: (input.comparisonResult as ProductComparisonResult | undefined)?.thermal?.results ?? [],
    referencePages,
    createdAt: new Date().toISOString()
  });

  await app.db.insert(reportContextSnapshots).values({
    id: snapshot.id,
    conversationId: snapshot.conversationId,
    projectId: snapshot.projectId ?? null,
    reportType: snapshot.reportType,
    selectedProductIdsJson: snapshot.selectedProductIds,
    selectedKnowledgeSourceIdsJson: snapshot.selectedKnowledgeSourceIds ?? [],
    userGoal: snapshot.userGoal ?? null,
    confirmedRequirementsJson: snapshot.confirmedRequirements,
    comparisonContextJson: (snapshot.comparisonContext ?? {}) as Record<string, unknown>,
    comparisonResultJson: (snapshot.comparisonResult ?? {}) as Record<string, unknown>,
    sourceRefsJson: (snapshot.sourceRefs ?? []) as unknown[],
    thermalResultsJson: snapshot.thermalResults ?? [],
    referencePagesJson: snapshot.referencePages ?? [],
    createdById: input.createdById ?? null
  });

  return snapshot;
}

export async function getReportContextSnapshot(
  app: FastifyInstance,
  snapshotId: string
): Promise<ReportContextSnapshot | null> {
  const [row] = await app.db.select().from(reportContextSnapshots)
    .where(eq(reportContextSnapshots.id, snapshotId)).limit(1);
  if (!row) return null;
  return freezeReportContextSnapshot({
    id: row.id,
    conversationId: row.conversationId,
    projectId: row.projectId,
    reportType: normalizeReportTypeCode(row.reportType) ?? row.reportType,
    selectedProductIds: row.selectedProductIdsJson ?? [],
    selectedKnowledgeSourceIds: row.selectedKnowledgeSourceIdsJson ?? [],
    userGoal: row.userGoal ?? undefined,
    confirmedRequirements: row.confirmedRequirementsJson ?? [],
    comparisonContext: row.comparisonContextJson as unknown as ComparisonContext,
    comparisonResult: row.comparisonResultJson as unknown as ProductComparisonResult,
    sourceRefs: (row.sourceRefsJson ?? []) as ReportContextSnapshot["sourceRefs"],
    thermalResults: row.thermalResultsJson ?? [],
    referencePages: mergeReferencePages(row.referencePagesJson ?? []),
    createdAt: row.createdAt.toISOString()
  });
}

export async function generateReportFromSnapshot(
  app: FastifyInstance,
  input: {
    snapshot: ReportContextSnapshot;
    user: AuthUser;
    request: FastifyRequest;
  }
) {
  const draft = buildDeterministicReportDraft(input.snapshot);
  const reportType = normalizeReportTypeCode(input.snapshot.reportType) ?? "material_compare";
  const queued = await createReport(app, input.request, input.user, {
    reportType,
    projectId: input.snapshot.projectId ?? null,
    conversationId: input.snapshot.conversationId,
    contentJson: {
      reportKind: REPORT_CONTEXT_REPORT_TYPE,
      snapshotId: input.snapshot.id,
      selectedProductIds: input.snapshot.selectedProductIds,
      selectedKnowledgeSourceIds: input.snapshot.selectedKnowledgeSourceIds ?? [],
      thermalResults: input.snapshot.thermalResults ?? [],
      ...draft
    },
    contextOverlay: {
      snapshotId: input.snapshot.id,
      reportType,
      selectedProductIds: input.snapshot.selectedProductIds,
      selectedKnowledgeSourceIds: input.snapshot.selectedKnowledgeSourceIds ?? [],
      userGoal: input.snapshot.userGoal ?? null,
      confirmedRequirements: input.snapshot.confirmedRequirements,
      comparison: input.snapshot.comparisonResult ?? null,
      sourceRefs: input.snapshot.sourceRefs,
      thermalResults: input.snapshot.thermalResults ?? [],
      referencePages: input.snapshot.referencePages ?? []
    }
  });

  await app.db.update(reportContextSnapshots).set({
    reportId: queued.reportId
  }).where(eq(reportContextSnapshots.id, input.snapshot.id));

  return {
    reportId: queued.reportId,
    taskId: queued.taskId,
    snapshotId: input.snapshot.id,
    reportType,
    status: queued.status,
    draft
  };
}

export async function confirmComparisonAndGenerateReport(
  app: FastifyInstance,
  input: {
    conversationId: string;
    projectId?: string | null;
    selectedProductIds: string[];
    userGoal?: string;
    confirmedRequirements?: string[];
    comparisonContext: ComparisonContext;
    comparisonResult: ProductComparisonResult;
    user: AuthUser;
    request: FastifyRequest;
  }
) {
  const snapshot = await createReportContextSnapshot(app, {
    conversationId: input.conversationId,
    projectId: input.projectId,
    selectedProductIds: input.selectedProductIds,
    userGoal: input.userGoal,
    confirmedRequirements: input.confirmedRequirements,
    comparisonContext: input.comparisonContext,
    comparisonResult: input.comparisonResult,
    createdById: input.user.id
  });
  const generated = await generateReportFromSnapshot(app, {
    snapshot,
    user: input.user,
    request: input.request
  });
  return { snapshot, ...generated };
}
