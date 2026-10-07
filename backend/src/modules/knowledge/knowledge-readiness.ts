/**
 * 知识版本可用性（Readiness）统一派生。
 *
 * 系统正式支持两条合法知识链，二者最终汇合为「PUBLISHED + AI_ENABLED + 存在正式可检索内容 + 来源可追溯」：
 *   A. 传统文件驱动：ORIGINAL → 解析 → text/chunks/pages → 审核 → 发布 → AI
 *   B. 页面驱动：完整页面 PNG/ZIP → knowledge_pages → 视觉识别 → 人工确认 → page-aware chunks
 *      → 审核 → 发布 → AI
 *
 * 因此「这个版本能不能审核 / 能不能发布 / AI 能不能用」不再由 `ORIGINAL 资产存在` 或
 * `version.parseStatus` 单独决定，而是由本模块统一派生；审核、发布、工作台 canPublish、
 * 文档健康、AI 可用性、Knowledge Test 全部消费同一份结论，避免 UI 判定与发布 API 分叉。
 *
 * 注意：`parseStatus` 语义保持不变（原始文件解析状态）。页面驱动版本没有 ORIGINAL 时保持
 * PENDING，不伪造 PARSED；可用性由 readiness 派生。
 */
import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { env } from "../../config/env.js";
import {
  knowledgeChunks,
  knowledgeDocumentAssets,
  knowledgeDocumentVersions,
  knowledgePageMappings,
  knowledgePages,
  knowledgeTocItems
} from "../../db/schema.js";
import { readPageRecognitionMeta } from "../../shared/page-recognition.js";

/** 离线页图上传来源：这些页面由 PNG/ZIP/人工创建，需要视觉识别与人工确认。 */
export const KNOWLEDGE_PAGE_OFFLINE_UPLOAD_SOURCES = ["BATCH", "ZIP", "MANUAL"] as const;

export type KnowledgeReadinessBlockerCode =
  | "NO_PAGES"
  | "STRICT_PUBLISH_WARNING"
  | "PAGE_IMAGE_MISSING"
  | "PAGE_RECOGNITION_PENDING"
  | "PAGE_RECOGNITION_PROCESSING"
  | "PAGE_RECOGNITION_FAILED"
  | "PAGE_REVIEW_REQUIRED"
  | "TRADITIONAL_PARSE_INCOMPLETE"
  | "SEARCH_SOURCE_REQUIRED"
  | "NO_FORMAL_KNOWLEDGE_SOURCE"
  | "SEARCHABLE_CONTENT_REQUIRED"
  | "INDEX_NOT_READY";

/** blocker 作用域：审核 / 发布 / AI 可用，三者共用同一份事实，避免 UI 与 API 两套口径 */
export type KnowledgeReadinessScope = "REVIEW" | "PUBLISH" | "AI";

export interface KnowledgeReadinessBlocker {
  code: KnowledgeReadinessBlockerCode;
  /** 面向 B 端的中文提示（不暴露技术细节） */
  message: string;
  /** 已登记的稳定 KNOWLEDGE_* 业务错误码（无对应码时为 null，发布门禁据此抛业务错误） */
  knowledgeErrorCode: string | null;
  /** 该 blocker 阻止哪些动作；reviewReady/publishReady/aiReady 由 base 能力 ∩ 对应作用域无 blocker 派生 */
  blocks: KnowledgeReadinessScope[];
}

/** 单个页面的可用性事实（可从 DB 行或 metadata 归一化得到） */
export interface KnowledgePageReadinessRow {
  pageImageObjectKey?: string | null;
  uploadSource?: string | null;
  recognitionStatus?: string | null;
  recognitionRunId?: string | null;
  hasText?: boolean | null;
}

/** 版本内页面维度的可用性事实（纯统计，不含任何识别原文/URL） */
export interface KnowledgePageReadinessFacts {
  pageCount: number;
  /** null = 未采集（调用方未知），0 = 明确无分块 */
  chunkCount: number | null;
  pagesMissingImageCount: number;
  /** 版本内是否存在离线页图（BATCH/ZIP/MANUAL） */
  hasOfflinePageImages: boolean;
  recognitionPendingPageCount: number;
  recognitionProcessingPageCount: number;
  recognitionReviewRequiredPageCount: number;
  recognitionFailedPageCount: number;
  confirmedRecognitionPageCount: number;
  /**
   * 未确认识别页面的聚合计数（PENDING + PROCESSING + REVIEW_REQUIRED + FAILED）。
   * 与细粒度计数同时提供：细粒度全部为 0 且本值 > 0 时按聚合口径提示。
   */
  unconfirmedRecognitionPageCount: number;
}

