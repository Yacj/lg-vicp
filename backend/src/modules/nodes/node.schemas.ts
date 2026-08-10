import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 节点图库模块 Zod Schema（body / query / params / DTO）。
 * - 版本化主体：节点图 node_drawings（同逻辑键多版本行，发布互斥，new-version 派生新草稿）。
 * - 子表：节点-方案关联 node_scheme_links，随节点版本整组复制，无独立审核列（状态由父节点承载）。
 * - 部位 position 为自由文本精确匹配（标准词汇表待甲方确认，后续可迁字典）。
 * - body 中日期（effectiveAt/expiresAt）接受 ISO 字符串，由 z.coerce.date() 转为 Date 传给服务层。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const nodeReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const nodeEvidenceLevelSchema = z.enum(["A", "B", "C"]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();

/** 证据列（create/update 共用，update 时额外允许省略） */
const evidenceFields = () => ({
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: nodeEvidenceLevelSchema.nullable().optional(),
  effectiveAt: dateInput(),
  expiresAt: dateInput()
});

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

// ---------------------------------------------------------------- 节点图（版本化主体）

export const nodeDrawingCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  /** 部位（自由文本，精确匹配检索；标准词汇表待甲方确认） */
  position: z.string().trim().min(1, "请输入部位").max(80),
  systemId: z.uuid("保温系统 ID 格式不正确").nullable().optional(),
  atlasPage: z.string().trim().max(40).nullable().optional(),
  imageFileId: z.uuid("高清图文件 ID 格式不正确").nullable().optional(),
  cadFileId: z.uuid("CAD 文件 ID 格式不正确").nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const nodeDrawingUpdateSchema = nodeDrawingCreateSchema.partial();

export const nodeDrawingDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  position: z.string(),
  systemId: z.string().uuid().nullable(),
  atlasPage: z.string().nullable(),
  imageFileId: z.string().uuid().nullable(),
  cadFileId: z.string().uuid().nullable(),
  description: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: nodeEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: nodeReviewStatusSchema,
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

// ---------------------------------------------------------------- 节点-方案关联（子表）

export const nodeSchemeLinkCreateSchema = z.object({
  schemeId: z.uuid("构造方案 ID 格式不正确"),
  atlasPage: z.string().trim().max(40).nullable().optional(),
  remark: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const nodeSchemeLinkUpdateSchema = nodeSchemeLinkCreateSchema.partial();

export const nodeSchemeLinkDto = z.object({
  id: z.uuid(),
  nodeDrawingId: z.uuid(),
  schemeId: z.uuid(),
  atlasPage: z.string().nullable(),
  remark: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: nodeEvidenceLevelSchema.nullable(),
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

export const nodeDrawingListQuerySchema = paginationQuerySchema.extend({
  status: nodeReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional(),
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
  /** 部位精确匹配（节点检索核心条件） */
  position: z.string().trim().max(80).optional()
});

export const nodeLinkListQuerySchema = paginationQuerySchema.extend({
  status: nodeReviewStatusSchema.optional()
});

// ---------------------------------------------------------------- 已发布读取（只读 PUBLISHED + 生效中）

export const publishedNodeQuerySchema = z.object({
  systemId: z.uuid("保温系统 ID 格式不正确").optional(),
  /** 部位精确匹配（节点检索核心条件） */
  position: z.string().trim().max(80).optional(),
  keyword: z.string().trim().max(80).optional()
});

/** 已发布节点详情：节点 + 关联方案（仅已发布且生效中的方案） */
export const publishedNodeDetailDto = nodeDrawingDto.extend({
  schemeLinks: z.array(nodeSchemeLinkDto)
});

// ---------------------------------------------------------------- 响应包装集合

export const NODE_RESPONSES = {
  single,
  paginated,
  /** 已发布列表包装：data 为 { items } */
  publishedList: (itemDto: z.ZodType) => single(z.object({ items: z.array(itemDto) })),
  nodeList: paginated(nodeDrawingDto),
  nodeSingle: single(nodeDrawingDto),
  nodeDetail: single(publishedNodeDetailDto),
  linkList: paginated(nodeSchemeLinkDto),
  linkSingle: single(nodeSchemeLinkDto),
  message: single(z.object({ message: z.string() }))
};