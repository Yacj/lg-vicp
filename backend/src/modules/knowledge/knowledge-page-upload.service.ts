/**
 * 离线页图批量上传 / ZIP 导入：写入 knowledge_pages（幂等 upsert by version+physicalPageNumber）。
 * 正式链路不再依赖 LibreOffice；上传后 recognitionStatus=PENDING，由视觉识别 Worker 处理。
 */
import { unzipSync } from "fflate";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { AuthUser } from "../../shared/auth-user.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import {
  PAGE_IMAGE_MAX_BYTES,
  PAGE_IMAGE_MIME,
  PAGE_IMAGE_MIN_WIDTH_HINT,
  emptyRecognitionMetadata,
  extractPageLabelFromFileName,
  mergePageMetadata,
  readPageRecognitionMeta,
  type PageRecognitionMetadata
} from "../../shared/page-recognition.js";
import { env } from "../../config/env.js";
import { files, knowledgeDocumentVersions, knowledgePages } from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

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

async function inspectImageWarnings(
  app: FastifyInstance,
  objectKey: string,
  mimeType: string
): Promise<string[]> {
  const warnings: string[] = [];
  try {
    const buffer = await app.storage.getObject(objectKey);
    const dims = readImageDimensions(buffer, mimeType);
    if (dims && dims.width < PAGE_IMAGE_MIN_WIDTH_HINT) {
      warnings.push(`图片宽度 ${dims.width}px 低于建议值 ${PAGE_IMAGE_MIN_WIDTH_HINT}px，可能影响视觉识别`);
    }
  } catch {
    warnings.push("无法读取图片尺寸，建议确认图片完整");
  }
  return warnings;
}

