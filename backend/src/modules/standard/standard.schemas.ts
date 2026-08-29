import { z } from "zod";

/**
 * 地方标准采集模块 Zod Schema（body / query / params / DTO）。
 * - 双通道：ingestType CRAWL（爬虫）| MANUAL（人工录入），文档行冗余 provinceCode 主维度。
 * - 人工录入为组合提交：文档元数据 + 适用范围[] + 指标[]，指标证据条款引用必填（refine 兜底）。
 * - body 中日期接受 ISO 字符串，由 z.coerce.date() 转为 Date 传给服务层。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const standardReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const standardIngestTypeSchema = z.enum(["CRAWL", "MANUAL"]);
export const standardDocumentStatusSchema = z.enum(["DRAFT_CONSULTATION", "OFFICIAL", "SUPERSEDED", "REPEALED"]);
export const standardIndicatorTypeSchema = z.enum(["K_VALUE", "HEAT_RESISTANCE", "OTHER"]);
export const standardReplacementTypeSchema = z.enum(["SUPERSEDE", "REPEAL"]);
export const standardCrawlScopeSchema = z.enum(["today", "all"]);

/** ISO 时间字符串 -> Date（服务层入参，nullable+optional：null=清空） */
const dateInput = () => z.coerce.date().nullable().optional();

const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({ items: z.array(itemDto), total: z.number(), page: z.number(), pageSize: z.number() }),
  requestId: z.string()
});
const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

// ---------------------------------------------------------------- 审核动作公共 body

export const approvalBodySchema = z.object({
  approvalNote: z.string().trim().max(2000).nullable().optional()
});
export const rejectBodySchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(2000)
});

// ---------------------------------------------------------------- 抓取来源

const catalogUrlSchema = z.object({
  label: z.string().trim().min(1).max(120),
  url: z.string().trim().url("栏目 URL 格式不正确").max(1000),
  listSelector: z.string().trim().max(300).optional(),
  itemLinkSelector: z.string().trim().max(300).optional(),
  paginationMode: z.enum(["url", "scroll", "none"]).default("none"),
  pageParam: z.string().trim().max(80).optional(),
  pageLimit: z.number().int().min(1).max(200).optional()
});

const extractRuleSchema = z.object({
  field: z.string().trim().min(1).max(80),
  pattern: z.string().trim().min(1).max(500),
  flags: z.string().trim().max(20).optional()
});

export const sourceCreateSchema = z.object({
  provinceCode: z.string().trim().min(1).max(40),
  provinceName: z.string().trim().min(1).max(120),
  officialDomain: z.string().trim().min(1).max(255),
  catalogUrls: z.array(catalogUrlSchema).max(50).default([]),
  extractRules: z.array(extractRuleSchema).max(50).default([]),
  keywords: z.object({
    titleKeywords: z.array(z.string().trim().min(1)).max(100).default([]),
    excludeKeywords: z.array(z.string().trim().min(1)).max(100).default([])
  }).default({ titleKeywords: [], excludeKeywords: [] }),
  crawlScope: standardCrawlScopeSchema.default("today"),
  enabled: z.boolean().default(true),
  // 运营补强：人工备注由 B 端维护（其余 last* 字段由抓取收尾处回写，不在创建/更新入参中）
  operatorRemark: z.string().trim().max(1000, "人工备注不能超过 1000 个字符").nullable().optional()
});
export const sourceUpdateSchema = sourceCreateSchema.partial();

export const crawlTriggerBodySchema = z.object({
  scope: standardCrawlScopeSchema.optional()
});

// ---------------------------------------------------------------- 抓取作业

