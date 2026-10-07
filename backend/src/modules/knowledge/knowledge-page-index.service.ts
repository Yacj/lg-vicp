/**
 * 页面驱动知识库「正式索引」收口服务。
 *
 * 职责边界（与 AGENTS.md / docs/knowledge/page-offline-recognition.md 一致）：
 * - 单页 Confirm 只产出「即时 page-aware chunk」，用于人工即时测试；它不是正式发布索引的唯一来源。
 * - 正式发布索引由版本级 `rebuildPageDrivenVersionIndex` 统一重建：
 *   读取全部「正式可索引页面」（页面驱动需 CONFIRMED，传统文本页用 parsedText），
 *   按 physicalPageNumber ASC 跨页统一解析，生成 knowledge_sections / knowledge_page_blocks / knowledge_chunks，
 *   chunkIndex 全局连续，并写入 pageId/sectionId 溯源。
 * - 任何会影响正式知识内容的页面变更（换图 / 改正式正文 / 删页）都必须：
 *   清派生索引（chunks / page_blocks / DRAFT 集 thermal rows）→ 版本索引置脏（indexDirty=true）。
 * - 发布前必须 indexReady（页面驱动版本），且通过完整性校验。
 *
 * 不涉及：热工引擎公式、R/K 语义、产品/用户/项目/报告模块。
 */
import { createHash } from "node:crypto";
import { and, asc, count, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AuthUser } from "../../shared/auth-user.js";
import type { DbExecutor } from "../../db/client.js";
import { AppError, NotFoundError } from "../../shared/errors.js";
import { env } from "../../config/env.js";
import { toInsertBatches } from "../../db/batch-insert.js";
import {
  knowledgeAliases,
  knowledgeChunks,
  knowledgeDocumentVersions,
  knowledgePageBlocks,
  knowledgePages,
  knowledgeSections,
  thermalReferenceRows,
  thermalReferenceSets
} from "../../db/schema.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";
import {
  buildChunksFromBlocks,
  buildSectionDrafts,
  createPageBlockScanState,
  parsePageToBlocks,
  type AliasDictEntry,
  type BlockDraft
} from "./knowledge-chunking.js";
import { normalizeSearchText } from "./knowledge.normalize.js";
import { pageRequiresRecognition } from "./knowledge-readiness.js";
import { writeAuditLog } from "../audit-logs/audit-log.service.js";

const CHUNK_WRITE_BATCH_SIZE = 500;
const PAGE_WRITE_BATCH_SIZE = 200;

