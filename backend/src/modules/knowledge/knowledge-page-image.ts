import path from "node:path";
import { eq } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import type { FastifyInstance } from "fastify";
import { knowledgePages } from "../../db/schema.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import { buildKnowledgePageRenderModel } from "../../shared/knowledge-page-render.js";
import { readPageRecognitionMeta, PAGE_IMAGE_MAX_BYTES } from "../../shared/page-recognition.js";

/** 让临时签名下载名与正式页图对象扩展名一致。 */
export function getPageImageDownloadName(objectKey: string, pageNumber: number): string {
  const extension = path.extname(objectKey).toLowerCase();
  const safeExtension = extension === ".jpg" || extension === ".jpeg" ? extension : ".png";
  return `page-${pageNumber}${safeExtension}`;
}

/** 调用方先按B权限或C来源规则授权；仅读取页自身对象，不能指定任意URL/key。 */
export async function readPageImageBytes(app: FastifyInstance, pageId: string, confirmedRevision?: string) {
  const [page] = await app.db.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
  if (!page?.pageImageObjectKey) throw new NotFoundError("来源页面原图不存在");
  if (confirmedRevision && buildKnowledgePageRenderModel(page.id, readPageRecognitionMeta(page.metadata).confirmedStructuredData)?.confirmedRevision !== confirmedRevision)
    throw new AppError("REFERENCE_REVISION_CHANGED", "来源确认版本已变化，请重新查询", 409);
  const info = await app.storage.statObject(page.pageImageObjectKey);
  if (!info || info.size > PAGE_IMAGE_MAX_BYTES) throw new NotFoundError("来源原图不存在或超出读取限制");
  const bytes = await app.storage.getObject(page.pageImageObjectKey);
  const type = await fileTypeFromBuffer(bytes);
  if (bytes.length > PAGE_IMAGE_MAX_BYTES || type?.mime !== "image/png" && type?.mime !== "image/jpeg") throw new AppError("INVALID_PAGE_IMAGE", "来源原图格式无效", 400);
  return { bytes, contentType: type.mime };
}
