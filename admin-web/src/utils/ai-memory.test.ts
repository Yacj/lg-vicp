import { describe, expect, it } from 'vitest'
import {
  getProjectAiMemoryStatusLabel,
  getProjectAiMemoryTypeLabel,
  getProjectAiMemoryVerifiedLabel,
} from './ai-memory'

describe('project AI memory labels', () => {
  it('maps type, status and confirmation for investigation UI', () => {
    expect(getProjectAiMemoryTypeLabel('FACT')).toBe('事实')
    expect(getProjectAiMemoryTypeLabel('ASSUMPTION')).toBe('假设')
    expect(getProjectAiMemoryStatusLabel('PENDING')).toBe('待确认')
    expect(getProjectAiMemoryStatusLabel('REJECTED')).toBe('无效')
    expect(getProjectAiMemoryVerifiedLabel(true)).toBe('已确认')
    expect(getProjectAiMemoryVerifiedLabel(false)).toBe('未确认')
  })
})
