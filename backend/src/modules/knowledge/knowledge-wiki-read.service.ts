import { and, asc, count, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import { env } from "../../config/env.js";
import type { FastifyInstance } from "fastify";
import {
  files,
  knowledgeChunks,
  knowledgeDocumentAssets,
  knowledgeDocuments,
  knowledgeDocumentVersions,
  knowledgePageMappings,
  knowledgePageBlocks,
  knowledgePages,
  knowledgeSections,
  knowledgeTocItems,
  projects
} from "../../db/schema.js";
import type { AuthUser } from "../../shared/auth-user.js";
import { canViewProject } from "../../shared/permissions.js";
import { ForbiddenError, NotFoundError } from "../../shared/errors.js";

/**
 * Wiki 原文阅读统一读取服务（C 端公开文库与 AI 来源详情共用，不写第二套逻辑）。
 * - 只返回 PUBLISHED + 生效中的版本（DRAFT/PENDING_REVIEW/APPROVED/DISABLED 一律不可读）；
 * - Document → Section(章节树) → Page(完整页) → Page Block(标题/段落/表格块) 为阅读层；
 * - 来源定位支持 sectionId/pageId/blockId/chunkId 任一入口，最终都回到"文档 + 章节路径 + 页 + 块 + 高亮"。
 */

export interface WikiDocumentSummary {
  id: string;
  title: string;
  versionId: string;
  version: number;
  docNumber: string | null;
  docType: string;
  visibility: string;
  projectId: string | null;
}

export interface WikiSectionNode {
  id: string;
  parentId: string | null;
  title: string;
  level: number;
  sectionPath: string[];
  startPage: number | null;
  endPage: number | null;
  sortOrder: number;
}

export interface WikiPageBlockDto {
  id: string;
  blockIndex: number;
  content: string;
  contentType: string;
  sourceAnchor: string | null;
  metadata: Record<string, unknown> | null;
}

export interface WikiPageListItem {
  id: string;
  pageNumber: number;
  physicalPageNumber: number;
  pageLabel: string | null;
  pageLabelSource: string;
  pageLabelConfidence: number | null;
  pageLabelVerified: boolean;
  pageTitle: string | null;
  hasTables: boolean;
  hasImages: boolean;
  sectionPath: string | null;
}

export interface WikiPageWindow {
  current: number;
  total: number;
  page: WikiPageDto;
  items: WikiPageListItem[];
}

export interface WikiPageDto {
  id: string;
  /** 兼容过渡字段：等价 physicalPageNumber（一期页码） */
  pageNumber: number;
  /** PDF 物理页序号（程序定位用） */
  physicalPageNumber: number;
  /** 用户看到的印刷页码标签（4 / 21 / A1 / A5 / D16 / G10；非整数，禁止 Number()） */
  pageLabel: string | null;
  pageLabelSource: string;
  pageLabelConfidence: number | null;
  pageLabelVerified: boolean;
  pageTitle: string | null;
  /** 机器提取文本（不代表原 PDF 排版；原文以 ORIGINAL PDF 页面/预览图为准） */
  /** @deprecated 请使用 extractedText；该字段仅为现有客户端兼容保留 */
  fullText: string;
  extractedText: string;
  blocks: WikiPageBlockDto[];
  /** 原文页面预览图（ORIGINAL PDF 逐页渲染；未渲染为 null） */
  pageImageUrl: string | null;
}

export interface SourceHighlight {
  pageId: string;
  pageNumber: number;
  blockId: string | null;
  text: string;
  charStart: number | null;
  charEnd: number | null;
}

export interface SourceDetailLocation {
  sectionId: string | null;
  chapter: string | null;
  section: string | null;
  sectionPath: string[] | null;
  citationAnchor: string | null;
  /** 兼容过渡字段：等价 physicalPageNumber */
  pageNumber: number | null;
  /** PDF 物理页序号（程序打开页面用） */
  physicalPageNumber: number | null;
  /** 印刷页码标签（AI 引用/展示用：4 / 21 / A1 / A5 / D16 / G10） */
  pageLabel: string | null;
  pageTitle: string | null;
}

export interface SourceDetail {
  document: WikiDocumentSummary;
  /** 命中内容对应的原文目录路径（TOC = 原文件目录；无关联时回退语义章节路径） */
  toc: { path: string[] | null };
  location: SourceDetailLocation;
  /** 原文定位：ORIGINAL 资产与页面预览（用户看到的"原文"= 正式原 PDF 页面，而非 parsedText） */
  original: {
    fileId: string | null;
    pageImageUrl: string | null;
    /** 原文件受控下载地址（预签名，短时效） */
    previewUrl: string | null;
  };
  /** 机器提取内容（检索/溯源用，非原文排版） */
  extracted: {
    text: string | null;
    blocks: WikiPageBlockDto[];
  };
  page: WikiPageDto | null;
  highlights: SourceHighlight[];
}

/** 来源定位入参：documentId + 任一层级单位（section/page/block/chunk） */
export interface SourceLocatorInput {
  documentId?: string | null;
  sectionId?: string | null;
  pageId?: string | null;
  blockId?: string | null;
  chunkId?: string | null;
  /** 兜底高亮文本（AI 实际命中的原文片段） */
  matchedText?: string | null;
}

interface ResolvedContext {
  document: typeof knowledgeDocuments.$inferSelect;
  version: typeof knowledgeDocumentVersions.$inferSelect;
}

/** 当天零点（生效期判断用） */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 版本是否可读：PUBLISHED 且未过失效日（C 端/来源详情共用口径） */
export function isVersionReadable(version: Pick<typeof knowledgeDocumentVersions.$inferSelect, "status" | "expiryDate">): boolean {
  if (version.status !== "PUBLISHED") return false;
  if (version.expiryDate && new Date(version.expiryDate) < startOfToday()) return false;
  return true;
}

/**
 * 项目权限守卫：平台文档对登录用户开放；项目内文档按项目可见性校验（私有项目越权返回 404 语义）。
 */
export function assertReadableKnowledgeDocument(
  document: Pick<typeof knowledgeDocuments.$inferSelect, "projectId">,
  actor: AuthUser,
  project: Pick<typeof projects.$inferSelect, "createdById" | "visibility"> | null
): void {
  if (!document.projectId) return;
  if (!project || !canViewProject(actor, project)) {
    throw new NotFoundError("知识资料不存在");
  }
}

/** 解析文档当前受控且可读版本：公开读取始终只使用 currentVersionId，不回退旧版。 */
async function resolveReadableVersion(
  app: FastifyInstance,
  documentId: string
): Promise<ResolvedContext> {
  const [document] = await app.db.select().from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), isNull(knowledgeDocuments.deletedAt), eq(knowledgeDocuments.status, "ACTIVE")))
    .limit(1);
  if (!document) throw new NotFoundError("知识资料不存在");

  const [version] = document.currentVersionId
    ? await app.db.select().from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.id, document.currentVersionId)).limit(1)
    : [];
  if (!version || !isVersionReadable(version)) throw new NotFoundError("知识资料不存在或尚未发布");
  return { document, version };
}

