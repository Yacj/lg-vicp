import { z } from "zod";

export const supportedMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "application/acad",
  "application/dxf"
] as const;

export const filePurposeSchema = z.enum(["GENERAL", "CHAT_IMAGE"]);

export const createUploadIntentBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  purpose: filePurposeSchema.default("GENERAL"),
  fileName: z.string().trim().min(1, "请输入文件名").max(255, "文件名不能超过 255 个字符"),
  mimeType: z.enum(supportedMimeTypes, "暂不支持该文件类型"),
  sizeBytes: z.number().int().positive("文件大小必须大于 0"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 格式不正确").optional()
});

export const fileParamsSchema = z.object({ id: z.uuid("文件 ID 格式不正确") });

/** 文件中心列表 / FilePicker 查询条件 */
export const fileCenterListQuerySchema = z.object({
  keyword: z.string().trim().max(120, "关键词不能超过 120 个字符").optional(),
  mimeType: z.string().trim().max(160).optional(),
  extension: z.string().trim().max(12).optional(),
  source: z.enum(["USER_UPLOAD", "BATCH_IMPORT", "CRAWLER", "INTERNAL_API", "THERMAL_IMPORT", "COLLECTION"], "文件来源不正确").optional(),
  status: z.enum(["UPLOADING", "UPLOADED", "QUEUED", "PARSING", "OCR_REQUIRED", "INDEXING", "READY", "FAILED", "RECYCLED"], "文件状态不正确").optional(),
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  createdFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").optional(),
  createdTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD").optional(),
  sort: z.enum(["createdAt", "sizeBytes", "originalName"], "排序字段不正确").optional(),
  includeRecycled: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100, "每页最多 100 条").default(20)
});

/** 最近使用（FilePicker 默认页签） */
export const fileRecentQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50, "最多返回 50 条").optional()
});