/** 版本维度的事实（来自版本行 + 资产行 + TOC/映射统计） */
export interface KnowledgeReadinessSource {
  usageMode: string;
  parseStatus: string;
  hasOriginalAsset: boolean;
  hasSearchSourceAsset: boolean;
  fallbackPageLabelCount?: number;
  mappingCount?: number;
  reliableMappingCount?: number;
  verifiedMappingCount?: number;
  tocItemCount?: number;
  confirmedTocCount?: number;
  /**
   * 版本级正式索引状态（页面驱动链）：缺省（undefined）= 兼容放行，由完整性校验兜底。
   * INDEX_READY 且非 dirty 才视为「索引与当前 CONFIRMED 页面一致」。
   */
  indexStatus?: string | null;
  indexDirty?: boolean | null;
  /** 索引内容版本号（= 构建时的 contentRevision） */
  indexRevision?: number | null;
  /** 当前正式页面内容修订号；发布门禁要求 indexRevision === contentRevision */
  contentRevision?: number | null;
  /** 缺省使用部署配置；显式值用于确定性验证。 */
  strictPublishCheck?: boolean;
}

export interface KnowledgeVersionReadiness {
  hasOriginalAsset: boolean;
  hasSearchSourceAsset: boolean;
  hasOfflinePageImages: boolean;
  /** 是否存在正式知识来源（传统文件链或页面驱动链任一就绪） */
  hasFormalKnowledgeSource: boolean;

  traditionalContentReady: boolean;
  offlinePageContentReady: boolean;
  /** 可被正式 AI 检索消费（两条链任一就绪 + 存在页面 + 存在 chunks） */
  searchableContentReady: boolean;

  /** 审核就绪 = 基础审核能力 ∩ 无 REVIEW 作用域 blocker */
  reviewReady: boolean;
  /** 发布就绪 = 基础发布能力 ∩ 无 PUBLISH 作用域 blocker（publishReady=true 必然 blockers 中无发布级拦截） */
  publishReady: boolean;
  /** AI 就绪 = 基础 AI 能力 ∩ 无 AI 作用域 blocker */
  aiReady: boolean;
  /** 无任何硬拦截（等价于 blockers.length === 0） */
  eligible: boolean;

  pageCount: number;
  chunkCount: number | null;
  pagesMissingImageCount: number;
  unconfirmedRecognitionPageCount: number;
  recognition: {
    pending: number;
    processing: number;
    reviewRequired: number;
    failed: number;
    confirmed: number;
  };

  blockers: KnowledgeReadinessBlocker[];
  /** 阻止审核的 blocker 子集 */
  reviewBlockers: KnowledgeReadinessBlocker[];
  /** 阻止发布的 blocker 子集（B 端 publishBlockers / 发布 API 共用） */
  publishBlockers: KnowledgeReadinessBlocker[];
  /** 阻止 AI 可用的 blocker 子集 */
  aiBlockers: KnowledgeReadinessBlocker[];
  /** 与 blockers 一一对应的稳定业务错误码（未登记的位置为 null） */
  blockerCodes: Array<string | null>;
  warnings: string[];
}

/** 传统文件链可发布/可审核的 parseStatus 放行集合（AI_ENABLED） */
const AI_TRADITIONAL_PARSE_STATUSES = ["PARSED", "PARTIAL", "NO_TEXT_LAYER"] as const;
/** BROWSE_ONLY 额外允许「无文本层且未绑定检索源」：仅浏览不参与 AI 检索 */
const BROWSE_TRADITIONAL_PARSE_STATUSES = [...AI_TRADITIONAL_PARSE_STATUSES, "SEARCH_SOURCE_REQUIRED"] as const;

export function isOfflineUploadedPage(row: KnowledgePageReadinessRow): boolean {
  const source = row.uploadSource ?? null;
  return source != null && (KNOWLEDGE_PAGE_OFFLINE_UPLOAD_SOURCES as readonly string[]).includes(source);
}

/**
 * 页面是否需要「人工识别确认」：
 * - 仅离线页图（BATCH/ZIP/MANUAL 上传）需要视觉识别；传统文件链的文本页不要求识别；
 * - 已有可读文本且从未进入识别流程的页面视为普通文本页，不强制识别（纯图片归档/文本页放行）；
 * - 一旦进入识别流程（排队 / 处理中 / 待确认 / 已确认 / 失败），必须收敛到 CONFIRMED。
 */
export function pageRequiresRecognition(row: KnowledgePageReadinessRow): boolean {
  if (!isOfflineUploadedPage(row)) return false;
  const hasRecognitionActivity = row.recognitionStatus != null || row.recognitionRunId != null;
  if (!hasRecognitionActivity) return row.hasText !== true;
  return true;
}

/** 页面是否缺原图：离线页图必须补图；无图且无可读文本的页面视为空页。 */
export function pageImageMissing(row: KnowledgePageReadinessRow): boolean {
  if (row.pageImageObjectKey) return false;
  return isOfflineUploadedPage(row) || row.hasText !== true;
}

/**
 * DB 行 / 既有 context 归一化为页面可用性事实行。
 * 同时兼容两种来源：直接给字段（列表页 SQL 抽取）或给整块 metadata（详情/门禁）。
 */