/** 生成稳定 UUID：同一版本内 rebuild 重跑时 section/block 身份稳定（不随重跑漂移）。 */
function stableUuid(versionId: string, kind: string, key: string): string {
  const hex = createHash("sha256").update(`${versionId}:${kind}:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

type PageRow = typeof knowledgePages.$inferSelect;

async function loadAliases(db: DbExecutor): Promise<AliasDictEntry[]> {
  const rows = await db.select({ term: knowledgeAliases.term, alias: knowledgeAliases.alias })
    .from(knowledgeAliases).where(eq(knowledgeAliases.enabled, true));
  return rows;
}

/** 版本索引是否要求「页面驱动就绪」（存在离线页图 = 页面驱动链）。 */
export function isPageDrivenVersion(input: { hasOfflinePageImages: boolean }): boolean {
  return input.hasOfflinePageImages;
}

/**
 * 页面正式正文来源（唯一权威口径）：
 * - 需要识别确认的页面（离线页图或已进入识别流程）：只取 confirmedStructuredData.fullText；未确认返回 null。
 * - 传统文本页：取 parsedText。
 * AI draft / 识别原始输出永不进入正式索引。
 */
export function resolveFormalPageText(page: PageRow): string | null {
  const meta = readPageRecognitionMeta(page.metadata);
  const requiresRecognition = pageRequiresRecognition({
    pageImageObjectKey: page.pageImageObjectKey,
    uploadSource: meta.uploadSource ?? null,
    recognitionStatus: meta.recognitionStatus ?? null,
    recognitionRunId: meta.recognitionRunId ?? null,
    hasText: (page.parsedText ?? "").length > 0
  });
  if (!requiresRecognition) {
    return (page.parsedText ?? "").trim() || null;
  }
  if (meta.recognitionStatus !== "CONFIRMED") return null;
  const text = (meta.confirmedStructuredData?.fullText ?? "").trim();
  return text || null;
}

/**
 * 页面正式内容 Mutation 统一入口（P0 收口）：
 * 任何会改变「正式可索引页面内容」的操作都必须调用本方法，禁止各 Service 各写一套。
 *
 * 语义：
 * - `contentRevision += 1`（原子自增，作为 rebuild 的 CAS 比对基准）；
 * - `indexDirty = true`；
 * - `indexStatus`：INDEX_READY / INDEX_FAILED → INDEX_PENDING；INDEXING 保持 INDEXING（重建进行中不降级）。
 *
 * 调用方（必须全部覆盖）：createManualPage / deleteManualPage / updateManualPage / upsertPageImage /
 * confirmPageRecognition / batchConfirmPageRecognition / 识别重置 / 正式正文修改 / 页面重排。
 */
export async function markPageContentMutation(
  db: DbExecutor,
  versionId: string
): Promise<void> {
  await db.update(knowledgeDocumentVersions).set({
    indexDirty: true,
    contentRevision: sql`${knowledgeDocumentVersions.contentRevision} + 1`,
    updatedAt: new Date()
  }).where(eq(knowledgeDocumentVersions.id, versionId));
  await db.update(knowledgeDocumentVersions).set({
    indexStatus: "INDEX_PENDING"
  }).where(and(
    eq(knowledgeDocumentVersions.id, versionId),
    sql`${knowledgeDocumentVersions.indexStatus} <> 'INDEXING'`
  ));
}

/** @deprecated 保留旧名以兼容既有调用方；语义等同 markPageContentMutation（含 contentRevision 自增）。 */
export async function markVersionIndexDirty(db: DbExecutor, versionId: string): Promise<void> {
  await markPageContentMutation(db, versionId);
}

export interface PurgePageIndexResult {
  chunksDeleted: number;
  blocksDeleted: number;
  thermalRowsDeleted: number;
  /** 引用该页且属于非 DRAFT（已发布/停用）热工参考集的行数：不可删除，需人工处理 */
  lockedThermalRows: number;
}

/**
 * 删除单页派生的正式索引（不改页面行）：
 * chunks（metadata.pageId 或 pageBlockId 命中）→ page_blocks → 可写的 DRAFT 集 thermal rows。
 * 已发布热工集不可变，其引用行只统计不删除（lockedThermalRows）。
 *
 * options.keepThermalRows = true 用于「只修正正文错字」场景：普通 chunk 需要重建，
 * 但热工结构未变，不得删除 thermal_reference_rows（否则会出现 CONFIRMED 却无热工行的非法中间态）。
 */
export async function purgePageDerivedIndex(
  db: DbExecutor,
  page: Pick<PageRow, "id" | "versionId">,
  options: { keepThermalRows?: boolean } = {}
): Promise<PurgePageIndexResult> {
  const blockRows = await db.select({ id: knowledgePageBlocks.id })
    .from(knowledgePageBlocks).where(eq(knowledgePageBlocks.pageId, page.id));
  const blockIds = blockRows.map((row) => row.id);

  const chunkCondition = blockIds.length > 0
    ? and(
      eq(knowledgeChunks.versionId, page.versionId),
      or(
        sql`${knowledgeChunks.metadata}->>'pageId' = ${page.id}`,
        inArray(knowledgeChunks.pageBlockId, blockIds)
      )
    )
    : and(
      eq(knowledgeChunks.versionId, page.versionId),
      sql`${knowledgeChunks.metadata}->>'pageId' = ${page.id}`
    );
  const deletedChunks = await db.delete(knowledgeChunks).where(chunkCondition).returning({ id: knowledgeChunks.id });

  const deletedBlocks = await db.delete(knowledgePageBlocks)
    .where(eq(knowledgePageBlocks.pageId, page.id))
    .returning({ id: knowledgePageBlocks.id });

  const thermalRows = options.keepThermalRows
    ? []
    : await db.select({ id: thermalReferenceRows.id, setId: thermalReferenceRows.setId })
      .from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  let thermalRowsDeleted = 0;
  let lockedThermalRows = 0;
  if (thermalRows.length > 0) {
    const setIds = [...new Set(thermalRows.map((row) => row.setId))];
    const sets = await db.select({ id: thermalReferenceSets.id, status: thermalReferenceSets.status })
      .from(thermalReferenceSets).where(inArray(thermalReferenceSets.id, setIds));
    const editableSetIds = new Set(sets.filter((set) => set.status === "DRAFT").map((set) => set.id));
    const deletableIds = thermalRows.filter((row) => editableSetIds.has(row.setId)).map((row) => row.id);
    lockedThermalRows = thermalRows.length - deletableIds.length;
    if (deletableIds.length > 0) {
      const deleted = await db.delete(thermalReferenceRows)
        .where(inArray(thermalReferenceRows.id, deletableIds))
        .returning({ id: thermalReferenceRows.id });
      thermalRowsDeleted = deleted.length;
    }
  }

  return {
    chunksDeleted: deletedChunks.length,
    blocksDeleted: deletedBlocks.length,
    thermalRowsDeleted,
    lockedThermalRows
  };
}

export interface PageLabelSyncResult {
  chunksUpdated: number;
  blocksUpdated: number;
  thermalRowsUpdated: number;
  /** 引用本页但属于非 DRAFT（已发布/停用）热工集的行数：不可修改，仅统计供调用方记录 integrity warning */
  lockedThermalRows: number;
}

/**
 * pageLabel 变更时的派生引用同步（来源展示元数据收口）。
 *
 * pageLabel 只属于「来源展示元数据」，不是正式正文内容：不触发全文 chunks 重建、不递增 contentRevision；
 * 但必须保证下列冗余字段与 knowledge_pages.pageLabel 一致，否则会出现
 * 「Page=A1-3，Chunk metadata=22，PageBlock metadata=22，Thermal Row=22」的来源展示不一致：
 * - knowledge_chunks.metadata.pageLabel（仅当原 metadata 已持久化该键）
 * - knowledge_page_blocks.metadata.pageLabel（仅当原 metadata 已持久化该键）
 * - 可编辑（DRAFT）热工集 thermal_reference_rows.sourcePageLabel
 *
 * 已发布 / 已停用热工集不可变：其引用行只统计不修改（lockedThermalRows），
 * 由调用方记录 integrity warning 或要求通过新版本 / 新热工集正式发布，绝不静默篡改 PUBLISHED 行。
 */
export async function syncPageLabelDerivedReferences(
  db: DbExecutor,
  page: Pick<PageRow, "id" | "versionId">,
  pageLabel: string | null
): Promise<PageLabelSyncResult> {
  let chunksUpdated = 0;
  let blocksUpdated = 0;

  const chunkRows = await db.select({ id: knowledgeChunks.id, metadata: knowledgeChunks.metadata })
    .from(knowledgeChunks)
    .where(and(
      eq(knowledgeChunks.versionId, page.versionId),
      sql`${knowledgeChunks.metadata}->>'pageId' = ${page.id}`
    ));
  for (const row of chunkRows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (!("pageLabel" in metadata) || metadata.pageLabel === pageLabel) continue;
    await db.update(knowledgeChunks).set({ metadata: { ...metadata, pageLabel } })
      .where(eq(knowledgeChunks.id, row.id));
    chunksUpdated += 1;
  }

  const blockRows = await db.select({ id: knowledgePageBlocks.id, metadata: knowledgePageBlocks.metadata })
    .from(knowledgePageBlocks).where(eq(knowledgePageBlocks.pageId, page.id));
  for (const row of blockRows) {
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    if (!("pageLabel" in metadata) || metadata.pageLabel === pageLabel) continue;
    await db.update(knowledgePageBlocks).set({ metadata: { ...metadata, pageLabel } })
      .where(eq(knowledgePageBlocks.id, row.id));
    blocksUpdated += 1;
  }

  const thermalRows = await db.select({ id: thermalReferenceRows.id, setId: thermalReferenceRows.setId })
    .from(thermalReferenceRows).where(eq(thermalReferenceRows.sourcePageId, page.id));
  let thermalRowsUpdated = 0;
  let lockedThermalRows = 0;
  if (thermalRows.length > 0) {
    const setIds = [...new Set(thermalRows.map((row) => row.setId))];
    const sets = await db.select({ id: thermalReferenceSets.id, status: thermalReferenceSets.status })
      .from(thermalReferenceSets).where(inArray(thermalReferenceSets.id, setIds));
    const editableSetIds = new Set(sets.filter((set) => set.status === "DRAFT").map((set) => set.id));
    const editableRowIds = thermalRows.filter((row) => editableSetIds.has(row.setId)).map((row) => row.id);
    lockedThermalRows = thermalRows.length - editableRowIds.length;
    if (editableRowIds.length > 0) {
      await db.update(thermalReferenceRows).set({ sourcePageLabel: pageLabel, updatedAt: new Date() })
        .where(inArray(thermalReferenceRows.id, editableRowIds));
      thermalRowsUpdated = editableRowIds.length;
    }
  }

  return { chunksUpdated, blocksUpdated, thermalRowsUpdated, lockedThermalRows };
}

export interface InvalidatePageIndexOptions {
  /** 同时清空识别快照（换图场景必须为 true） */
  resetRecognition?: boolean;
  /** 换图场景：清空旧 parsedText（旧正文已不属于当前图片） */
  clearParsedText?: boolean;
  /** 只修正正文错字：保留 thermal_reference_rows（热工结构未变） */
  keepThermalRows?: boolean;
  reason?: string;
}

/**
 * 页面内容变化统一失效入口。
 * 清理派生索引 + 可选清空识别快照 + 版本索引置脏（contentRevision++）；返回统计与 lockedThermalRows 供调用方提示。
 */
export async function invalidatePageKnowledgeIndex(
  db: DbExecutor,
  pageId: string,
  options: InvalidatePageIndexOptions = {}
): Promise<PurgePageIndexResult & { pageId: string; versionId: string }> {
  const [page] = await db.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
  if (!page) throw new NotFoundError("页面不存在");

  const purged = await purgePageDerivedIndex(db, page, { keepThermalRows: options.keepThermalRows });

  if (options.resetRecognition || options.clearParsedText) {
    const meta = readPageRecognitionMeta(page.metadata);
    const nextMeta = {
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
    await db.update(knowledgePages).set({
      metadata: nextMeta,
      ...(options.clearParsedText ? { parsedText: null } : {})
    }).where(eq(knowledgePages.id, pageId));
  }

  await markVersionIndexDirty(db, page.versionId);
  return { ...purged, pageId, versionId: page.versionId };
}

// ---------------------------------------------------------------- 版本级正式索引重建

export interface RebuildIndexResult {
  versionId: string;
  pageCount: number;
  indexedPageCount: number;
  sectionCount: number;
  blockCount: number;
  chunkCount: number;
  /** 本次索引对应的 contentRevision（成功时等于当时的 contentRevision） */
  indexRevision: number;
  /** 重建开始时读取的 contentRevision */
  contentRevision: number;
  /** 是否成功写入 INDEX_READY（CAS 失败时为 false） */
  indexReady: boolean;
  /** true：重建期间页面内容已被并发修改，结果已丢弃，需重新重建 */
  stale: boolean;
}

/** rebuild 期间版本内容被并发修改（CAS 失败）时抛出的哨兵错误，用于回滚整个事务并降级为 INDEX_PENDING。 */
class VersionRevisionConflictError extends Error {
  constructor(public readonly versionId: string, public readonly startRevision: number) {
    super(`版本 ${versionId} 在索引重建期间内容已变更（startRevision=${startRevision}）`);
    this.name = "VersionRevisionConflictError";
  }
}

function assertVersionIndexRebuildable(version: { status: string }, options: { maintenance?: boolean } = {}): void {
  // 内部维护式重建（maintenance）允许 PUBLISHED：只重建派生索引，不改 PUBLISHED 正文/页面内容。
  if (options.maintenance) return;
  if (version.status !== "DRAFT" && version.status !== "APPROVED") {
    throw new AppError(
      "KNOWLEDGE_VERSION_NOT_REBUILDABLE",
      "仅草稿或已审核（未发布）版本可以重建正式索引",
      409
    );
  }
}

/**
 * 版本级正式索引重建（页面驱动主链的正式来源）。
 * 读取全部「正式可索引页面」→ 跨页统一解析 → 生成 sections / page_blocks / chunks（chunkIndex 全局连续）。
 *
 * 并发一致性（P0-1）：读取页面内容前记录 startRevision = contentRevision；最终写入 INDEX_READY 时使用
 * CAS（WHERE content_revision = startRevision）。若重建期间发生任何 Page Mutation（contentRevision 已变），
 * CAS 影响行数为 0 → 丢弃本次结果并置 INDEX_PENDING + indexDirty=true，绝不误标 INDEX_READY。
 *
 * 失败处理的 Revision Awareness（P0-1b）：catch 分支同样具备版本感知——若更新的重建已写入
 * INDEX_READY（clean 且 indexRevision === contentRevision），或本次重建所基于的 contentRevision 已过期，
 * 则旧重建的失败不得覆盖当前状态（仅记录 stale rebuild discarded）。
 *
 * options.maintenance：内部维护式重建（仅后台维护调用），允许对 PUBLISHED 版本重建派生索引。
 */
export async function rebuildPageDrivenVersionIndex(
  app: FastifyInstance,
  request: FastifyRequest | null,
  actor: AuthUser | null,
  versionId: string,
  options: { maintenance?: boolean } = {}
): Promise<RebuildIndexResult> {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  assertVersionIndexRebuildable(version, options);

  const startRevision = version.contentRevision ?? 0;
  const pages = await app.db.select().from(knowledgePages)
    .where(eq(knowledgePages.versionId, versionId))
    .orderBy(asc(knowledgePages.physicalPageNumber));
  if (pages.length === 0) {
    throw new AppError("KNOWLEDGE_VERSION_EMPTY", "当前版本还没有资料页面，无法重建索引", 400);
  }
  const pageDriven = pages.some((page) => {
    const meta = readPageRecognitionMeta(page.metadata);
    return page.pageImageObjectKey != null && meta.uploadSource != null;
  });
  if (!pageDriven) {
    throw new AppError(
      "KNOWLEDGE_INDEX_NOT_PAGE_DRIVEN",
      "当前版本不是页面驱动知识版本，正式索引由传统文件解析链维护",
      400
    );
  }

  await app.db.update(knowledgeDocumentVersions).set({
    indexStatus: "INDEXING",
    indexDirty: true,
    updatedAt: new Date()
  }).where(eq(knowledgeDocumentVersions.id, versionId));

  let indexedPageCount = 0;
  try {
    const aliases = await loadAliases(app.db);
    const scanState = createPageBlockScanState();
    const blocks: BlockDraft[] = [];
    for (const page of pages) {
      const text = resolveFormalPageText(page);
      if (!text) continue;
      indexedPageCount += 1;
      blocks.push(...parsePageToBlocks({ page: page.physicalPageNumber, text }, aliases, scanState));
    }

    const sectionDrafts = buildSectionDrafts(version.title, blocks);
    const pageIdByPhysical = new Map(pages.map((page) => [page.physicalPageNumber, page.id]));

    const result = await app.db.transaction(async (tx) => {
      await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId));
      await tx.delete(knowledgePageBlocks).where(eq(knowledgePageBlocks.versionId, versionId));
      await tx.delete(knowledgeSections).where(eq(knowledgeSections.versionId, versionId));

      const sectionIdByKey = new Map<string, string>();
      for (const draft of sectionDrafts) {
        sectionIdByKey.set(draft.sectionKey, stableUuid(versionId, "section", draft.sectionKey));
      }
      const rootSectionId = sectionIdByKey.get("root")!;
      for (const batch of toInsertBatches(sectionDrafts.map((draft) => {
        const parentKey = draft.sectionKey === "root"
          ? null
          : draft.sectionKey.split("/").slice(0, -1).join("/") || "root";
        return {
          id: sectionIdByKey.get(draft.sectionKey)!,
          documentId: version.documentId,
          versionId,
          parentId: parentKey ? sectionIdByKey.get(parentKey) ?? rootSectionId : null,
          sectionKey: draft.sectionKey,
          title: draft.title,
          level: draft.level,
          headingPath: draft.headingPath,
          sortOrder: draft.sortOrder,
          startPage: draft.startPage,
          endPage: draft.endPage,
          searchText: draft.searchText,
          sourceAnchor: null
        };
      }))) {
        await tx.insert(knowledgeSections).values(batch);
      }

      // 页内 block 序号 + 章节归属（同页多小节各归各；跨页章节由共享 scanState 延续）
      const blockIndexByPage = new Map<number, number>();
      const blockRows: Array<typeof knowledgePageBlocks.$inferInsert> = [];
      const chunkRows: Array<{ blockId: string; sectionId: string; chunk: ReturnType<typeof buildChunksFromBlocks>[number] }> = [];
      for (const block of blocks) {
        const targetPhysical = block.sourcePage;
        const pageId = targetPhysical != null ? pageIdByPhysical.get(targetPhysical) : undefined;
        if (!pageId) continue;
        const blockIndex = blockIndexByPage.get(targetPhysical!) ?? 0;
        blockIndexByPage.set(targetPhysical!, blockIndex + 1);
        const sectionKey = block.sectionDraftPath.join("/") || "root";
        const sectionId = sectionIdByKey.get(sectionKey) ?? rootSectionId;
        const blockId = stableUuid(versionId, "block", `${targetPhysical}:${blockIndex}`);
        blockRows.push({
          id: blockId,
          documentId: version.documentId,
          versionId,
          pageId,
          sectionId,
          blockIndex,
          content: block.content,
          contentType: block.contentType,
          searchText: block.searchText,
          sourceAnchor: block.sourceAnchor,
          metadata: block.metadata ?? null
        });
        for (const chunk of buildChunksFromBlocks([block])) {
          chunkRows.push({ blockId, sectionId, chunk });
        }
      }
      for (const batch of toInsertBatches(blockRows, PAGE_WRITE_BATCH_SIZE)) {
        await tx.insert(knowledgePageBlocks).values(batch);
      }

      const pageIdByBlockId = new Map(blockRows.map((row) => [row.id!, row.pageId]));

      let chunkIndex = 0;
      let inserted = 0;
      let buffer: Array<typeof knowledgeChunks.$inferInsert> = [];
      const flush = async () => {
        if (buffer.length === 0) return;
        const batch = buffer;
        buffer = [];
        for (const values of toInsertBatches(batch, CHUNK_WRITE_BATCH_SIZE)) {
          await tx.insert(knowledgeChunks).values(values);
        }
      };
      for (const { blockId, sectionId, chunk } of chunkRows) {
        const pageId = pageIdByBlockId.get(blockId)!;
        const page = pages.find((item) => item.id === pageId);
        const row: typeof knowledgeChunks.$inferInsert = {
          documentId: version.documentId,
          versionId,
          sectionId,
          pageBlockId: blockId,
          projectId: null,
          chunkIndex: chunkIndex++,
          content: chunk.content,
          sourcePage: chunk.sourcePage,
          pageEnd: chunk.pageEnd,
          sourceSection: chunk.sourceSection,
          headingLevel: chunk.headingLevel,
          contentType: chunk.contentType,
          searchText: chunk.searchText || normalizeSearchText(chunk.content),
          keywords: chunk.keywords,
          aliasTerms: chunk.aliasTerms,
          citationAnchor: chunk.citationAnchor,
          metadata: {
            ...(chunk.metadata ?? {}),
            pageId,
            physicalPageNumber: page?.physicalPageNumber ?? chunk.sourcePage,
            pageLabel: page?.pageLabel ?? null,
            documentId: version.documentId,
            versionId,
            pageAware: true
          }
        };
        buffer.push(row);
        inserted += 1;
        if (buffer.length >= CHUNK_WRITE_BATCH_SIZE) await flush();
      }
      await flush();

      // 页面首个内容块的章节归属（Wiki 阅读与来源详情使用）
      const firstSectionByPage = new Map<string, { sectionId: string; sectionPath: string | null }>();
      for (const block of blocks) {
        const pageId = block.sourcePage != null ? pageIdByPhysical.get(block.sourcePage) : undefined;
        if (!pageId || firstSectionByPage.has(pageId)) continue;
        const sectionKey = block.sectionDraftPath.join("/") || "root";
        firstSectionByPage.set(pageId, {
          sectionId: sectionIdByKey.get(sectionKey) ?? rootSectionId,
          sectionPath: block.sectionDraftPath.length > 0
            ? block.sectionDraftPath[block.sectionDraftPath.length - 1]!
            : null
        });
      }
      for (const page of pages) {
        const link = firstSectionByPage.get(page.id);
        await tx.update(knowledgePages).set({
          sectionId: link?.sectionId ?? rootSectionId,
          sectionPath: link?.sectionPath ?? null
        }).where(eq(knowledgePages.id, page.id));
      }

      // CAS：仅当 contentRevision 仍等于 startRevision 时才允许宣称 INDEX_READY。
      // indexRevision 记录「本次索引构建所基于的 contentRevision」，发布门禁要求二者相等。
      const casRows = await tx.update(knowledgeDocumentVersions).set({
        indexStatus: "INDEX_READY",
        indexDirty: false,
        indexBuiltAt: new Date(),
        indexRevision: startRevision,
        updatedAt: new Date()
      }).where(and(
        eq(knowledgeDocumentVersions.id, versionId),
        eq(knowledgeDocumentVersions.contentRevision, startRevision)
      )).returning({ id: knowledgeDocumentVersions.id });

      if (casRows.length === 0) {
        // 重建期间发生 Page Mutation：丢弃本次重建结果（事务回滚），降级为 INDEX_PENDING。
        throw new VersionRevisionConflictError(versionId, startRevision);
      }

      if (request && actor) {
        await writeAuditLog({
          db: tx, request, actor,
          action: "knowledge.version_index_rebuilt",
          targetType: "knowledge_document_version",
          targetId: versionId,
          afterJson: {
            pageCount: pages.length,
            indexedPageCount,
            sectionCount: sectionDrafts.length,
            blockCount: blockRows.length,
            chunkCount: inserted,
            indexRevision: startRevision,
            maintenance: Boolean(options.maintenance)
          }
        });
      }
      return {
        sectionCount: sectionDrafts.length,
        blockCount: blockRows.length,
        chunkCount: inserted,
        indexRevision: startRevision
      };
    });

    return {
      versionId,
      pageCount: pages.length,
      indexedPageCount,
      contentRevision: startRevision,
      indexReady: true,
      stale: false,
      ...result
    };
  } catch (error) {
    // Revision Awareness（P0）：失败处理也必须具备版本感知，禁止无条件改写版本索引状态。
    // 真实竞态：Rebuild A（startRevision=10）→ 期间 Mutation（contentRevision=11）→ Rebuild B（startRevision=11）
    // 很快成功写入 INDEX_READY/clean/indexRevision=11 → 旧 Rebuild A 才结束并失败。
    // 若 A 的 catch 无条件降级，会把 B 刚写好的正确 READY 状态错误改回 INDEX_PENDING + dirty。
    const [latestVersion] = await app.db.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
    const indexFresh = latestVersion != null
      && latestVersion.indexStatus === "INDEX_READY"
      && latestVersion.indexDirty === false
      && (latestVersion.indexRevision ?? 0) === (latestVersion.contentRevision ?? 0);
    const contentAdvanced = latestVersion != null && (latestVersion.contentRevision ?? 0) !== startRevision;

    if (error instanceof VersionRevisionConflictError) {
      if (indexFresh) {
        // 更新的重建已就绪：旧重建的失败不得覆盖，只记录 stale rebuild discarded。
        app.log.warn({
          versionId,
          startRevision,
          contentRevision: latestVersion?.contentRevision ?? null,
          indexRevision: latestVersion?.indexRevision ?? null
        }, "检测到更新的索引重建已就绪，丢弃过期重建（stale rebuild discarded）");
        return {
          versionId,
          pageCount: pages.length,
          indexedPageCount,
          sectionCount: 0,
          blockCount: 0,
          chunkCount: 0,
          indexRevision: latestVersion?.indexRevision ?? 0,
          contentRevision: startRevision,
          indexReady: false,
          stale: true
        };
      }
      // 并发 Mutation：不得宣称 Ready，保留 INDEX_PENDING + indexDirty，等待重新 rebuild。
      await app.db.update(knowledgeDocumentVersions).set({
        indexStatus: "INDEX_PENDING",
        indexDirty: true,
        updatedAt: new Date()
      }).where(eq(knowledgeDocumentVersions.id, versionId));
      return {
        versionId,
        pageCount: pages.length,
        indexedPageCount,
        sectionCount: 0,
        blockCount: 0,
        chunkCount: 0,
        indexRevision: latestVersion?.indexRevision ?? version.indexRevision ?? 0,
        contentRevision: startRevision,
        indexReady: false,
        stale: true
      };
    }
    // 非并发冲突的失败：仅当「本次重建所基于的内容版本仍是当前版本」且「当前索引未就绪」时才写 INDEX_FAILED，
    // 否则同样视为过期失败（已有更新的重建在进行或已完成），不得覆盖当前状态。
    if (indexFresh || contentAdvanced) {
      app.log.warn({
        versionId,
        startRevision,
        contentRevision: latestVersion?.contentRevision ?? null,
        indexStatus: latestVersion?.indexStatus ?? null
      }, "索引重建失败但版本内容或索引已更新，跳过过期 INDEX_FAILED 写入");
      throw error;
    }
    await app.db.update(knowledgeDocumentVersions).set({
      indexStatus: "INDEX_FAILED",
      indexDirty: true,
      updatedAt: new Date()
    }).where(eq(knowledgeDocumentVersions.id, versionId));
    throw error;
  }
}

/**
 * 内部维护式重建（P1-7 恢复通道）。
 * 允许对 PUBLISHED / DISABLED 版本重建「派生索引」（sections / page_blocks / chunks / page.sectionId），
 * 但绝不修改 PUBLISHED 正文与页面内容字段（parsedText / pageImageObjectKey / 识别快照）——
 * 「允许内部维护式重建索引」≠「允许修改 PUBLISHED 正文/页面」。
 *
 * 仅后台维护调用（B_ADMIN + system:knowledge:doc:parse），不开放普通编辑入口。
 */
export async function maintenanceRebuildPublishedVersionIndex(
  app: FastifyInstance,
  request: FastifyRequest | null,
  actor: AuthUser | null,
  versionId: string
): Promise<RebuildIndexResult> {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  if (version.status !== "PUBLISHED" && version.status !== "DISABLED") {
    throw new AppError(
      "KNOWLEDGE_VERSION_NOT_MAINTENANCE_REBUILDABLE",
      "内部维护式重建仅用于已发布/已停用版本；草稿或已审核版本请使用常规索引重建",
      409
    );
  }
  return rebuildPageDrivenVersionIndex(app, request, actor, versionId, { maintenance: true });
}

// ---------------------------------------------------------------- 发布前完整性校验
export interface KnowledgeIntegrityIssue {
  code: string;
  message: string;
  /** 涉及的页面/对象（B 端可直接展示） */
  details?: Record<string, unknown>;
}

export interface KnowledgeIntegrityResult {
  ok: boolean;
  pageDriven: boolean;
  indexReady: boolean;
  issues: KnowledgeIntegrityIssue[];
  stats: {
    pageCount: number;
    chunkCount: number;
    blockCount: number;
    sectionCount: number;
    orphanChunkCount: number;
    orphanBlockCount: number;
    /** 真正 orphan：sourcePageId 指向的 knowledge_pages.id 在数据库中已不存在 */
    orphanThermalRowCount: number;
    /** 本版本页面作为来源的热工参考行数（跨版本行不计入，也不判 orphan） */
    versionThermalRowCount: number;
    indexStatus: string | null;
    indexDirty: boolean;
    indexRevision: number;
    contentRevision: number;
  };
}

/**
 * 页面驱动版本发布前完整性校验（可读中文原因，不用笼统错误码）。
 * 仅对页面驱动版本强校验 indexReady；传统文件链返回 applicable=false 由既有 readiness 负责。
 */
export async function validatePageDrivenKnowledgeIntegrity(
  app: FastifyInstance,
  versionId: string
): Promise<KnowledgeIntegrityResult> {
  const [version] = await app.db.select().from(knowledgeDocumentVersions)
    .where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");

  const [pages, [chunkRow], [blockRow], [sectionRow]] = await Promise.all([
    app.db.select().from(knowledgePages).where(eq(knowledgePages.versionId, versionId))
      .orderBy(asc(knowledgePages.physicalPageNumber)),
    app.db.select({ value: count() }).from(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId)),
    app.db.select({ value: count() }).from(knowledgePageBlocks).where(eq(knowledgePageBlocks.versionId, versionId)),
    app.db.select({ value: count() }).from(knowledgeSections).where(eq(knowledgeSections.versionId, versionId))
  ]);
  const chunkCount = Number(chunkRow?.value ?? 0);
  const blockCount = Number(blockRow?.value ?? 0);
  const sectionCount = Number(sectionRow?.value ?? 0);

  const pageDriven = pages.some((page) => {
    const meta = readPageRecognitionMeta(page.metadata);
    return page.pageImageObjectKey != null && meta.uploadSource != null;
  });

  const issues: KnowledgeIntegrityIssue[] = [];
  const pushIssue = (code: string, message: string, details?: Record<string, unknown>) => {
    issues.push({ code, message, ...(details ? { details } : {}) });
  };

  if (pages.length === 0) {
    pushIssue("NO_PAGES", "当前版本还没有资料页面，请先上传完整页面图片");
  }

  // 页码重复（physicalPageNumber 唯一约束外的防御性检查）
  const seenPhysical = new Set<number>();
  const duplicatePhysical: number[] = [];
  for (const page of pages) {
    if (seenPhysical.has(page.physicalPageNumber)) duplicatePhysical.push(page.physicalPageNumber);
    seenPhysical.add(page.physicalPageNumber);
  }
  if (duplicatePhysical.length > 0) {
    pushIssue("DUPLICATE_PHYSICAL_PAGE", `存在重复物理页序号：${duplicatePhysical.join(", ")}`, { duplicatePhysical });
  }

  // 页面驱动：缺图 / 未确认
  const missingImagePages: number[] = [];
  const unconfirmedPages: number[] = [];
  for (const page of pages) {
    const meta = readPageRecognitionMeta(page.metadata);
    const requires = pageRequiresRecognition({
      pageImageObjectKey: page.pageImageObjectKey,
      uploadSource: meta.uploadSource ?? null,
      recognitionStatus: meta.recognitionStatus ?? null,
      recognitionRunId: meta.recognitionRunId ?? null,
      hasText: (page.parsedText ?? "").length > 0
    });
    if (requires && !page.pageImageObjectKey) missingImagePages.push(page.physicalPageNumber);
    if (requires && meta.recognitionStatus !== "CONFIRMED") unconfirmedPages.push(page.physicalPageNumber);
  }
  if (missingImagePages.length > 0) {
    pushIssue("PAGE_IMAGE_MISSING", `第 ${missingImagePages.join("、")} 页缺少原页图片`, { pages: missingImagePages });
  }
  if (unconfirmedPages.length > 0) {
    pushIssue("PAGE_UNCONFIRMED", `第 ${unconfirmedPages.join("、")} 页识别尚未确认`, { pages: unconfirmedPages });
  }

  // 索引就绪（仅页面驱动强校验；版本行未携带索引状态时视为兼容放行）
  const indexStatusKnown = version.indexStatus != null;
  const contentRevision = version.contentRevision ?? 0;
  const indexRevision = version.indexRevision ?? 0;
  const revisionAligned = indexRevision === contentRevision;
  const indexReady = !indexStatusKnown
    || (version.indexStatus === "INDEX_READY" && !version.indexDirty && revisionAligned);
  if (pageDriven && indexStatusKnown && !indexReady) {
    pushIssue(
      version.indexStatus === "INDEX_FAILED" ? "INDEX_FAILED" : "INDEX_NOT_READY",
      version.indexStatus === "INDEX_FAILED"
        ? "版本正式索引重建失败，请重新重建后再发布"
        : "版本正式索引尚未完成（或页面变更后未重建），请先执行版本索引重建",
      { indexStatus: version.indexStatus, indexDirty: version.indexDirty }
    );
  }
  // 索引内容版本必须与当前正式页面内容版本严格一致（Publish Gate 要求 indexRevision === contentRevision）
  if (pageDriven && indexStatusKnown && version.indexStatus === "INDEX_READY" && !version.indexDirty && !revisionAligned) {
    pushIssue(
      "INDEX_REVISION_MISMATCH",
      `版本正式索引内容版本不一致（indexRevision=${indexRevision}，contentRevision=${contentRevision}），请重新重建版本索引`,
      { indexRevision, contentRevision }
    );
  }
  // 版本 pageCount 与真实页面行数一致（防御性检查）
  if (version.pageCount != null && version.pageCount !== pages.length) {
    pushIssue("PAGE_COUNT_MISMATCH", `版本记录页数（${version.pageCount}）与实际页面数（${pages.length}）不一致，请重新同步页面`, {
      recorded: version.pageCount,
      actual: pages.length
    });
  }

  // 孤儿 chunk：page-aware chunk 的 metadata.pageId 必须指向存在的页面
  const pageIds = new Set(pages.map((page) => page.id));
  const chunkRows = await app.db.select({
    id: knowledgeChunks.id,
    pageId: sql<string | null>`${knowledgeChunks.metadata}->>'pageId'`,
    pageAware: sql<string | null>`${knowledgeChunks.metadata}->>'pageAware'`
  }).from(knowledgeChunks).where(eq(knowledgeChunks.versionId, versionId));
  const pageAwareChunks = chunkRows.filter((row) => row.pageAware === "true");
  const orphanChunks = pageAwareChunks.filter((row) => !row.pageId || !pageIds.has(row.pageId));
  if (orphanChunks.length > 0) {
    pushIssue("ORPHAN_CHUNK", `检测到 ${orphanChunks.length} 条孤立 Chunk（来源页面已不存在）`, {
      count: orphanChunks.length,
      chunkIds: orphanChunks.slice(0, 20).map((row) => row.id)
    });
  }

  // 孤儿 page_block（FK 已保证，防御性统计）
  const blockRowsForIntegrity = await app.db.select({ id: knowledgePageBlocks.id, pageId: knowledgePageBlocks.pageId })
    .from(knowledgePageBlocks).where(eq(knowledgePageBlocks.versionId, versionId));
  const orphanBlocks = blockRowsForIntegrity.filter((row) => !row.pageId || !pageIds.has(row.pageId));
  if (orphanBlocks.length > 0) {
    pushIssue("ORPHAN_BLOCK", `检测到 ${orphanBlocks.length} 条孤立内容块（来源页面已不存在）`, { count: orphanBlocks.length });
  }

  // 热工参考行（P0-2 修正）：
  // 真正 orphan 的唯一判定是「sourcePageId 指向的 knowledge_pages.id 在数据库中不存在」。
  // 绝不能定义成「不属于当前 Version」——Document A 的 V1 页已发布并留有 thermal row，
  // 验证 V2 时 V1-P22 当然不属于 V2，但它并不是 orphan。
  const thermalRows = await app.db.select({ id: thermalReferenceRows.id, sourcePageId: thermalReferenceRows.sourcePageId })
    .from(thermalReferenceRows).where(eq(thermalReferenceRows.sourceDocumentId, version.documentId));
  const referencedPageIds = [...new Set(
    thermalRows.map((row) => row.sourcePageId).filter((id): id is string => id != null)
  )];
  const existingReferencedPages = referencedPageIds.length > 0
    ? await app.db.select({ id: knowledgePages.id }).from(knowledgePages)
      .where(inArray(knowledgePages.id, referencedPageIds))
    : [];
  const existingReferencedPageIds = new Set(existingReferencedPages.map((row) => row.id));
  const orphanThermal = thermalRows.filter((row) => row.sourcePageId != null && !existingReferencedPageIds.has(row.sourcePageId));
  if (orphanThermal.length > 0) {
    pushIssue("ORPHAN_THERMAL_ROW", `检测到 ${orphanThermal.length} 条孤立热工参考行（来源页面已从数据库删除）`, {
      count: orphanThermal.length,
      rowIds: orphanThermal.slice(0, 20).map((row) => row.id)
    });
  }
  // Version 级热工完整性：只统计「来源页面属于当前版本」的行（跨版本行不参与本版本判定）。
  const versionThermalRowCount = thermalRows.filter((row) => row.sourcePageId != null && pageIds.has(row.sourcePageId)).length;

  // AI_ENABLED：必须有可检索内容
  if (version.usageMode === "AI_ENABLED" && pageDriven && chunkCount === 0) {
    pushIssue("SEARCHABLE_CONTENT_REQUIRED", "版本没有可被 AI 检索的内容（chunks = 0），请先重建版本索引");
  }

  return {
    ok: issues.length === 0,
    pageDriven,
    indexReady,
    issues,
    stats: {
      pageCount: pages.length,
      chunkCount,
      blockCount,
      sectionCount,
      orphanChunkCount: orphanChunks.length,
      orphanBlockCount: orphanBlocks.length,
      orphanThermalRowCount: orphanThermal.length,
      versionThermalRowCount,
      indexStatus: version.indexStatus ?? null,
      indexDirty: version.indexDirty ?? true,
      indexRevision,
      contentRevision
    }
  };
}

/** 版本索引状态 + 完整性校验（B 端「版本索引」面板使用）。 */
export async function getVersionIndexStatus(app: FastifyInstance, versionId: string) {
  const [version] = await app.db.select({
    indexStatus: knowledgeDocumentVersions.indexStatus,
    indexDirty: knowledgeDocumentVersions.indexDirty,
    indexBuiltAt: knowledgeDocumentVersions.indexBuiltAt,
    indexRevision: knowledgeDocumentVersions.indexRevision,
    contentRevision: knowledgeDocumentVersions.contentRevision
  }).from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  const integrity = await validatePageDrivenKnowledgeIntegrity(app, versionId);
  return { versionId, ...version, integrity };
}

// ---------------------------------------------------------------- 识别任务对账（stale 恢复）
export interface ReconcileRecognitionResult {
  scanned: number;
  recovered: number;
  stillPending: number;
  details: Array<{ pageId: string; physicalPageNumber: number; status: string; action: string }>;
}

/**
 * 识别任务对账：PENDING/PROCESSING 超过阈值且队列中不存在对应任务时，恢复为可重新入队状态。
 * 避免「PENDING 但无 Job 且无法重新入队」的永久卡死。
 */
export async function reconcilePageRecognitionJobs(
  app: FastifyInstance,
  versionId?: string
): Promise<ReconcileRecognitionResult> {
  const thresholdMs = env.PAGE_RECOGNITION_STALE_MINUTES * 60 * 1000;
  const cutoff = new Date(Date.now() - thresholdMs);
  const rows = await app.db.select().from(knowledgePages)
    .where(versionId
      ? and(
        eq(knowledgePages.versionId, versionId),
        sql`${knowledgePages.metadata}->>'recognitionStatus' in ('PENDING','PROCESSING')`,
        sql`${knowledgePages.metadata}->>'recognitionRunId' is not null`
      )
      : and(
        sql`${knowledgePages.metadata}->>'recognitionStatus' in ('PENDING','PROCESSING')`,
        sql`${knowledgePages.metadata}->>'recognitionRunId' is not null`
      ));

  const result: ReconcileRecognitionResult = { scanned: 0, recovered: 0, stillPending: 0, details: [] };
  for (const page of rows) {
    const meta = readPageRecognitionMeta(page.metadata);
    const queuedAt = meta.recognitionQueuedAt ? new Date(meta.recognitionQueuedAt) : null;
    // 未记录入队时间时以页面创建时间兜底（老数据）
    const reference = queuedAt && !Number.isNaN(queuedAt.getTime()) ? queuedAt : page.createdAt;
    if (reference > cutoff) continue;
    result.scanned += 1;

    let jobActive = false;
    try {
      const job = await app.queues.pageRecognition.getJob(`page-recog-${page.id}`);
      if (job) {
        const state = await job.getState();
        jobActive = state === "waiting" || state === "active" || state === "delayed" || state === "waiting-children";
      }
    } catch {
      jobActive = true; // 队列查询失败时不误判为 stale，保守跳过
    }
    if (jobActive) {
      result.stillPending += 1;
      result.details.push({
        pageId: page.id,
        physicalPageNumber: page.physicalPageNumber,
        status: meta.recognitionStatus ?? "PENDING",
        action: "KEEP"
      });
      continue;
    }

    await app.db.update(knowledgePages).set({
      metadata: {
        ...(page.metadata ?? {}),
        ...meta,
        recognitionStatus: "PENDING",
        recognitionRunId: null,
        recognitionQueuedAt: null,
        lastRecognitionError: "识别任务丢失或已终止，已恢复为可重新入队状态"
      }
    }).where(eq(knowledgePages.id, page.id));
    result.recovered += 1;
    result.details.push({
      pageId: page.id,
      physicalPageNumber: page.physicalPageNumber,
      status: meta.recognitionStatus ?? "PENDING",
      action: "RECOVERED"
    });
  }
  return result;
}
