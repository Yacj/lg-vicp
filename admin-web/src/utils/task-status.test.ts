import { describe, expect, it } from 'vitest'
import { FILE_STATUS_TEXT, statusText, taskStatusText, taskStatusTheme, TASK_STATUS_TEXT } from './task-status'

describe('task-status mapping', () => {
  it('covers every backend file status', () => {
    const statuses = [
      'UPLOADING', 'UPLOADED', 'QUEUED', 'PARSING', 'OCR_REQUIRED',
      'INDEXING', 'READY', 'FAILED', 'DELETED',
    ] as const
    statuses.forEach((status) => {
      expect(FILE_STATUS_TEXT[status]).toBeTruthy()
    })
  })

  it('covers every backend task status', () => {
    const statuses = ['QUEUED', 'ACTIVE', 'COMPLETED', 'FAILED'] as const
    statuses.forEach((status) => {
      expect(TASK_STATUS_TEXT[status]).toBeTruthy()
    })
  })

  it('maps statuses to readable text', () => {
    expect(statusText('QUEUED')).toBe('排队中')
    expect(statusText('ACTIVE')).toBe('处理中')
    expect(statusText('COMPLETED')).toBe('已完成')
    expect(statusText('FAILED')).toBe('失败')
    expect(statusText('OCR_REQUIRED')).toBe('需要 OCR')
    expect(statusText('READY')).toBe('已完成')
    expect(taskStatusText('QUEUED')).toBe('排队中')
    expect(statusText('UNKNOWN_STATE')).toBe('UNKNOWN_STATE')
  })

  it('maps statuses to display themes', () => {
    expect(taskStatusTheme('QUEUED')).toBe('primary')
    expect(taskStatusTheme('ACTIVE')).toBe('primary')
    expect(taskStatusTheme('COMPLETED')).toBe('success')
    expect(taskStatusTheme('FAILED')).toBe('danger')
    expect(taskStatusTheme('OCR_REQUIRED')).toBe('warning')
    expect(taskStatusTheme('CANCELLED')).toBe('default')
    expect(taskStatusTheme('SOMETHING_ELSE')).toBe('default')
  })
})