export function toPageReadinessRow(row: {
  pageImageObjectKey?: string | null;
  hasText?: boolean | null;
  parsedText?: string | null;
  uploadSource?: string | null;
  recognitionStatus?: string | null;
  recognitionRunId?: string | null;
  metadata?: Record<string, unknown> | null;
}): KnowledgePageReadinessRow {
  const meta = row.metadata ? readPageRecognitionMeta(row.metadata) : null;
  const uploadSource = row.uploadSource ?? meta?.uploadSource ?? null;
  return {
    pageImageObjectKey: row.pageImageObjectKey ?? null,
    uploadSource,
    recognitionStatus: row.recognitionStatus ?? meta?.recognitionStatus ?? null,
    recognitionRunId: row.recognitionRunId ?? meta?.recognitionRunId ?? null,
    hasText: row.hasText ?? (row.parsedText != null && row.parsedText.length > 0)
  };
}

/** 汇总页面事实：仅统计，不读取识别原文与签名地址。 */
export function summarizePageReadiness(
  rows: Array<KnowledgePageReadinessRow | Parameters<typeof toPageReadinessRow>[0]>,
  chunkCount: number | null
): KnowledgePageReadinessFacts {
  const facts: KnowledgePageReadinessFacts = {
    pageCount: rows.length,
    chunkCount,
    pagesMissingImageCount: 0,
    hasOfflinePageImages: false,
    recognitionPendingPageCount: 0,
    recognitionProcessingPageCount: 0,
    recognitionReviewRequiredPageCount: 0,
    recognitionFailedPageCount: 0,
    confirmedRecognitionPageCount: 0,
    unconfirmedRecognitionPageCount: 0
  };
  for (const raw of rows) {
    const row = toPageReadinessRow(raw);
    if (row.pageImageObjectKey && isOfflineUploadedPage(row)) facts.hasOfflinePageImages = true;
    if (pageImageMissing(row)) facts.pagesMissingImageCount += 1;
    if (!pageRequiresRecognition(row)) continue;
    switch (row.recognitionStatus) {
      case "CONFIRMED":
        facts.confirmedRecognitionPageCount += 1;
        break;
      case "PROCESSING":
        facts.recognitionProcessingPageCount += 1;
        break;
      case "REVIEW_REQUIRED":
        facts.recognitionReviewRequiredPageCount += 1;
        break;
      case "FAILED":
        facts.recognitionFailedPageCount += 1;
        break;
      default:
        // PENDING / 无状态：识别尚未开始或排队中
        facts.recognitionPendingPageCount += 1;
        break;
    }
  }
  facts.unconfirmedRecognitionPageCount = facts.recognitionPendingPageCount
    + facts.recognitionProcessingPageCount
    + facts.recognitionReviewRequiredPageCount
    + facts.recognitionFailedPageCount;
  return facts;
}

/**
 * 统一派生知识版本可用性。纯函数：审核 / 发布 / 工作台 / 健康 / AI 可用性 / Knowledge Test 共用。
 */