export const crawlJobListQuerySchema = z.object({
  sourceId: z.uuid("来源 ID 格式不正确").optional(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCESS", "FAILED"]).optional()
});

// ---------------------------------------------------------------- 标准文档（双通道）

export const documentListQuerySchema = z.object({
  provinceCode: z.string().trim().max(40).optional(),
  documentNo: z.string().trim().max(120).optional(),
  standardStatus: standardDocumentStatusSchema.optional(),
  reviewStatus: standardReviewStatusSchema.optional(),
  ingestType: standardIngestTypeSchema.optional(),
  sourceId: z.uuid("来源 ID 格式不正确").optional()
});

export const applicabilityInputSchema = z.object({
  regionCode: z.string().trim().min(1).max(40),
  regionName: z.string().trim().min(1).max(120),
  buildingTypes: z.array(z.string().trim().min(1)).max(100).default([]),
  structureTypes: z.array(z.string().trim().min(1)).max(100).default([]),
  scopeText: z.string().trim().max(4000).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional()
});

export const indicatorInputSchema = z.object({
  indicatorType: standardIndicatorTypeSchema.default("K_VALUE"),
  indicatorName: z.string().trim().min(1).max(120),
  value: z.coerce.number().positive("指标数值必须为正数").max(100000),
  unit: z.string().trim().max(40).nullable().optional(),
  evidenceRef: z.string().trim().min(1, "证据条款引用必填").max(120),
  rawText: z.string().trim().max(4000).nullable().optional()
});

/** 人工录入组合提交：文档 + 适用范围[] + 指标[]；至少一条指标且证据引用必填 */
export const manualDocumentCreateSchema = z.object({
  provinceCode: z.string().trim().min(1).max(40),
  provinceName: z.string().trim().min(1).max(120),
  documentNo: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().max(80).nullable().optional(),
  standardStatus: standardDocumentStatusSchema.default("OFFICIAL"),
  publishDate: z.coerce.date().nullable().optional(),
  implementDate: z.coerce.date().nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput(),
  originUrl: z.string().trim().url("原文链接格式不正确").max(1000).nullable().optional(),
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  applicability: z.array(applicabilityInputSchema).max(100).default([]),
  indicators: z.array(indicatorInputSchema).min(1, "至少录入一条指标")
}).refine(
  (value) => value.indicators.every((indicator) => indicator.evidenceRef.trim().length > 0),
  { message: "每条指标必须填写证据条款引用（evidenceRef）", path: ["indicators"] }
);

export const documentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  category: z.string().trim().max(80).nullable().optional(),
  standardStatus: standardDocumentStatusSchema.optional(),
  publishDate: z.coerce.date().nullable().optional(),
  implementDate: z.coerce.date().nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput(),
  originUrl: z.string().trim().url("原文链接格式不正确").max(1000).nullable().optional()
});

// ---------------------------------------------------------------- 适用范围 / 指标 / 替代关系

export const applicabilityCreateSchema = applicabilityInputSchema.extend({
  documentId: z.uuid("文档 ID 格式不正确")
});
export const applicabilityUpdateSchema = applicabilityInputSchema.partial();

export const indicatorListQuerySchema = z.object({
  documentId: z.uuid("文档 ID 格式不正确").optional(),
  reviewStatus: standardReviewStatusSchema.optional(),
  indicatorType: standardIndicatorTypeSchema.optional()
});

export const indicatorUpdateSchema = z.object({
  indicatorName: z.string().trim().min(1).max(120).optional(),
  value: z.coerce.number().positive("指标数值必须为正数").max(100000).optional(),
  unit: z.string().trim().max(40).nullable().optional(),
  evidenceRef: z.string().trim().min(1).max(120).optional(),
  rawText: z.string().trim().max(4000).nullable().optional()
});

export const replacementCreateSchema = z.object({
  oldDocumentId: z.uuid("旧文档 ID 格式不正确"),
  newDocumentId: z.uuid("新文档 ID 格式不正确"),
  replacementType: standardReplacementTypeSchema.default("SUPERSEDE"),
  transitionStartAt: dateInput(),
  transitionEndAt: dateInput(),
  note: z.string().trim().max(2000).nullable().optional()
});
export const replacementListQuerySchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "REJECTED"]).optional()
});

// ---------------------------------------------------------------- 生效标准查询

export const effectiveStandardsQuerySchema = z.object({
  regionCode: z.string().trim().min(1).max(40),
  asOfDate: z.coerce.date().optional()
});

