import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyRequest } from "fastify";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import type { AppQueues } from "../../queues/queues.js";
import type { Database, DbExecutor } from "../../db/client.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { AUDIT_ACTIONS } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from "../../shared/errors.js";
import type { ObjectStorage } from "../../storage/index.js";
import {
  files,
  knowledgeCrawlerSources,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  knowledgeRankingRules,
  parsingJobs,
  users
} from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

/**
 * 知识库多来源接入服务：SHA-256 去重、批量导入（B 端预签名）、
 * 爬虫下载与内部受控 API（服务端直写对象存储）共用入库与解析投递链路。
 * 依赖显式注入（db/storage/queues），API 与 Worker 复用同一套逻辑。
 */

export interface IngestDeps {
  db: Database;
  storage: ObjectStorage;
  queues: Pick<AppQueues, "documentProcessing">;
}

/** 版本号 = 当前最大版本 + 1（与 knowledge-admin.service 同逻辑，避免循环依赖） */
export async function nextVersionNumber(db: DbExecutor, documentId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number>`coalesce(max(${knowledgeDocumentVersions.version}), 0)` })
    .from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.documentId, documentId));
  return (row?.max ?? 0) + 1;
}

/** 文件扩展名白名单清洗（与服务端 objectKey 生成共用） */
export function safeExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return extension.slice(0, 12);
}

/** 服务端入口（爬虫/内部 API）无登录用户：以最早创建的超级管理员作为归属与审计人 */
export async function resolveSystemActor(db: Database): Promise<AuthUser> {
  const [admin] = await db.select({ id: users.id }).from(users)
    .where(eq(users.role, "SUPER_ADMIN")).orderBy(asc(users.createdAt)).limit(1);
  if (!admin) throw new ServiceUnavailableError("系统未配置超级管理员，无法执行服务端导入");
  return { id: admin.id, role: "SUPER_ADMIN", channelType: null, clientType: "B_ADMIN", permissionCodes: [] };
}

/**
 * SHA-256 去重：同一内容（同哈希）已存在文件时拒绝重复入库。
 * 命中已发布版本 → 直接冲突；仅草稿 → 冲突并提示先处理已有草稿。
 * excludeFileId 用于上传完成校验场景排除本次文件自身。
 */
export async function assertNoDuplicateSha256(
  db: DbExecutor,
  sha256: string | null,
  excludeFileId?: string
): Promise<void> {
  if (!sha256) return;
  const conditions = [eq(files.sha256, sha256), ne(files.status, "DELETED")];
  if (excludeFileId) conditions.push(ne(files.id, excludeFileId));
  const [existingFile] = await db.select({ id: files.id }).from(files)
    .where(and(...conditions)).limit(1);
  if (!existingFile) return;
  const [published] = await db.select({ id: knowledgeDocumentVersions.id }).from(knowledgeDocumentVersions)
    .where(and(eq(knowledgeDocumentVersions.fileId, existingFile.id), eq(knowledgeDocumentVersions.status, "PUBLISHED"))).limit(1);
  if (published) throw new ConflictError("相同内容（SHA-256）的文档已入库并发布，不能重复导入");
  throw new ConflictError("相同内容（SHA-256）的文件已存在且未发布，请先处理已有草稿或变更文件后重试");
}

// ---------------------------------------------------------------- 批量导入（B 端预签名）

export interface BatchImportItem {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  title?: string;
  docType?: string;
  categoryId?: string;
  changeNote?: string;
}

export interface BatchImportResultItem {
  documentId: string;
  versionId: string;
  fileId: string;
  title: string;
  uploadUrl: string;
  headers: Record<string, string>;
  expiresAt: Date;
}

/**
 * 批量导入：逐项创建文档 + DRAFT 版本 + UPLOADING 文件（source=BATCH_IMPORT），
 * 返回预签名上传地址，客户端直传后复用 completeVersionUpload 完成绑定并触发解析。
 */
