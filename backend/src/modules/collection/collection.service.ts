import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import type { AppQueues } from "../../queues/queues.js";
import type { Database } from "../../db/client.js";
import {
  collectionRecords,
  collectionSkills,
  collectionSources,
  collectionTasks,
  files,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  parsingJobs
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { CollectionError } from "../../shared/collection-errors.js";
import { NotFoundError } from "../../shared/errors.js";
import { getPagination } from "../../shared/pagination.js";
import type { ObjectStorage } from "../../storage/index.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { createKnowledgeWithFile, KNOWLEDGE_ALLOWED_MIME_TYPES } from "../knowledge/knowledge-workflow.service.js";
import { addParsingJobToQueue, nextVersionNumber } from "../knowledge/knowledge-admin.service.js";

/** P0 自动采集固定间隔：24 小时，不向业务管理员暴露 Cron */
export const COLLECTION_AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const COLLECTION_AUTO_SCAN_JOB_ID = "collection-auto-scan";

export function nextCollectionScanAt(input: {
  enabled: boolean;
  lastCollectedAt: Date | string | null | undefined;
  lastRunAt: Date | string | null | undefined;
  now?: Date;
}): string | null {
  if (!input.enabled) return null;
  const last = input.lastCollectedAt ?? input.lastRunAt;
  if (!last) return (input.now ?? new Date()).toISOString();
  const lastTime = last instanceof Date ? last.getTime() : new Date(last).getTime();
  return new Date(lastTime + COLLECTION_AUTO_INTERVAL_MS).toISOString();
}

export async function ensureCollectionAutoScanScheduler(
  queue: Pick<AppQueues["collectionFetch"], "upsertJobScheduler">
) {
  await queue.upsertJobScheduler(
    COLLECTION_AUTO_SCAN_JOB_ID,
    { every: COLLECTION_AUTO_INTERVAL_MS },
    { name: "scan_sources", data: {} }
  );
}

export interface CollectionDeps {
  db: Database;
  storage: ObjectStorage;
  queues: Pick<AppQueues, "collectionFetch" | "documentProcessing">;
}

const INFLIGHT_STATUSES = ["PENDING", "RUNNING"] as const;

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toCollectionSourceDto(row: typeof collectionSources.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl,
    mode: "AUTO" as const,
    enabled: row.enabled,
    skillId: row.skillId,
    lastCollectedAt: toIso(row.lastCollectedAt),
    lastRunAt: toIso(row.lastRunAt),
    nextScanAt: nextCollectionScanAt(row),
    createdById: row.createdById,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export function toCollectionTaskDto(row: typeof collectionTasks.$inferSelect) {
  return {
    id: row.id,
    sourceId: row.sourceId,
    name: row.name,
    sourceUrl: row.sourceUrl,
    mode: row.mode,
    status: row.status,
    resultFileId: row.resultFileId,
    resultMeta: row.resultMeta,
    errorMessage: row.errorMessage,
    createdById: row.createdById,
    createdAt: toIso(row.createdAt)!,
    startedAt: toIso(row.startedAt),
    finishedAt: toIso(row.finishedAt),
    importedKnowledgeDocumentId: row.importedKnowledgeDocumentId
  };
}

async function enqueueFetch(deps: CollectionDeps, taskId: string) {
  await deps.queues.collectionFetch.add("fetch_task", { taskId }, { jobId: `collection-fetch-${taskId}` });
}

async function hasInflightTask(deps: CollectionDeps, sourceId: string) {
  const [row] = await deps.db.select({ id: collectionTasks.id }).from(collectionTasks).where(and(
    eq(collectionTasks.sourceId, sourceId),
    inArray(collectionTasks.status, [...INFLIGHT_STATUSES])
  )).limit(1);
  return Boolean(row);
}

async function enqueueAutoTaskIfIdle(
  deps: CollectionDeps,
  source: typeof collectionSources.$inferSelect,
  createdById: string | null
) {
  try {
    await createAutoCollectionTask(deps, source, createdById);
  } catch (error) {
    if (!(error instanceof CollectionError) || error.code !== "COLLECTION_INFLIGHT") throw error;
  }
}

export async function createAutoCollectionTask(
  deps: CollectionDeps,
  source: typeof collectionSources.$inferSelect,
  createdById: string | null
) {
  if (await hasInflightTask(deps, source.id)) {
    throw new CollectionError("COLLECTION_INFLIGHT");
  }
  const [task] = await deps.db.insert(collectionTasks).values({
    sourceId: source.id,
    name: source.name,
    sourceUrl: source.sourceUrl,
    mode: "AUTO",
    status: "PENDING",
    createdById
  }).returning();
  await enqueueFetch(deps, task!.id);
  return task!;
}

export async function listCollectionSources(deps: CollectionDeps) {
  const rows = await deps.db.select().from(collectionSources).orderBy(desc(collectionSources.updatedAt));
  return rows.map(toCollectionSourceDto);
}

export async function createCollectionSource(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; sourceUrl: string; enabled?: boolean; skillId?: string | null }
) {
  const [created] = await deps.db.insert(collectionSources).values({
    name: input.name,
    sourceUrl: input.sourceUrl,
    mode: "AUTO",
    enabled: input.enabled ?? true,
    skillId: input.skillId ?? null,
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_SOURCE_CREATED, targetType: "collection_source", targetId: created!.id,
    afterJson: { name: created!.name, sourceUrl: created!.sourceUrl, enabled: created!.enabled, skillId: created!.skillId }
  });
  if (created!.enabled) {
    await enqueueAutoTaskIfIdle(deps, created!, actor.id);
  }
  return toCollectionSourceDto(created!);
}

export async function updateCollectionSource(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: { name?: string; sourceUrl?: string; skillId?: string | null }
) {
  const [existing] = await deps.db.select().from(collectionSources).where(eq(collectionSources.id, id)).limit(1);
  if (!existing) throw new NotFoundError("采集源不存在");
  const [updated] = await deps.db.update(collectionSources).set({
    name: input.name ?? existing.name,
    sourceUrl: input.sourceUrl ?? existing.sourceUrl,
    skillId: input.skillId === undefined ? existing.skillId : input.skillId,
    updatedAt: new Date()
  }).where(eq(collectionSources.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_SOURCE_UPDATED, targetType: "collection_source", targetId: id,
    beforeJson: { name: existing.name, sourceUrl: existing.sourceUrl, skillId: existing.skillId },
    afterJson: { name: updated!.name, sourceUrl: updated!.sourceUrl, skillId: updated!.skillId }
  });
  return toCollectionSourceDto(updated!);
}

export async function toggleCollectionSource(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  enabled: boolean
) {
  const [existing] = await deps.db.select().from(collectionSources).where(eq(collectionSources.id, id)).limit(1);
  if (!existing) throw new NotFoundError("采集源不存在");
  const [updated] = await deps.db.update(collectionSources).set({
    enabled,
    updatedAt: new Date()
  }).where(eq(collectionSources.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_SOURCE_TOGGLED, targetType: "collection_source", targetId: id,
    beforeJson: { enabled: existing.enabled },
    afterJson: { enabled }
  });
  if (enabled && !existing.enabled) {
    await enqueueAutoTaskIfIdle(deps, updated!, actor.id);
  }
  return toCollectionSourceDto(updated!);
}

export async function createManualCollectionTask(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; sourceUrl: string; remark?: string }
) {
  const [task] = await deps.db.insert(collectionTasks).values({
    name: input.name,
    sourceUrl: input.sourceUrl,
    mode: "MANUAL",
    status: "PENDING",
    resultMeta: input.remark ? { remark: input.remark } : null,
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_TASK_CREATED, targetType: "collection_task", targetId: task!.id,
    afterJson: { name: task!.name, sourceUrl: task!.sourceUrl, mode: "MANUAL" }
  });
  await enqueueFetch(deps, task!.id);
  return toCollectionTaskDto(task!);
}

