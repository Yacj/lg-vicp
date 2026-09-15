import { z } from "zod";

/**
 * 普通企业信息 DTO：只暴露名称/简称/Logo/简介/官网/资质。
 * 工商、银行、联系人等历史字段不进入本 schema。
 */

export const companyQualificationWriteSchema = z.object({
  name: z.string().trim().min(1, "请输入资质名称").max(160, "资质名称不能超过 160 个字符"),
  fileId: z.uuid("资质附件文件 ID 格式不正确"),
  certificateNo: z.string().trim().max(120, "证书编号不能超过 120 个字符").nullable().optional(),
  expireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "有效期格式应为 YYYY-MM-DD").nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional()
});

export const companyQualificationUpdateSchema = companyQualificationWriteSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "请至少提供一个要修改的字段" }
);

export const companyProfileUpdateSchema = z.object({
  name: z.string().trim().min(1, "请输入企业名称").max(160, "企业名称不能超过 160 个字符"),
  shortName: z.string().trim().max(80, "企业简称不能超过 80 个字符").nullable().optional(),
  logoFileId: z.uuid("Logo 文件 ID 格式不正确").nullable().optional(),
  description: z.string().trim().max(10000, "企业简介不能超过 10000 个字符").nullable().optional(),
  website: z.string().trim().max(200, "企业官网不能超过 200 个字符").nullable().optional()
});

export const companyQualificationDto = z.object({
  id: z.uuid(),
  name: z.string(),
  fileId: z.string().uuid().nullable(),
  certificateNo: z.string().nullable(),
  expireDate: z.string().nullable(),
  sortOrder: z.number(),
  previewUrl: z.string().nullable(),
  mimeType: z.string().nullable()
});

export const companyProfileDto = z.object({
  id: z.string().uuid().nullable(),
  name: z.string(),
  shortName: z.string().nullable(),
  logoFileId: z.string().uuid().nullable(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  logoPreviewUrl: z.string().nullable(),
  qualifications: z.array(companyQualificationDto),
  updatedAt: z.string().nullable()
});

export const companyAboutQualificationDto = z.object({
  id: z.uuid(),
  name: z.string(),
  fileId: z.string().uuid().nullable(),
  certificateNo: z.string().nullable(),
  expireDate: z.string().nullable(),
  sortOrder: z.number(),
  file: z.object({
    fileId: z.string().uuid(),
    previewUrl: z.string(),
    mimeType: z.string().nullable()
  }).nullable()
});

export const companyAboutDto = z.object({
  name: z.string(),
  shortName: z.string().nullable(),
  logo: z.object({
    fileId: z.string().uuid(),
    previewUrl: z.string()
  }).nullable(),
  description: z.string().nullable(),
  website: z.string().nullable(),
  qualifications: z.array(companyAboutQualificationDto)
});

const envelope = (data: z.ZodType) => z.object({
  success: z.boolean(),
  data,
  requestId: z.string()
});

export const COMPANY_RESPONSES = {
  profile: envelope(companyProfileDto),
  qualification: envelope(companyQualificationDto),
  qualificationList: envelope(z.object({ items: z.array(companyQualificationDto) })),
  message: envelope(z.object({ message: z.string() })),
  about: envelope(companyAboutDto)
} as const;

export const companyQualificationIdParams = z.object({
  id: z.uuid("资质 ID 格式不正确")
});
