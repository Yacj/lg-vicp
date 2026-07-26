import { z } from "zod";

export const supportedMimeTypes = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg"
] as const;

export const createUploadIntentBodySchema = z.object({
  projectId: z.uuid("项目 ID 格式不正确").optional(),
  fileName: z.string().trim().min(1, "请输入文件名").max(255, "文件名不能超过 255 个字符"),
  mimeType: z.enum(supportedMimeTypes, "暂不支持该文件类型"),
  sizeBytes: z.number().int().positive("文件大小必须大于 0"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, "SHA-256 格式不正确").optional()
});

export const fileParamsSchema = z.object({ id: z.uuid("文件 ID 格式不正确") });