export function deriveKnowledgeVersionReadiness(
  source: KnowledgeReadinessSource,
  facts: KnowledgePageReadinessFacts
): KnowledgeVersionReadiness {
  const blockers: KnowledgeReadinessBlocker[] = [];
  const warnings: string[] = [];
  const aiEnabled = source.usageMode === "AI_ENABLED";
  const allowedParseStatuses: readonly string[] = source.usageMode === "BROWSE_ONLY"
    ? BROWSE_TRADITIONAL_PARSE_STATUSES
    : AI_TRADITIONAL_PARSE_STATUSES;
  const traditionalParseAllowed = allowedParseStatuses.includes(source.parseStatus);

  const pushBlocker = (
    code: KnowledgeReadinessBlockerCode,
    message: string,
    knowledgeErrorCode: string | null,
    blocks: KnowledgeReadinessScope[]
  ) => {
    blockers.push({ code, message, knowledgeErrorCode, blocks });
  };

  // ---- 传统文件链：保留既有口径（ORIGINAL + 解析状态放行集合）
  const traditionalContentReady = source.hasOriginalAsset && traditionalParseAllowed;

  // ---- 页面驱动链：页面齐备 + 无缺图 + （AI_ENABLED 时）识别全部确认
  const offlinePagesPresent = facts.pageCount > 0
    && facts.hasOfflinePageImages
    && facts.pagesMissingImageCount === 0;
  const recognitionSettled = facts.recognitionPendingPageCount === 0
    && facts.recognitionProcessingPageCount === 0
    && facts.recognitionReviewRequiredPageCount === 0
    && facts.recognitionFailedPageCount === 0;
  // BROWSE_ONLY 仅浏览：页面齐备即可发布（纯图片归档不强制识别确认）
  const offlinePageContentReady = offlinePagesPresent && (!aiEnabled || recognitionSettled);

  const hasFormalKnowledgeSource = traditionalContentReady || offlinePageContentReady;
  const searchableContentReady = hasFormalKnowledgeSource
    && facts.pageCount > 0
    && (facts.chunkCount ?? 0) > 0;
  // 明确「已知为空」（0）与「未采集」（null）：只有确定没有分块时才按硬拦截处理
  const chunkCountKnownEmpty = facts.chunkCount === 0;

  if (facts.pageCount === 0) {
    pushBlocker("NO_PAGES", "当前版本还没有资料页面，请先上传完整页面图片", "KNOWLEDGE_VERSION_EMPTY", ["REVIEW", "PUBLISH", "AI"]);
  }

  if (aiEnabled) {
    // 页面缺原图（离线页图必须补图；页面驱动版本无 ORIGINAL 时同样硬拦截）
    if (facts.pagesMissingImageCount > 0 && (facts.hasOfflinePageImages || !source.hasOriginalAsset)) {
      pushBlocker(
        "PAGE_IMAGE_MISSING",
        `离线页图版本有 ${facts.pagesMissingImageCount} 页缺少原页图片，不能发布为 AI_ENABLED`,
        "KNOWLEDGE_VERSION_PAGES_MISSING_IMAGE",
        ["REVIEW", "PUBLISH", "AI"]
      );
    }
    if (facts.hasOfflinePageImages) {
      const granularTotal = facts.recognitionPendingPageCount
        + facts.recognitionProcessingPageCount
        + facts.recognitionReviewRequiredPageCount
        + facts.recognitionFailedPageCount;
      if (granularTotal === 0 && facts.unconfirmedRecognitionPageCount > 0) {
        pushBlocker(
          "PAGE_REVIEW_REQUIRED",
          `离线页图版本有 ${facts.unconfirmedRecognitionPageCount} 页识别未确认，不能发布为 AI_ENABLED`,
          "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
          ["REVIEW", "PUBLISH", "AI"]
        );
      } else {
        if (facts.recognitionFailedPageCount > 0) {
          pushBlocker(
            "PAGE_RECOGNITION_FAILED",
            `离线页图版本有 ${facts.recognitionFailedPageCount} 页识别失败，请重新识别后再发布`,
            "KNOWLEDGE_VERSION_PAGES_RECOGNITION_FAILED",
            ["REVIEW", "PUBLISH", "AI"]
          );
        }
        if (facts.recognitionProcessingPageCount > 0) {
          pushBlocker(
            "PAGE_RECOGNITION_PROCESSING",
            `离线页图版本有 ${facts.recognitionProcessingPageCount} 页正在识别中，请等待识别完成后再发布`,
            "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
            ["REVIEW", "PUBLISH", "AI"]
          );
        }
        if (facts.recognitionPendingPageCount > 0) {
          pushBlocker(
            "PAGE_RECOGNITION_PENDING",
            `离线页图版本有 ${facts.recognitionPendingPageCount} 页尚未完成识别，请完成识别并确认后再发布`,
            "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
            ["REVIEW", "PUBLISH", "AI"]
          );
        }
        if (facts.recognitionReviewRequiredPageCount > 0) {
          pushBlocker(
            "PAGE_REVIEW_REQUIRED",
            `离线页图版本有 ${facts.recognitionReviewRequiredPageCount} 页识别结果待人工确认，不能发布为 AI_ENABLED`,
            "KNOWLEDGE_VERSION_PAGES_UNCONFIRMED",
            ["REVIEW", "PUBLISH", "AI"]
          );
        }
      }
    }
    if (source.hasOriginalAsset) {
      // P1-3：页面驱动链已就绪时，ORIGINAL 只是「可选附件」。
      // 此时原始文件解析失败/无文本层不阻塞正式可用性，只保留 warning；否则才是硬拦截。
      const originalBlocking = !offlinePageContentReady;
      const originalScopes: KnowledgeReadinessScope[] = ["REVIEW", "PUBLISH", "AI"];
      if (source.parseStatus === "SEARCH_SOURCE_REQUIRED") {
        if (originalBlocking) {
          pushBlocker(
            "SEARCH_SOURCE_REQUIRED",
            "原文件没有文本层且未绑定可检索的文本源：请上传 SEARCH_SOURCE 资产后升级解析，或将版本用途改为 BROWSE_ONLY（仅浏览）",
            "KNOWLEDGE_SEARCH_SOURCE_REQUIRED",
            originalScopes
          );
        } else {
          warnings.push("原始资料没有可检索文本层，但已确认页面内容完整可用，不影响正式发布与 AI 使用");
        }
      } else if (source.parseStatus === "OCR_REQUIRED") {
        if (originalBlocking) {
          pushBlocker(
            "TRADITIONAL_PARSE_INCOMPLETE",
            "原文件需要 OCR 才能读取文字，请补充可搜索文字版本后再发布",
            null,
            originalScopes
          );
        } else {
          warnings.push("原始资料需要 OCR 才能读取文字，但已确认页面内容完整可用，不影响正式发布与 AI 使用");
        }
      } else if (source.parseStatus === "FAILED") {
        if (originalBlocking) {
          pushBlocker(
            "TRADITIONAL_PARSE_INCOMPLETE",
            "文件识别失败，请重新解析后再发布",
            null,
            originalScopes
          );
        } else {
          warnings.push("原始资料文本解析失败，不影响已确认页面内容的正式使用");
        }
      } else if (!traditionalParseAllowed) {
        if (originalBlocking) {
          pushBlocker(
            "TRADITIONAL_PARSE_INCOMPLETE",
            "版本尚未完成解析，不能发布",
            null,
            originalScopes
          );
        }
      }
      if (source.parseStatus === "NO_TEXT_LAYER" && !source.hasSearchSourceAsset) {
        if (originalBlocking) {
          pushBlocker(
            "SEARCH_SOURCE_REQUIRED",
            "原文件没有文本层且不存在 SEARCH_SOURCE 文本源，不能进入 AI 检索",
            "KNOWLEDGE_SEARCH_SOURCE_REQUIRED",
            originalScopes
          );
        } else {
          warnings.push("原始资料没有文本层且未绑定检索源，但已确认页面内容完整可用，不影响正式发布与 AI 使用");
        }
      }
      if (source.parseStatus === "NO_TEXT_LAYER" && (source.mappingCount ?? 0) === 0 && originalBlocking) {
        pushBlocker(
          "TRADITIONAL_PARSE_INCOMPLETE",
          "检索文本未映射到任何 ORIGINAL 页面，不能生成可回溯的 AI 引用",
          null,
          originalScopes
        );
      }
    }
    // 两条链都未就绪且没有更具体的 blocker 时，才给出兜底来源提示（不叠加噪音）
    if (!hasFormalKnowledgeSource && blockers.length === 0) {
      if (facts.pageCount === 0) {
        pushBlocker(
          "NO_PAGES",
          "当前版本还没有资料页面，请先上传完整页面图片",
          "KNOWLEDGE_VERSION_EMPTY",
          ["REVIEW", "PUBLISH", "AI"]
        );
      } else {
        pushBlocker(
          "NO_FORMAL_KNOWLEDGE_SOURCE",
          "当前版本还没有可用于 AI 检索的正式内容：请上传完整页面图片并完成识别确认，或补充原始文件并完成解析",
          null,
          ["REVIEW", "PUBLISH", "AI"]
        );
      }
    }
    // P1-1：正式来源已就绪但确定没有任何可检索内容（chunkCount = 0）时，AI_ENABLED 不允许正式发布。
    // 只在「来源就绪」时提示，避免与 NO_PAGES / NO_FORMAL_KNOWLEDGE_SOURCE 噪音叠加。
    // BROWSE_ONLY（仅浏览，不参与 AI 检索）走上面的分支，不受本规则约束。
    if (hasFormalKnowledgeSource && chunkCountKnownEmpty) {
      pushBlocker(
        "SEARCHABLE_CONTENT_REQUIRED",
        "当前版本还没有可被 AI 检索的内容（chunks = 0），不能发布为 AI_ENABLED",
        "KNOWLEDGE_SEARCHABLE_CONTENT_REQUIRED",
        ["PUBLISH", "AI"]
      );
    }
    // P0/P1：页面驱动版本的正式索引必须与当前 CONFIRMED 页面一致（版本级 rebuild 完成）。
    // 单页 Confirm 只产出即时 chunk，不能作为正式发布索引；indexStatus 缺省时兼容放行（由完整性校验兜底）。
    if (facts.hasOfflinePageImages && source.indexStatus != null) {
      // 发布门禁三条件缺一不可：INDEX_READY + 非 dirty + indexRevision === contentRevision。
      // 缺省（未提供 revision）时兼容放行，由 validatePageDrivenKnowledgeIntegrity 兜底。
      const revisionKnown = source.indexRevision != null && source.contentRevision != null;
      const revisionAligned = !revisionKnown || source.indexRevision === source.contentRevision;
      const indexReady = source.indexStatus === "INDEX_READY" && !source.indexDirty && revisionAligned;
      if (!indexReady) {
        pushBlocker(
          "INDEX_NOT_READY",
          source.indexStatus === "INDEX_FAILED"
            ? "版本正式索引重建失败，请重新重建后再发布"
            : "版本正式索引尚未完成（或页面变更后未重建），请先执行版本索引重建",
          "KNOWLEDGE_INDEX_NOT_READY",
          ["PUBLISH", "AI"]
        );
      }
    }
  }

  // ---- 软提示（沿用既有口径，顺序不变）
  const tocItemCount = source.tocItemCount ?? 0;
  const confirmedTocCount = source.confirmedTocCount ?? 0;
  const fallbackPageLabelCount = source.fallbackPageLabelCount ?? 0;
  const mappingCount = source.mappingCount ?? 0;
  const reliableMappingCount = source.reliableMappingCount ?? 0;
  const verifiedMappingCount = source.verifiedMappingCount ?? 0;
  if (tocItemCount === 0) {
    warnings.push("原文目录尚不可用：请从 PDF 书签、目录页、配套检索源或人工维护生成 TOC");
  } else if (confirmedTocCount === 0) {
    warnings.push("原文目录尚未人工确认（CONFIRMED），AI 引用的目录路径以当前草稿为准");
  }
  if (fallbackPageLabelCount > 0) {
    warnings.push(`有 ${fallbackPageLabelCount} 页仅使用物理页码回退（FALLBACK），未识别到可靠印刷页码`);
  }
  if (mappingCount > 0 && verifiedMappingCount === 0) {
    warnings.push("检索页到原文页的映射尚未人工核验（verified），引用回溯可能偏页");
  }
  if (mappingCount > reliableMappingCount) {
    warnings.push(`有 ${mappingCount - reliableMappingCount} 条低置信映射不能用于正式 AI 引用`);
  }
  if (facts.pageCount === 0) {
    warnings.push("尚未上传任何资料页面；请上传完整页面图片或原始文件");
  }
  if (facts.pagesMissingImageCount > 0) {
    warnings.push(`有 ${facts.pagesMissingImageCount} 页缺少页面图片`);
  }
  if (facts.unconfirmedRecognitionPageCount > 0) {
    warnings.push(`有 ${facts.unconfirmedRecognitionPageCount} 页视觉识别尚未确认（CONFIRMED），发布后热工引用可能不完整`);
  }
  if (facts.hasOfflinePageImages && facts.chunkCount === 0) {
    warnings.push("页面已上传但尚未生成可检索内容（chunks），AI 检索暂不可用");
  }

  if (aiEnabled && (source.strictPublishCheck ?? env.STRICT_KNOWLEDGE_PUBLISH_CHECK) && warnings.length > 0) {
    pushBlocker("STRICT_PUBLISH_WARNING", `严格发布检查未通过：${warnings.join("；")}`, null, ["PUBLISH"]);
  }

  // ---- 统一事实来源：先算基础能力，再按作用域扣减 blocker。
  //      禁止出现 publishReady=true 但存在发布级 blocker 的分叉（B 端显示可发布、API 却拒绝）。
  const reviewBlockers = blockers.filter((blocker) => blocker.blocks.includes("REVIEW"));
  const publishBlockers = blockers.filter((blocker) => blocker.blocks.includes("PUBLISH"));
  const aiBlockers = blockers.filter((blocker) => blocker.blocks.includes("AI"));

  const baseReviewReady = hasFormalKnowledgeSource;
  const basePublishReady = hasFormalKnowledgeSource && facts.pageCount > 0;
  const baseAiReady = aiEnabled && searchableContentReady;

  const reviewReady = baseReviewReady && reviewBlockers.length === 0;
  const publishReady = basePublishReady && publishBlockers.length === 0;
  const aiReady = baseAiReady && aiBlockers.length === 0;

  return {
    hasOriginalAsset: source.hasOriginalAsset,
    hasSearchSourceAsset: source.hasSearchSourceAsset,
    hasOfflinePageImages: facts.hasOfflinePageImages,
    hasFormalKnowledgeSource,
    traditionalContentReady,
    offlinePageContentReady,
    searchableContentReady,
    reviewReady,
    publishReady,
    aiReady,
    eligible: blockers.length === 0,
    pageCount: facts.pageCount,
    chunkCount: facts.chunkCount,
    pagesMissingImageCount: facts.pagesMissingImageCount,
    unconfirmedRecognitionPageCount: facts.unconfirmedRecognitionPageCount,
    recognition: {
      pending: facts.recognitionPendingPageCount,
      processing: facts.recognitionProcessingPageCount,
      reviewRequired: facts.recognitionReviewRequiredPageCount,
      failed: facts.recognitionFailedPageCount,
      confirmed: facts.confirmedRecognitionPageCount
    },
    blockers,
    reviewBlockers,
    publishBlockers,
    aiBlockers,
    blockerCodes: blockers.map((blocker) => blocker.knowledgeErrorCode),
    warnings
  };
}

