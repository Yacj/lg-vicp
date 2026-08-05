import { z } from "zod";
import { paginationQuerySchema } from "../../shared/pagination.js";

/**
 * 主数据模块 Zod Schema（body / query / params / DTO）。
 * - body 中日期（effectiveAt/expiresAt）接受 ISO 字符串，由 z.coerce.date() 转为 Date 传给服务层；
 *   issueDate/expiryDate 为 date 列，保持 YYYY-MM-DD 字符串。
 * - update body 字段一律 nullable + optional：undefined=不修改，null=清空。
 * - DTO 挂 schema.response，日期序列化为 ISO 字符串（fastify-type-provider-zod 标准行为）。
 */

// ---------------------------------------------------------------- 公共

export const uuidParams = z.object({ id: z.uuid("ID 格式不正确") });

export const mdReviewStatusSchema = z.enum(["DRAFT", "PENDING_REVIEW", "APPROVED", "PUBLISHED", "DISABLED", "REJECTED"]);
export const mdEvidenceLevelSchema = z.enum(["A", "B", "C"]);
export const mdSpecClassSchema = z.enum(["I", "II", "III"]);
export const mdParamSourceSchema = z.enum(["TECHNICAL_REGULATION", "ATLAS", "DETECTION", "ENTERPRISE_NOMINAL"]);
export const mdProductionStatusSchema = z.enum(["PRODUCING", "STOPPED"]);
export const mdStandardTypeSchema = z.enum(["STANDARD", "CUSTOM"]);
export const mdAttachmentTargetTypeSchema = z.enum(["PRODUCT_SERIES", "PRODUCT_SPEC", "ENTERPRISE"]);

/** ISO 时间字符串 -> Date（服务层入参） */
const dateInput = () => z.coerce.date().nullable().optional();
/** date 列（YYYY-MM-DD 字符串） */
const plainDateInput = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").nullable().optional();

