import { describe, expect, it } from 'vitest'
import type { CollectionTask } from '@/types/collection'
import {
  COLLECTION_UI_STATUS_OPTIONS,
  collectionModeLabel,
  collectionResultFileName,
  collectionUiStatusMeta,
  isCollectionConfirmable,
  isCollectionImported,
  toCollectionUiStatus,
} from './collection'

function task(overrides: Partial<CollectionTask> = {}): CollectionTask {
  return {
    createdAt: '2026-09-16T02:00:00.000Z',
    createdById: null,
    errorMessage: null,
    finishedAt: null,
    id: 'task-1',
    importedKnowledgeDocumentId: null,
    mode: 'MANUAL',
    name: '安徽地方标准',
    resultFileId: null,
    resultMeta: null,
    sourceId: null,
    sourceUrl: 'https://example.com/std',
    startedAt: null,
    status: 'WAITING_CONFIRM',
    ...overrides,
  }
}

describe('collection presentation', () => {
  it('maps backend PENDING/RUNNING to 采集中', () => {
    expect(toCollectionUiStatus('PENDING')).toBe('COLLECTING')
    expect(toCollectionUiStatus('RUNNING')).toBe('COLLECTING')
    expect(collectionUiStatusMeta('PENDING')).toMatchObject({ label: '采集中', status: 'processing' })
    expect(collectionUiStatusMeta('RUNNING')).toMatchObject({ label: '采集中', status: 'processing' })
  })

  it('uses business labels for confirm/import/fail states', () => {
    expect(collectionUiStatusMeta('WAITING_CONFIRM').label).toBe('待确认')
    expect(collectionUiStatusMeta('COMPLETED').label).toBe('已入库')
    expect(collectionUiStatusMeta('FAILED').label).toBe('采集失败')
    expect(collectionModeLabel('MANUAL')).toBe('手动采集')
    expect(collectionModeLabel('AUTO')).toBe('自动采集')
  })

  it('only treats waiting-confirm tasks without knowledge as confirmable', () => {
    expect(isCollectionConfirmable(task())).toBe(true)
    expect(isCollectionConfirmable(task({ importedKnowledgeDocumentId: 'doc-1' }))).toBe(false)
    expect(isCollectionConfirmable(task({ status: 'COMPLETED' }))).toBe(false)
  })

  it('treats completed or imported tasks as already in knowledge', () => {
    expect(isCollectionImported(task({ status: 'COMPLETED', importedKnowledgeDocumentId: 'doc-1' }))).toBe(true)
    expect(isCollectionImported(task({ status: 'WAITING_CONFIRM', importedKnowledgeDocumentId: 'doc-1' }))).toBe(true)
    expect(isCollectionImported(task())).toBe(false)
  })

  it('reads result file name from meta without exposing crawler internals', () => {
    expect(collectionResultFileName(task())).toBeNull()
    expect(collectionResultFileName(task({ resultFileId: 'file-1' }))).toBe('采集结果')
    expect(collectionResultFileName(task({
      resultFileId: 'file-1',
      resultMeta: { fileName: 'ah-standard.pdf', mimeType: 'application/pdf' },
    }))).toBe('ah-standard.pdf')
  })

  it('exposes business UI status options without crawler internals', () => {
    expect(COLLECTION_UI_STATUS_OPTIONS.map(item => item.label)).toEqual([
      '采集中',
      '待确认',
      '已入库',
      '采集失败',
    ])
  })
})
