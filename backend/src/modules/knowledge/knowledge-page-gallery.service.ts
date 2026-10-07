import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray } from "drizzle-orm";
import { fileTypeFromBuffer } from "file-type";
import type { AuthUser } from "../../shared/auth-user.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import {
  emptyRecognitionMetadata,
  isPageRecognitionBusy,
  mergePageMetadata,
  PAGE_IMAGE_MAX_BYTES,
  PAGE_IMAGE_MIME,
  readPageRecognitionMeta
} from "../../shared/page-recognition.js";
import { assertKnowledgeVersionEditable } from "./knowledge-version-guard.js";
import { markPageContentMutation, purgePageDerivedIndex, syncPageLabelDerivedReferences } from "./knowledge-page-index.service.js";
import { files, knowledgeDocumentVersions, knowledgePages, thermalReferenceRows } from "../../db/schema.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

async function requireVersion(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  assertKnowledgeVersionEditable(version);
  return version;
}

async function resolvePageImage(app: FastifyInstance, version: typeof knowledgeDocumentVersions.$inferSelect, pageNumber: number, fileId: string) {
  const [file] = await app.db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file || file.status !== "READY") throw new NotFoundError("页面图片不存在或尚未上传完成");
  if (!PAGE_IMAGE_MIME.has(file.mimeType)) {
    throw new AppError("INVALID_PAGE_IMAGE", "仅支持 PNG / JPG 页面图片", 400);
  }
  const bytes = await app.storage.getObject(file.objectKey);
  if (bytes.byteLength > PAGE_IMAGE_MAX_BYTES) {
    throw new AppError("PAGE_IMAGE_TOO_LARGE", "单张页面图片不能超过 15MB", 400);
  }
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected || !PAGE_IMAGE_MIME.has(detected.mime) || detected.mime !== file.mimeType) {
    throw new AppError("INVALID_PAGE_IMAGE", "页面图片内容与文件类型不匹配，仅支持 PNG / JPG", 400);
  }
  const key = `knowledge/page-images/${version.documentId}/${version.id}/p${pageNumber}-${randomUUID()}.${detected.mime === "image/png" ? "png" : "jpg"}`;
  await app.storage.putObject(key, bytes, detected.mime);
  return key;
}

async function removeOldOwnedPageImage(app: FastifyInstance, oldKey: string | null, newKey: string | null) {
  if (oldKey && oldKey !== newKey && oldKey.startsWith("knowledge/page-images/")) {
    await app.storage.removeObject(oldKey).catch(() => undefined);
  }
}

/** 事务内把版本 pageCount 同步为当前 knowledge_pages 行数；排序不应改变该值。 */
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

export async function createManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: {
    pageNumber: number;
    pageLabel?: string | null;
    pageTitle?: string | null;
    parsedText?: string | null;
    imageFileId?: string | null;
  }
) {
  const version = await requireVersion(app, versionId);
  const [conflict] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageNumber, input.pageNumber)))
    .limit(1);
  if (conflict) throw new AppError("PAGE_NUMBER_CONFLICT", "该页码已存在", 400);
  const pageImageObjectKey = input.imageFileId ? await resolvePageImage(app, version, input.pageNumber, input.imageFileId) : null;
  const created = await app.db.transaction(async (tx) => {
    const [page] = await tx.insert(knowledgePages).values({
      documentId: version.documentId,
      versionId,
      pageNumber: input.pageNumber,
      physicalPageNumber: input.pageNumber,
      pageLabel: input.pageLabel ?? String(input.pageNumber),
      pageLabelSource: "MANUAL",
      pageLabelVerified: true,
      pageTitle: input.pageTitle ?? null,
      parsedText: input.parsedText ?? null,
      pageImageObjectKey,
      parseStatus: "PARSED",
      metadata: pageImageObjectKey
        ? mergePageMetadata(null, emptyRecognitionMetadata({
          recognitionStatus: "PENDING",
          uploadSource: "MANUAL"
        }))
        : null
    }).returning();
    await syncVersionPageCount(tx, versionId);
    // P0-3：新增页面同样属于正式内容 Mutation（contentRevision++ / indexDirty=true），
    // 否则会出现「INDEX_READY + 新增 page 后仍显示 READY」的错误状态。
    await markPageContentMutation(tx, versionId);
    return page!;
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_created", targetType: "knowledge_page", targetId: created.id,
    afterJson: { versionId, pageNumber: input.pageNumber, pageImageObjectKey }
  });
  return created;
}

