/**
 * 离线页图批量上传 / ZIP 导入：写入 knowledge_pages（幂等 upsert by version+physicalPageNumber）。
 * 正式链路不再依赖 LibreOffice；上传后 recognitionStatus=PENDING，由视觉识别 Worker 处理。
 */
import { unzipSync } from "fflate";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, count, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AuthUser } from "../../shared/auth-user.js";
import type { DbExecutor } from "../../db/client.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import {
  PAGE_IMAGE_MAX_BYTES,
  PAGE_IMAGE_MIME,
  PAGE_IMAGE_MIN_WIDTH_HINT,
  ZIP_MAX_IMAGE_ENTRIES,
  emptyRecognitionMetadata,
  extractPageLabelFromFileName,
  isPageRecognitionBusy,
  mergePageMetadata,
  naturalPageSort,
  readPageRecognitionMeta,
  type PageRecognitionMetadata
} from "../../shared/page-recognition.js";
import { mapWithConcurrency } from "../../shared/concurrency.js";
import { assertKnowledgeVersionEditable } from "./knowledge-version-guard.js";
import { markPageContentMutation, purgePageDerivedIndex } from "./knowledge-page-index.service.js";
import { env } from "../../config/env.js";
import { files, knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import { detectPageImageMime, inspectZipCentralDirectory, normalizeZipEntryName } from "./knowledge-page-upload.security.js";

const ZIP_MIME = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/octet-stream"
]);

export type PageUploadItemInput = {
  fileId: string;
  physicalPageNumber?: number;
  pageLabel?: string | null;
  pageTitle?: string | null;
};

export type ZipManifestEntry = {
  file: string;
  pageLabel?: string;
  physicalPageNumber?: number;
  pageTitle?: string;
};

async function requireVersion(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  assertKnowledgeVersionEditable(version);
  return version;
}
async function syncVersionPageCount(
  db: { update: FastifyInstance["db"]["update"]; select: FastifyInstance["db"]["select"] },
  versionId: string
) {
  const [row] = await db.select({ value: count() }).from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId));
  await db.update(knowledgeDocumentVersions).set({
    pageCount: row?.value ?? 0,
    updatedAt: new Date()
  }).where(eq(knowledgeDocumentVersions.id, versionId));
  return row?.value ?? 0;
}

/** PNG IHDR 宽高；JPEG SOF 宽高。解析失败返回 null（不阻断上传） */
export function readImageDimensions(buffer: Buffer, mimeType: string): { width: number; height: number } | null {
  try {
    if (mimeType === "image/png" && buffer.length >= 24) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }
    if (mimeType === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) break;
        const marker = buffer[offset + 1]!;
        const length = buffer.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
          break;
        }
        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function loadReadyPageImageFile(app: FastifyInstance, fileId: string) {
  const [file] = await app.db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.status !== "READY") throw new NotFoundError("页面图片不存在或尚未上传完成");
  if (!PAGE_IMAGE_MIME.has(file.mimeType)) {
    throw new AppError("INVALID_PAGE_IMAGE", "仅支持 PNG / JPG 页面图片", 400);
  }
  if (file.sizeBytes > PAGE_IMAGE_MAX_BYTES) {
    throw new AppError("PAGE_IMAGE_TOO_LARGE", `单张页面图片不能超过 ${PAGE_IMAGE_MAX_BYTES / (1024 * 1024)}MB`, 400);
  }
  return file;
}

/**
 * 同一 version + physicalPageNumber：更新同页、替换图片、保留 page id。
 * 换图即正式内容变化：清空识别候选与已确认快照 + 删除该页派生索引（chunks/blocks/DRAFT 热工行）
 * + 清空旧 parsedText，并将版本正式索引置脏（indexDirty），等待重新识别 / 重新确认 / 版本重建。
 */