/** 校验文档归属版本一致且可读（来源定位必须锚定已发布版本） */
async function resolveReadableVersionForDocument(
  app: FastifyInstance,
  documentId: string,
  versionId: string
): Promise<ResolvedContext> {
  const context = await resolveReadableVersion(app, documentId);
  if (context.version.id !== versionId) throw new NotFoundError("知识资料版本不存在或尚未发布");
  return context;
}

function toDocumentSummary(context: ResolvedContext): WikiDocumentSummary {
  return {
    id: context.document.id,
    title: context.document.title,
    versionId: context.version.id,
    version: context.version.version,
    docNumber: context.document.docNumber,
    docType: context.document.docType,
    visibility: context.document.visibility,
    projectId: context.document.projectId
  };
}

/** 章节 + 祖先标题路径查询（sectionPath 不含文档标题，与 headingPath 区分） */
function toSectionPath(
  section: Pick<typeof knowledgeSections.$inferSelect, "headingPath" | "title">,
  docTitle: string
): string[] {
  const heading = section.headingPath ?? [];
  const withoutDoc = heading.length > 1 && heading[0] === docTitle ? heading.slice(1) : heading;
  return withoutDoc.length > 0 ? withoutDoc : [section.title];
}

async function getSection(app: FastifyInstance, sectionId: string) {
  const [section] = await app.db.select().from(knowledgeSections).where(eq(knowledgeSections.id, sectionId)).limit(1);
  return section ?? null;
}