export async function updateManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  physicalPageNumber: number,
  input: {
    pageNumber?: number;
    pageLabel?: string | null;
    pageTitle?: string | null;
    parsedText?: string | null;
    imageFileId?: string | null;
    /**
     * 正式正文修改语义（仅当 parsedText 变化时生效）：
     * - DISPLAY（默认）：只修正正文错字/标点/排版，热工结构字段未变 → 保留 thermal rows 与 CONFIRMED，仅重建普通索引；
     * - STRUCTURE：改动可能影响 system/scheme/productSpec/thickness/productR/totalR/K → 旧 thermal row 失效，
     *   页面回到 REVIEW_REQUIRED，必须重新 Review / Confirm 后才重新生成热工行。
     */
    textChangeMode?: "DISPLAY" | "STRUCTURE";
  }
) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  if (input.pageNumber !== undefined && input.pageNumber !== page.pageNumber) {
    const [conflict] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
      .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageNumber, input.pageNumber)))
      .limit(1);
    if (conflict) throw new AppError("PAGE_NUMBER_CONFLICT", "该页码已存在", 400);
  }
  const version = await requireVersion(app, versionId);
  const pageImageObjectKey = input.imageFileId === undefined
    ? page.pageImageObjectKey
    : input.imageFileId
      ? await resolvePageImage(app, version, physicalPageNumber, input.imageFileId)
      : null;
  // P0-1：页面图片或正式正文变化必须让旧正式索引失效（否则「页面显示 B、AI 仍检索 A」）。
  const imageChanged = input.imageFileId !== undefined && pageImageObjectKey !== page.pageImageObjectKey;
  const parsedTextChanged = input.parsedText !== undefined && (input.parsedText ?? null) !== (page.parsedText ?? null);
  const invalidatesIndex = imageChanged || parsedTextChanged;

  const meta = readPageRecognitionMeta(page.metadata);
  // P1-6：识别排队中（PENDING + active runId）或执行中（PROCESSING）禁止换图，避免旧 Job 继续跑造成冲突。
  if (imageChanged && isPageRecognitionBusy(meta)) {
    throw new AppError(
      "PAGE_RECOGNITION_BUSY",
      "当前页面正在排队或识别，请稍后重试。",
      409,
      {
        errorCode: "PAGE_RECOGNITION_BUSY",
        pageId: page.id,
        recognitionStatus: meta.recognitionStatus ?? "PENDING",
        recognitionRunId: meta.recognitionRunId ?? null,
        hint: "如确认识别任务已终止，请先执行「识别任务对账」恢复页面状态后再换图"
      }
    );
  }
  const textChangeMode: "DISPLAY" | "STRUCTURE" = input.textChangeMode ?? "DISPLAY";
  // 结构性正文修改：页面驱动已确认页的热工结构可能变化 → 必须重新 Review / Confirm。
  const structuralTextChange = !imageChanged && parsedTextChanged && textChangeMode === "STRUCTURE";
  // pageLabel 是「来源展示元数据」，不属于正式正文内容：不重建全文 chunks、不递增 contentRevision，
  // 但必须同步派生冗余引用（chunk/pageBlock metadata、DRAFT 热工行 sourcePageLabel），
  // 否则会出现「Page=A1-3，而 Chunk/Block/Thermal Row 仍是 22」的来源展示不一致。
  const nextPageLabel = input.pageLabel !== undefined ? (input.pageLabel ?? String(page.physicalPageNumber)) : page.pageLabel;
  const pageLabelChanged = input.pageLabel !== undefined && nextPageLabel !== page.pageLabel;

  let nextMeta: Record<string, unknown> | null = page.metadata ?? null;
  if (imageChanged) {
    // 换图：清空识别候选与已确认快照，重新进入 PENDING，等待重新识别与重新确认。
    nextMeta = {
      ...(page.metadata ?? {}),
      ...meta,
      recognitionStatus: "PENDING",
      recognitionRunId: null,
      recognitionQueuedAt: null,
      structuredData: null,
      draftStructuredData: null,
      confirmedStructuredData: null,
      confirmedAt: null,
      confirmedById: null,
      lastRecognitionError: null,
      recognitionWarnings: [],
      imageWarnings: meta.imageWarnings ?? []
    };
  } else if (parsedTextChanged) {
    // 正文变化：同步已确认/候选快照的 fullText，避免「正文变了 chunk 不变」。
    const nextText = input.parsedText ?? "";
    const withText = (value: typeof meta.structuredData) => value ? { ...value, fullText: nextText } : value;
    nextMeta = {
      ...(page.metadata ?? {}),
      ...meta,
      ...(structuralTextChange ? { recognitionStatus: "REVIEW_REQUIRED" } : {}),
      structuredData: withText(meta.structuredData),
      draftStructuredData: withText(meta.draftStructuredData),
      confirmedStructuredData: withText(meta.confirmedStructuredData)
    };
  }
  const nextParsedText = imageChanged
    ? (input.parsedText !== undefined ? input.parsedText : null)
    : (input.parsedText !== undefined ? input.parsedText : page.parsedText);

  const result = await app.db.transaction(async (tx) => {
    if (invalidatesIndex) {
      // 只修正正文（DISPLAY）时保留 thermal rows：热工结构未变，删除会造成
      // 「recognitionStatus = CONFIRMED 但本页 Thermal Row 已被 purge」的非法中间态。
      const keepThermalRows = parsedTextChanged && !imageChanged && !structuralTextChange;
      await purgePageDerivedIndex(tx, page, { keepThermalRows });
    }
    const [row] = await tx.update(knowledgePages).set({
      pageNumber: input.pageNumber ?? page.pageNumber,
      pageLabel: nextPageLabel,
      pageLabelSource: input.pageLabel !== undefined ? "MANUAL" : page.pageLabelSource,
      pageLabelVerified: input.pageLabel !== undefined ? Boolean(input.pageLabel) : page.pageLabelVerified,
      pageTitle: input.pageTitle !== undefined ? input.pageTitle : page.pageTitle,
      parsedText: nextParsedText,
      pageImageObjectKey,
      metadata: nextMeta
    }).where(eq(knowledgePages.id, page.id)).returning();
    const labelSync = pageLabelChanged
      ? await syncPageLabelDerivedReferences(tx, page, nextPageLabel)
      : null;
    if (invalidatesIndex) await markPageContentMutation(tx, versionId);
    return { page: row!, labelSync };
  });
  const updated = result.page;
  const labelSync = result.labelSync;
  await removeOldOwnedPageImage(app, page.pageImageObjectKey, pageImageObjectKey);
  const integrityWarnings: string[] = [];
  if (labelSync && labelSync.lockedThermalRows > 0) {
    integrityWarnings.push(
      `有 ${labelSync.lockedThermalRows} 条热工参考行属于已发布/已停用参考集，其来源标签保持不可变；`
      + "如需更新请通过新版本或新热工参考集正式发布"
    );
  }
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_updated", targetType: "knowledge_page", targetId: page.id,
    beforeJson: { pageNumber: page.pageNumber, pageLabel: page.pageLabel, pageTitle: page.pageTitle, pageImageObjectKey: page.pageImageObjectKey },
    afterJson: {
      pageNumber: updated.pageNumber,
      pageLabel: updated.pageLabel,
      pageTitle: updated.pageTitle,
      pageImageObjectKey: updated.pageImageObjectKey,
      indexInvalidated: invalidatesIndex,
      imageChanged,
      parsedTextChanged,
      textChangeMode: parsedTextChanged ? textChangeMode : null,
      structuralTextChange,
      thermalRowsPreserved: parsedTextChanged && !imageChanged && !structuralTextChange,
      pageLabelChanged,
      ...(labelSync ? {
        pageLabelSync: {
          chunksUpdated: labelSync.chunksUpdated,
          blocksUpdated: labelSync.blocksUpdated,
          thermalRowsUpdated: labelSync.thermalRowsUpdated,
          lockedThermalRows: labelSync.lockedThermalRows
        }
      } : {}),
      ...(integrityWarnings.length > 0 ? { integrityWarnings } : {})
    }
  });
  return updated;
}