export async function upsertPageImage(
  app: FastifyInstance,
  version: typeof knowledgeDocumentVersions.$inferSelect,
  input: {
    physicalPageNumber: number;
    pageLabel: string;
    pageTitle?: string | null;
    pageImageObjectKey: string;
    metadataPatch: PageRecognitionMetadata;
  },
  db: DbExecutor = app.db
) {
  assertKnowledgeVersionEditable(version);
  const [existing] = await db.select().from(knowledgePages)
    .where(and(
      eq(knowledgePages.versionId, version.id),
      eq(knowledgePages.physicalPageNumber, input.physicalPageNumber)
    )).limit(1);

  if (existing) {
    const prevMeta = readPageRecognitionMeta(existing.metadata);
    // P1-6：busy 判定统一复用 isPageRecognitionBusy()，覆盖
    // PROCESSING，以及 PENDING + recognitionRunId（已入队、Job 仍 active/waiting/delayed）。
    // 直接换图会让旧 Job 继续跑并与新图冲突，因此显式拒绝（提示稍后重试），
    // 不依赖 15 分钟 stale reconcile 兜底。
    if (isPageRecognitionBusy(prevMeta)) {
      throw new AppError("PAGE_RECOGNITION_BUSY", "当前页面正在排队或识别，请稍后重试。", 409, {
        errorCode: "PAGE_RECOGNITION_BUSY",
        pageId: existing.id,
        recognitionStatus: prevMeta.recognitionStatus ?? "PENDING",
        recognitionRunId: prevMeta.recognitionRunId ?? null,
        hint: "如确认识别任务已终止，请先执行「识别任务对账」恢复页面状态后再换图"
      });
    }
    // 换图 = 正式内容变化：先清派生索引（chunks/blocks/DRAFT 热工行），再重置识别快照。
    const purged = await purgePageDerivedIndex(db, existing);
    const nextMeta = mergePageMetadata(existing.metadata, emptyRecognitionMetadata({
      uploadSource: input.metadataPatch.uploadSource ?? prevMeta.uploadSource,
      originalFileName: input.metadataPatch.originalFileName ?? prevMeta.originalFileName,
      imageWarnings: input.metadataPatch.imageWarnings ?? [],
      recognitionStatus: "PENDING",
      recognitionRunId: input.metadataPatch.recognitionRunId ?? null,
      recognitionQueuedAt: input.metadataPatch.recognitionQueuedAt ?? null
    }));
    const [updated] = await db.update(knowledgePages).set({
      pageLabel: input.pageLabel,
      pageLabelSource: "MANUAL",
      pageLabelVerified: true,
      pageTitle: input.pageTitle !== undefined ? input.pageTitle : existing.pageTitle,
      pageImageObjectKey: input.pageImageObjectKey,
      hasImages: true,
      // 旧 parsedText 属于旧图片，换图后清空，避免残留正文与检索不一致
      parsedText: null,
      metadata: nextMeta,
      parseStatus: "PARSED"
    }).where(eq(knowledgePages.id, existing.id)).returning();
    await markPageContentMutation(db, version.id);
    return {
      page: updated!,
      created: false,
      previousObjectKey: existing.pageImageObjectKey,
      invalidated: true,
      purged,
      lockedThermalRows: purged.lockedThermalRows
    };
  }

  const [created] = await db.insert(knowledgePages).values({
    documentId: version.documentId,
    versionId: version.id,
    pageNumber: input.physicalPageNumber,
    physicalPageNumber: input.physicalPageNumber,
    pageLabel: input.pageLabel,
    pageLabelSource: "MANUAL",
    pageLabelVerified: true,
    pageTitle: input.pageTitle ?? null,
    pageImageObjectKey: input.pageImageObjectKey,
    hasImages: true,
    parseStatus: "PARSED",
    metadata: mergePageMetadata(null, emptyRecognitionMetadata({
      recognitionStatus: "PENDING",
      ...input.metadataPatch
    }))
  }).returning();
  await markPageContentMutation(db, version.id);
  return { page: created!, created: true, previousObjectKey: null, invalidated: true, purged: null, lockedThermalRows: 0 };
}

async function removeReplacedPageImage(app: FastifyInstance, objectKey: string | null | undefined, nextKey: string) {
  if (objectKey && objectKey !== nextKey && objectKey.startsWith("knowledge/page-images/")) {
    await app.storage.removeObject(objectKey).catch(() => undefined);
  }
}