/**
 * 采集版本可用性上下文（资产 / 映射 / TOC / 页面 / 分块）。
 * 页面只取 pageImageObjectKey + parsed_text 是否有内容 + metadata（识别状态），
 * 不读取识别正文与签名地址。
 */
export async function collectAiReadinessContext(
  app: FastifyInstance,
  versionId: string
): Promise<{
  hasOriginalAsset: boolean;
  hasSearchSourceAsset: boolean;
  pageCount: number;
  fallbackPageLabelCount: number;
  mappingCount: number;
  reliableMappingCount: number;
  verifiedMappingCount: number;
  tocItemCount: number;
  confirmedTocCount: number;
  unconfirmedRecognitionPageCount: number;
  pagesMissingImageCount: number;
  hasOfflinePageImages?: boolean;
  pageRows: KnowledgePageReadinessRow[];
  chunkCount: number;
}> {
  const [assetRows, mappingRows, tocRows, pageRows, chunkRows] = await Promise.all([
    app.db.select({ role: knowledgeDocumentAssets.role }).from(knowledgeDocumentAssets)
      .where(eq(knowledgeDocumentAssets.versionId, versionId)),
    app.db.select({ verified: knowledgePageMappings.verified, confidence: knowledgePageMappings.confidence })
      .from(knowledgePageMappings).where(eq(knowledgePageMappings.versionId, versionId)),
    app.db.select({ status: knowledgeTocItems.status }).from(knowledgeTocItems)
      .where(eq(knowledgeTocItems.versionId, versionId)),
    app.db.select({
      pageImageObjectKey: knowledgePages.pageImageObjectKey,
      metadata: knowledgePages.metadata
    }).from(knowledgePages).where(eq(knowledgePages.versionId, versionId)),
    app.db.select({ value: count() }).from(knowledgeChunks)
      .where(eq(knowledgeChunks.versionId, versionId))
  ]);
  const normalizedPages = pageRows.map((row) => toPageReadinessRow(row));
  const facts = summarizePageReadiness(normalizedPages, Number(chunkRows[0]?.value ?? 0));
  return {
    hasOriginalAsset: assetRows.some((row) => row.role === "ORIGINAL"),
    hasSearchSourceAsset: assetRows.some((row) => row.role === "SEARCH_SOURCE"),
    pageCount: facts.pageCount,
    fallbackPageLabelCount: 0,
    mappingCount: mappingRows.length,
    reliableMappingCount: mappingRows.filter((row) => row.verified
      || (row.confidence != null && row.confidence >= env.KNOWLEDGE_MAPPING_MIN_AI_CONFIDENCE)).length,
    verifiedMappingCount: mappingRows.filter((row) => row.verified).length,
    tocItemCount: tocRows.length,
    confirmedTocCount: tocRows.filter((row) => row.status === "CONFIRMED").length,
    unconfirmedRecognitionPageCount: facts.unconfirmedRecognitionPageCount,
    pagesMissingImageCount: facts.pagesMissingImageCount,
    hasOfflinePageImages: facts.hasOfflinePageImages,
    pageRows: normalizedPages,
    chunkCount: facts.chunkCount ?? 0
  };
}

