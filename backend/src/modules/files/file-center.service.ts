import { and, asc, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import { files, users } from "../../db/schema.js";
import { AppError } from "../../shared/errors.js";
import path from "node:path";
import { getFileReferenceCounts, getFileReferences } from "./file-reference.service.js";

type Db = FastifyInstance["db"];
type FileRow = typeof files.$inferSelect;

/** 文件中心轻字段：列表/选择器不返回 objectKey、bucket 或任何永久 URL */
export type FileCenterItem = {
  id: string;
  originalName: string;
  mimeType: string;
  extension: string | null;
  sizeBytes: number;
  status: FileRow["status"];
  source: FileRow["source"];
  projectId: string | null;
  ownerUserId: string;
  uploaderName: string | null;
  sha256: string | null;
  errorMessage: string | null;
  referenceCount?: number;
  recycledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function fileExtension(fileName: string): string | null {
  const extension = path.extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!extension) return null;
  return extension.slice(0, 12);
}

function toItem(row: { file: FileRow; uploaderName: string | null }, referenceCount?: number): FileCenterItem {
  return {
    id: row.file.id,
    originalName: row.file.originalName,
    mimeType: row.file.mimeType,
    extension: fileExtension(row.file.originalName),
    sizeBytes: row.file.sizeBytes,
    status: row.file.status,
    source: row.file.source,
    projectId: row.file.projectId,
    ownerUserId: row.file.ownerUserId,
    uploaderName: row.uploaderName,
    sha256: row.file.sha256,
    errorMessage: row.file.errorMessage,
    ...(referenceCount === undefined ? {} : { referenceCount }),
    recycledAt: row.file.recycledAt,
    createdAt: row.file.createdAt,
    updatedAt: row.file.updatedAt
  };
}

export type FileCenterListQuery = {
  keyword?: string;
  mimeType?: string;
  extension?: string;
  source?: FileRow["source"];
  status?: FileRow["status"];
  projectId?: string;
  createdFrom?: string;
  createdTo?: string;
  sort?: "createdAt" | "sizeBytes" | "originalName";
  includeRecycled?: string;
  page?: number;
  pageSize?: number;
};

/** 文件中心 / FilePicker 列表：B_ADMIN 全平台可见，默认只列 READY 且未删除文件 */
export async function listCenterFiles(
  app: FastifyInstance,
  query: FileCenterListQuery
): Promise<{ items: FileCenterItem[]; total: number; page: number; pageSize: number }> {
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 20;

  const conditions = [isNull(files.deletedAt)];
  if (query.status) {
    conditions.push(eq(files.status, query.status));
  } else if (query.includeRecycled === "1") {
    // 回收站视图：RECYCLED + 正常文件一起，前端按 status 区分
  } else {
    conditions.push(ne(files.status, "RECYCLED"));
    conditions.push(ne(files.status, "DELETED"));
  }
  if (query.keyword) {
    const pattern = `%${query.keyword}%`;
    const keywordCondition = or(
      ilike(files.originalName, pattern),
      ilike(users.displayName, pattern)
    );
    if (keywordCondition) conditions.push(keywordCondition);
  }
  if (query.mimeType) conditions.push(eq(files.mimeType, query.mimeType));
  if (query.extension) {
    // 扩展名过滤：originalName 后缀匹配（忽略大小写，可带点传入）
    conditions.push(ilike(files.originalName, `%.${query.extension.replace(/^\./, "")}`));
  }
  if (query.source) conditions.push(eq(files.source, query.source));
  if (query.projectId) conditions.push(eq(files.projectId, query.projectId));
  if (query.createdFrom) conditions.push(gte(files.createdAt, new Date(`${query.createdFrom}T00:00:00Z`)));
  if (query.createdTo) conditions.push(lte(files.createdAt, new Date(`${query.createdTo}T23:59:59Z`)));

  const where = and(...conditions);
  const orderBy = query.sort === "sizeBytes"
    ? desc(files.sizeBytes)
    : query.sort === "originalName"
      ? asc(files.originalName)
      : desc(files.createdAt);

  const [rows, [totalRow]] = await Promise.all([
    app.db.select({ file: files, uploaderName: users.displayName })
      .from(files)
      .leftJoin(users, eq(users.id, files.ownerUserId))
      .where(where)
      .orderBy(orderBy)
      .offset((page - 1) * pageSize)
      .limit(pageSize),
    app.db.select({ value: count() }).from(files).leftJoin(users, eq(users.id, files.ownerUserId)).where(where)
  ]);

  const referenceCounts = await getFileReferenceCounts(app.db, rows.map((row) => row.file.id));
  return {
    items: rows.map((row) => toItem(row, referenceCounts.get(row.file.id) ?? 0)),
    total: totalRow?.value ?? 0,
    page,
    pageSize
  };
}

/** FilePicker 最近使用：当前用户上传时间倒序的 READY 文件 */
export async function listRecentFiles(app: FastifyInstance, userId: string, limit = 20): Promise<FileCenterItem[]> {
  const rows = await app.db.select({ file: files, uploaderName: users.displayName })
    .from(files)
    .leftJoin(users, eq(users.id, files.ownerUserId))
    .where(and(
      eq(files.ownerUserId, userId),
      eq(files.status, "READY"),
      isNull(files.deletedAt)
    ))
    .orderBy(desc(files.createdAt))
    .limit(Math.min(limit, 50));
  return rows.map((row) => toItem(row, 0));
}

export async function findCenterFile(app: FastifyInstance, fileId: string) {
  const [row] = await app.db.select({ file: files, uploaderName: users.displayName })
    .from(files)
    .leftJoin(users, eq(users.id, files.ownerUserId))
    .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
    .limit(1);
  return row ?? null;
}

/** 文件中心详情（含引用计数） */
export async function getCenterFileDetail(app: FastifyInstance, fileId: string): Promise<FileCenterItem | null> {
  const row = await findCenterFile(app, fileId);
  if (!row) return null;
  const referenceCounts = await getFileReferenceCounts(app.db, [fileId]);
  return toItem(row, referenceCounts.get(fileId) ?? 0);
}

/** SHA256 去重：同内容（哈希一致）且状态 READY 的未删除文件直接复用 */
export async function findReusableFile(app: FastifyInstance, sha256: string, excludeFileId?: string): Promise<FileRow | null> {
  const conditions = [
    eq(files.sha256, sha256.toLowerCase()),
    eq(files.status, "READY"),
    isNull(files.deletedAt)
  ];
  if (excludeFileId) conditions.push(ne(files.id, excludeFileId));
  const [existing] = await app.db.select().from(files).where(and(...conditions)).orderBy(desc(files.createdAt)).limit(1);
  return existing ?? null;
}

const INLINE_PREVIEW_MIMES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "text/plain"
]);

/**
 * 文件预览：可内联渲染的类型返回短期签名预览 URL；
 * 其他类型（Word/CAD 等）返回 DOWNLOAD 模式，前端引导走下载。
 * 永远不返回永久公开 URL，签名按需生成。
 */
export async function previewCenterFile(app: FastifyInstance, file: FileRow): Promise<{
  mode: "INLINE" | "DOWNLOAD";
  url?: string;
  expiresIn?: number;
}> {
  if (!INLINE_PREVIEW_MIMES.has(file.mimeType)) {
    return { mode: "DOWNLOAD" };
  }
  const url = await app.storage.createPreviewUrl(file.objectKey, env.STORAGE_PRESIGN_EXPIRES_SECONDS);
  return { mode: "INLINE", url, expiresIn: env.STORAGE_PRESIGN_EXPIRES_SECONDS };
}

/** 回收保护：被任何业务引用的文件禁止回收 */
export async function assertFileNotReferenced(app: FastifyInstance, fileId: string) {
  const references = await getFileReferences(app.db, fileId, 20);
  if (references.length > 0) {
    throw new AppError("FILE_IN_USE", "文件正在被业务引用，不能回收或删除", 400, {
      errorCode: "FILE_IN_USE",
      references
    });
  }
}