export async function createBatchImportIntents(
  deps: IngestDeps,
  request: FastifyRequest,
  actor: AuthUser,
  items: BatchImportItem[]
): Promise<{ items: BatchImportResultItem[] }> {
  if (items.length === 0) throw new ForbiddenError("导入列表不能为空");
  if (items.length > 100) throw new ForbiddenError("单次批量导入不能超过 100 个文件");
  const results: BatchImportResultItem[] = [];
  for (const item of items) {
    if (item.sizeBytes > env.MAX_UPLOAD_BYTES) {
      throw new ForbiddenError(`文件 ${item.fileName} 不能超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`);
    }
    await assertNoDuplicateSha256(deps.db, item.sha256 ?? null);
    const fileId = randomUUID();
    const objectKey = `knowledge/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(item.fileName)}`;
    const { documentId, versionId } = await deps.db.transaction(async (tx) => {
      const [document] = await tx.insert(knowledgeDocuments).values({
        title: item.title?.trim() || item.fileName,
        docType: (item.docType ?? "OTHER") as "OTHER",
        categoryId: item.categoryId,
        status: "ACTIVE",
        createdById: actor.id
      }).returning();
      const versionNumber = await nextVersionNumber(tx, document!.id);
      const [version] = await tx.insert(knowledgeDocumentVersions).values({
        documentId: document!.id,
        version: versionNumber,
        title: item.title?.trim() || item.fileName,
        status: "DRAFT",
        pipelineStatus: "UPLOAD_PENDING",
        parseStatus: "PENDING",
        changeNote: item.changeNote,
        createdById: actor.id
      }).returning();
      await tx.insert(files).values({
        id: fileId,
        ownerUserId: actor.id,
        storageProvider: deps.storage.provider,
        bucket: deps.storage.bucket,
        objectKey,
        originalName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        sha256: item.sha256,
        source: "BATCH_IMPORT",
        status: "UPLOADING"
      });
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.KNOWLEDGE_BATCH_IMPORTED, targetType: "knowledge_document", targetId: document!.id,
        afterJson: { title: document!.title, versionId: version!.id }
      });
      return { documentId: document!.id, versionId: version!.id };
    });
    const upload = await deps.storage.createUploadUrl(objectKey, item.mimeType, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
    results.push({
      documentId,
      versionId,
      fileId,
      title: item.title?.trim() || item.fileName,
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresAt: upload.expiresAt
    });
  }
  return { items: results };
}

// ---------------------------------------------------------------- 服务端直写入库（爬虫/内部 API）

export interface ServerSideIngestInput {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  content: Buffer;
  source: "CRAWLER" | "INTERNAL_API";
  docType?: string;
  categoryId?: string;
  title?: string;
}

export interface ServerSideIngestResult {
  documentId: string;
  versionId: string;
  fileId: string;
  parsingJobId: string;
  /** 同 sha256 已在库（未删除）时跳过入库，返回幂等结果 */
  skipped: boolean;
}

/**
 * 服务端直写入库（爬虫/内部 API 共用）：
 * putObject → files(QUEUED) → DRAFT 版本绑定 → 创建解析任务并投递队列。
 * 幂等：同 sha256 已在库时直接跳过（定时抓取重复下载同一版本时不重复入库）。
 * 产物默认 DRAFT/REVIEW_PENDING 待审核，不自动发布。
 */