async function getPage(app: FastifyInstance, pageId: string) {
  const [page] = await app.db.select().from(knowledgePages).where(eq(knowledgePages.id, pageId)).limit(1);
  return page ?? null;
}

async function getBlocksOfPage(app: FastifyInstance, pageId: string): Promise<WikiPageBlockDto[]> {
  const rows = await app.db.select({
    id: knowledgePageBlocks.id,
    blockIndex: knowledgePageBlocks.blockIndex,
    content: knowledgePageBlocks.content,
    contentType: knowledgePageBlocks.contentType,
    sourceAnchor: knowledgePageBlocks.sourceAnchor,
    metadata: knowledgePageBlocks.metadata
  })
    .from(knowledgePageBlocks)
    .where(eq(knowledgePageBlocks.pageId, pageId))
    .orderBy(asc(knowledgePageBlocks.blockIndex));
  return rows;
}

async function toPageDto(app: FastifyInstance, page: typeof knowledgePages.$inferSelect, blocks: WikiPageBlockDto[]): Promise<WikiPageDto> {
  const text = page.parsedText ?? "";
  let pageImageUrl: string | null = null;
  if (page.pageImageObjectKey) {
    try {
      pageImageUrl = await app.storage.createDownloadUrl(page.pageImageObjectKey, `page-${page.physicalPageNumber}.${page.pageImageObjectKey.endsWith(".webp") ? "webp" : "png"}`, 3600);
    } catch {
      pageImageUrl = null;
    }
  }
  return {
    id: page.id,
    pageNumber: page.pageNumber,
    physicalPageNumber: page.physicalPageNumber ?? page.pageNumber,
    pageLabel: page.pageLabel,
    pageLabelSource: page.pageLabelSource,
    pageLabelConfidence: page.pageLabelConfidence,
    pageLabelVerified: page.pageLabelVerified,
    pageTitle: page.pageTitle,
    fullText: text,
    extractedText: text,
    blocks,
    pageImageUrl
  };
}

/** 页面行 → DTO 的同步形态（列表场景，不返回正文与 Blocks） */
function toPageListItem(page: typeof knowledgePages.$inferSelect): WikiPageListItem {
  return {
    id: page.id,
    pageNumber: page.pageNumber,
    physicalPageNumber: page.physicalPageNumber ?? page.pageNumber,
    pageLabel: page.pageLabel,
    pageLabelSource: page.pageLabelSource,
    pageLabelConfidence: page.pageLabelConfidence,
    pageLabelVerified: page.pageLabelVerified,
    pageTitle: page.pageTitle,
    hasTables: page.hasTables,
    hasImages: page.hasImages,
    sectionPath: page.sectionPath
  };
}

/**
 * 高亮定位：优先 block 文本在页全文中定位（块内容来自页面原文逐行提取，可直接命中），
 * 其次 matchedText 全文匹配兜底；找不到偏移时仍返回文本，不编造坐标。
 */
export function locateHighlight(fullText: string, text: string): { charStart: number | null; charEnd: number | null } {
  if (!text) return { charStart: null, charEnd: null };
  const direct = fullText.indexOf(text);
  if (direct >= 0) return { charStart: direct, charEnd: direct + text.length };
  const normalizedFull = fullText.replace(/\s+/g, "");
  const normalizedText = text.replace(/\s+/g, "");
  if (normalizedText && normalizedFull.includes(normalizedText)) {
    // 归一化命中时不映射原始偏移（空白差异会导致坐标漂移），只返回文本
    return { charStart: null, charEnd: null };
  }
  return { charStart: null, charEnd: null };
}

async function buildHighlight(app: FastifyInstance, page: typeof knowledgePages.$inferSelect, blockId: string | null, matchedText: string | null): Promise<SourceHighlight[]> {
  let text = matchedText ?? null;
  if (blockId) {
    const [block] = await app.db.select({ content: knowledgePageBlocks.content })
      .from(knowledgePageBlocks).where(eq(knowledgePageBlocks.id, blockId)).limit(1);
    if (block) text = block.content;
  }
  if (!text) return [];
  const { charStart, charEnd } = locateHighlight(page.parsedText ?? "", text);
  return [{
    pageId: page.id,
    pageNumber: page.pageNumber,
    blockId: blockId ?? null,
    text,
    charStart,
    charEnd
  }];
}

