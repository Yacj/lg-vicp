import type { FastifyRequest } from "fastify";
import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import type { Database, DbExecutor } from "../../db/client.js";
import {
  crawlJobs,
  standardApplicability,
  standardDocuments,
  standardIndicators,
  standardReplacements,
  standardSources,
  thermalStandardLimits,
  type StandardReplacement
} from "../../db/schema.js";
import type { AppQueues } from "../../queues/queues.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { ConflictError } from "../../shared/errors.js";
import { StandardError } from "../../shared/standard-errors.js";
import type { ObjectStorage } from "../../storage/index.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { upsertProfessionalReview } from "../review-center/professional-review.js";

/**
 * 地方标准采集业务服务（双通道：爬虫 CRAWL / 人工 MANUAL）。
 * - 人工录入组合提交（文档 + 适用范围 + 指标），证据必填，进入与爬虫文档相同的审核流转。
 * - 轻量审核流转 submit/approve/reject/publish（不挂 masterdata 工作流，语义一致）。
 * - 指标 publish 同事务转换落库 thermal_standard_limits（basisCode=documentNo），
 *   同 (regionCode, basisCode) 旧版自动 DISABLED，多标准同地区天然并存。
 * 依赖显式注入（db/storage/queues），B 端接口与测试共用。
 */

export interface StandardDeps {
  db: Database;
  storage: ObjectStorage;
  queues?: Pick<AppQueues, "maintenance">;
}

// ---------------------------------------------------------------- 审核流转（轻量）

/** 状态守卫 + 事务更新 + 审计；before 用于发布互斥等副作用，返回更新后的行 */
async function transition(
  deps: StandardDeps,
  request: FastifyRequest,
  actor: AuthUser,
  table: AnyPgTable,
  idColumn: AnyPgColumn,
  statusColumn: AnyPgColumn,
  id: string,
  from: string[],
  to: string,
  action: string,
  targetType: string,
  label: string,
  extraSet: Record<string, unknown> = {},
  before?: (tx: DbExecutor, row: Record<string, unknown>) => Promise<void>
): Promise<Record<string, unknown>> {
  const [row] = await deps.db.select().from(table).where(eq(idColumn as never, id)).limit(1);
  if (!row) throw new StandardError("STANDARD_NOT_FOUND", `${label}不存在`);
  const current = row.status as string;
  if (!from.includes(current)) {
    throw new StandardError("STANDARD_STATUS_CONFLICT", `${label}当前状态（${current}）不允许执行该操作`);
  }
  return deps.db.transaction(async (tx) => {
    if (before) await before(tx, row as Record<string, unknown>);
    const [updated] = await tx.update(table)
      .set({ ...extraSet, status: to, updatedAt: new Date() } as never)
      .where(eq(idColumn as never, id))
      .returning();
    await writeAuditLog({
      db: tx, request, actor,
      action, targetType, targetId: id,
      beforeJson: { status: current },
      afterJson: { status: to }
    });
    // 统一审核记录（审核中心队列数据源）：submit/approve/reject 与状态变更同事务 upsert
    const reviewStatus = to === "PENDING_REVIEW" ? "PENDING_REVIEW" as const
      : to === "APPROVED" ? "APPROVED" as const
      : to === "REJECTED" ? "REJECTED" as const
      : null;
    if (reviewStatus) {
      await upsertProfessionalReview({
        db: tx,
        entityType: targetType,
        entityId: id,
        entityVersion: null,
        status: reviewStatus,
        comment: (extraSet.approvalNote as string | undefined) ?? (extraSet.rejectReason as string | undefined) ?? null,
        actorUserId: actor.id,
        requestId: request.id
      });
    }
    return updated as Record<string, unknown>;
  });
}

// ---------------------------------------------------------------- 抓取来源与作业

export interface SourceInput {
  provinceCode: string;
  provinceName: string;
  officialDomain: string;
  catalogUrls?: unknown[];
  extractRules?: unknown[];
  keywords?: { titleKeywords?: string[]; excludeKeywords?: string[] };
  crawlScope?: "today" | "all";
  enabled?: boolean;
}

export async function listSources(deps: StandardDeps, enabled?: boolean) {
  return deps.db.select().from(standardSources)
    .where(enabled === undefined ? undefined : eq(standardSources.enabled, enabled))
    .orderBy(asc(standardSources.provinceCode));
}

export async function getSource(deps: StandardDeps, id: string) {
  const [source] = await deps.db.select().from(standardSources).where(eq(standardSources.id, id)).limit(1);
  if (!source) throw new StandardError("STANDARD_NOT_FOUND", "抓取来源不存在");
  return source;
}