/**
 * 逐页入队识别任务，单页入队失败不影响其他页面：
 * 失败页面回退为「可重新入队」状态（PENDING + recognitionRunId=null），
 * 避免出现「PENDING 但无 Job 且无法重新入队」的永久卡死（manual/auto/batch retry 均可恢复）。
 */
export async function enqueueRecognitionWithRecovery(
  app: FastifyInstance,
  versionId: string,
  actor: Pick<AuthUser, "id">,
  rows: Array<{ pageId: string }>,
  recognitionRunIds: Map<string, string>
): Promise<{ enqueued: number; failed: Array<{ pageId: string; error: string }> }> {
  let enqueued = 0;
  const failed: Array<{ pageId: string; error: string }> = [];
  for (const row of rows) {
    const recognitionRunId = recognitionRunIds.get(row.pageId);
    if (!recognitionRunId) continue;
    try {
      await app.queues.pageRecognition.add(
        "recognize-page",
        { pageId: row.pageId, versionId, triggeredBy: actor.id, recognitionRunId },
        { jobId: `page-recog-${row.pageId}`, removeOnComplete: true, removeOnFail: true }
      );
      enqueued += 1;
    } catch (error) {
      const [page] = await app.db.select().from(knowledgePages).where(eq(knowledgePages.id, row.pageId)).limit(1);
      if (page) {
        const meta = readPageRecognitionMeta(page.metadata);
        await app.db.update(knowledgePages).set({
          metadata: mergePageMetadata(page.metadata, {
            ...meta,
            recognitionStatus: "PENDING",
            recognitionRunId: null,
            recognitionQueuedAt: null,
            lastRecognitionError: "识别任务入队失败，可重新触发识别"
          })
        }).where(eq(knowledgePages.id, row.pageId));
      }
      failed.push({ pageId: row.pageId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { enqueued, failed };
}

export async function batchUploadVersionPages(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  items: PageUploadItemInput[],
  options?: { enqueueRecognition?: boolean }
) {
  if (items.length === 0) throw new AppError("EMPTY_PAGE_UPLOAD", "请至少上传一张页面图片", 400);
  const version = await requireVersion(app, versionId);
  if (items.length > env.PAGE_BATCH_MAX_ITEMS) {
    throw new AppError("PAGE_BATCH_TOO_MANY", `单次批量上传不能超过 ${env.PAGE_BATCH_MAX_ITEMS} 张图片`, 400);
  }

  // 1) 预检：先读取文件行（不读 Buffer），校验单张大小 / 总量 / 页序。
  const existingMax = await app.db.select({
    maxPhysical: sql<number>`coalesce(max(${knowledgePages.physicalPageNumber}), 0)`
  }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  let nextPhysical = Number(existingMax[0]?.maxPhysical ?? 0) + 1;

  const fileRows = await Promise.all(items.map((item) => loadReadyPageImageFile(app, item.fileId)));
  const totalBytes = fileRows.reduce((sum, file) => sum + Number(file.sizeBytes ?? 0), 0);
  if (totalBytes > env.PAGE_BATCH_MAX_TOTAL_BYTES) {
    throw new AppError(
      "PAGE_BATCH_TOO_LARGE",
      `单次批量上传总大小不能超过 ${Math.floor(env.PAGE_BATCH_MAX_TOTAL_BYTES / (1024 * 1024))}MB`,
      400,
      { totalBytes, maxTotalBytes: env.PAGE_BATCH_MAX_TOTAL_BYTES }
    );
  }

  // 2) 页序：显式 physicalPageNumber 优先；未指定的按文件名自然排序（不依赖浏览器选择顺序）。
  const loaded = items.map((item, index) => ({ item, file: fileRows[index]! }));
  const requestedPageNumbers = new Set<number>();
  const planned: Array<{
    physicalPageNumber: number; pageLabel: string; pageTitle: string | null;
    file: typeof files.$inferSelect;
  }> = [];
  for (const entry of loaded.filter((row) => row.item.physicalPageNumber != null)) {
    const physical = entry.item.physicalPageNumber!;
    if (!Number.isInteger(physical) || physical < 1) {
      throw new AppError("INVALID_PHYSICAL_PAGE_NUMBER", "physicalPageNumber 必须为正整数", 400);
    }
    if (requestedPageNumbers.has(physical)) {
      throw new AppError("DUPLICATE_PHYSICAL_PAGE_NUMBER", `本次上传的 physicalPageNumber 重复：${physical}`, 400, {
        errorCode: "DUPLICATE_PHYSICAL_PAGE_NUMBER",
        physicalPageNumber: physical
      });
    }
    requestedPageNumbers.add(physical);
    nextPhysical = Math.max(nextPhysical, physical + 1);
    planned.push({
      physicalPageNumber: physical,
      pageLabel: entry.item.pageLabel?.trim() || extractPageLabelFromFileName(entry.file.originalName) || String(physical),
      pageTitle: entry.item.pageTitle ?? null,
      file: entry.file
    });
  }
  const implicit = naturalPageSort(
    loaded.filter((row) => row.item.physicalPageNumber == null),
    (entry) => entry.file.originalName
  );
  for (const entry of implicit) {
    while (requestedPageNumbers.has(nextPhysical)) nextPhysical += 1;
    const physical = nextPhysical++;
    requestedPageNumbers.add(physical);
    planned.push({
      physicalPageNumber: physical,
      pageLabel: entry.item.pageLabel?.trim() || extractPageLabelFromFileName(entry.file.originalName) || String(physical),
      pageTitle: entry.item.pageTitle ?? null,
      file: entry.file
    });
  }

  // 3) 并发受限读取 + 内容校验 + 立即上传，读完即释放 Buffer（不再整批常驻内存）。
  const createdObjectKeys: string[] = [];
  let prepared: Array<{
    physicalPageNumber: number; pageLabel: string; pageTitle: string | null;
    file: typeof files.$inferSelect; key: string; mimeType: string; warnings: string[];
  }>;
  try {
    prepared = await mapWithConcurrency(planned, env.PAGE_BATCH_READ_CONCURRENCY, async (entry) => {
      const bytes = await app.storage.getObject(entry.file.objectKey);
      if (bytes.byteLength > PAGE_IMAGE_MAX_BYTES) {
        throw new AppError("PAGE_IMAGE_TOO_LARGE", `单张页面图片不能超过 ${PAGE_IMAGE_MAX_BYTES / (1024 * 1024)}MB`, 400);
      }
      const mimeType = await detectPageImageMime(bytes, entry.file.originalName);
      if (mimeType !== entry.file.mimeType) {
        throw new AppError("INVALID_PAGE_IMAGE", "页面图片内容与文件类型不匹配，仅支持 PNG / JPG", 400);
      }
      const dims = readImageDimensions(bytes, mimeType);
      const warnings = dims && dims.width < PAGE_IMAGE_MIN_WIDTH_HINT
        ? [`图片宽度 ${dims.width}px 低于建议值 ${PAGE_IMAGE_MIN_WIDTH_HINT}px，可能影响视觉识别`]
        : [];
      const key = `knowledge/page-images/${version.documentId}/${version.id}/p${entry.physicalPageNumber}-${randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`;
      await app.storage.putObject(key, bytes, mimeType);
      createdObjectKeys.push(key);
      return { ...entry, key, mimeType, warnings };
    });
  } catch (error) {
    await Promise.all(createdObjectKeys.map((key) => app.storage.removeObject(key).catch(() => undefined)));
    throw error;
  }

  const results: Array<{
    pageId: string;
    physicalPageNumber: number;
    pageLabel: string | null;
    created: boolean;
    warnings: string[];
  }> = [];
  const recognitionRunIds = new Map<string, string>();
  const replacedObjects: Array<{ previous: string | null; next: string }> = [];
  let pageCount = 0;
  try {
    pageCount = await app.db.transaction(async (tx) => {
      for (const item of prepared) {
        const recognitionRunId = options?.enqueueRecognition === false ? null : randomUUID();
        const upserted = await upsertPageImage(app, version, {
          physicalPageNumber: item.physicalPageNumber, pageLabel: item.pageLabel, pageTitle: item.pageTitle,
          pageImageObjectKey: item.key,
          metadataPatch: {
            uploadSource: "BATCH",
            originalFileName: item.file.originalName,
            imageWarnings: item.warnings,
            recognitionStatus: "PENDING",
            recognitionRunId,
            recognitionQueuedAt: recognitionRunId ? new Date().toISOString() : null
          }
        }, tx);
        replacedObjects.push({ previous: upserted.previousObjectKey, next: item.key });
        results.push({ pageId: upserted.page.id, physicalPageNumber: upserted.page.physicalPageNumber, pageLabel: upserted.page.pageLabel, created: upserted.created, warnings: item.warnings });
        if (recognitionRunId) recognitionRunIds.set(upserted.page.id, recognitionRunId);
      }
      const currentCount = await syncVersionPageCount(tx, versionId);
      await writeAuditLog({ db: tx, request, actor, action: "knowledge.pages_batch_uploaded", targetType: "knowledge_document_version", targetId: versionId, afterJson: { count: results.length, pageCount: currentCount, created: results.filter((r) => r.created).length } });
      return currentCount;
    });
  } catch (error) {
    await Promise.all(createdObjectKeys.map((key) => app.storage.removeObject(key).catch(() => undefined)));
    throw error;
  }
  await Promise.all(replacedObjects.map(({ previous, next }) => removeReplacedPageImage(app, previous, next)));

  const enqueue = options?.enqueueRecognition === false
    ? { enqueued: 0, failed: [] as Array<{ pageId: string; error: string }> }
    : await enqueueRecognitionWithRecovery(app, versionId, actor, results, recognitionRunIds);

  return { pageCount, items: results, enqueued: enqueue.enqueued, enqueueFailed: enqueue.failed };
}

function isAllowedPageImageName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg");
}

export async function importVersionPagesFromZip(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  zipFileId: string,
  options?: { enqueueRecognition?: boolean }
) {
  const version = await requireVersion(app, versionId);
  const [zipFile] = await app.db.select().from(files).where(eq(files.id, zipFileId)).limit(1);
  if (!zipFile || zipFile.status !== "READY") throw new NotFoundError("ZIP 文件不存在或尚未上传完成");
  if (zipFile.sizeBytes > env.MAX_UPLOAD_BYTES) {
    throw new AppError("ZIP_TOO_LARGE", "ZIP 超过系统文件大小限制", 400);
  }
  if (!ZIP_MIME.has(zipFile.mimeType) && !zipFile.originalName.toLowerCase().endsWith(".zip")) {
    throw new AppError("INVALID_ZIP", "请上传 ZIP 压缩包", 400);
  }

  const zipBuffer = await app.storage.getObject(zipFile.objectKey);
  inspectZipCentralDirectory(zipBuffer);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(zipBuffer));
  } catch {
    throw new AppError("INVALID_ZIP", "ZIP 解包失败，请检查压缩包是否损坏", 400);
  }

  const fileMap = new Map<string, Uint8Array>();
  let manifest: ZipManifestEntry[] | null = null;
  for (const [rawName, data] of Object.entries(entries)) {
    const name = normalizeZipEntryName(rawName);
    if (!name || name.endsWith("/")) continue;
    const base = path.posix.basename(name);
    if (base.toLowerCase() === "manifest.json") {
      try {
        const parsed = JSON.parse(Buffer.from(data).toString("utf8"));
        if (Array.isArray(parsed)) {
          if (parsed.length > ZIP_MAX_IMAGE_ENTRIES) {
            throw new AppError("INVALID_MANIFEST", "manifest.json 页面条目不能超过 200 条", 400);
          }
          if (parsed.some((item) => !item || typeof item !== "object"
            || typeof item.file !== "string"
            || (item.pageLabel !== undefined && typeof item.pageLabel !== "string")
            || (item.pageTitle !== undefined && typeof item.pageTitle !== "string")
            || (item.physicalPageNumber !== undefined
              && (!Number.isInteger(item.physicalPageNumber) || item.physicalPageNumber < 1)))) {
            throw new AppError("INVALID_MANIFEST", "manifest.json 页面字段无效", 400);
          }
          manifest = parsed as ZipManifestEntry[];
        }
      } catch {
        throw new AppError("INVALID_MANIFEST", "manifest.json 格式无效", 400);
      }
      continue;
    }
    if (!isAllowedPageImageName(base)) continue;
    if (fileMap.has(name)) throw new AppError("DUPLICATE_MANIFEST_FILE", `ZIP 内文件路径重复：${name}`, 400);
    fileMap.set(name, data);
  }

  type Planned = {
    fileName: string;
    bytes: Uint8Array;
    physicalPageNumber: number;
    pageLabel: string;
    pageTitle?: string | null;
  };
  const planned: Planned[] = [];
  const manifestFiles = new Set<string>();

  if (manifest && manifest.length > 0) {
    let order = 1;
    for (const entry of manifest) {
      const safeName = normalizeZipEntryName(entry.file);
      if (manifestFiles.has(safeName)) {
        throw new AppError("DUPLICATE_MANIFEST_FILE", `manifest 中的图片不能重复引用：${entry.file}`, 400);
      }
      manifestFiles.add(safeName);
      const bytes = fileMap.get(safeName);
      if (!bytes) {
        throw new AppError("MANIFEST_FILE_MISSING", `manifest 中的文件不存在：${entry.file}`, 400);
      }
      const physical = entry.physicalPageNumber ?? order;
      planned.push({
        fileName: path.posix.basename(entry.file),
        bytes,
        physicalPageNumber: physical,
        pageLabel: entry.pageLabel?.trim()
          || extractPageLabelFromFileName(entry.file)
          || String(physical),
        pageTitle: entry.pageTitle ?? null
      });
      order += 1;
    }
  } else {
    const imageNames = naturalPageSort([...fileMap.keys()].filter(isAllowedPageImageName), (name) => name);
    if (imageNames.length === 0) {
      throw new AppError("EMPTY_ZIP", "ZIP 内未找到 PNG/JPG 页面图片", 400);
    }
    let physical = 1;
    for (const name of imageNames) {
      const bytes = fileMap.get(name)!;
      planned.push({
        fileName: path.posix.basename(name),
        bytes,
        physicalPageNumber: physical,
        pageLabel: extractPageLabelFromFileName(name) || String(physical),
        pageTitle: null
      });
      physical += 1;
    }
  }

  const seenPhysicalPages = new Set<number>();
  const preflight: Array<Planned & { mimeType: string; warnings: string[] }> = [];
  let plannedBytes = 0;
  for (const item of planned) {
    if (!Number.isInteger(item.physicalPageNumber) || item.physicalPageNumber < 1 || seenPhysicalPages.has(item.physicalPageNumber)) {
      throw new AppError("DUPLICATE_PHYSICAL_PAGE_NUMBER", "manifest 中的 physicalPageNumber 不能重复，且必须为正整数", 400, {
        errorCode: "DUPLICATE_PHYSICAL_PAGE_NUMBER",
        physicalPageNumber: item.physicalPageNumber
      });
    }
    seenPhysicalPages.add(item.physicalPageNumber);
    plannedBytes += item.bytes.byteLength;
  }
  if (planned.length > env.PAGE_BATCH_MAX_ITEMS) {
    throw new AppError("PAGE_BATCH_TOO_MANY", `单次导入不能超过 ${env.PAGE_BATCH_MAX_ITEMS} 张图片`, 400);
  }
  if (plannedBytes > env.PAGE_BATCH_MAX_TOTAL_BYTES) {
    throw new AppError(
      "PAGE_BATCH_TOO_LARGE",
      `单次导入总大小不能超过 ${Math.floor(env.PAGE_BATCH_MAX_TOTAL_BYTES / (1024 * 1024))}MB`,
      400,
      { totalBytes: plannedBytes, maxTotalBytes: env.PAGE_BATCH_MAX_TOTAL_BYTES }
    );
  }

  const results: Array<{
    pageId: string;
    physicalPageNumber: number;
    pageLabel: string | null;
    created: boolean;
    warnings: string[];
    fileName: string;
  }> = [];
  const recognitionRunIds = new Map<string, string>();

  for (const item of planned) {
    const buffer = Buffer.from(item.bytes);
    if (buffer.byteLength > PAGE_IMAGE_MAX_BYTES) {
      throw new AppError(
        "PAGE_IMAGE_TOO_LARGE",
        `${item.fileName} 超过 ${PAGE_IMAGE_MAX_BYTES / (1024 * 1024)}MB`,
        400
      );
    }
    const mimeType = await detectPageImageMime(buffer, item.fileName);
    const dims = readImageDimensions(buffer, mimeType);
    const warnings: string[] = [];
    if (dims && dims.width < PAGE_IMAGE_MIN_WIDTH_HINT) {
      warnings.push(`图片宽度 ${dims.width}px 低于建议值 ${PAGE_IMAGE_MIN_WIDTH_HINT}px`);
    }

    preflight.push({ ...item, bytes: buffer, mimeType, warnings });
  }

  const createdObjectKeys: string[] = [];
  const replacedObjects: Array<{ previous: string | null; next: string }> = [];
  let pageCount = 0;
  try {
    for (const item of preflight) {
      const key = `knowledge/page-images/${version.documentId}/${version.id}/p${item.physicalPageNumber}-${randomUUID()}.${item.mimeType === "image/png" ? "png" : "jpg"}`;
      createdObjectKeys.push(key);
      await app.storage.putObject(key, Buffer.from(item.bytes), item.mimeType);
    }
    pageCount = await app.db.transaction(async (tx) => {
      for (let index = 0; index < preflight.length; index++) {
        const item = preflight[index]!;
        const key = createdObjectKeys[index]!;
        const recognitionRunId = options?.enqueueRecognition === false ? null : randomUUID();
        const upserted = await upsertPageImage(app, version, {
          physicalPageNumber: item.physicalPageNumber, pageLabel: item.pageLabel, pageTitle: item.pageTitle,
          pageImageObjectKey: key,
          metadataPatch: {
            uploadSource: "ZIP",
            originalFileName: item.fileName,
            imageWarnings: item.warnings,
            recognitionStatus: "PENDING",
            recognitionRunId,
            recognitionQueuedAt: recognitionRunId ? new Date().toISOString() : null
          }
        }, tx);
        replacedObjects.push({ previous: upserted.previousObjectKey, next: key });
        results.push({ pageId: upserted.page.id, physicalPageNumber: upserted.page.physicalPageNumber, pageLabel: upserted.page.pageLabel, created: upserted.created, warnings: item.warnings, fileName: item.fileName });
        if (recognitionRunId) recognitionRunIds.set(upserted.page.id, recognitionRunId);
      }
      const currentCount = await syncVersionPageCount(tx, versionId);
      await writeAuditLog({ db: tx, request, actor, action: "knowledge.pages_imported_zip", targetType: "knowledge_document_version", targetId: versionId, afterJson: { zipFileId, count: results.length, pageCount: currentCount, hasManifest: Boolean(manifest) } });
      return currentCount;
    });
  } catch (error) {
    await Promise.all(createdObjectKeys.map((key) => app.storage.removeObject(key).catch(() => undefined)));
    throw error;
  }
  await Promise.all(replacedObjects.map(({ previous, next }) => removeReplacedPageImage(app, previous, next)));

  const enqueue = options?.enqueueRecognition === false
    ? { enqueued: 0, failed: [] as Array<{ pageId: string; error: string }> }
    : await enqueueRecognitionWithRecovery(app, versionId, actor, results, recognitionRunIds);

  return {
    pageCount,
    imported: results.length,
    hasManifest: Boolean(manifest),
    items: results,
    enqueued: enqueue.enqueued,
    enqueueFailed: enqueue.failed
  };
}