/** 来源定位主入口：任一层级单位（section/page/block/chunk）→ 文档 + 章节路径 + 页 + 高亮 */
export async function resolveSourceDetail(
  app: FastifyInstance,
  actor: AuthUser,
  input: SourceLocatorInput
): Promise<SourceDetail> {
  if (!input.documentId && !input.sectionId && !input.pageId && !input.blockId && !input.chunkId) {
    throw new NotFoundError("缺少来源定位信息");
  }

  let context: ResolvedContext;
  let section: typeof knowledgeSections.$inferSelect | null = null;
  let page: typeof knowledgePages.$inferSelect | null = null;
  let blockId: string | null = null;
  let citationAnchor: string | null = null;
  let hasUnmappedSearchPage = false;

  if (input.chunkId) {
    const [chunk] = await app.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.id, input.chunkId)).limit(1);
    if (!chunk) throw new NotFoundError("来源切片不存在");
    context = await resolveReadableVersionForDocument(app, chunk.documentId, chunk.versionId);
    if (chunk.sectionId) section = await getSection(app, chunk.sectionId);
    if (chunk.pageBlockId) blockId = chunk.pageBlockId;
    if (!page && chunk.sourcePage != null) {
      const searchPageNumber = typeof chunk.metadata?.searchPageNumber === "number"
        ? chunk.metadata.searchPageNumber
        : null;
      if (searchPageNumber != null) {
        // 双源 Chunk 的 sourcePage 不能直接当 ORIGINAL 页；必须经显式映射回溯。
        page = await app.db.select({ page: knowledgePages })
          .from(knowledgePageMappings)
          .innerJoin(knowledgePages, eq(knowledgePages.id, knowledgePageMappings.originalPageId))
          .where(and(
            eq(knowledgePageMappings.versionId, chunk.versionId),
            eq(knowledgePageMappings.searchPhysicalPageNumber, searchPageNumber),
            sql`(${knowledgePageMappings.verified} = true or ${knowledgePageMappings.confidence} >= ${env.KNOWLEDGE_MAPPING_MIN_AI_CONFIDENCE})`
          )).limit(1).then((rows) => rows[0]?.page ?? null);
        hasUnmappedSearchPage = page == null;
      } else {
        page = await app.db.select().from(knowledgePages)
          .where(and(eq(knowledgePages.versionId, chunk.versionId), eq(knowledgePages.physicalPageNumber, chunk.sourcePage)))
          .limit(1).then((rows) => rows[0] ?? null);
        if (!page) {
          page = await app.db.select().from(knowledgePages)
            .where(and(eq(knowledgePages.versionId, chunk.versionId), eq(knowledgePages.pageNumber, chunk.sourcePage)))
            .limit(1).then((rows) => rows[0] ?? null);
        }
      }
    }
    citationAnchor = chunk.citationAnchor;
  } else if (input.blockId) {
    const [block] = await app.db.select().from(knowledgePageBlocks).where(eq(knowledgePageBlocks.id, input.blockId)).limit(1);
    if (!block) throw new NotFoundError("来源内容块不存在");
    context = await resolveReadableVersionForDocument(app, block.documentId, block.versionId);
    blockId = block.id;
    if (block.sectionId) section = await getSection(app, block.sectionId);
    page = await getPage(app, block.pageId);
    citationAnchor = block.sourceAnchor;
  } else if (input.pageId) {
    page = await getPage(app, input.pageId);
    if (!page) throw new NotFoundError("来源页面不存在");
    context = await resolveReadableVersionForDocument(app, page.documentId, page.versionId);
    if (page.sectionId) section = await getSection(app, page.sectionId);
  } else if (input.sectionId) {
    section = await getSection(app, input.sectionId);
    if (!section) throw new NotFoundError("来源章节不存在");
    context = await resolveReadableVersionForDocument(app, section.documentId, section.versionId);
  } else {
    context = await resolveReadableVersion(app, input.documentId!);
  }

  // 项目内文档执行项目可见性守卫
  if (context.document.projectId) {
    const [project] = await app.db.select({ createdById: projects.createdById, visibility: projects.visibility })
      .from(projects).where(eq(projects.id, context.document.projectId)).limit(1);
    assertReadableKnowledgeDocument(context.document, actor, project ?? null);
  }

  // 兜底：section 来源取章节起始页（优先物理页定位）；无页时取版本首页
  if (!page && !hasUnmappedSearchPage) {
    const physical = section?.startPage ?? 0;
    page = await app.db.select().from(knowledgePages)
      .where(and(eq(knowledgePages.versionId, context.version.id), eq(knowledgePages.physicalPageNumber, physical)))
      .limit(1).then((rows) => rows[0] ?? null);
    if (!page) {
      page = await app.db.select().from(knowledgePages)
        .where(and(eq(knowledgePages.versionId, context.version.id), eq(knowledgePages.pageNumber, physical)))
        .limit(1).then((rows) => rows[0] ?? null);
    }
    if (!page) {
      page = await app.db.select().from(knowledgePages)
        .where(eq(knowledgePages.versionId, context.version.id))
        .orderBy(asc(knowledgePages.pageNumber)).limit(1).then((rows) => rows[0] ?? null);
    }
  }

  const docTitle = context.document.title;
  const sectionPath = section ? toSectionPath(section, docTitle) : null;
  const location: SourceDetailLocation = {
    sectionId: section?.id ?? null,
    chapter: sectionPath && sectionPath.length > 1 ? sectionPath[0]! : sectionPath?.[0] ?? null,
    section: section ? section.title : null,
    sectionPath,
    citationAnchor: citationAnchor ?? section?.sourceAnchor ?? null,
    pageNumber: page?.pageNumber ?? (hasUnmappedSearchPage ? null : section?.startPage ?? null),
    physicalPageNumber: page?.physicalPageNumber ?? null,
    pageLabel: page?.pageLabel ?? null,
    pageTitle: page?.pageTitle ?? null
  };

  const blocks = page ? await getBlocksOfPage(app, page.id) : [];
  const highlights = page ? await buildHighlight(app, page, blockId, input.matchedText ?? null) : [];

  // 原文导航：TOC 路径 + ORIGINAL 资产 + 页面预览 URL
  const tocPath = await resolveTocPath(app, context.version.id, section?.id ?? null, page?.physicalPageNumber ?? null);
  const [originalAsset] = await app.db.select({ fileId: knowledgeDocumentAssets.fileId })
    .from(knowledgeDocumentAssets)
    .where(and(eq(knowledgeDocumentAssets.versionId, context.version.id), eq(knowledgeDocumentAssets.role, "ORIGINAL")))
    .limit(1);
  let previewUrl: string | null = null;
  if (originalAsset) {
    try {
      const [fileRow] = await app.db.select({ objectKey: files.objectKey, originalName: files.originalName })
        .from(files).where(eq(files.id, originalAsset.fileId)).limit(1);
      if (fileRow) {
        previewUrl = await app.storage.createDownloadUrl(fileRow.objectKey, fileRow.originalName ?? "original.pdf", 1800);
      }
    } catch {
      previewUrl = null;
    }
  }
  const pageDto = page ? await toPageDto(app, page, blocks) : null;

  return {
    document: toDocumentSummary(context),
    toc: { path: tocPath },
    location,
    original: {
      fileId: originalAsset?.fileId ?? null,
      pageImageUrl: pageDto?.pageImageUrl ?? null,
      previewUrl
    },
    extracted: {
      text: pageDto?.extractedText ?? null,
      blocks
    },
    page: pageDto,
    highlights
  };
}

