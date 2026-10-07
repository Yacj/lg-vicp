import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { env } from "../../config/env.js";
import {
  files,
  parsingJobs,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgePageMappings,
  knowledgePages,
  knowledgeSections,
  knowledgeTocItems
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { ConflictError, NotFoundError } from "../../shared/errors.js";
import { isKnowledgeErrorCode, KnowledgeError } from "../../shared/knowledge-errors.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";
import {
  collectKnowledgeVersionReadiness,
  toReadinessLogContext
} from "./knowledge-readiness.js";
import { validatePageDrivenKnowledgeIntegrity } from "./knowledge-page-index.service.js";
import { assertKnowledgeVersionEditable } from "./knowledge-version-guard.js";

/**
 * 原文档导航模型服务（2026-08 二次优化）：
 * - 双源文件资产（ORIGINAL / SEARCH_SOURCE）：检索源允许绑定到任意未停用版本（转曲件升级路径）；
 * - 原文目录 TOC：自动识别仅初稿（PENDING_REVIEW），人工校正 CONFIRMED；TOC ≠ Section；
 * - 页面维护：pageLabel/pageTitle 人工修正（A1/A5/D16 等非数字页码）；
 * - 发布门禁：AI_ENABLED 必须存在可搜索文本源（硬拦截）；TOC/映射未核验为软提示。
 */

export type KnowledgeAssetRole = "ORIGINAL" | "SEARCH_SOURCE" | "OCR_SOURCE" | "PREVIEW";

async function requireVersion(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  return version;
}

// ---------------------------------------------------------------- 文件资产（双源）

export async function listVersionAssets(app: FastifyInstance, versionId: string) {
  const rows = await app.db.select({
    id: knowledgeDocumentAssets.id,
    role: knowledgeDocumentAssets.role,
    isPrimary: knowledgeDocumentAssets.isPrimary,
    fileId: knowledgeDocumentAssets.fileId,
    fileName: files.originalName,
    mimeType: files.mimeType,
    sizeBytes: files.sizeBytes,
    fileStatus: files.status,
    createdAt: knowledgeDocumentAssets.createdAt
  })
    .from(knowledgeDocumentAssets)
    .innerJoin(files, eq(files.id, knowledgeDocumentAssets.fileId))
    .where(eq(knowledgeDocumentAssets.versionId, versionId))
    .orderBy(asc(knowledgeDocumentAssets.createdAt));
  return { items: rows };
}

export async function bindVersionAsset(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: { role: KnowledgeAssetRole; fileId: string }
) {
  const version = await requireVersion(app, versionId);
  assertKnowledgeVersionEditable(version);
  const [file] = await app.db.select({ id: files.id, status: files.status })
    .from(files).where(eq(files.id, input.fileId)).limit(1);
  if (!file) throw new NotFoundError("文件不存在");
  if (file.status === "DELETED") throw new ConflictError("已删除文件不能绑定为版本资产");
  const existing = await app.db.select({ id: knowledgeDocumentAssets.id })
    .from(knowledgeDocumentAssets)
    .where(and(
      eq(knowledgeDocumentAssets.versionId, versionId),
      eq(knowledgeDocumentAssets.role, input.role)
    )).limit(1);
  const saved = await app.db.transaction(async (tx) => {
    if (existing.length > 0) {
      const [updated] = await tx.update(knowledgeDocumentAssets)
        .set({ fileId: input.fileId, updatedAt: new Date() })
        .where(eq(knowledgeDocumentAssets.id, existing[0]!.id))
        .returning();
      if (input.role === "ORIGINAL") {
        await tx.update(knowledgeDocumentVersions).set({ fileId: input.fileId, updatedAt: new Date() })
          .where(eq(knowledgeDocumentVersions.id, versionId));
      }
      return updated!;
    }
    const [created] = await tx.insert(knowledgeDocumentAssets).values({
      documentId: version.documentId,
      versionId,
      fileId: input.fileId,
      role: input.role,
      isPrimary: true,
      createdById: actor.id
    }).returning();
    if (input.role === "ORIGINAL") {
      await tx.update(knowledgeDocumentVersions).set({ fileId: input.fileId, updatedAt: new Date() })
        .where(eq(knowledgeDocumentVersions.id, versionId));
    }
    return created!;
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_asset_bound", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { role: input.role, fileId: input.fileId, assetId: saved.id }
  });
  return saved;
}

export async function updateVersionAsset(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  assetId: string,
  input: { isPrimary?: boolean }
) {
  assertKnowledgeVersionEditable(await requireVersion(app, versionId));
  const [existing] = await app.db.select().from(knowledgeDocumentAssets)
    .where(and(eq(knowledgeDocumentAssets.id, assetId), eq(knowledgeDocumentAssets.versionId, versionId))).limit(1);
  if (!existing) throw new NotFoundError("文件资产不存在");
  const [updated] = await app.db.update(knowledgeDocumentAssets)
    .set({ isPrimary: input.isPrimary ?? existing.isPrimary, updatedAt: new Date() })
    .where(eq(knowledgeDocumentAssets.id, assetId)).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_asset_updated", targetType: "knowledge_document_version", targetId: versionId,
    beforeJson: { isPrimary: existing.isPrimary },
    afterJson: { isPrimary: updated!.isPrimary }
  });
  return updated!;
}

