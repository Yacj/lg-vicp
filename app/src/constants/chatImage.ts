/** 与后端 `shared/chat-image` 对齐：P0 只做聊天图片，不上传文档。 */
export const CHAT_IMAGE_MAX_COUNT = 4
export const CHAT_IMAGE_SUGGESTED_MAX_BYTES = 10 * 1024 * 1024
export const CHAT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const
export const CHAT_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png'])

export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number]

export const CHAT_IMAGE_ONLY_CONTENT = '请看图片'

export const VISION_FAILURE_MESSAGE = '图片识别失败，请重试。'
export const VISION_ERROR_CODES = new Set(['VISION_MODEL_NOT_CONFIGURED'])