/**
 * TOC 路径解析：优先取关联 sectionId 的目录条目并沿 parentId 上溯；
 * 无 section 关联时按物理页匹配目录条目；两者皆无返回 null（调用方回退语义章节路径）。
 */
async function resolveTocPath(
  app: FastifyInstance,
  versionId: string,
  sectionId: string | null,
  physicalPageNumber: number | null
): Promise<string[] | null> {
  const items = await app.db.select({
    id: knowledgeTocItems.id,
    parentId: knowledgeTocItems.parentId,
    title: knowledgeTocItems.title,
    level: knowledgeTocItems.level,
    sortOrder: knowledgeTocItems.sortOrder,
    sectionId: knowledgeTocItems.sectionId,
    physicalPageNumber: knowledgeTocItems.physicalPageNumber
  })
    .from(knowledgeTocItems)
    .where(eq(knowledgeTocItems.versionId, versionId))
    .orderBy(asc(knowledgeTocItems.sortOrder));
  if (items.length === 0) return null;
  let hit = (sectionId ? items.find((item) => item.sectionId === sectionId) : undefined)
    ?? (physicalPageNumber != null
      ? items.filter((item) => item.physicalPageNumber === physicalPageNumber).slice(-1)[0]
      : undefined);
  if (!hit) return null;
  const byId = new Map(items.map((item) => [item.id, item]));
  const path: string[] = [hit.title];
  const seen = new Set<string>([hit.id]);
  let cursor = hit.parentId ? byId.get(hit.parentId) : undefined;
  while (cursor && !seen.has(cursor.id)) {
    path.unshift(cursor.title);
    seen.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return path;
}

// ---------------------------------------------------------------- 公开文库（C 端只读）

export interface PublicDocumentListQuery {
  categoryId?: string;
  docType?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  sort?: "latest" | "title";
}

export interface PublicDocumentListItem {
  id: string;
  title: string;
  docNumber: string | null;
  docType: string;
  versionId: string;
  version: number;
  pageCount: number | null;
  region: string | null;
  publishedAt: Date | null;
}

/**
 * 公开文库文档列表：visibility=PUBLIC + ACTIVE + 未删除 + 当前版本 PUBLISHED 生效中。
 * 复用 Wiki 读取口径，不开放草稿与审核中版本。
 */
export async function listPublicDocuments(
  app: FastifyInstance,
  query: PublicDocumentListQuery
): Promise<{ items: PublicDocumentListItem[]; total: number }> {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(50, Math.max(1, query.pageSize));
  const conditions: ReturnType<typeof and>[] = [
    eq(knowledgeDocuments.visibility, "PUBLIC"),
    eq(knowledgeDocuments.status, "ACTIVE"),
    isNull(knowledgeDocuments.deletedAt)
  ];
  if (query.categoryId) conditions.push(eq(knowledgeDocuments.categoryId, query.categoryId));
  if (query.docType) conditions.push(eq(knowledgeDocuments.docType, query.docType as typeof knowledgeDocuments.$inferSelect["docType"]));
  if (query.keyword) {
    conditions.push(or(
      ilike(knowledgeDocuments.title, `%${query.keyword}%`),
      ilike(knowledgeDocuments.docNumber, `%${query.keyword}%`)
    )!);
  }
  const where = and(
    eq(knowledgeDocumentVersions.status, "PUBLISHED"),
    or(isNull(knowledgeDocumentVersions.expiryDate), gte(knowledgeDocumentVersions.expiryDate, startOfToday().toISOString().slice(0, 10)))!,
    ...conditions
  );

  const items = await app.db.select({
    id: knowledgeDocuments.id,
    title: knowledgeDocuments.title,
    docNumber: knowledgeDocuments.docNumber,
    docType: knowledgeDocuments.docType,
    versionId: knowledgeDocumentVersions.id,
    version: knowledgeDocumentVersions.version,
    pageCount: knowledgeDocuments.pageCount,
    region: knowledgeDocuments.region,
    publishedAt: knowledgeDocumentVersions.publishedAt
  })
    .from(knowledgeDocuments)
    .innerJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId))
    .where(where)
    .orderBy(query.sort === "title" ? asc(knowledgeDocuments.title) : desc(knowledgeDocuments.updatedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [totalRow] = await app.db.select({ value: count() })
    .from(knowledgeDocuments)
    .innerJoin(knowledgeDocumentVersions, eq(knowledgeDocumentVersions.id, knowledgeDocuments.currentVersionId))
    .where(where);
  return { items, total: totalRow?.value ?? 0 };
}

// ---------------------------------------------------------------- 公开文库文档/章节/页面读取

/** 校验文档处于公开文库可见状态（不泄露私有文档存在性：一律 404） */
export function assertPublicDocument(document: Pick<typeof knowledgeDocuments.$inferSelect, "visibility" | "status" | "deletedAt">): void {
  if (document.visibility !== "PUBLIC" || document.status !== "ACTIVE" || document.deletedAt) {
    throw new NotFoundError("知识资料不存在");
  }
}

/** 章节树（扁平有序，前端可按 parentId/level 组树） */
export async function listDocumentSections(
  app: FastifyInstance,
  versionId: string
): Promise<WikiSectionNode[]> {
  const rows = await app.db.select({
    id: knowledgeSections.id,
    parentId: knowledgeSections.parentId,
    title: knowledgeSections.title,
    level: knowledgeSections.level,
    headingPath: knowledgeSections.headingPath,
    sortOrder: knowledgeSections.sortOrder,
    startPage: knowledgeSections.startPage,
    endPage: knowledgeSections.endPage
  })
    .from(knowledgeSections)
    .where(eq(knowledgeSections.versionId, versionId))
    .orderBy(asc(knowledgeSections.sortOrder), asc(knowledgeSections.level));
  const docTitle = rows[0]?.headingPath?.[0];
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    title: row.title,
    level: row.level,
    sectionPath: row.headingPath && docTitle && row.headingPath[0] === docTitle
      ? row.headingPath.slice(1)
      : row.headingPath ?? [],
    startPage: row.startPage,
    endPage: row.endPage,
    sortOrder: row.sortOrder
  }));
}