export async function reorderManualPages(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  pageNumbers: Array<{ physicalPageNumber: number; pageNumber: number }>
) {
  await requireVersion(app, versionId);
  const rows = await app.db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  const byPhysical = new Map(rows.map((row) => [row.physicalPageNumber, row]));
  for (const item of pageNumbers) {
    if (!byPhysical.has(item.physicalPageNumber) || item.pageNumber < 1) {
      throw new AppError("INVALID_PAGE_ORDER", "排序中的页面不存在或页码无效", 400);
    }
  }
  const nextNumbers = pageNumbers.map((item) => item.pageNumber);
  if (new Set(nextNumbers).size !== nextNumbers.length) {
    throw new AppError("INVALID_PAGE_ORDER", "排序页码不能重复", 400);
  }
  await app.db.transaction(async (tx) => {
    for (const item of pageNumbers) {
      await tx.update(knowledgePages).set({ pageNumber: item.pageNumber + 100000 })
        .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, item.physicalPageNumber)));
    }
    for (const item of pageNumbers) {
      await tx.update(knowledgePages).set({ pageNumber: item.pageNumber })
        .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, item.physicalPageNumber)));
    }
    // 排序只改 pageNumber，不改变 pageCount；但页序是公开文库/图库的结构顺序，
    // 因此同样属于正式内容 Mutation（contentRevision++ / indexDirty=true）。
    await markPageContentMutation(tx, versionId);
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.pages_reordered", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { pageNumbers, pageCountUnchanged: true }
  });
  return { message: "页面顺序已更新" };
}