export async function deleteVersionAsset(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  assetId: string
) {
  assertKnowledgeVersionEditable(await requireVersion(app, versionId));
  const [existing] = await app.db.select().from(knowledgeDocumentAssets)
    .where(and(eq(knowledgeDocumentAssets.id, assetId), eq(knowledgeDocumentAssets.versionId, versionId))).limit(1);
  if (!existing) throw new NotFoundError("文件资产不存在");
  if (existing.role === "ORIGINAL") {
    throw new ConflictError("ORIGINAL 资产不可删除（由版本主文件承担），可绑定新的检索文本源替代");
  }
  await app.db.delete(knowledgeDocumentAssets).where(eq(knowledgeDocumentAssets.id, assetId));
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_asset_deleted", targetType: "knowledge_document_version", targetId: versionId,
    beforeJson: { role: existing.role, fileId: existing.fileId }
  });
  return { message: "文件资产已删除" };
}

// ---------------------------------------------------------------- 原文目录 TOC

export async function listVersionToc(app: FastifyInstance, versionId: string) {
  const items = await app.db.select().from(knowledgeTocItems)
    .where(eq(knowledgeTocItems.versionId, versionId))
    .orderBy(asc(knowledgeTocItems.sortOrder), asc(knowledgeTocItems.level));
  return { items };
}

export interface TocItemInput {
  title: string;
  pageLabel?: string | null;
  physicalPageNumber?: number | null;
  parentId?: string | null;
  level?: number;
  source?: "PDF_BOOKMARK" | "TOC_PAGE" | "MANUAL" | "COMPANION_FILE";
  sectionId?: string | null;
}

/**
 * 已确认 TOC 的标题与页签属于人工校验结果：在其精确指定物理页时回写页面标题；
 * 仅为 FALLBACK 的页面补充 TOC 页签，永远不覆盖人工页面校正。
 */
async function syncConfirmedTocPageMetadata(app: FastifyInstance, versionId: string): Promise<void> {
  const items = await app.db.select({
    title: knowledgeTocItems.title,
    pageLabel: knowledgeTocItems.pageLabel,
    physicalPageNumber: knowledgeTocItems.physicalPageNumber
  }).from(knowledgeTocItems).where(and(
    eq(knowledgeTocItems.versionId, versionId),
    eq(knowledgeTocItems.status, "CONFIRMED")
  ));
  for (const item of items) {
    if (item.physicalPageNumber == null) continue;
    const [page] = await app.db.select({
      id: knowledgePages.id,
      pageLabelSource: knowledgePages.pageLabelSource
    }).from(knowledgePages).where(and(
      eq(knowledgePages.versionId, versionId),
      eq(knowledgePages.physicalPageNumber, item.physicalPageNumber)
    )).limit(1);
    if (!page || page.pageLabelSource === "MANUAL") continue;
    await app.db.update(knowledgePages).set({
      pageTitle: item.title,
      ...(item.pageLabel && page.pageLabelSource === "FALLBACK"
        ? {
            pageLabel: item.pageLabel,
            pageLabelSource: "TOC_MAPPING" as const,
            pageLabelConfidence: 0.9,
            pageLabelVerified: false
          }
        : {})
    }).where(eq(knowledgePages.id, page.id));
  }
}