export async function listCollectionTasks(
  deps: CollectionDeps,
  query: { page: number; pageSize: number; mode?: "MANUAL" | "AUTO"; status?: typeof collectionTasks.$inferSelect["status"]; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.mode ? eq(collectionTasks.mode, query.mode) : undefined,
    query.status ? eq(collectionTasks.status, query.status) : undefined,
    query.keyword
      ? or(ilike(collectionTasks.name, `%${query.keyword}%`), ilike(collectionTasks.sourceUrl, `%${query.keyword}%`))
      : undefined
  );
  const [rows, total] = await Promise.all([
    deps.db.select().from(collectionTasks).where(where).orderBy(desc(collectionTasks.createdAt)).offset(skip).limit(take),
    deps.db.select({ value: count() }).from(collectionTasks).where(where)
  ]);
  return { items: rows.map(toCollectionTaskDto), total: Number(total[0]?.value ?? 0), page: query.page, pageSize: query.pageSize };
}

export async function getCollectionTask(deps: CollectionDeps, id: string) {
  const [row] = await deps.db.select().from(collectionTasks).where(eq(collectionTasks.id, id)).limit(1);
  if (!row) throw new NotFoundError("采集任务不存在");
  return toCollectionTaskDto(row);
}

/**
 * 确认入库：WAITING_CONFIRM → 复用知识库 create-with-file 默认值创建 DRAFT。
 * 禁止自动发布；C 端 AI 不会检索 DRAFT。
 */