/** 页面页码回退计数需要单列（与识别/图片统计分开采集，避免把 metadata 读全） */
export async function countFallbackPageLabels(app: FastifyInstance, versionId: string): Promise<number> {
  const [row] = await app.db.select({ value: count() }).from(knowledgePages)
    .where(and(eq(knowledgePages.versionId, versionId), eq(knowledgePages.pageLabelSource, "FALLBACK")));
  return Number(row?.value ?? 0);
}

/**
 * 版本可用性主入口：资产 + 页面事实 → 统一 readiness。
 * 审核 / 发布 / 工作台 / 健康 / AI 可用性 / Knowledge Test 都调用本函数。
 */
export async function collectKnowledgeVersionReadiness(
  app: FastifyInstance,
  version: Pick<typeof knowledgeDocumentVersions.$inferSelect, "id" | "usageMode" | "parseStatus" | "fileId" | "indexStatus" | "indexDirty" | "indexRevision" | "contentRevision">
): Promise<KnowledgeVersionReadiness> {
  const [context, fallbackPageLabelCount] = await Promise.all([
    collectAiReadinessContext(app, version.id),
    countFallbackPageLabels(app, version.id)
  ]);
  return deriveKnowledgeVersionReadiness(
    {
      usageMode: version.usageMode,
      parseStatus: version.parseStatus,
      // 兼容历史数据：版本主文件（fileId）视为 ORIGINAL
      hasOriginalAsset: context.hasOriginalAsset || Boolean(version.fileId),
      hasSearchSourceAsset: context.hasSearchSourceAsset,
      fallbackPageLabelCount,
      mappingCount: context.mappingCount,
      reliableMappingCount: context.reliableMappingCount,
      verifiedMappingCount: context.verifiedMappingCount,
      tocItemCount: context.tocItemCount,
      confirmedTocCount: context.confirmedTocCount,
      indexStatus: version.indexStatus,
      indexDirty: version.indexDirty,
      indexRevision: version.indexRevision,
      contentRevision: version.contentRevision
    },
    summarizePageReadiness(context.pageRows, context.chunkCount)
  );
}