export async function deleteManualPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  physicalPageNumber: number
) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  await requireVersion(app, versionId);
  // P0-2：删除页面必须事务级清理所有来源于该页的正式索引，避免孤儿 chunk 继续被 AI 检索。
  // DRAFT 集热工行随页删除；已发布/停用热工集不可变，存在引用时拒绝删除（人工先处理热工集）。
  const purged = await app.db.transaction(async (tx) => {
    const result = await purgePageDerivedIndex(tx, page);
    if (result.lockedThermalRows > 0) {
      throw new AppError("PAGE_IN_USE", "该页面已被已发布热工参考方案引用，不能删除", 400, {
        errorCode: "PAGE_IN_USE",
        lockedThermalRows: result.lockedThermalRows
      });
    }
    await tx.delete(knowledgePages).where(eq(knowledgePages.id, page.id));
    await syncVersionPageCount(tx, versionId);
    await markPageContentMutation(tx, versionId);
    return result;
  });
  await removeOldOwnedPageImage(app, page.pageImageObjectKey, null);
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_deleted", targetType: "knowledge_page", targetId: page.id,
    beforeJson: { versionId, physicalPageNumber, pageNumber: page.pageNumber },
    afterJson: {
      chunksDeleted: purged.chunksDeleted,
      blocksDeleted: purged.blocksDeleted,
      thermalRowsDeleted: purged.thermalRowsDeleted
    }
  });
  return { message: "页面已删除", purged };
}

export async function listPageReferenceRows(app: FastifyInstance, versionId: string, physicalPageNumber: number) {
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page || page.pageNumber < 1) throw new NotFoundError("页面不存在");
  const rows = await app.db.select({
    id: thermalReferenceRows.id,
    setId: thermalReferenceRows.setId,
    thicknessMm: thermalReferenceRows.thicknessMm,
    productThermalResistance: thermalReferenceRows.productThermalResistance,
    totalThermalResistance: thermalReferenceRows.totalThermalResistance,
    kValue: thermalReferenceRows.kValue,
    sourcePageLabel: thermalReferenceRows.sourcePageLabel
  }).from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  return { pageId: page.id, items: rows };
}

export async function assertPagesBelongToDocument(app: FastifyInstance, documentId: string, pageIds: string[]) {
  if (pageIds.length === 0) return;
  const rows = await app.db.select({ id: knowledgePages.id, documentId: knowledgePages.documentId })
    .from(knowledgePages).where(inArray(knowledgePages.id, pageIds));
  if (rows.length !== pageIds.length || rows.some((row) => row.documentId !== documentId)) {
    throw new AppError("INVALID_SOURCE_PAGE", "所选页面不属于该知识资料", 400);
  }
}