export async function importCollectionTaskToKnowledge(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  taskId: string
) {
  const [task] = await app.db.select().from(collectionTasks).where(eq(collectionTasks.id, taskId)).limit(1);
  if (!task) throw new NotFoundError("采集任务不存在");
  if (task.importedKnowledgeDocumentId) throw new CollectionError("COLLECTION_TASK_ALREADY_IMPORTED");
  if (task.status !== "WAITING_CONFIRM") throw new CollectionError("COLLECTION_TASK_NOT_CONFIRMABLE");
  if (!task.resultFileId) throw new CollectionError("COLLECTION_RESULT_MISSING");

  const [file] = await app.db.select().from(files).where(eq(files.id, task.resultFileId)).limit(1);
  if (!file) throw new CollectionError("COLLECTION_RESULT_MISSING", "采集结果文件不存在");

  const created = (KNOWLEDGE_ALLOWED_MIME_TYPES as readonly string[]).includes(file.mimeType)
    ? await createKnowledgeWithFile(app, request, actor, {
      title: task.name,
      docType: "OTHER",
      originalFileId: file.id
    })
    : await createKnowledgeDraftFromAnyFile(app, request, actor, { title: task.name, file });

  await app.db.update(collectionTasks).set({
    status: "COMPLETED",
    importedKnowledgeDocumentId: created.document.id,
    updatedAt: new Date()
  }).where(eq(collectionTasks.id, taskId));

  await writeAuditLog({
    db: app.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_TASK_IMPORTED, targetType: "collection_task", targetId: taskId,
    afterJson: {
      knowledgeDocumentId: created.document.id,
      versionId: created.version.id,
      versionStatus: "DRAFT",
      published: false
    }
  });

  const [version] = await app.db.select({
    id: knowledgeDocumentVersions.id,
    status: knowledgeDocumentVersions.status
  }).from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, created.version.id)).limit(1);

  return {
    taskId,
    knowledgeDocumentId: created.document.id,
    versionId: created.version.id,
    versionStatus: version?.status ?? "DRAFT",
    published: false
  };
}

/** HTML 等非 PDF/DOCX 采集结果：仍建 DRAFT 知识文档，不自动解析、不发布 */
async function createKnowledgeDraftFromAnyFile(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  input: { title: string; file: typeof files.$inferSelect }
) {
  const created = await app.db.transaction(async (tx) => {
    const [document] = await tx.insert(knowledgeDocuments).values({
      title: input.title,
      docType: "OTHER",
      status: "ACTIVE",
      createdById: actor.id
    }).returning();
    const versionNumber = await nextVersionNumber(tx, document!.id);
    const [version] = await tx.insert(knowledgeDocumentVersions).values({
      documentId: document!.id,
      version: versionNumber,
      title: input.title,
      status: "DRAFT",
      parseStatus: "PENDING",
      pipelineStatus: "UPLOADED",
      fileId: input.file.id,
      createdById: actor.id
    }).returning();
    await tx.insert(knowledgeDocumentAssets).values({
      documentId: document!.id,
      versionId: version!.id,
      fileId: input.file.id,
      role: "ORIGINAL",
      isPrimary: true,
      createdById: actor.id
    });
    const [job] = await tx.insert(parsingJobs).values({
      documentId: document!.id,
      versionId: version!.id,
      jobType: "PARSE",
      status: "QUEUED",
      fileId: input.file.id,
      queuedById: actor.id
    }).returning();
    return { document: document!, version: version!, job: job! };
  });
  await addParsingJobToQueue(app, {
    id: created.job.id,
    fileId: input.file.id,
    versionId: created.version.id,
    jobType: "PARSE"
  });
  return {
    document: { id: created.document.id, title: created.document.title, docType: created.document.docType },
    version: { id: created.version.id, versionNo: created.version.version }
  };
}

/** 扫描启用中的自动源：超过固定间隔且无进行中任务则创建 AUTO 任务（不发布） */
export async function scanEnabledCollectionSources(deps: CollectionDeps) {
  const sources = await deps.db.select().from(collectionSources).where(eq(collectionSources.enabled, true));
  const now = Date.now();
  const created: string[] = [];
  for (const source of sources) {
    const last = source.lastCollectedAt ? new Date(source.lastCollectedAt).getTime() : 0;
    if (last > 0 && now - last < COLLECTION_AUTO_INTERVAL_MS) continue;
    if (await hasInflightTask(deps, source.id)) continue;
    const task = await createAutoCollectionTask(deps, source, source.createdById);
    created.push(task.id);
  }
  return { scanned: sources.length, enqueued: created.length, taskIds: created };
}

function toSkillDto(row: typeof collectionSkills.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    keywordsJson: row.keywordsJson ?? [],
    instruction: row.instruction,
    enabled: row.enabled,
    createdAt: toIso(row.createdAt)!,
    updatedAt: toIso(row.updatedAt)!
  };
}