/** 整表替换（B 端人工校正提交）：CONFIRMED 需显式 confirm 标记；单事务删旧写新 */
export async function replaceVersionToc(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  items: TocItemInput[],
  options: { confirm?: boolean } = {}
) {
  const version = await requireVersion(app, versionId);
  assertKnowledgeVersionEditable(version);
  const saved = await app.db.transaction(async (tx) => {
    await tx.delete(knowledgeTocItems).where(eq(knowledgeTocItems.versionId, versionId));
    let sortOrder = 0;
    const rows: Array<{ id: string; level: number }> = [];
    for (const item of items) {
      const level = Math.max(1, Math.min(6, item.level ?? 1));
      const [row] = await tx.insert(knowledgeTocItems).values({
        documentId: version.documentId,
        versionId,
        parentId: item.parentId ?? null,
        level,
        sortOrder,
        title: item.title.slice(0, 255),
        pageLabel: item.pageLabel ?? null,
        physicalPageNumber: item.physicalPageNumber ?? null,
        source: item.source ?? "MANUAL",
        confidence: item.source && item.source !== "MANUAL" ? 0.8 : null,
        sectionId: item.sectionId ?? null,
        status: options.confirm ? "CONFIRMED" as const : "PENDING_REVIEW" as const,
        createdById: actor.id,
        updatedById: actor.id
      }).returning({ id: knowledgeTocItems.id });
      rows.push({ id: row!.id, level });
      sortOrder += 1;
    }
    return rows;
  });
  if (options.confirm) await syncConfirmedTocPageMetadata(app, versionId);
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_toc_replaced", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { itemCount: saved.length, confirmed: options.confirm === true }
  });
  return { message: `目录已保存（${saved.length} 项）`, itemCount: saved.length };
}

export async function updateTocItem(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  tocId: string,
  input: { title?: string; pageLabel?: string | null; physicalPageNumber?: number | null; sectionId?: string | null; status?: "DRAFT" | "PENDING_REVIEW" | "CONFIRMED" }
) {
  const [existing] = await app.db.select().from(knowledgeTocItems).where(eq(knowledgeTocItems.id, tocId)).limit(1);
  if (!existing) throw new NotFoundError("目录条目不存在");
  assertKnowledgeVersionEditable(await requireVersion(app, existing.versionId));
  const [updated] = await app.db.update(knowledgeTocItems).set({
    title: input.title?.slice(0, 255) ?? existing.title,
    pageLabel: input.pageLabel !== undefined ? input.pageLabel : existing.pageLabel,
    physicalPageNumber: input.physicalPageNumber !== undefined ? input.physicalPageNumber : existing.physicalPageNumber,
    sectionId: input.sectionId !== undefined ? input.sectionId : existing.sectionId,
    status: input.status ?? existing.status,
    updatedById: actor.id,
    updatedAt: new Date()
  }).where(eq(knowledgeTocItems.id, tocId)).returning();
  if (updated?.status === "CONFIRMED") await syncConfirmedTocPageMetadata(app, updated.versionId);
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.toc_item_updated", targetType: "knowledge_toc_item", targetId: tocId,
    beforeJson: { title: existing.title, pageLabel: existing.pageLabel, status: existing.status },
    afterJson: { title: updated!.title, pageLabel: updated!.pageLabel, status: updated!.status }
  });
  return updated!;
}

export async function deleteTocItem(app: FastifyInstance, request: FastifyRequest, actor: AuthUser, tocId: string) {
  const [existing] = await app.db.select({ id: knowledgeTocItems.id, versionId: knowledgeTocItems.versionId }).from(knowledgeTocItems)
    .where(eq(knowledgeTocItems.id, tocId)).limit(1);
  if (!existing) throw new NotFoundError("目录条目不存在");
  assertKnowledgeVersionEditable(await requireVersion(app, existing.versionId));
  await app.db.delete(knowledgeTocItems).where(eq(knowledgeTocItems.id, tocId));
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.toc_item_deleted", targetType: "knowledge_toc_item", targetId: tocId
  });
  return { message: "目录条目已删除" };
}

