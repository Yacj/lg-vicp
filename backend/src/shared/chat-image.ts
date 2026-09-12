import { env } from "../config/env.js";

/** 聊天图片允许的 MIME（JPG/JPEG/PNG） */
export const CHAT_IMAGE_MIME_TYPES = ["image/jpeg", "image/png"] as const;
export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number];

/** 单次发送最多 4 张 */
export const CHAT_IMAGE_MAX_COUNT = 4;

/** 产品层单张建议上限 10MB，实际硬限制不超过全局上传上限 */
export const CHAT_IMAGE_SUGGESTED_MAX_BYTES = 10 * 1024 * 1024;

/** Vision 看图用的短时签名 URL（秒） */
export const VISION_SIGNED_URL_EXPIRES_SECONDS = 120;

export function isChatImageMime(mimeType: string): mimeType is ChatImageMimeType {
  return (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function chatImageMaxBytes(): number {
  return Math.min(CHAT_IMAGE_SUGGESTED_MAX_BYTES, env.MAX_UPLOAD_BYTES);
}

/** CHAT_IMAGE 上传完成后直接 READY，不得进入文档/知识/PDF 解析 */
export function shouldEnqueueDocumentParse(purpose: string | null | undefined): boolean {
  return purpose !== "CHAT_IMAGE";
}

export function isReusableChatImage(file: { status: string; mimeType: string }): boolean {
  return file.status === "READY" && isChatImageMime(file.mimeType);
}