/** 公开文库文档详情：文档元信息 + 当前已发布版本 + 章节树 */
export async function getPublicDocumentDetail(
  app: FastifyInstance,
  documentId: string
): Promise<{ document: WikiDocumentSummary; sections: WikiSectionNode[] }> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  return {
    document: toDocumentSummary(context),
    sections: await listDocumentSections(app, context.version.id)
  };
}

/** 公开文库页面列表（分页） */
export async function listPublicDocumentPages(
  app: FastifyInstance,
  documentId: string,
  page: number,
  pageSize: number
): Promise<{ items: WikiPageListItem[]; total: number }> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  const normalizedPage = Math.max(1, page);
  const normalizedSize = Math.min(100, Math.max(1, pageSize));
  const [items, [totalRow]] = await Promise.all([
    app.db.select({
      id: knowledgePages.id,
      pageNumber: knowledgePages.pageNumber,
      physicalPageNumber: knowledgePages.physicalPageNumber,
      pageLabel: knowledgePages.pageLabel,
      pageLabelSource: knowledgePages.pageLabelSource,
      pageLabelConfidence: knowledgePages.pageLabelConfidence,
      pageLabelVerified: knowledgePages.pageLabelVerified,
      pageTitle: knowledgePages.pageTitle,
      hasTables: knowledgePages.hasTables,
      hasImages: knowledgePages.hasImages,
      sectionPath: knowledgePages.sectionPath
    })
      .from(knowledgePages)
      .where(eq(knowledgePages.versionId, context.version.id))
      .orderBy(asc(knowledgePages.pageNumber))
      .limit(normalizedSize)
      .offset((normalizedPage - 1) * normalizedSize),
    app.db.select({ value: count() }).from(knowledgePages).where(eq(knowledgePages.versionId, context.version.id))
  ]);
  return { items: items.map((item) => toPageListItem(item as typeof knowledgePages.$inferSelect)), total: totalRow?.value ?? 0 };
}