// ---------------------------------------------------------------- DTO（响应结构描述）

export const sourceDto = z.object({
  id: z.uuid(),
  provinceCode: z.string(),
  provinceName: z.string(),
  officialDomain: z.string(),
  catalogUrls: z.array(catalogUrlSchema),
  parserType: z.string(),
  extractRules: z.array(extractRuleSchema),
  keywords: z.object({ titleKeywords: z.array(z.string()), excludeKeywords: z.array(z.string()) }),
  crawlScope: standardCrawlScopeSchema,
  enabled: z.boolean(),
  lastCrawledAt: z.date().nullable(),
  lastCrawlStatus: z.string().nullable(),
  lastCrawlSummary: z.record(z.string(), z.unknown()).nullable(),
  lastErrorMessage: z.string().nullable(),
  operatorRemark: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

export const crawlJobDto = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCESS", "FAILED"]),
  triggeredBy: z.enum(["SCHEDULE", "MANUAL"]),
  scope: standardCrawlScopeSchema,
  catalogResults: z.array(z.record(z.string(), z.unknown())),
  statsJson: z.record(z.string(), z.unknown()).nullable(),
  errorMessage: z.string().nullable(),
  startedAt: z.date().nullable(),
  finishedAt: z.date().nullable(),
  createdAt: z.date()
});

export const documentDto = z.object({
  id: z.uuid(),
  ingestType: standardIngestTypeSchema,
  provinceCode: z.string(),
  provinceName: z.string(),
  sourceId: z.uuid().nullable(),
  crawlJobId: z.uuid().nullable(),
  documentNo: z.string(),
  title: z.string(),
  category: z.string().nullable(),
  standardStatus: standardDocumentStatusSchema,
  publishDate: z.date().nullable(),
  implementDate: z.date().nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  originUrl: z.string().nullable(),
  pageHtmlObjectKey: z.string().nullable(),
  pageHtmlSha256: z.string().nullable(),
  fileObjectKey: z.string().nullable(),
  fileSha256: z.string().nullable(),
  fileSize: z.number().nullable(),
  screenshotObjectKey: z.string().nullable(),
  parseStatus: z.enum(["PENDING", "PARSED", "FAILED"]),
  supersededById: z.uuid().nullable(),
  version: z.number(),
  status: standardReviewStatusSchema,
  submittedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  publishedAt: z.date().nullable(),
  createdById: z.uuid().nullable(),
  createdAt: z.date()
});

export const applicabilityDto = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  regionCode: z.string(),
  regionName: z.string(),
  buildingTypes: z.array(z.string()),
  structureTypes: z.array(z.string()),
  scopeText: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  status: standardReviewStatusSchema,
  createdAt: z.date()
});

export const indicatorDto = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  applicabilityId: z.uuid().nullable(),
  indicatorType: standardIndicatorTypeSchema,
  indicatorName: z.string(),
  value: z.number(),
  unit: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  rawText: z.string().nullable(),
  evidenceLevel: z.enum(["A", "B", "C"]).nullable(),
  screenshotObjectKey: z.string().nullable(),
  status: standardReviewStatusSchema,
  reviewedAt: z.date().nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  version: z.number(),
  createdAt: z.date()
});

export const replacementDto = z.object({
  id: z.uuid(),
  oldDocumentId: z.uuid(),
  newDocumentId: z.uuid(),
  replacementType: standardReplacementTypeSchema,
  transitionStartAt: z.date().nullable(),
  transitionEndAt: z.date().nullable(),
  status: z.enum(["PENDING", "CONFIRMED", "REJECTED"]),
  note: z.string().nullable(),
  confirmedById: z.uuid().nullable(),
  confirmedAt: z.date().nullable(),
  createdAt: z.date()
});

export const effectiveStandardDto = z.object({
  document: documentDto,
  applicability: z.array(applicabilityDto),
  indicators: z.array(indicatorDto)
});

export const publishedIndicatorQuerySchema = z.object({
  regionCode: z.string().trim().min(1).max(40),
  indicatorType: standardIndicatorTypeSchema.optional()
});