/**
 * 同一 version + physicalPageNumber：更新同页、替换图片、保留 page id。
 * 替换图片后 recognitionStatus 重置为 PENDING（已确认页进入候选重审，不静默覆盖 confirmedStructuredData）。
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
  }
) {
  const [existing] = await app.db.select().from(knowledgePages)
    .where(and(
      eq(knowledgePages.versionId, version.id),
      eq(knowledgePages.physicalPageNumber, input.physicalPageNumber)
    )).limit(1);

  if (existing) {
    const prevMeta = readPageRecognitionMeta(existing.metadata);
    const wasConfirmed = prevMeta.recognitionStatus === "CONFIRMED";
    const nextMeta = mergePageMetadata(existing.metadata, {
      ...emptyRecognitionMetadata({
        confirmedStructuredData: wasConfirmed
          ? (prevMeta.confirmedStructuredData ?? prevMeta.structuredData)
          : prevMeta.confirmedStructuredData,
        confirmedAt: wasConfirmed ? prevMeta.confirmedAt : prevMeta.confirmedAt,
        confirmedById: wasConfirmed ? prevMeta.confirmedById : prevMeta.confirmedById,
        uploadSource: input.metadataPatch.uploadSource ?? prevMeta.uploadSource,
        originalFileName: input.metadataPatch.originalFileName ?? prevMeta.originalFileName,
        imageWarnings: input.metadataPatch.imageWarnings ?? [],
        recognitionStatus: "PENDING"
      })
    });
    const [updated] = await app.db.update(knowledgePages).set({
      pageLabel: input.pageLabel,
      pageLabelSource: "MANUAL",
      pageLabelVerified: true,
      pageTitle: input.pageTitle !== undefined ? input.pageTitle : existing.pageTitle,
      pageImageObjectKey: input.pageImageObjectKey,
      hasImages: true,
      metadata: nextMeta,
      parseStatus: "PARSED"
    }).where(eq(knowledgePages.id, existing.id)).returning();
    return { page: updated!, created: false };
  }

  const [created] = await app.db.insert(knowledgePages).values({
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
  return { page: created!, created: true };
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
  const existingMax = await app.db.select({
    maxPhysical: sql<number>`coalesce(max(${knowledgePages.physicalPageNumber}), 0)`
  }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  let nextPhysical = Number(existingMax[0]?.maxPhysical ?? 0) + 1;

  const results: Array<{
    pageId: string;
    physicalPageNumber: number;
    pageLabel: string | null;
    created: boolean;
    warnings: string[];
  }> = [];

  for (const item of items) {
    const file = await loadReadyPageImageFile(app, item.fileId);
    const warnings = await inspectImageWarnings(app, file.objectKey, file.mimeType);
    const physicalPageNumber = item.physicalPageNumber ?? nextPhysical++;
    if (item.physicalPageNumber != null) {
      nextPhysical = Math.max(nextPhysical, item.physicalPageNumber + 1);
    }
    const pageLabel = item.pageLabel?.trim()
      || extractPageLabelFromFileName(file.originalName)
      || String(physicalPageNumber);
    const upserted = await upsertPageImage(app, version, {
      physicalPageNumber,
      pageLabel,
      pageTitle: item.pageTitle ?? null,
      pageImageObjectKey: file.objectKey,
      metadataPatch: {
        uploadSource: "BATCH",
        originalFileName: file.originalName,
        imageWarnings: warnings,
        recognitionStatus: "PENDING"
      }
    });
    results.push({
      pageId: upserted.page.id,
      physicalPageNumber: upserted.page.physicalPageNumber,
      pageLabel: upserted.page.pageLabel,
      created: upserted.created,
      warnings
    });
  }

  const pageCount = await syncVersionPageCount(app.db, versionId);
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.pages_batch_uploaded",
    targetType: "knowledge_document_version",
    targetId: versionId,
    afterJson: { count: results.length, pageCount, created: results.filter((r) => r.created).length }
  });

  if (options?.enqueueRecognition !== false) {
    for (const row of results) {
      await app.queues.pageRecognition.add(
        "recognize-page",
        { pageId: row.pageId, versionId, triggeredBy: actor.id },
        { jobId: `page-recog-${row.pageId}-${Date.now()}`, removeOnComplete: true }
      );
    }
  }

  return { pageCount, items: results };
}

function normalizeZipEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\.\//, "");
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
          manifest = parsed as ZipManifestEntry[];
        }
      } catch {
        throw new AppError("INVALID_MANIFEST", "manifest.json 格式无效", 400);
      }
      continue;
    }
    if (!isAllowedPageImageName(base)) continue;
    fileMap.set(base, data);
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

  if (manifest && manifest.length > 0) {
    let order = 1;
    for (const entry of manifest) {
      const bytes = fileMap.get(entry.file) ?? fileMap.get(path.posix.basename(entry.file));
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
    const imageNames = [...new Set(
      [...fileMap.keys()].filter((name) => !name.includes("/") && isAllowedPageImageName(name))
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (imageNames.length === 0) {
      throw new AppError("EMPTY_ZIP", "ZIP 内未找到 PNG/JPG 页面图片", 400);
    }
    let physical = 1;
    for (const name of imageNames) {
      const bytes = fileMap.get(name)!;
      planned.push({
        fileName: name,
        bytes,
        physicalPageNumber: physical,
        pageLabel: extractPageLabelFromFileName(name) || String(physical),
        pageTitle: null
      });
      physical += 1;
    }
  }

  const results: Array<{
    pageId: string;
    physicalPageNumber: number;
    pageLabel: string | null;
    created: boolean;
    warnings: string[];
    fileName: string;
  }> = [];

  for (const item of planned) {
    const buffer = Buffer.from(item.bytes);
    if (buffer.byteLength > PAGE_IMAGE_MAX_BYTES) {
      throw new AppError(
        "PAGE_IMAGE_TOO_LARGE",
        `${item.fileName} 超过 ${PAGE_IMAGE_MAX_BYTES / (1024 * 1024)}MB`,
        400
      );
    }
    const detected = await fileTypeFromBuffer(buffer);
    const mimeType = detected?.mime === "image/png" || detected?.mime === "image/jpeg"
      ? detected.mime
      : item.fileName.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    if (!PAGE_IMAGE_MIME.has(mimeType)) {
      throw new AppError("INVALID_PAGE_IMAGE", `${item.fileName} 不是 PNG/JPG`, 400);
    }
    const dims = readImageDimensions(buffer, mimeType);
    const warnings: string[] = [];
    if (dims && dims.width < PAGE_IMAGE_MIN_WIDTH_HINT) {
      warnings.push(`图片宽度 ${dims.width}px 低于建议值 ${PAGE_IMAGE_MIN_WIDTH_HINT}px`);
    }

    const objectKey = `knowledge/page-images/${version.documentId}/${version.id}/${item.physicalPageNumber}-${randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`;
    await app.storage.putObject(objectKey, buffer, mimeType);

    const upserted = await upsertPageImage(app, version, {
      physicalPageNumber: item.physicalPageNumber,
      pageLabel: item.pageLabel,
      pageTitle: item.pageTitle,
      pageImageObjectKey: objectKey,
      metadataPatch: {
        uploadSource: "ZIP",
        originalFileName: item.fileName,
        imageWarnings: warnings,
        recognitionStatus: "PENDING"
      }
    });
    results.push({
      pageId: upserted.page.id,
      physicalPageNumber: upserted.page.physicalPageNumber,
      pageLabel: upserted.page.pageLabel,
      created: upserted.created,
      warnings,
      fileName: item.fileName
    });
  }

  const pageCount = await syncVersionPageCount(app.db, versionId);
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.pages_imported_zip",
    targetType: "knowledge_document_version",
    targetId: versionId,
    afterJson: { zipFileId, count: results.length, pageCount, hasManifest: Boolean(manifest) }
  });

  if (options?.enqueueRecognition !== false) {
    for (const row of results) {
      await app.queues.pageRecognition.add(
        "recognize-page",
        { pageId: row.pageId, versionId, triggeredBy: actor.id },
        { jobId: `page-recog-${row.pageId}-${Date.now()}`, removeOnComplete: true }
      );
    }
  }

  return {
    pageCount,
    imported: results.length,
    hasManifest: Boolean(manifest),
    items: results
  };
}

export async function listVersionPagesForRecognition(app: FastifyInstance, versionId: string) {
  await requireVersion(app, versionId);
  const rows = await app.db.select().from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId))
    .orderBy(asc(knowledgePages.physicalPageNumber));
  return rows.map((row) => {
    const meta = readPageRecognitionMeta(row.metadata);
    return {
      id: row.id,
      physicalPageNumber: row.physicalPageNumber,
      pageNumber: row.pageNumber,
      pageLabel: row.pageLabel,
      pageTitle: row.pageTitle,
      hasImage: Boolean(row.pageImageObjectKey),
      recognitionStatus: meta.recognitionStatus ?? null,
      recognitionWarnings: meta.recognitionWarnings ?? [],
      imageWarnings: meta.imageWarnings ?? [],
      lastRecognitionError: meta.lastRecognitionError ?? null,
      confirmedAt: meta.confirmedAt ?? null
    };
  });
}