export async function createSource(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, input: SourceInput
) {
  const [dup] = await deps.db.select({ id: standardSources.id }).from(standardSources)
    .where(and(eq(standardSources.provinceCode, input.provinceCode), eq(standardSources.officialDomain, input.officialDomain)))
    .limit(1);
  if (dup) throw new ConflictError("同一省份域名已配置抓取来源");
  const [created] = await deps.db.insert(standardSources).values({
    provinceCode: input.provinceCode,
    provinceName: input.provinceName,
    officialDomain: input.officialDomain,
    catalogUrls: (input.catalogUrls ?? []) as never,
    extractRules: (input.extractRules ?? []) as never,
    keywords: { titleKeywords: input.keywords?.titleKeywords ?? [], excludeKeywords: input.keywords?.excludeKeywords ?? [] } as never,
    crawlScope: input.crawlScope ?? "today",
    enabled: input.enabled ?? true,
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_SOURCE_CREATED, targetType: "standard_source", targetId: created!.id,
    afterJson: { provinceCode: created!.provinceCode, officialDomain: created!.officialDomain }
  });
  return created!;
}

export async function updateSource(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, input: Partial<SourceInput>
) {
  const [existing] = await deps.db.select().from(standardSources).where(eq(standardSources.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "抓取来源不存在");
  const [updated] = await deps.db.update(standardSources).set({
    provinceCode: input.provinceCode ?? existing.provinceCode,
    provinceName: input.provinceName ?? existing.provinceName,
    officialDomain: input.officialDomain ?? existing.officialDomain,
    catalogUrls: (input.catalogUrls ?? existing.catalogUrls) as never,
    extractRules: (input.extractRules ?? existing.extractRules) as never,
    keywords: ({
      titleKeywords: input.keywords?.titleKeywords ?? existing.keywords?.titleKeywords ?? [],
      excludeKeywords: input.keywords?.excludeKeywords ?? existing.keywords?.excludeKeywords ?? []
    }) as never,
    crawlScope: input.crawlScope ?? existing.crawlScope,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date()
  }).where(eq(standardSources.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_SOURCE_UPDATED, targetType: "standard_source", targetId: id,
    beforeJson: { enabled: existing.enabled },
    afterJson: { enabled: updated!.enabled }
  });
  return updated!;
}

export async function deleteSource(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await deps.db.select().from(standardSources).where(eq(standardSources.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "抓取来源不存在");
  if (existing.enabled) throw new ConflictError("请先停用抓取来源再删除");
  await deps.db.delete(standardSources).where(eq(standardSources.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_SOURCE_DELETED, targetType: "standard_source", targetId: id,
    afterJson: { provinceCode: existing.provinceCode }
  });
}

/** 手动触发抓取：建作业（QUEUED）→ 入队 maintenance；scope 可临时覆盖来源配置 */
export async function triggerCrawl(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser,
  sourceId: string, scope?: "today" | "all"
) {
  if (!deps.queues) throw new ConflictError("队列未初始化，无法触发抓取");
  const [source] = await deps.db.select().from(standardSources).where(eq(standardSources.id, sourceId)).limit(1);
  if (!source) throw new StandardError("STANDARD_NOT_FOUND", "抓取来源不存在");
  if (!source.enabled) throw new ConflictError("抓取来源已停用，请先启用");
  const [job] = await deps.db.insert(crawlJobs).values({
    sourceId,
    status: "QUEUED",
    triggeredBy: "MANUAL",
    scope: scope ?? source.crawlScope ?? "today"
  }).returning();
  await deps.queues.maintenance.add("standard_crawl", { crawlJobId: job!.id }, {
    jobId: `standard-crawl-${job!.id}`,
    attempts: 1 // 手动触发单次执行，失败由 B 端重跑（避免重复抓取）
  });
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_SOURCE_RUN, targetType: "standard_source", targetId: sourceId,
    afterJson: { crawlJobId: job!.id, scope: job!.scope }
  });
  return job!;
}

export async function listCrawlJobs(deps: StandardDeps, sourceId?: string, status?: string) {
  const conditions = [
    sourceId ? eq(crawlJobs.sourceId, sourceId) : undefined,
    status ? eq(crawlJobs.status, status as never) : undefined
  ].filter(Boolean) as never[];
  return deps.db.select().from(crawlJobs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(crawlJobs.createdAt));
}

export async function getCrawlJob(deps: StandardDeps, id: string) {
  const [job] = await deps.db.select().from(crawlJobs).where(eq(crawlJobs.id, id)).limit(1);
  if (!job) throw new StandardError("STANDARD_NOT_FOUND", "抓取作业不存在");
  return job;
}

// ---------------------------------------------------------------- 标准文档（双通道）

export interface ManualDocumentInput {
  provinceCode: string;
  provinceName: string;
  documentNo: string;
  title: string;
  category?: string | null;
  standardStatus?: string;
  publishDate?: Date | string | null;
  implementDate?: Date | string | null;
  effectiveAt?: Date | string | null;
  expiresAt?: Date | string | null;
  originUrl?: string | null;
  evidenceSource?: string | null;
  applicability: Array<{
    regionCode: string;
    regionName: string;
    buildingTypes?: string[];
    structureTypes?: string[];
    scopeText?: string | null;
    evidenceRef?: string | null;
  }>;
  indicators: Array<{
    indicatorType?: string;
    indicatorName: string;
    value: number;
    unit?: string | null;
    evidenceRef: string;
    rawText?: string | null;
  }>;
}