/** 证据列（create/update 共用，update 时额外允许省略） */
const evidenceFields = () => ({
  evidenceSource: z.string().trim().max(500).nullable().optional(),
  evidenceRef: z.string().trim().max(120).nullable().optional(),
  evidenceLevel: mdEvidenceLevelSchema.nullable().optional(),
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

// ---------------------------------------------------------------- 企业内容

export const enterpriseProfileCreateSchema = z.object({
  code: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(160),
  shortName: z.string().trim().max(80).nullable().optional(),
  intro: z.string().trim().max(10000).nullable().optional(),
  logoFileId: z.uuid("文件 ID 格式不正确").nullable().optional(),
  address: z.string().trim().max(255).nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  contactEmail: z.string().trim().max(120).nullable().optional(),
  website: z.string().trim().max(200).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const enterpriseProfileUpdateSchema = enterpriseProfileCreateSchema.partial();

export const enterpriseProfileDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  shortName: z.string().nullable(),
  intro: z.string().nullable(),
  logoFileId: z.string().uuid().nullable(),
  address: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  website: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 企业证书

export const certificateCreateSchema = z.object({
  certName: z.string().trim().min(1).max(160),
  certNo: z.string().trim().max(120).nullable().optional(),
  issuer: z.string().trim().max(160).nullable().optional(),
  issueDate: plainDateInput(),
  expiryDate: plainDateInput(),
  fileId: z.uuid("文件 ID 格式不正确").nullable().optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  ...evidenceFields()
});
export const certificateUpdateSchema = certificateCreateSchema.partial();

export const certificateDto = z.object({
  id: z.uuid(),
  certName: z.string(),
  certNo: z.string().nullable(),
  issuer: z.string().nullable(),
  issueDate: z.string().nullable(),
  expiryDate: z.string().nullable(),
  fileId: z.string().uuid().nullable(),
  description: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 产品系列

export const productSeriesCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(10000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const productSeriesUpdateSchema = productSeriesCreateSchema.partial();

export const productSeriesDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 产品规格

export const productSpecCreateSchema = z.object({
  seriesId: z.uuid("系列 ID 格式不正确"),
  specCode: z.string().trim().min(1).max(80),
  specClass: mdSpecClassSchema,
  thicknessMm: z.number().positive("厚度必须大于 0"),
  lengthMm: z.number().positive("长度必须大于 0").nullable().optional(),
  widthMm: z.number().positive("宽度必须大于 0").nullable().optional(),
  combustionGrade: z.string().trim().max(20).nullable().optional(),
  productionStatus: mdProductionStatusSchema.optional(),
  standardType: mdStandardTypeSchema.optional(),
  supplyRegions: z.array(z.string().trim().min(1).max(40)).max(50).optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const productSpecUpdateSchema = productSpecCreateSchema.partial();

export const productSpecDto = z.object({
  id: z.uuid(),
  seriesId: z.string().uuid(),
  specCode: z.string(),
  version: z.number(),
  specClass: mdSpecClassSchema,
  thicknessMm: z.number(),
  lengthMm: z.number().nullable(),
  widthMm: z.number().nullable(),
  combustionGrade: z.string().nullable(),
  productionStatus: mdProductionStatusSchema,
  standardType: mdStandardTypeSchema,
  supplyRegions: z.array(z.string()),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 产品性能参数

export const productParameterCreateSchema = z.object({
  specId: z.uuid("规格 ID 格式不正确"),
  parameterCode: z.string().trim().min(1).max(80),
  parameterName: z.string().trim().min(1).max(120),
  paramSource: mdParamSourceSchema,
  value: z.number("参数值必须为数字"),
  unit: z.string().trim().max(40).nullable().optional(),
  allowedUsage: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  applicableScope: z.string().trim().max(2000).nullable().optional(),
  testReportFileId: z.uuid("文件 ID 格式不正确").nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const productParameterUpdateSchema = productParameterCreateSchema.partial();

export const productParameterDto = z.object({
  id: z.uuid(),
  specId: z.string().uuid(),
  parameterCode: z.string(),
  parameterName: z.string(),
  paramSource: mdParamSourceSchema,
  version: z.number(),
  value: z.number(),
  unit: z.string().nullable(),
  allowedUsage: z.array(z.string()),
  applicableScope: z.string().nullable(),
  testReportFileId: z.string().uuid().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

/** 参数冲突视图（listProductParameterGroups）：组内四来源并存 */
export const productParameterGroupDto = z.object({
  specId: z.string().uuid(),
  parameterCode: z.string(),
  parameterName: z.string(),
  sources: z.array(productParameterDto)
});

// ---------------------------------------------------------------- 产品附件

export const attachmentCreateSchema = z.object({
  targetType: mdAttachmentTargetTypeSchema,
  targetId: z.uuid("目标 ID 格式不正确"),
  fileId: z.uuid("文件 ID 格式不正确"),
  attachmentType: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const attachmentUpdateSchema = attachmentCreateSchema.partial();

export const attachmentDto = z.object({
  id: z.uuid(),
  targetType: mdAttachmentTargetTypeSchema,
  targetId: z.string().uuid(),
  fileId: z.string().uuid(),
  attachmentType: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 材料

export const materialCreateSchema = z.object({
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(60).nullable().optional(),
  description: z.string().trim().max(10000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const materialUpdateSchema = materialCreateSchema.partial();

export const materialDto = z.object({
  id: z.uuid(),
  code: z.string(),
  version: z.number(),
  name: z.string(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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

// ---------------------------------------------------------------- 材料参数版本

export const materialParameterCreateSchema = z.object({
  materialId: z.uuid("材料 ID 格式不正确"),
  thermalConductivity: z.number("导热系数必须为数字"),
  correctionFactor: z.number("修正系数必须为数字").nullable().optional(),
  density: z.number("密度必须为数字").nullable().optional(),
  compressiveStrength: z.number("抗压强度必须为数字").nullable().optional(),
  bondStrength: z.number("粘结强度必须为数字").nullable().optional(),
  combustionGrade: z.string().trim().max(20).nullable().optional(),
  applicableStandard: z.string().trim().max(200).nullable().optional(),
  source: z.string().trim().max(255).nullable().optional(),
  allowedUsage: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  applicableScope: z.string().trim().max(2000).nullable().optional(),
  changeNote: z.string().trim().max(2000).nullable().optional(),
  ...evidenceFields()
});
export const materialParameterUpdateSchema = materialParameterCreateSchema.partial();

export const materialParameterDto = z.object({
  id: z.uuid(),
  materialId: z.string().uuid(),
  version: z.number(),
  thermalConductivity: z.number(),
  correctionFactor: z.number().nullable(),
  density: z.number().nullable(),
  compressiveStrength: z.number().nullable(),
  bondStrength: z.number().nullable(),
  combustionGrade: z.string().nullable(),
  applicableStandard: z.string().nullable(),
  source: z.string().nullable(),
  allowedUsage: z.array(z.string()),
  applicableScope: z.string().nullable(),
  changeNote: z.string().nullable(),
  evidenceSource: z.string().nullable(),
  evidenceRef: z.string().nullable(),
  evidenceLevel: mdEvidenceLevelSchema.nullable(),
  effectiveAt: z.date().nullable(),
  expiresAt: z.date().nullable(),
  status: mdReviewStatusSchema,
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
  status: mdReviewStatusSchema.optional(),
  keyword: z.string().trim().max(80).optional()
};

export const mdListQuerySchema = paginationQuerySchema.extend(statusQueryShape);
export const mdSpecListQuerySchema = paginationQuerySchema.extend(statusQueryShape).extend({
  seriesId: z.uuid("系列 ID 格式不正确").optional(),
  specClass: mdSpecClassSchema.optional(),
  standardType: mdStandardTypeSchema.optional(),
  productionStatus: mdProductionStatusSchema.optional()
});
export const mdParameterListQuerySchema = paginationQuerySchema.extend(statusQueryShape).extend({
  specId: z.uuid("规格 ID 格式不正确").optional(),
  parameterCode: z.string().trim().max(80).optional(),
  paramSource: mdParamSourceSchema.optional()
});
export const mdMaterialParameterListQuerySchema = paginationQuerySchema.extend(statusQueryShape).extend({
  materialId: z.uuid("材料 ID 格式不正确").optional()
});
export const mdAttachmentListQuerySchema = paginationQuerySchema.extend({
  targetType: mdAttachmentTargetTypeSchema.optional(),
  targetId: z.uuid("目标 ID 格式不正确").optional(),
  status: mdReviewStatusSchema.optional()
});
export const mdParameterGroupQuerySchema = z.object({
  specId: z.uuid("规格 ID 格式不正确").optional(),
  status: mdReviewStatusSchema.optional()
});

// ---------------------------------------------------------------- 已发布读取（只读 PUBLISHED + 生效中）

export const publishedSpecQuerySchema = z.object({
  seriesId: z.uuid("系列 ID 格式不正确").optional(),
  specClass: mdSpecClassSchema.optional(),
  keyword: z.string().trim().max(80).optional()
});
export const publishedParameterQuerySchema = z.object({
  specId: z.uuid("规格 ID 格式不正确").optional(),
  parameterCode: z.string().trim().max(80).optional(),
  usage: z.string().trim().max(40).optional()
});
export const publishedMaterialQuerySchema = z.object({
  keyword: z.string().trim().max(80).optional()
});
export const publishedMaterialParameterQuerySchema = z.object({
  materialId: z.uuid("材料 ID 格式不正确").optional(),
  usage: z.string().trim().max(40).optional()
});

/** 响应包装集合（供路由 schema.response 引用） */
export const MD_RESPONSES = {
  /** 通用单对象包装：data 为实体 DTO */
  single,
  /** 通用分页包装：data 为 { items, total, page, pageSize } */
  paginated,
  /** 通用数组包装：data 为 { items } */
  publishedList: (itemDto: z.ZodType) => single(z.object({ items: z.array(itemDto) })),
  profileList: paginated(enterpriseProfileDto),
  profileSingle: single(enterpriseProfileDto),
  certificateList: paginated(certificateDto),
  certificateSingle: single(certificateDto),
  seriesList: paginated(productSeriesDto),
  seriesSingle: single(productSeriesDto),
  specList: paginated(productSpecDto),
  specSingle: single(productSpecDto),
  parameterList: paginated(productParameterDto),
  parameterSingle: single(productParameterDto),
  parameterGroups: single(z.object({ groups: z.array(productParameterGroupDto) })),
  attachmentList: paginated(attachmentDto),
  attachmentSingle: single(attachmentDto),
  materialList: paginated(materialDto),
  materialSingle: single(materialDto),
  materialParameterList: paginated(materialParameterDto),
  materialParameterSingle: single(materialParameterDto),
  message: single(z.object({ message: z.string() }))
} as const;