/** 按版本读取单页完整内容；调用方负责版本可见性与权限校验。 */
export async function getVersionPage(
  app: FastifyInstance,
  versionId: string,
  physicalPageNumber: number
): Promise<WikiPageDto> {
  const [version] = await app.db.select({ id: knowledgeDocumentVersions.id })
    .from(knowledgeDocumentVersions).where(eq(knowledgeDocumentVersions.id, versionId)).limit(1);
  if (!version) throw new NotFoundError("文档版本不存在");
  let [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.physicalPageNumber, physicalPageNumber)))
    .limit(1);
  if (!page) {
    [page] = await app.db.select().from(knowledgePages)
      .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageNumber, physicalPageNumber)))
      .limit(1);
  }
  if (!page) throw new NotFoundError("页面不存在");
  return toPageDto(app, page, await getBlocksOfPage(app, page.id));
}

/**
 * 按版本读取当前页及相邻轻量页面。当前页才返回机器提取文本与 Blocks，
 * `items` 仅承载页面导航信息，避免阅读器预取整份 PDF 的正文。
 */
export async function getVersionPageWindow(
  app: FastifyInstance,
  versionId: string,
  center: number,
  before: number,
  after: number
): Promise<WikiPageWindow> {
  const normalizedBefore = Math.min(10, Math.max(0, before));
  const normalizedAfter = Math.min(10, Math.max(0, after));
  const page = await getVersionPage(app, versionId, center);
  const actualCenter = page.physicalPageNumber;
  const [rows, [totalRow]] = await Promise.all([
    app.db.select({
      id: knowledgePages.id,
      pageNumber: knowledgePages.pageNumber,
      physicalPageNumber: knowledgePages.physicalPageNumber,
      pageLabel: knowledgePages.pageLabel,
      pageLabelSource: knowledgePages.pageLabelSource,
      pageLabelConfidence: knowledgePages.pageLabelConfidence,
      pageLabelVerified: knowledgePages.pageLabelVerified,
      pageTitle: knowledgePages.pageTitle,
      hasTables: knowledgePages.hasTables,
      hasImages: knowledgePages.hasImages,
      sectionPath: knowledgePages.sectionPath
    }).from(knowledgePages)
      .where(and(
        eq(knowledgePages.versionId, versionId),
        gte(knowledgePages.physicalPageNumber, actualCenter - normalizedBefore),
        lte(knowledgePages.physicalPageNumber, actualCenter + normalizedAfter)
      ))
      .orderBy(asc(knowledgePages.physicalPageNumber)),
    app.db.select({ value: count() }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId))
  ]);
  return {
    current: actualCenter,
    total: totalRow?.value ?? 0,
    page,
    items: rows.map((row) => toPageListItem(row as typeof knowledgePages.$inferSelect))
  };
}

