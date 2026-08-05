import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 保温系统/构造方案模块 Zod Schema（body / query / params / DTO）。
 * - 版本化主体：保温系统、构造方案（同逻辑键多版本行，发布互斥，new-version 派生新草稿）。
 * - 子表：构造层、产品选项、方案文档，随方案版本整组复制，无独立审核列（状态由父方案承载）。
 * - body 中日期（effectiveAt/expiresAt）接受 ISO 字符串，由 z.coerce.date() 转为 Date 传给服务层。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const constructionReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const constructionLayerTypeSchema = z.enum(["BASE_LAYER", "PRODUCT_LAYER", "FIXING_LAYER", "VARIABLE_LAYER"]);
export const schemeDocumentTargetTypeSchema = z.enum(["SYSTEM", "SCHEME"]);
export const constructionEvidenceLevelSchema = z.enum(["A", "B", "C"]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();

/** 证据列（create/update 共用，update 时额外允许省略） */
const evidenceFields = () => ({
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});

/** 厚度：毫米，正数，最多两位小数 */
const thicknessInput = () => z.coerce.number().positive().max(10000).nullable().optional();

// 分页响应包装（挂 schema.response）
const paginated = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: z.object({
    items: z.array(itemDto),
    total: z.number(),
    page: z.number(),
    pageSize: z.number()
  }),
  requestId: z.string()
});
const single = (itemDto: z.ZodType) => z.object({
  success: z.boolean(),
  data: itemDto,
  requestId: z.string()
});

// ---------------------------------------------------------------- 保温系统