export async function ingestServerSideFile(
  deps: IngestDeps,
  request: FastifyRequest | null,
  actor: AuthUser,
  input: ServerSideIngestInput
): Promise<ServerSideIngestResult> {
  const actualSha256 = createHash("sha256").update(input.content).digest("hex");
  if (actualSha256.toLowerCase() !== input.sha256.toLowerCase()) {
    throw new ForbiddenError("文件哈希与申请信息不一致，文件可能被篡改");
  }
  const [existingFile] = await deps.db.select({ id: files.id }).from(files)
    .where(and(eq(files.sha256, actualSha256), ne(files.status, "DELETED"))).limit(1);
  if (existingFile) {
    const [version] = await deps.db.select({ id: knowledgeDocumentVersions.id }).from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.fileId, existingFile.id)).limit(1);
    return { documentId: "", versionId: version?.id ?? "", fileId: existingFile.id, parsingJobId: "", skipped: true };
  }

  const fileId = randomUUID();
  const objectKey = `knowledge/crawler/${new Date().toISOString().slice(0, 10)}/${fileId}${safeExtension(input.fileName)}`;
  await deps.storage.putObject(objectKey, input.content, input.mimeType);

  const { documentId, versionId, parsingJobId } = await deps.db.transaction(async (tx) => {
    const [document] = await tx.insert(knowledgeDocuments).values({
      title: input.title?.trim() || input.fileName,
      docType: (input.docType ?? "OTHER") as "OTHER",
      categoryId: input.categoryId,
      status: "ACTIVE",
      createdById: actor.id
    }).returning();
    const versionNumber = await nextVersionNumber(tx, document!.id);
    const [version] = await tx.insert(knowledgeDocumentVersions).values({
      documentId: document!.id,
      version: versionNumber,
      fileId,
      title: input.title?.trim() || input.fileName,
      status: "DRAFT",
      pipelineStatus: "UPLOADED",
      parseStatus: "PENDING",
      createdById: actor.id
    }).returning();
    const [file] = await tx.insert(files).values({
      id: fileId,
      ownerUserId: actor.id,
      storageProvider: deps.storage.provider,
      bucket: deps.storage.bucket,
      objectKey,
      originalName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      sha256: actualSha256,
      source: input.source,
      status: "QUEUED"
    }).returning();
    const [job] = await tx.insert(parsingJobs).values({
      documentId: document!.id,
      versionId: version!.id,
      jobType: "PARSE",
      status: "QUEUED",
      fileId: file!.id,
      queuedById: actor.id
    }).returning();
    if (request) {
      await writeAuditLog({
        db: tx, request, actor,
        action: AUDIT_ACTIONS.KNOWLEDGE_VERSION_PARSED, targetType: "knowledge_document_version", targetId: version!.id,
        afterJson: { source: input.source, parsingJobId: job!.id, sha256: actualSha256 }
      });
    }
    return { documentId: document!.id, versionId: version!.id, parsingJobId: job!.id };
  });

  try {
    await deps.queues.documentProcessing.add("parse_document", {
      parsingJobId,
      fileId,
      versionId,
      jobType: "PARSE"
    }, { jobId: parsingJobId });
  } catch (error) {
    await deps.db.update(parsingJobs).set({
      status: "FAILED", errorMessage: "解析任务投递失败，请稍后重试", updatedAt: new Date()
    }).where(eq(parsingJobs.id, parsingJobId));
    throw new ServiceUnavailableError("解析任务投递失败，请稍后重试");
  }
  return { documentId, versionId, fileId, parsingJobId, skipped: false };
}

// ---------------------------------------------------------------- 爬虫抓取

/** 下载 URL 模板渲染：支持 {date}（yyyy-mm-dd）占位符 */
export function renderDownloadUrl(pattern: string, now = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  return pattern.replaceAll("{date}", date);
}

/** 抓取单个抓取源：下载 → 哈希 → 幂等入库 → 解析；定时任务与手动触发共用 */
export async function runCrawlerSource(
  deps: IngestDeps,
  request: FastifyRequest | null,
  sourceId: string
): Promise<{ sourceName: string; ingested: boolean; fileId: string; message: string }> {
  const [source] = await deps.db.select().from(knowledgeCrawlerSources)
    .where(and(eq(knowledgeCrawlerSources.id, sourceId), eq(knowledgeCrawlerSources.enabled, true))).limit(1);
  if (!source) throw new NotFoundError("抓取源不存在或已停用");
  const actor = await resolveSystemActor(deps.db);
  const url = renderDownloadUrl(source.downloadUrlPattern);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    redirect: "follow",
    headers: { "User-Agent": "lg-vicp-knowledge-crawler/1.0" }
  });
  if (!response.ok) throw new ServiceUnavailableError(`抓取失败：HTTP ${response.status}`);
  const content = Buffer.from(await response.arrayBuffer());
  if (content.length > env.MAX_UPLOAD_BYTES) {
    throw new ForbiddenError(`抓取文件超过 ${Math.floor(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB 上限`);
  }
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const fileName = source.name.includes(".") ? source.name : `${source.name}.pdf`;
  const sha256 = createHash("sha256").update(content).digest("hex");
  const result = await ingestServerSideFile(deps, request, actor, {
    fileName,
    mimeType: contentType,
    sizeBytes: content.length,
    sha256,
    content,
    source: "CRAWLER",
    docType: source.docType,
    title: source.name
  });
  if (request) {
    await writeAuditLog({
      db: deps.db, request, actor,
      action: AUDIT_ACTIONS.KNOWLEDGE_CRAWLER_RUN, targetType: "knowledge_crawler_source", targetId: source.id,
      afterJson: { url, ingested: !result.skipped, fileId: result.fileId, message: result.skipped ? "skipped" : "ingested" }
    });
  }
  return {
    sourceName: source.name,
    ingested: !result.skipped,
    fileId: result.fileId,
    message: result.skipped ? "内容未变化，跳过入库（幂等）" : "抓取并入库成功，等待解析与人工审核"
  };
}