/** 公开文库窗口读取（只允许当前已发布且公开的版本）。 */
export async function getPublicDocumentPageWindow(
  app: FastifyInstance,
  documentId: string,
  center: number,
  before: number,
  after: number
): Promise<WikiPageWindow> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  return getVersionPageWindow(app, context.version.id, center, before, after);
}

/** 公开文库单页完整内容（按物理页序号定位；兼容旧 pageNumber 语义） */
export async function getPublicDocumentPage(
  app: FastifyInstance,
  documentId: string,
  pageNumber: number
): Promise<WikiPageDto> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  return getVersionPage(app, context.version.id, pageNumber);
}

/** 公开文库单页完整内容（按印刷页码标签定位：4 / 21 / A1 / A5 / D16 / G10；字符串精确匹配，禁止 Number()） */
export async function getPublicDocumentPageByLabel(
  app: FastifyInstance,
  documentId: string,
  pageLabel: string
): Promise<WikiPageDto> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  const [page] = await app.db.select().from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, context.version.id), eq(knowledgePages.pageLabel, pageLabel)))
    .orderBy(asc(knowledgePages.physicalPageNumber))
    .limit(1);
  if (!page) throw new NotFoundError("页面不存在");
  return toPageDto(app, page, await getBlocksOfPage(app, page.id));
}

/** 公开文库原文目录（TOC；只读已发布版本，自动识别初稿同样可见但带 status 标注） */
export async function getPublicDocumentToc(
  app: FastifyInstance,
  documentId: string
): Promise<{ items: Array<{
  id: string;
  parentId: string | null;
  level: number;
  sortOrder: number;
  title: string;
  pageLabel: string | null;
  physicalPageNumber: number | null;
  source: string;
  status: string;
  sectionId: string | null;
}> }> {
  const context = await resolveReadableVersion(app, documentId);
  assertPublicDocument(context.document);
  const { listVersionToc } = await import("./knowledge-original.service.js");
  const result = await listVersionToc(app, context.version.id);
  return {
    items: result.items.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      level: item.level,
      sortOrder: item.sortOrder,
      title: item.title,
      pageLabel: item.pageLabel,
      physicalPageNumber: item.physicalPageNumber,
      source: item.source,
      status: item.status,
      sectionId: item.sectionId
    }))
  };
}