/**
 * 发布门禁上下文（兼容既有调用方与测试的扁平结构）。
 * 新增字段均可选：仅当提供细粒度识别计数时按细粒度提示，否则回落到聚合口径。
 */
export interface AiReadinessContext {
  hasOriginalAsset: boolean;
  hasSearchSourceAsset: boolean;
  pageCount: number;
  fallbackPageLabelCount: number;
  mappingCount: number;
  reliableMappingCount: number;
  verifiedMappingCount: number;
  tocItemCount: number;
  confirmedTocCount: number;
  /** 有页图但未确认视觉识别的页面数（离线页图正式链路） */
  unconfirmedRecognitionPageCount: number;
  pagesMissingImageCount: number;
  hasOfflinePageImages?: boolean;
  chunkCount?: number;
  recognitionPendingPageCount?: number;
  recognitionProcessingPageCount?: number;
  recognitionReviewRequiredPageCount?: number;
  recognitionFailedPageCount?: number;
  confirmedRecognitionPageCount?: number;
  /** 版本级正式索引状态（页面驱动链） */
  indexStatus?: string | null;
  indexDirty?: boolean | null;
  indexRevision?: number | null;
  contentRevision?: number | null;
}

export interface AiReadinessResult {
  /** 无硬拦截（发布门禁口径：publishReady） */
  eligible: boolean;
  /** 硬拦截提示（中文，与 blockerCodes 一一对应） */
  blockers: string[];
  /** 与 blockers 一一对应的稳定业务错误码（未登记为 null） */
  blockerCodes: Array<string | null>;
  /** 软提示：TOC 未确认 / 映射未人工核验（发布成功但仍返回） */
  warnings: string[];
  /** 发布是否放行（传统文件链或页面驱动链任一就绪，且存在资料页面） */
  publishReady: boolean;
  readiness: KnowledgeVersionReadiness;
}