export async function listCollectionSkills(deps: CollectionDeps) {
  const rows = await deps.db.select().from(collectionSkills).orderBy(desc(collectionSkills.updatedAt));
  return rows.map(toSkillDto);
}

export async function createCollectionSkill(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; keywordsJson?: string[]; instruction?: string; enabled?: boolean }
) {
  const [created] = await deps.db.insert(collectionSkills).values({
    name: input.name,
    keywordsJson: input.keywordsJson ?? [],
    instruction: input.instruction ?? null,
    enabled: input.enabled ?? true,
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_SKILL_CREATED, targetType: "collection_skill", targetId: created!.id,
    afterJson: { name: created!.name, keywordsJson: created!.keywordsJson }
  });
  return toSkillDto(created!);
}

export async function updateCollectionSkill(
  deps: CollectionDeps,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: { name?: string; keywordsJson?: string[]; instruction?: string; enabled?: boolean }
) {
  const [existing] = await deps.db.select().from(collectionSkills).where(eq(collectionSkills.id, id)).limit(1);
  if (!existing) throw new NotFoundError("采集技能不存在");
  const [updated] = await deps.db.update(collectionSkills).set({
    name: input.name ?? existing.name,
    keywordsJson: input.keywordsJson ?? existing.keywordsJson,
    instruction: input.instruction === undefined ? existing.instruction : input.instruction,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date()
  }).where(eq(collectionSkills.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.COLLECTION_SKILL_UPDATED, targetType: "collection_skill", targetId: id,
    beforeJson: existing, afterJson: updated
  });
  return toSkillDto(updated!);
}

export async function listCollectionRecords(
  deps: CollectionDeps,
  query: { page: number; pageSize: number; sourceId?: string; keyword?: string }
) {
  const { skip, take } = getPagination(query.page, query.pageSize);
  const where = and(
    query.sourceId ? eq(collectionRecords.sourceId, query.sourceId) : undefined,
    query.keyword ? or(ilike(collectionRecords.title, `%${query.keyword}%`), ilike(collectionRecords.url, `%${query.keyword}%`)) : undefined
  );
  const [items, [totalRow]] = await Promise.all([
    deps.db.select({
      id: collectionRecords.id,
      sourceId: collectionRecords.sourceId,
      sourceName: collectionSources.name,
      skillId: collectionRecords.skillId,
      taskId: collectionRecords.taskId,
      title: collectionRecords.title,
      url: collectionRecords.url,
      publishedAt: collectionRecords.publishedAt,
      collectedAt: collectionRecords.collectedAt,
      keywords: collectionRecords.keywordsJson,
      summary: collectionRecords.summary,
      createdAt: collectionRecords.createdAt
    }).from(collectionRecords)
      .leftJoin(collectionSources, eq(collectionSources.id, collectionRecords.sourceId))
      .where(where)
      .orderBy(desc(collectionRecords.collectedAt))
      .offset(skip)
      .limit(take),
    deps.db.select({ value: count() }).from(collectionRecords).where(where)
  ]);
  return {
    items: items.map((row) => ({
      id: row.id,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      title: row.title,
      url: row.url,
      keywords: row.keywords ?? [],
      publishedAt: toIso(row.publishedAt),
      collectedAt: toIso(row.collectedAt)!,
      summary: row.summary,
      status: "COLLECTED" as const,
      createdAt: toIso(row.createdAt)!
    })),
    total: totalRow?.value ?? 0,
    page: query.page,
    pageSize: query.pageSize
  };
}

async function countSince(deps: CollectionDeps, since: Date) {
  const [row] = await deps.db.select({ value: count() }).from(collectionRecords).where(gte(collectionRecords.collectedAt, since));
  return row?.value ?? 0;
}

export async function getCollectionDashboard(deps: CollectionDeps) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const [totalRow] = await deps.db.select({ value: count() }).from(collectionRecords);
  return {
    total: totalRow?.value ?? 0,
    today: await countSince(deps, startOfToday),
    thisMonth: await countSince(deps, startOfMonth),
    thisYear: await countSince(deps, startOfYear)
  };
}

export async function getCollectionTrends(deps: CollectionDeps, granularity: "day" | "month" | "year") {
  const bucket = granularity === "day"
    ? sql<string>`to_char(${collectionRecords.collectedAt}, 'YYYY-MM-DD')`
    : granularity === "month"
      ? sql<string>`to_char(${collectionRecords.collectedAt}, 'YYYY-MM')`
      : sql<string>`to_char(${collectionRecords.collectedAt}, 'YYYY')`;
  const rows = await deps.db.select({
    bucket,
    count: count()
  }).from(collectionRecords).groupBy(bucket).orderBy(bucket);
  return {
    granularity,
    items: rows.map((row) => ({ period: row.bucket, count: Number(row.count) }))
  };
}