// ---------------------------------------------------------------- 抓取源管理（B 端）

export type CrawlerDocType = "SPECIFICATION" | "DETAIL_ATLAS" | "STANDARD" | "APPLICATION_GUIDE" |
  "MATERIAL_COMPARISON" | "COMPANY_PROFILE" | "THERMAL_FORMULA" | "OTHER";

export async function listCrawlerSources(deps: IngestDeps, enabled?: boolean) {
  const rows = await deps.db.select().from(knowledgeCrawlerSources)
    .where(enabled === undefined ? undefined : eq(knowledgeCrawlerSources.enabled, enabled))
    .orderBy(desc(knowledgeCrawlerSources.createdAt));
  return rows;
}

export async function createCrawlerSource(
  deps: IngestDeps,
  request: FastifyRequest,
  actor: AuthUser,
  input: { name: string; baseUrl: string; downloadUrlPattern: string; docType?: CrawlerDocType; enabled?: boolean }
) {
  const [created] = await deps.db.insert(knowledgeCrawlerSources).values({
    name: input.name,
    baseUrl: input.baseUrl,
    downloadUrlPattern: input.downloadUrlPattern,
    docType: input.docType ?? "STANDARD",
    enabled: input.enabled ?? true,
    createdById: actor.id
  }).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_CRAWLER_CREATED, targetType: "knowledge_crawler_source", targetId: created!.id,
    afterJson: { name: created!.name, downloadUrlPattern: created!.downloadUrlPattern }
  });
  return created!;
}

export async function updateCrawlerSource(
  deps: IngestDeps,
  request: FastifyRequest,
  actor: AuthUser,
  id: string,
  input: { name?: string; baseUrl?: string; downloadUrlPattern?: string; docType?: CrawlerDocType; enabled?: boolean }
) {
  const [existing] = await deps.db.select().from(knowledgeCrawlerSources).where(eq(knowledgeCrawlerSources.id, id)).limit(1);
  if (!existing) throw new NotFoundError("抓取源不存在");
  const [updated] = await deps.db.update(knowledgeCrawlerSources).set({
    name: input.name ?? existing.name,
    baseUrl: input.baseUrl ?? existing.baseUrl,
    downloadUrlPattern: input.downloadUrlPattern ?? existing.downloadUrlPattern,
    docType: input.docType ?? existing.docType,
    enabled: input.enabled ?? existing.enabled,
    updatedAt: new Date()
  }).where(eq(knowledgeCrawlerSources.id, id)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_CRAWLER_UPDATED, targetType: "knowledge_crawler_source", targetId: id,
    beforeJson: { name: existing.name, enabled: existing.enabled },
    afterJson: { name: updated!.name, enabled: updated!.enabled }
  });
  return updated!;
}