export function normalizeDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 人工录入组合提交：文档 DRAFT + 适用范围 DRAFT + 指标 PENDING_REVIEW，证据必填 */
export async function createManualDocument(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, input: ManualDocumentInput
) {
  if (input.indicators.length === 0 || input.indicators.some((indicator) => !indicator.evidenceRef?.trim())) {
    throw new StandardError("STANDARD_EVIDENCE_REQUIRED", "人工录入至少一条指标，且每条指标必须填写证据条款引用（evidenceRef）");
  }
  const [dup] = await deps.db.select({ id: standardDocuments.id }).from(standardDocuments)
    .where(and(eq(standardDocuments.provinceCode, input.provinceCode), eq(standardDocuments.documentNo, input.documentNo)))
    .limit(1);
  if (dup) throw new StandardError("STANDARD_DUPLICATE_KEY", `同省份编号 ${input.documentNo} 已存在，请核对编号或关联既有版本`);

  return deps.db.transaction(async (tx) => {
    const [document] = await tx.insert(standardDocuments).values({
      ingestType: "MANUAL",
      provinceCode: input.provinceCode,
      provinceName: input.provinceName,
      documentNo: input.documentNo,
      title: input.title,
      category: input.category ?? null,
      standardStatus: (input.standardStatus ?? "OFFICIAL") as never,
      publishDate: normalizeDate(input.publishDate),
      implementDate: normalizeDate(input.implementDate),
      effectiveAt: normalizeDate(input.effectiveAt),
      expiresAt: normalizeDate(input.expiresAt),
      originUrl: input.originUrl ?? null,
      parsedMetaJson: { evidenceSource: input.evidenceSource ?? null, ingestType: "MANUAL" },
      parseStatus: "PARSED",
      version: 1,
      status: "DRAFT",
      createdById: actor.id
    }).returning();
    const documentId = document!.id;

    const applicabilityIds: string[] = [];
    for (const item of input.applicability) {
      const [applicability] = await tx.insert(standardApplicability).values({
        documentId,
        regionCode: item.regionCode,
        regionName: item.regionName,
        buildingTypes: (item.buildingTypes ?? []) as never,
        structureTypes: (item.structureTypes ?? []) as never,
        scopeText: item.scopeText ?? null,
        evidenceRef: item.evidenceRef ?? null,
        status: "DRAFT",
        createdById: actor.id
      }).returning();
      applicabilityIds.push(applicability!.id);
    }
    const applicabilityId = applicabilityIds[0] ?? null;

    for (const indicator of input.indicators) {
      await tx.insert(standardIndicators).values({
        documentId,
        applicabilityId,
        indicatorType: (indicator.indicatorType ?? "K_VALUE") as never,
        indicatorName: indicator.indicatorName,
        value: indicator.value,
        unit: indicator.unit ?? null,
        evidenceRef: indicator.evidenceRef,
        rawText: indicator.rawText ?? null,
        status: "PENDING_REVIEW",
        version: 1
      });
    }

    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.STANDARD_DOCUMENT_CREATED, targetType: "standard_document", targetId: documentId,
      afterJson: { documentNo: input.documentNo, ingestType: "MANUAL", indicators: input.indicators.length }
    });
    return document!;
  });
}

export interface DocumentFilter {
  provinceCode?: string;
  documentNo?: string;
  standardStatus?: string;
  reviewStatus?: string;
  ingestType?: string;
  sourceId?: string;
}

export async function listDocuments(deps: StandardDeps, filter: DocumentFilter = {}) {
  const conditions = [
    filter.provinceCode ? eq(standardDocuments.provinceCode, filter.provinceCode) : undefined,
    filter.documentNo ? ilike(standardDocuments.documentNo, `%${filter.documentNo}%`) : undefined,
    filter.standardStatus ? eq(standardDocuments.standardStatus, filter.standardStatus as never) : undefined,
    filter.reviewStatus ? eq(standardDocuments.status, filter.reviewStatus as never) : undefined,
    filter.ingestType ? eq(standardDocuments.ingestType, filter.ingestType as never) : undefined,
    filter.sourceId ? eq(standardDocuments.sourceId, filter.sourceId) : undefined
  ].filter(Boolean) as never[];
  return deps.db.select().from(standardDocuments)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(standardDocuments.createdAt));
}

export async function getDocument(deps: StandardDeps, id: string) {
  const [document] = await deps.db.select().from(standardDocuments).where(eq(standardDocuments.id, id)).limit(1);
  if (!document) throw new StandardError("STANDARD_NOT_FOUND", "标准文档不存在");
  const [applicability] = await Promise.all([
    deps.db.select().from(standardApplicability).where(eq(standardApplicability.documentId, id)).orderBy(asc(standardApplicability.regionCode)),
    deps.db.select().from(standardIndicators).where(eq(standardIndicators.documentId, id)).orderBy(asc(standardIndicators.createdAt))
  ]);
  return { ...document, applicability, indicators: applicability[1] ?? [] };
}