/** 重排：按提交顺序更新 sortOrder（ parentId/level 一并接受） */
export async function reorderVersionToc(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  items: Array<{ id: string; sortOrder: number; parentId?: string | null; level?: number }>
) {
  assertKnowledgeVersionEditable(await requireVersion(app, versionId));
  await app.db.transaction(async (tx) => {
    for (const item of items) {
      await tx.update(knowledgeTocItems).set({
        sortOrder: item.sortOrder,
        ...(item.parentId !== undefined ? { parentId: item.parentId } : {}),
        ...(item.level !== undefined ? { level: Math.max(1, Math.min(6, item.level)) } : {}),
        updatedById: actor.id,
        updatedAt: new Date()
      }).where(and(eq(knowledgeTocItems.id, item.id), eq(knowledgeTocItems.versionId, versionId)));
    }
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_toc_reordered", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { count: items.length }
  });
  return { message: `目录顺序已更新（${items.length} 项）` };
}

/** remap：按 pageLabel 反查物理页回填 physicalPageNumber，并按标题回链语义 Section */
export async function remapVersionToc(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string
) {
  assertKnowledgeVersionEditable(await requireVersion(app, versionId));
  const pages = await app.db.select({
    physicalPageNumber: knowledgePages.physicalPageNumber,
    pageLabel: knowledgePages.pageLabel
  }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  const sections = await app.db.select({
    id: knowledgeSections.id,
    title: knowledgeSections.title
  }).from(knowledgeSections).where(eq(knowledgeSections.versionId, versionId));
  const items = await app.db.select().from(knowledgeTocItems).where(eq(knowledgeTocItems.versionId, versionId));

  let remapped = 0;
  let linked = 0;
  await app.db.transaction(async (tx) => {
    for (const item of items) {
      const patch: Record<string, unknown> = {};
      if (item.pageLabel) {
        const page = pages.find((row) => row.pageLabel === item.pageLabel);
        if (page && page.physicalPageNumber !== item.physicalPageNumber) {
          patch.physicalPageNumber = page.physicalPageNumber;
        }
      }
      if (!item.sectionId) {
        const section = sections.find((row) => row.title === item.title);
        if (section) {
          patch.sectionId = section.id;
          linked += 1;
        }
      }
      if (Object.keys(patch).length > 0) {
        await tx.update(knowledgeTocItems).set({ ...patch, updatedById: actor.id, updatedAt: new Date() })
          .where(eq(knowledgeTocItems.id, item.id));
        remapped += 1;
      }
    }
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_toc_remapped", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { remapped, linked }
  });
  return { message: `目录重映射完成（更新 ${remapped} 项，关联章节 ${linked} 项）`, remapped, linked };
}

// ---------------------------------------------------------------- 页面维护（印刷页码/页面标题）

export async function updateVersionPage(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  physicalPageNumber: number,
  input: { pageLabel?: string | null; pageTitle?: string | null }
) {
  assertKnowledgeVersionEditable(await requireVersion(app, versionId));
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page) throw new NotFoundError("页面不存在");
  const [updated] = await app.db.update(knowledgePages).set({
    pageLabel: input.pageLabel !== undefined
      ? input.pageLabel ?? String(physicalPageNumber)
      : page.pageLabel,
    pageLabelSource: input.pageLabel !== undefined
      ? input.pageLabel ? "MANUAL" : "FALLBACK"
      : page.pageLabelSource,
    pageLabelConfidence: input.pageLabel !== undefined && input.pageLabel ? null : page.pageLabelConfidence,
    pageLabelVerified: input.pageLabel !== undefined ? Boolean(input.pageLabel) : page.pageLabelVerified,
    pageTitle: input.pageTitle !== undefined ? input.pageTitle : page.pageTitle
  }).where(eq(knowledgePages.id, page.id)).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_page_updated", targetType: "knowledge_document_version", targetId: versionId,
    beforeJson: { physicalPageNumber, pageLabel: page.pageLabel, pageTitle: page.pageTitle },
    afterJson: { physicalPageNumber, pageLabel: updated!.pageLabel, pageTitle: updated!.pageTitle }
  });
  return updated!;
}

// ---------------------------------------------------------------- 发布门禁（AI_ENABLED / BROWSE_ONLY）

/**
 * 发布门禁已统一收口到 knowledge-readiness：
 * - 传统文件链（ORIGINAL + 解析完成）与页面驱动链（完整页面 + 识别确认 + 可检索内容）任一就绪即可发布；
 * - 不再把「必须 ORIGINAL」「version.parseStatus = PARSED」作为所有版本的硬前提；
 * - 审核 / 发布 / 工作台 canPublish / 文档健康 / AI 可用性共用同一份 readiness，避免判定分叉。
 */