export function contextToReadinessFacts(context: AiReadinessContext): KnowledgePageReadinessFacts {
  const facts: KnowledgePageReadinessFacts = {
    pageCount: context.pageCount,
    chunkCount: context.chunkCount ?? null,
    pagesMissingImageCount: context.pagesMissingImageCount,
    hasOfflinePageImages: context.hasOfflinePageImages === true,
    recognitionPendingPageCount: context.recognitionPendingPageCount ?? 0,
    recognitionProcessingPageCount: context.recognitionProcessingPageCount ?? 0,
    recognitionReviewRequiredPageCount: context.recognitionReviewRequiredPageCount ?? 0,
    recognitionFailedPageCount: context.recognitionFailedPageCount ?? 0,
    confirmedRecognitionPageCount: context.confirmedRecognitionPageCount ?? 0,
    unconfirmedRecognitionPageCount: context.unconfirmedRecognitionPageCount
  };
  return facts;
}

/**
 * 版本可用性判定（发布/审核门禁口径）。
 * 页面驱动链已就绪时不要求 ORIGINAL；两条链都未就绪才拦截。
 */
export function evaluateVersionAiReadiness(
  version: { usageMode: string; parseStatus: string },
  context: AiReadinessContext
): AiReadinessResult {
  const readiness = deriveKnowledgeVersionReadiness(
    {
      usageMode: version.usageMode,
      parseStatus: version.parseStatus,
      hasOriginalAsset: context.hasOriginalAsset,
      hasSearchSourceAsset: context.hasSearchSourceAsset,
      fallbackPageLabelCount: context.fallbackPageLabelCount,
      mappingCount: context.mappingCount,
      reliableMappingCount: context.reliableMappingCount,
      verifiedMappingCount: context.verifiedMappingCount,
      tocItemCount: context.tocItemCount,
      confirmedTocCount: context.confirmedTocCount,
      indexStatus: context.indexStatus ?? null,
      indexDirty: context.indexDirty ?? null,
      indexRevision: context.indexRevision ?? null,
      contentRevision: context.contentRevision ?? null
    },
    contextToReadinessFacts(context)
  );
  return {
    eligible: readiness.eligible,
    blockers: readiness.blockers.map((blocker) => blocker.message),
    blockerCodes: readiness.blockerCodes,
    warnings: readiness.warnings,
    publishReady: readiness.publishReady,
    readiness
  };
}

/** Readiness 失败日志字段：只记录确定性统计，不含识别正文、签名地址与敏感文件地址。 */
export function toReadinessLogContext(
  readiness: KnowledgeVersionReadiness,
  ids: { documentId?: string | null; versionId: string; usageMode?: string | null }
) {
  return {
    documentId: ids.documentId ?? null,
    versionId: ids.versionId,
    usageMode: ids.usageMode ?? null,
    hasOriginalAsset: readiness.hasOriginalAsset,
    pageCount: readiness.pageCount,
    chunkCount: readiness.chunkCount,
    pagesMissingImageCount: readiness.pagesMissingImageCount,
    unconfirmedRecognitionPageCount: readiness.unconfirmedRecognitionPageCount,
    blockers: readiness.blockers.map((blocker) => blocker.code)
  };
}
