import { getApiErrorCode } from '@/api/core/handlers'
import { VISION_ERROR_CODES, VISION_FAILURE_MESSAGE } from '@/constants/chatImage'

function readErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object') {
    const record = error as { message?: unknown, code?: unknown, name?: unknown }
    return [record.message, record.code, record.name].filter(item => typeof item === 'string').join(' ')
  }
  return String(error || '')
}

export function isVisionFailure(error: unknown) {
  const code = getApiErrorCode(error)
  if (typeof code === 'string' && VISION_ERROR_CODES.has(code)) {
    return true
  }
  const text = readErrorText(error)
  if (VISION_ERROR_CODES.has(text)) {
    return true
  }
  return /视觉|图片识别|VISION/i.test(text)
}

export function visionFailureMessage(error?: unknown) {
  if (error instanceof Error && error.message && /尚未配置可用的视觉模型/.test(error.message)) {
    return VISION_FAILURE_MESSAGE
  }
  return VISION_FAILURE_MESSAGE
}