export {
  collectAiReadinessContext,
  collectKnowledgeVersionReadiness,
  deriveKnowledgeVersionReadiness,
  evaluateVersionAiReadiness,
  summarizePageReadiness,
  toPageReadinessRow,
  toReadinessLogContext,
  type AiReadinessContext,
  type AiReadinessResult,
  type KnowledgePageReadinessFacts,
  type KnowledgePageReadinessRow,
  type KnowledgeReadinessBlocker,
  type KnowledgeReadinessSource,
  type KnowledgeVersionReadiness
} from "./knowledge-readiness.js";

/**
 * 发布门禁组装：空版本硬拦截 + 统一 readiness 判定 + 软提示。
 * 允许先创建空 DRAFT 版本，但空版本（0 个 Knowledge Page）不允许发布，返回稳定业务错误
 * KNOWLEDGE_VERSION_EMPTY；带稳定错误码的 blocker（页面缺图 / 识别未确认 / 识别失败 / 缺检索源）
 * 同样以 KnowledgeError 抛出，其余 blocker 沿用 ConflictError 中文提示。
 */
export async function assertVersionPublishable(
  app: FastifyInstance,
  version: typeof knowledgeDocumentVersions.$inferSelect
) {
  const readiness = await collectKnowledgeVersionReadiness(app, version);
  if (readiness.pageCount === 0) {
    throw new KnowledgeError("KNOWLEDGE_VERSION_EMPTY");
  }
  // 单一事实来源：publishReady 已包含「无 PUBLISH 作用域 blocker」，不再单独判 blockers.length，
  // 保证 B 端 canPublish（同一 readiness.publishReady）与发布 API 完全一致。
  if (!readiness.publishReady) {
    app.log.warn(
      toReadinessLogContext(readiness, {
        documentId: version.documentId,
        versionId: version.id,
        usageMode: version.usageMode
      }),
      "知识版本发布门禁未通过"
    );
    const publishBlockers = readiness.publishBlockers.length > 0 ? readiness.publishBlockers : readiness.blockers;
    const coded = publishBlockers.find((blocker) => blocker.knowledgeErrorCode != null && isKnowledgeErrorCode(blocker.knowledgeErrorCode));
    if (coded?.knowledgeErrorCode && isKnowledgeErrorCode(coded.knowledgeErrorCode)) {
      throw new KnowledgeError(coded.knowledgeErrorCode, coded.message);
    }
    throw new ConflictError(
      publishBlockers.length > 0
        ? publishBlockers.map((blocker) => blocker.message).join("；")
        : "当前版本不满足发布条件，请先完成资料页面或原始文件处理"
    );
  }
  // 页面驱动版本：发布前额外做一次完整性校验（孤儿 chunk / 页码重复 / 索引未就绪等），
  // 返回可读中文原因，避免笼统错误码。仅当版本行携带索引状态字段时执行（真实 DB 行恒有该字段）。
  const integrity = version.indexStatus != null
    ? await validatePageDrivenKnowledgeIntegrity(app, version.id)
    : null;
  if (integrity && integrity.pageDriven && !integrity.ok) {
    app.log.warn(
      { versionId: version.id, issues: integrity.issues.map((issue) => issue.code), stats: integrity.stats },
      "知识版本发布完整性校验未通过"
    );
    throw new ConflictError(integrity.issues.map((issue) => issue.message).join("；"));
  }
  return {
    eligible: readiness.publishReady,
    blockers: readiness.blockers.map((blocker) => blocker.message),
    blockerCodes: readiness.blockerCodes,
    warnings: readiness.warnings,
    publishReady: readiness.publishReady,
    readiness,
    integrity
  };
}

// ---------------------------------------------------------------- 页面映射人工核验