export const insulationSystemCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  systemType: z.string().trim().min(1).max(80),
  description: z.string().trim().max(4000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const insulationSystemUpdateSchema = insulationSystemCreateSchema.partial();

export const insulationSystemDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  systemType: z.string(),
  description: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: constructionReviewStatusSchema,
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.date().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.date().nullable(),
  approvalNote: z.string().nullable(),
  rejectedById: z.string().uuid().nullable(),
  rejectedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  publishedById: z.string().uuid().nullable(),
  publishedAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 构造方案

export const constructionSchemeCreateSchema = z.object({
  systemId: z.uuid("保温系统 ID 格式不正确"),
  schemeCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  substrateMaterial: z.string().trim().min(1).max(120),
  substrateThickness: thicknessInput(),
  drawingFileId: z.uuid("图纸文件 ID 格式不正确").nullable().optional(),
  atlasPage: z.string().trim().max(40).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const constructionSchemeUpdateSchema = constructionSchemeCreateSchema.partial();

export const constructionSchemeDto = z.object({
  id: z.uuid(),
  systemId: z.uuid(),
  schemeCode: z.string(),
  version: z.number(),
  name: z.string(),
  substrateMaterial: z.string(),
  substrateThickness: z.number().nullable(),
  drawingFileId: z.string().uuid().nullable(),
  atlasPage: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: constructionReviewStatusSchema,
  submittedById: z.string().uuid().nullable(),
  submittedAt: z.date().nullable(),
  approvedById: z.string().uuid().nullable(),
  approvedAt: z.date().nullable(),
  approvalNote: z.string().nullable(),
  rejectedById: z.string().uuid().nullable(),
  rejectedAt: z.date().nullable(),
  rejectReason: z.string().nullable(),
  publishedById: z.string().uuid().nullable(),
  publishedAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 构造层

export const constructionLayerCreateSchema = z.object({
  layerOrder: z.coerce.number().int().positive().max(100),
  layerType: constructionLayerTypeSchema,
  layerName: z.string().trim().min(1).max(120),
  materialId: z.uuid("材料 ID 格式不正确").nullable().optional(),
  thickness: thicknessInput(),
  ...evidenceFields()
});
export const constructionLayerUpdateSchema = constructionLayerCreateSchema.partial();

export const constructionLayerDto = z.object({
  id: z.uuid(),
  schemeId: z.uuid(),
  layerOrder: z.number(),
  layerType: constructionLayerTypeSchema,
  layerName: z.string(),
  materialId: z.string().uuid().nullable(),
  thickness: z.number().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 产品选项

export const schemeProductOptionCreateSchema = z.object({
  productSpecId: z.uuid("产品规格 ID 格式不正确"),
  minThickness: z.coerce.number().positive().max(10000),
  maxThickness: z.coerce.number().positive().max(10000),
  defaultThickness: z.coerce.number().positive().max(10000).nullable().optional(),
  ...evidenceFields()
});
export const schemeProductOptionUpdateSchema = schemeProductOptionCreateSchema.partial();

export const schemeProductOptionDto = z.object({
  id: z.uuid(),
  schemeId: z.uuid(),
  productSpecId: z.uuid(),
  minThickness: z.number(),
  maxThickness: z.number(),
  defaultThickness: z.number().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 方案文档

export const schemeDocumentCreateSchema = z.object({
  targetType: schemeDocumentTargetTypeSchema,
  targetId: z.uuid("目标 ID 格式不正确"),
  knowledgeDocumentId: z.uuid("知识文档 ID 格式不正确").nullable().optional(),
  atlasPage: z.string().trim().max(40).nullable().optional(),
  ...evidenceFields()
});
export const schemeDocumentUpdateSchema = schemeDocumentCreateSchema.partial();

export const schemeDocumentDto = z.object({
  id: z.uuid(),
  targetType: schemeDocumentTargetTypeSchema,
  targetId: z.uuid(),
  knowledgeDocumentId: z.string().uuid().nullable(),
  atlasPage: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: constructionEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  createdById: z.string().uuid().nullable(),
  updatedById: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// ---------------------------------------------------------------- 工作流请求体

/** 审核通过（approve）：approvalNote 可选 */
export const approveBodySchema = z.object({
  approvalNote: z.string().trim().max(2000).optional()
});

/** 驳回（reject）：rejectReason 必填，体现审核决议 */
export const rejectBodySchema = z.object({
  rejectReason: z.string().trim().min(1, "驳回原因必填").max(2000)
});

/** 派生新版本：changeNote 可选 */
export const newVersionBodySchema = z.object({
  changeNote: z.string().trim().max(2000).optional()
});

// ---------------------------------------------------------------- 查询 schema（挂 request.querystring）

const statusQueryShape = {
  status: constructionReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
};

export const constructionSystemListQuerySchema = paginationQuerySchema.extend(statusQueryShape);
export const constructionSchemeListQuerySchema = paginationQuerySchema.extend(statusQueryShape).extend({
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
  schemeCode: z.string().trim().max(40).optional()
});
export const constructionLayerListQuerySchema = paginationQuerySchema.extend(statusQueryShape);
export const constructionOptionListQuerySchema = paginationQuerySchema.extend(statusQueryShape);
export const constructionDocumentListQuerySchema = paginationQuerySchema.extend({
  targetType: schemeDocumentTargetTypeSchema.optional(),
  targetId: z.uuid("目标 ID 格式不正确").optional(),
  status: constructionReviewStatusSchema.optional()
});

// ---------------------------------------------------------------- 已发布读取（只读 PUBLISHED + 生效中）

export const publishedSystemQuerySchema = z.object({
  systemType: z.string().trim().max(80).optional(),
  keyword: z.string().trim().max(80).optional()
});
export const publishedSchemeQuerySchema = z.object({
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
  schemeCode: z.string().trim().max(40).optional(),
  keyword: z.string().trim().max(80).optional()
});

// ---------------------------------------------------------------- 响应包装集合

/** 方案详情聚合：方案 + 层 + 产品选项 + 文档 */
export const schemeDetailDto = constructionSchemeDto.extend({
  layers: z.array(constructionLayerDto),
  productOptions: z.array(schemeProductOptionDto),
  documents: z.array(schemeDocumentDto)
});

export const CONSTRUCTION_RESPONSES = {
  /** 通用单对象包装：data 为实体 DTO */
  single,
  /** 通用分页包装：data 为 { items, total, page, pageSize } */
  paginated,
  /** 通用数组包装：data 为 { items } */
  publishedList: (itemDto: z.ZodType) => single(z.object({ items: z.array(itemDto) })),
  systemList: paginated(insulationSystemDto),
  systemSingle: single(insulationSystemDto),
  schemeList: paginated(constructionSchemeDto),
  schemeSingle: single(constructionSchemeDto),
  schemeDetail: single(schemeDetailDto),
  layerList: paginated(constructionLayerDto),
  layerSingle: single(constructionLayerDto),
  optionList: paginated(schemeProductOptionDto),
  optionSingle: single(schemeProductOptionDto),
  documentList: paginated(schemeDocumentDto),
  documentSingle: single(schemeDocumentDto),
  message: single(z.object({ message: z.string() }))
};