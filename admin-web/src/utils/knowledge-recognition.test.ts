import type { PageRecognitionResult } from '@/types/knowledge'
import { describe, expect, it } from 'vitest'
import { currentRecognitionCandidate } from './knowledge-recognition'

const oldConfirmed: PageRecognitionResult = { fullText: '上次确认的正文', systems: [] }
const newCandidate: PageRecognitionResult = { fullText: '本次待校验的正文', systems: [] }

describe('currentRecognitionCandidate', () => {
  const retained = {
    structuredData: oldConfirmed,
    draftStructuredData: oldConfirmed,
    confirmedStructuredData: oldConfirmed,
  }

  it('重新识别排队或执行时不展示旧确认内容', () => {
    expect(currentRecognitionCandidate(retained, 'PENDING')).toBeNull()
    expect(currentRecognitionCandidate(retained, 'PROCESSING')).toBeNull()
  })

  it('本轮重新识别失败时不把旧确认内容当作当前结果', () => {
    expect(currentRecognitionCandidate(retained, 'FAILED')).toBeNull()
  })

  it('新候选待校验时展示新结果', () => {
    expect(currentRecognitionCandidate({ ...retained, structuredData: newCandidate, draftStructuredData: newCandidate }, 'REVIEW_REQUIRED')).toBe(newCandidate)
  })

  it('已确认页面仍展示正式内容', () => {
    expect(currentRecognitionCandidate(retained, 'CONFIRMED')).toBe(oldConfirmed)
  })
})