/** 仅 DRAFT 文档可编辑（审核流转开始后锁定） */
export async function updateDocument(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string,
  input: Partial<Omit<ManualDocumentInput, "applicability" | "indicators">>
) {
  const [existing] = await deps.db.select().from(standardDocuments).where(eq(standardDocuments.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "标准文档不存在");
  if (existing.status !== "DRAFT") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅草稿状态的文档可编辑");
  const [updated] = await deps.db.update(standardDocuments).set({
    title: input.title ?? existing.title,
    category: input.category ?? existing.category,
    standardStatus: (input.standardStatus ?? existing.standardStatus) as never,
    publishDate: input.publishDate !== undefined ? normalizeDate(input.publishDate) : existing.publishDate,
    implementDate: input.implementDate !== undefined ? normalizeDate(input.implementDate) : existing.implementDate,
    effectiveAt: input.effectiveAt !== undefined ? normalizeDate(input.effectiveAt) : existing.effectiveAt,
    expiresAt: input.expiresAt !== undefined ? normalizeDate(input.expiresAt) : existing.expiresAt,
    originUrl: input.originUrl ?? existing.originUrl,
    updatedById: actor.id,
    updatedAt: new Date()
  }).where(eq(standardDocuments.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_DOCUMENT_UPDATED, targetType: "standard_document", targetId: id,
    afterJson: { title: updated!.title }
  });
  return updated!;
}

export async function deleteDocument(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await deps.db.select().from(standardDocuments).where(eq(standardDocuments.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "标准文档不存在");
  if (existing.status !== "DRAFT") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅草稿状态的文档可删除");
  await deps.db.delete(standardDocuments).where(eq(standardDocuments.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_DOCUMENT_DELETED, targetType: "standard_document", targetId: id,
    afterJson: { documentNo: existing.documentNo }
  });
}

// ---------------------------------------------------------------- 文档审核流转

export async function submitDocument(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  return transition(deps, request, actor, standardDocuments, standardDocuments.id, standardDocuments.status,
    id, ["DRAFT", "REJECTED"], "PENDING_REVIEW", AUDIT_ACTIONS.STANDARD_DOCUMENT_SUBMITTED, "standard_document", "标准文档",
    { submittedById: actor.id, submittedAt: new Date() });
}

export async function approveDocument(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string) {
  return transition(deps, request, actor, standardDocuments, standardDocuments.id, standardDocuments.status,
    id, ["PENDING_REVIEW"], "APPROVED", AUDIT_ACTIONS.STANDARD_DOCUMENT_APPROVED, "standard_document", "标准文档",
    { approvedById: actor.id, approvedAt: new Date(), approvalNote: approvalNote ?? null });
}

export async function rejectDocument(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string) {
  return transition(deps, request, actor, standardDocuments, standardDocuments.id, standardDocuments.status,
    id, ["PENDING_REVIEW"], "REJECTED", AUDIT_ACTIONS.STANDARD_DOCUMENT_REJECTED, "standard_document", "标准文档",
    { rejectedById: actor.id, rejectedAt: new Date(), rejectReason });
}

/** 文档发布：同 (provinceCode, documentNo) 其他 PUBLISHED 行自动 DISABLED */
export async function publishDocument(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  return transition(deps, request, actor, standardDocuments, standardDocuments.id, standardDocuments.status,
    id, ["APPROVED"], "PUBLISHED", AUDIT_ACTIONS.STANDARD_DOCUMENT_PUBLISHED, "standard_document", "标准文档",
    { publishedById: actor.id, publishedAt: new Date() },
    async (tx, row) => {
      await tx.update(standardDocuments).set({ status: "DISABLED", updatedAt: new Date() })
        .where(and(
          eq(standardDocuments.provinceCode, row.provinceCode as string),
          eq(standardDocuments.documentNo, row.documentNo as string),
          ne(standardDocuments.id, id),
          eq(standardDocuments.status, "PUBLISHED")
        ));
    });
}

// ---------------------------------------------------------------- 适用范围

export interface ApplicabilityInput {
  documentId: string;
  regionCode: string;
  regionName: string;
  buildingTypes?: string[];
  structureTypes?: string[];
  scopeText?: string | null;
  evidenceRef?: string | null;
}

export async function listApplicability(deps: StandardDeps, documentId?: string, regionCode?: string) {
  const conditions = [
    documentId ? eq(standardApplicability.documentId, documentId) : undefined,
    regionCode ? eq(standardApplicability.regionCode, regionCode) : undefined
  ].filter(Boolean) as never[];
  return deps.db.select().from(standardApplicability)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(standardApplicability.createdAt));
}

export async function createApplicability(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, input: ApplicabilityInput
) {
  const [document] = await deps.db.select({ id: standardDocuments.id, status: standardDocuments.status }).from(standardDocuments)
    .where(eq(standardDocuments.id, input.documentId)).limit(1);
  if (!document) throw new StandardError("STANDARD_NOT_FOUND", "标准文档不存在");
  if (document.status !== "DRAFT") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅草稿状态的文档可维护适用范围");
  const [dup] = await deps.db.select({ id: standardApplicability.id }).from(standardApplicability)
    .where(and(eq(standardApplicability.documentId, input.documentId), eq(standardApplicability.regionCode, input.regionCode)))
    .limit(1);
  if (dup) throw new ConflictError("该文档已配置此地区的适用范围");
  const [created] = await deps.db.insert(standardApplicability).values({
    documentId: input.documentId,
    regionCode: input.regionCode,
    regionName: input.regionName,
    buildingTypes: (input.buildingTypes ?? []) as never,
    structureTypes: (input.structureTypes ?? []) as never,
    scopeText: input.scopeText ?? null,
    evidenceRef: input.evidenceRef ?? null,
    status: "DRAFT",
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_APPLICABILITY_CREATED, targetType: "standard_applicability", targetId: created!.id,
    afterJson: { documentId: input.documentId, regionCode: input.regionCode }
  });
  return created!;
}

export async function updateApplicability(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, input: Partial<Omit<ApplicabilityInput, "documentId">>
) {
  const [existing] = await deps.db.select().from(standardApplicability).where(eq(standardApplicability.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "适用范围不存在");
  if (existing.status !== "DRAFT") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅草稿状态的适用范围可编辑");
  const [updated] = await deps.db.update(standardApplicability).set({
    regionCode: input.regionCode ?? existing.regionCode,
    regionName: input.regionName ?? existing.regionName,
    buildingTypes: (input.buildingTypes ?? existing.buildingTypes) as never,
    structureTypes: (input.structureTypes ?? existing.structureTypes) as never,
    scopeText: input.scopeText ?? existing.scopeText,
    evidenceRef: input.evidenceRef ?? existing.evidenceRef,
    updatedById: actor.id,
    updatedAt: new Date()
  }).where(eq(standardApplicability.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_APPLICABILITY_UPDATED, targetType: "standard_applicability", targetId: id,
    afterJson: { regionCode: updated!.regionCode }
  });
  return updated!;
}

export async function deleteApplicability(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await deps.db.select().from(standardApplicability).where(eq(standardApplicability.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "适用范围不存在");
  if (existing.status !== "DRAFT") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅草稿状态的适用范围可删除");
  await deps.db.delete(standardApplicability).where(eq(standardApplicability.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_APPLICABILITY_DELETED, targetType: "standard_applicability", targetId: id,
    afterJson: { regionCode: existing.regionCode }
  });
}

export async function submitApplicability(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  return transition(deps, request, actor, standardApplicability, standardApplicability.id, standardApplicability.status,
    id, ["DRAFT", "REJECTED"], "PENDING_REVIEW", AUDIT_ACTIONS.STANDARD_APPLICABILITY_SUBMITTED, "standard_applicability", "适用范围",
    { submittedById: actor.id, submittedAt: new Date() });
}

export async function approveApplicability(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string) {
  return transition(deps, request, actor, standardApplicability, standardApplicability.id, standardApplicability.status,
    id, ["PENDING_REVIEW"], "APPROVED", AUDIT_ACTIONS.STANDARD_APPLICABILITY_APPROVED, "standard_applicability", "适用范围",
    { approvedById: actor.id, approvedAt: new Date(), approvalNote: approvalNote ?? null });
}

export async function rejectApplicability(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string) {
  return transition(deps, request, actor, standardApplicability, standardApplicability.id, standardApplicability.status,
    id, ["PENDING_REVIEW"], "REJECTED", AUDIT_ACTIONS.STANDARD_APPLICABILITY_REJECTED, "standard_applicability", "适用范围",
    { rejectedById: actor.id, rejectedAt: new Date(), rejectReason });
}

export async function publishApplicability(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  return transition(deps, request, actor, standardApplicability, standardApplicability.id, standardApplicability.status,
    id, ["APPROVED"], "PUBLISHED", AUDIT_ACTIONS.STANDARD_APPLICABILITY_PUBLISHED, "standard_applicability", "适用范围",
    { publishedById: actor.id, publishedAt: new Date() });
}

// ---------------------------------------------------------------- 指标

export interface IndicatorFilter {
  documentId?: string;
  reviewStatus?: string;
  indicatorType?: string;
}

export async function listIndicators(deps: StandardDeps, filter: IndicatorFilter = {}) {
  const conditions = [
    filter.documentId ? eq(standardIndicators.documentId, filter.documentId) : undefined,
    filter.reviewStatus ? eq(standardIndicators.status, filter.reviewStatus as never) : undefined,
    filter.indicatorType ? eq(standardIndicators.indicatorType, filter.indicatorType as never) : undefined
  ].filter(Boolean) as never[];
  return deps.db.select().from(standardIndicators)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(standardIndicators.updatedAt));
}

export interface IndicatorUpdateInput {
  indicatorName?: string;
  value?: number;
  unit?: string | null;
  evidenceRef?: string;
  rawText?: string | null;
}

export async function getIndicator(deps: StandardDeps, id: string) {
  const [indicator] = await deps.db.select().from(standardIndicators).where(eq(standardIndicators.id, id)).limit(1);
  if (!indicator) throw new StandardError("STANDARD_NOT_FOUND", "指标不存在");
  return indicator;
}

/** 人工修正指标（数值/证据引用/页码），仅 DRAFT/PENDING_REVIEW/REJECTED 可改 */
export async function updateIndicator(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, input: IndicatorUpdateInput
) {
  const [existing] = await deps.db.select().from(standardIndicators).where(eq(standardIndicators.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "指标不存在");
  if (!["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(existing.status)) {
    throw new StandardError("STANDARD_STATUS_CONFLICT", "已审核通过的指标不可修改");
  }
  const [updated] = await deps.db.update(standardIndicators).set({
    indicatorName: input.indicatorName ?? existing.indicatorName,
    value: input.value ?? existing.value,
    unit: input.unit ?? existing.unit,
    evidenceRef: input.evidenceRef ?? existing.evidenceRef,
    rawText: input.rawText ?? existing.rawText,
    updatedAt: new Date()
  }).where(eq(standardIndicators.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_INDICATOR_UPDATED, targetType: "standard_indicator", targetId: id,
    beforeJson: { value: existing.value },
    afterJson: { value: updated!.value }
  });
  return updated!;
}

export async function deleteIndicator(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await deps.db.select().from(standardIndicators).where(eq(standardIndicators.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "指标不存在");
  if (!["DRAFT", "PENDING_REVIEW", "REJECTED"].includes(existing.status)) {
    throw new StandardError("STANDARD_STATUS_CONFLICT", "已审核通过的指标不可删除");
  }
  await deps.db.delete(standardIndicators).where(eq(standardIndicators.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_INDICATOR_DELETED, targetType: "standard_indicator", targetId: id,
    afterJson: { value: existing.value }
  });
}

export async function approveIndicator(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, approvalNote?: string) {
  return transition(deps, request, actor, standardIndicators, standardIndicators.id, standardIndicators.status,
    id, ["PENDING_REVIEW"], "APPROVED", AUDIT_ACTIONS.STANDARD_INDICATOR_APPROVED, "standard_indicator", "指标",
    { approvedById: actor.id, approvedAt: new Date(), approvalNote: approvalNote ?? null, reviewedById: actor.id, reviewedAt: new Date() });
}

export async function rejectIndicator(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, rejectReason: string) {
  return transition(deps, request, actor, standardIndicators, standardIndicators.id, standardIndicators.status,
    id, ["PENDING_REVIEW"], "REJECTED", AUDIT_ACTIONS.STANDARD_INDICATOR_REJECTED, "standard_indicator", "指标",
    { rejectedById: actor.id, rejectedAt: new Date(), rejectReason, reviewedById: actor.id, reviewedAt: new Date() });
}

/**
 * 指标发布（核心动作）：同事务转换落库 thermal_standard_limits。
 * 前置校验：文档 PUBLISHED + 指标所属适用范围 PUBLISHED。
 * 转换：basisCode=documentNo、basisName=title、clauseRef=evidenceRef（缺省取原文片段）、
 * limitKValue=value、生效窗=文档生效窗、standard_document_id 溯源；
 * 同 (regionCode, basisCode) 旧 PUBLISHED 行自动 DISABLED（多版本互斥）。
 * 第一版仅 K_VALUE 指标落库（HEAT_RESISTANCE/OTHER 正常审核流转但不生成限值行）。
 */
export async function publishIndicator(deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  return transition(deps, request, actor, standardIndicators, standardIndicators.id, standardIndicators.status,
    id, ["APPROVED"], "PUBLISHED", AUDIT_ACTIONS.STANDARD_INDICATOR_PUBLISHED, "standard_indicator", "指标",
    { publishedById: actor.id, publishedAt: new Date(), reviewedById: actor.id, reviewedAt: new Date() },
    async (tx, row) => {
      const [document] = await tx.select().from(standardDocuments).where(eq(standardDocuments.id, row.documentId as string)).limit(1);
      if (!document) throw new StandardError("STANDARD_NOT_FOUND", "标准文档不存在");
      if (document.status !== "PUBLISHED") throw new StandardError("STANDARD_NOT_PUBLISHED", "请先发布标准文档再发布指标");
      if (row.indicatorType !== "K_VALUE") return; // 第一版仅 K 值转换落库
      if (!row.applicabilityId) throw new StandardError("STANDARD_NOT_APPLICABLE");
      const [applicability] = await tx.select().from(standardApplicability)
        .where(eq(standardApplicability.id, row.applicabilityId as string)).limit(1);
      if (!applicability || applicability.status !== "PUBLISHED") {
        throw new StandardError("STANDARD_NOT_APPLICABLE", "指标所属适用范围未发布，请先发布适用范围");
      }

      const keyConditions = [
        eq(thermalStandardLimits.regionCode, applicability.regionCode),
        eq(thermalStandardLimits.basisCode, document.documentNo)
      ];
      await tx.update(thermalStandardLimits).set({ status: "DISABLED", updatedAt: new Date() })
        .where(and(...keyConditions, eq(thermalStandardLimits.status, "PUBLISHED")));
      const [maxRow] = await tx.select({ max: sql<number>`coalesce(max(${thermalStandardLimits.version}), 0)` })
        .from(thermalStandardLimits).where(and(...keyConditions));

      const clauseRef = (typeof row.evidenceRef === "string" && row.evidenceRef.trim()
        ? row.evidenceRef
        : `原文：${String(row.rawText ?? "").slice(0, 100)}`).slice(0, 120);
      const now = new Date();
      const [limitRow] = await tx.insert(thermalStandardLimits).values({
        regionCode: applicability.regionCode,
        version: (maxRow?.max ?? 0) + 1,
        regionName: applicability.regionName,
        basisCode: document.documentNo,
        basisName: document.title,
        standardDocumentId: document.id,
        clauseRef,
        limitKValue: row.value as number,
        changeNote: `来源标准 ${document.documentNo}（${document.ingestType} 通道）`,
        evidenceSource: document.originUrl ?? `standard:${document.id}`,
        evidenceRef: (row.evidenceRef as string | null) ?? null,
        evidenceLevel: (row.evidenceLevel as never) ?? null,
        effectiveAt: document.effectiveAt ?? now,
        expiresAt: document.expiresAt,
        status: "PUBLISHED",
        publishedById: actor.id,
        publishedAt: now,
        createdById: actor.id
      }).returning();
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.STANDARD_LIMIT_PUBLISHED, targetType: "thermal_standard_limit", targetId: limitRow!.id,
        afterJson: {
          regionCode: applicability.regionCode,
          basisCode: document.documentNo,
          limitKValue: row.value,
          version: limitRow!.version
        }
      });
    });
}

// ---------------------------------------------------------------- 替代关系与过渡期

export interface ReplacementInput {
  oldDocumentId: string;
  newDocumentId: string;
  replacementType?: string;
  transitionStartAt?: Date | string | null;
  transitionEndAt?: Date | string | null;
  note?: string | null;
}

export async function listReplacements(deps: StandardDeps, status?: string) {
  return deps.db.select().from(standardReplacements)
    .where(status ? eq(standardReplacements.status, status as never) : undefined)
    .orderBy(desc(standardReplacements.createdAt));
}

export async function createReplacement(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, input: ReplacementInput
) {
  if (input.oldDocumentId === input.newDocumentId) throw new ConflictError("新旧标准不能是同一份文档");
  const [dup] = await deps.db.select({ id: standardReplacements.id }).from(standardReplacements)
    .where(and(eq(standardReplacements.oldDocumentId, input.oldDocumentId), eq(standardReplacements.newDocumentId, input.newDocumentId)))
    .limit(1);
  if (dup) throw new ConflictError("该替代关系已存在");
  const [created] = await deps.db.insert(standardReplacements).values({
    oldDocumentId: input.oldDocumentId,
    newDocumentId: input.newDocumentId,
    replacementType: (input.replacementType ?? "SUPERSEDE") as never,
    transitionStartAt: normalizeDate(input.transitionStartAt),
    transitionEndAt: normalizeDate(input.transitionEndAt),
    note: input.note ?? null,
    status: "PENDING"
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_REPLACEMENT_CREATED, targetType: "standard_replacement", targetId: created!.id,
    afterJson: { oldDocumentId: input.oldDocumentId, newDocumentId: input.newDocumentId }
  });
  return created!;
}

export async function deleteReplacement(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  const [existing] = await deps.db.select().from(standardReplacements).where(eq(standardReplacements.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "替代关系不存在");
  if (existing.status === "CONFIRMED") throw new ConflictError("已确认的替代关系不可删除");
  await deps.db.delete(standardReplacements).where(eq(standardReplacements.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_REPLACEMENT_DELETED, targetType: "standard_replacement", targetId: id,
    afterJson: { oldDocumentId: existing.oldDocumentId }
  });
}

/**
 * 确认替代：事务内 CONFIRMED + 旧文档 expiresAt=过渡期结束时间（未填则立即失效）。
 * 过渡期内新旧并存（limits 生效窗不变），过渡期结束由每日扫描失效。
 */
export async function confirmReplacement(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string
) {
  return deps.db.transaction(async (tx) => {
    const [replacement] = await tx.select().from(standardReplacements).where(eq(standardReplacements.id, id)).limit(1);
    if (!replacement) throw new StandardError("STANDARD_NOT_FOUND", "替代关系不存在");
    if (replacement.status !== "PENDING") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅待确认的替代关系可确认");
    const transitionEndAt = replacement.transitionEndAt ?? replacement.transitionStartAt ?? new Date();
    const [updated] = await tx.update(standardReplacements).set({
      status: "CONFIRMED",
      confirmedById: actor.id,
      confirmedAt: new Date(),
      updatedAt: new Date()
    }).where(eq(standardReplacements.id, id)).returning();
    await tx.update(standardDocuments).set({ expiresAt: transitionEndAt, updatedAt: new Date() })
      .where(and(eq(standardDocuments.id, replacement.oldDocumentId), eq(standardDocuments.status, "PUBLISHED")));
    await writeAuditLog({
      db: tx, request, actor,
      action: AUDIT_ACTIONS.STANDARD_REPLACEMENT_CONFIRMED, targetType: "standard_replacement", targetId: id,
      beforeJson: { status: replacement.status },
      afterJson: { status: "CONFIRMED", oldExpiresAt: transitionEndAt.toISOString() }
    });
    return updated!;
  });
}

export async function rejectReplacement(
  deps: StandardDeps, request: FastifyRequest, actor: AuthUser, id: string, reason: string
) {
  const [existing] = await deps.db.select().from(standardReplacements).where(eq(standardReplacements.id, id)).limit(1);
  if (!existing) throw new StandardError("STANDARD_NOT_FOUND", "替代关系不存在");
  if (existing.status !== "PENDING") throw new StandardError("STANDARD_STATUS_CONFLICT", "仅待确认的替代关系可驳回");
  const [updated] = await deps.db.update(standardReplacements).set({
    status: "REJECTED",
    note: reason ? `${existing.note ?? ""}\n驳回：${reason}`.trim() : existing.note,
    updatedAt: new Date()
  }).where(eq(standardReplacements.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.STANDARD_REPLACEMENT_REJECTED, targetType: "standard_replacement", targetId: id,
    afterJson: { status: "REJECTED", reason }
  });
  return updated!;
}

/** 每日扫描：过渡期已结束的旧标准文档（PUBLISHED 且 expiresAt 已过）→ DISABLED */
export async function expireSupersededDocuments(db: DbExecutor, now = new Date()): Promise<number> {
  const expired = await db.select({ id: standardDocuments.id }).from(standardDocuments)
    .where(and(
      eq(standardDocuments.status, "PUBLISHED"),
      sql`${standardDocuments.expiresAt} is not null`,
      sql`${standardDocuments.expiresAt} <= ${now}`
    ));
  if (expired.length === 0) return 0;
  await db.update(standardDocuments).set({ status: "DISABLED", updatedAt: now })
    .where(inArray(standardDocuments.id, expired.map((row) => row.id)));
  return expired.length;
}

// ---------------------------------------------------------------- 生效标准查询（B 端）

export interface EffectiveStandard {
  document: typeof standardDocuments.$inferSelect;
  applicability: typeof standardApplicability.$inferSelect[];
  indicators: typeof standardIndicators.$inferSelect[];
}

/** 查询指定地区全部已发布生效指标（确定性取数，供 B 端核对） */
export async function listPublishedIndicators(
  deps: StandardDeps, regionCode: string, indicatorType?: string
) {
  const applicability = await deps.db.select({ id: standardApplicability.id, documentId: standardApplicability.documentId })
    .from(standardApplicability)
    .where(and(eq(standardApplicability.regionCode, regionCode), eq(standardApplicability.status, "PUBLISHED")));
  const documentIds = [...new Set(applicability.map((item) => item.documentId))];
  if (documentIds.length === 0) return [];
  const documents = await deps.db.select({ id: standardDocuments.id }).from(standardDocuments)
    .where(and(eq(standardDocuments.status, "PUBLISHED"), inArray(standardDocuments.id, documentIds)));
  const publishedDocIds = documents.map((document) => document.id);
  if (publishedDocIds.length === 0) return [];
  return deps.db.select().from(standardIndicators)
    .where(and(
      eq(standardIndicators.status, "PUBLISHED"),
      inArray(standardIndicators.documentId, publishedDocIds),
      indicatorType ? eq(standardIndicators.indicatorType, indicatorType as never) : undefined
    ))
    .orderBy(desc(standardIndicators.updatedAt));
}

/** 查询指定地区指定时点的已发布生效标准（时间线/项目日期查询） */
export async function listEffectiveStandards(
  deps: StandardDeps, regionCode: string, asOfDate = new Date()
): Promise<EffectiveStandard[]> {
  const applicability = await deps.db.select().from(standardApplicability)
    .where(and(eq(standardApplicability.regionCode, regionCode), eq(standardApplicability.status, "PUBLISHED")));
  const documentIds = [...new Set(applicability.map((item) => item.documentId))];
  if (documentIds.length === 0) return [];
  const documents = await deps.db.select().from(standardDocuments)
    .where(and(
      eq(standardDocuments.status, "PUBLISHED"),
      inArray(standardDocuments.id, documentIds),
      or(sql`${standardDocuments.effectiveAt} is null`, sql`${standardDocuments.effectiveAt} <= ${asOfDate}`),
      or(sql`${standardDocuments.expiresAt} is null`, sql`${standardDocuments.expiresAt} > ${asOfDate}`)
    ));
  const publishedDocIds = documents.map((document) => document.id);
  if (publishedDocIds.length === 0) return [];
  const indicators = await deps.db.select().from(standardIndicators)
    .where(and(eq(standardIndicators.status, "PUBLISHED"), inArray(standardIndicators.documentId, publishedDocIds)));
  return documents.map((document) => ({
    document,
    applicability: applicability.filter((item) => item.documentId === document.id),
    indicators: indicators.filter((indicator) => indicator.documentId === document.id)
  }));
}