/** 人工核验/修正映射：MANUAL 方式写入，verified=true */
export async function verifyVersionPageMappings(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  input: { mappings: Array<{ searchPhysicalPageNumber: number; originalPhysicalPageNumber: number; pageLabel?: string | null }> }
) {
  const version = await requireVersion(app, versionId);
  assertKnowledgeVersionEditable(version);
  const originalPageIdByPhysical = new Map<number, string>();
  const pageRows = await app.db.select({ id: knowledgePages.id, physicalPageNumber: knowledgePages.physicalPageNumber })
    .from(knowledgePages).where(eq(knowledgePages.versionId, versionId));
  for (const row of pageRows) originalPageIdByPhysical.set(row.physicalPageNumber, row.id);
  const saved = await app.db.transaction(async (tx) => {
    let written = 0;
    for (const mapping of input.mappings) {
      const originalPageId = originalPageIdByPhysical.get(mapping.originalPhysicalPageNumber);
      if (!originalPageId) continue;
      await tx.insert(knowledgePageMappings).values({
        documentId: version.documentId,
        versionId,
        originalPageId,
        searchPhysicalPageNumber: mapping.searchPhysicalPageNumber,
        pageLabel: mapping.pageLabel ?? null,
        mappingMethod: "MANUAL",
        confidence: null,
        verified: true,
        createdById: actor.id
      }).onConflictDoUpdate({
        target: [knowledgePageMappings.versionId, knowledgePageMappings.searchPhysicalPageNumber],
        set: {
          originalPageId,
          pageLabel: mapping.pageLabel ?? null,
          mappingMethod: "MANUAL",
          confidence: null,
          verified: true,
          updatedAt: new Date()
        }
      });
      written += 1;
    }
    return written;
  });
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.page_mappings_verified", targetType: "knowledge_document_version", targetId: versionId,
    afterJson: { count: saved }
  });
  return { message: `已人工核验 ${saved} 条页面映射`, count: saved };
}

export async function listVersionPageMappings(app: FastifyInstance, versionId: string) {
  const [items, [totalRow]] = await Promise.all([
    app.db.select({
      id: knowledgePageMappings.id,
      searchPhysicalPageNumber: knowledgePageMappings.searchPhysicalPageNumber,
      originalPageId: knowledgePageMappings.originalPageId,
      pageLabel: knowledgePageMappings.pageLabel,
      mappingMethod: knowledgePageMappings.mappingMethod,
      confidence: knowledgePageMappings.confidence,
      verified: knowledgePageMappings.verified
    }).from(knowledgePageMappings)
      .where(eq(knowledgePageMappings.versionId, versionId))
      .orderBy(asc(knowledgePageMappings.searchPhysicalPageNumber)),
    app.db.select({ value: count() }).from(knowledgePageMappings).where(eq(knowledgePageMappings.versionId, versionId))
  ]);
  return { items, total: totalRow?.value ?? 0 };
}

// ---------------------------------------------------------------- 版本用途（usageMode）

export async function updateVersionUsageMode(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string,
  usageMode: "AI_ENABLED" | "BROWSE_ONLY"
) {
  const version = await requireVersion(app, versionId);
  assertKnowledgeVersionEditable(version);
  const [updated] = await app.db.update(knowledgeDocumentVersions)
    .set({ usageMode, updatedById: actor.id, updatedAt: new Date() })
    .where(eq(knowledgeDocumentVersions.id, versionId)).returning();
  await writeAuditLog({
    db: app.db, request, actor,
    action: "knowledge.version_usage_mode_changed", targetType: "knowledge_document_version", targetId: versionId,
    beforeJson: { usageMode: version.usageMode },
    afterJson: { usageMode }
  });
  return updated!;
}

// ---------------------------------------------------------------- 升级解析（历史资料 Wiki/预览/TOC 升级，不降级状态）

export async function enqueueUpgradeParse(
  app: FastifyInstance,
  request: FastifyRequest,
  actor: AuthUser,
  versionId: string
) {
  const version = await requireVersion(app, versionId);
  assertKnowledgeVersionEditable(version);
  const [pageRow] = await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId)).limit(1);
  if (!pageRow) throw new ConflictError("该版本缺少页面数据，请先执行解析");
  const job = await app.db.transaction(async (tx) => {
    const [created] = await tx.insert(parsingJobs).values({
      documentId: version.documentId,
      versionId,
      jobType: "UPGRADE_PARSE",
      status: "QUEUED",
      fileId: version.fileId,
      queuedById: actor.id
    }).returning();
    await writeAuditLog({
      db: tx, request, actor,
      action: "knowledge.version_upgrade_parse_enqueued", targetType: "knowledge_document_version", targetId: versionId,
      afterJson: { parsingJobId: created!.id }
    });
    return created!;
  });
  await app.queues.documentProcessing.add("parse_document", {
    parsingJobId: job.id,
    fileId: version.fileId ?? "",
    versionId,
    jobType: "UPGRADE_PARSE"
  }, { jobId: job.id });
  return { message: "升级解析任务已提交（保留版本发布状态）", jobId: job.id };
}