export async function deleteCrawlerSource(deps: IngestDeps, request: FastifyRequest, actor: AuthUser, id: string) {
  const [existing] = await deps.db.select().from(knowledgeCrawlerSources).where(eq(knowledgeCrawlerSources.id, id)).limit(1);
  if (!existing) throw new NotFoundError("抓取源不存在");
  await deps.db.delete(knowledgeCrawlerSources).where(eq(knowledgeCrawlerSources.id, id));
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_CRAWLER_DELETED, targetType: "knowledge_crawler_source", targetId: id,
    beforeJson: { name: existing.name }
  });
  return { message: "抓取源已删除" };
}

// ---------------------------------------------------------------- 排序规则（检索权重）

export async function listRankingRules(deps: IngestDeps) {
  return deps.db.select().from(knowledgeRankingRules).orderBy(asc(knowledgeRankingRules.key));
}

export async function updateRankingRule(
  deps: IngestDeps,
  request: FastifyRequest,
  actor: AuthUser,
  key: string,
  input: { weight?: number; enabled?: boolean; description?: string }
) {
  const [existing] = await deps.db.select().from(knowledgeRankingRules).where(eq(knowledgeRankingRules.key, key)).limit(1);
  if (!existing) throw new NotFoundError("排序规则不存在");
  const [updated] = await deps.db.update(knowledgeRankingRules).set({
    weight: input.weight ?? existing.weight,
    enabled: input.enabled ?? existing.enabled,
    description: input.description ?? existing.description,
    updatedAt: new Date()
  }).where(eq(knowledgeRankingRules.key, key)).returning();
  await writeAuditLog({
    db: deps.db, request, actor,
    action: AUDIT_ACTIONS.KNOWLEDGE_RANKING_UPDATED, targetType: "knowledge_ranking_rule", targetId: key,
    beforeJson: { weight: existing.weight, enabled: existing.enabled },
    afterJson: { weight: updated!.weight, enabled: updated!.enabled }
  });
  return updated!;
}

/** 读取启用中的排序权重（key → weight）；检索侧每请求读取一次，量小不缓存 */
export async function loadRankingWeights(deps: IngestDeps): Promise<Record<string, number>> {
  const rows = await deps.db.select({ key: knowledgeRankingRules.key, weight: knowledgeRankingRules.weight })
    .from(knowledgeRankingRules).where(eq(knowledgeRankingRules.enabled, true));
  const weights = Object.fromEntries(rows.map((row) => [row.key, row.weight]));
  // 未配置种子时兜底，避免检索侧拿到空权重
  return { ...DEFAULT_RANKING_WEIGHTS, ...weights };
}

/** 检索权重缺省值（与 seed 种子保持一致，作为兜底） */
export const DEFAULT_RANKING_WEIGHTS: Record<string, number> = {
  TITLE_HIT: 30,
  CLAUSE_NO_HIT: 25,
  PHRASE_HIT: 20,
  KEYWORD_HIT: 5,
  ALIAS_HIT: 4,
  FULLTEXT_HIT: 1,
  FUZZY_HIT: 0.5,
  EVIDENCE_LEVEL_BONUS: 3,
  CURRENT_VERSION_BONUS: 2
};

export const RANKING_RULE_KEYS = Object.keys(DEFAULT_RANKING_WEIGHTS);

/** 种子用排序规则元数据（单一事实源：seed 与运行时共用） */
export function buildRankingRuleSeeds(): Array<{ key: string; weight: number; description: string }> {
  return [
    { key: "TITLE_HIT", weight: 30, description: "文档标题/版本标题命中" },
    { key: "CLAUSE_NO_HIT", weight: 25, description: "条款号/引用锚点命中" },
    { key: "PHRASE_HIT", weight: 20, description: "完整短语命中" },
    { key: "KEYWORD_HIT", weight: 5, description: "关键词扩展命中（每个）" },
    { key: "ALIAS_HIT", weight: 4, description: "别名词命中（每个）" },
    { key: "FULLTEXT_HIT", weight: 1, description: "全文检索命中" },
    { key: "FUZZY_HIT", weight: 0.5, description: "pg_trgm 模糊命中" },
    { key: "EVIDENCE_LEVEL_BONUS", weight: 3, description: "证据等级 A 加分" },
    { key: "CURRENT_VERSION_BONUS", weight: 2, description: "当前受控版本加分" }
  ];
}