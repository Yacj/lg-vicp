import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createCollectionSource,
  createCollectionSkill,
  createManualCollection,
  disableCollectionSource,
  enableCollectionSource,
  fetchCollectionDashboard,
  fetchCollectionRecords,
  fetchCollectionSkills,
  fetchCollectionSources,
  fetchCollectionTask,
  fetchCollectionTasks,
  fetchCollectionTrends,
  importCollectionTaskToKnowledge,
  updateCollectionSource,
  updateCollectionSkill,
} from './collection'

vi.mock('@/api/http/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('collection api contracts', () => {
  it('creates a manual collection with only confirmed fields', async () => {
    await createManualCollection({
      name: '安徽地方标准',
      sourceUrl: 'https://example.com/std',
      remark: '待核对',
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/collection/manual', {
      name: '安徽地方标准',
      sourceUrl: 'https://example.com/std',
      remark: '待核对',
    })
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('cron')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('xpath')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('headers')
  })

  it('manages auto sources without technical crawler fields', async () => {
    const signal = new AbortController().signal
    await fetchCollectionSources(signal)
    await createCollectionSource({
      name: '安徽标准平台',
      sourceUrl: 'https://example.com',
      enabled: true,
    })
    await updateCollectionSource('source-1', { name: '安徽标准平台' })
    await enableCollectionSource('source-1')
    await disableCollectionSource('source-1')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/collection/sources', { signal })
    expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/api/v1/platform/collection/sources', {
      name: '安徽标准平台',
      sourceUrl: 'https://example.com',
      enabled: true,
    })
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('cookie')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('selector')
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/collection/sources/source-1', {
      name: '安徽标准平台',
    })
    expect(mockedApi.post).toHaveBeenNthCalledWith(2, '/api/v1/platform/collection/sources/source-1/enable')
    expect(mockedApi.post).toHaveBeenNthCalledWith(3, '/api/v1/platform/collection/sources/source-1/disable')
  })

  it('manages collection skills, dashboard, trends and records', async () => {
    const signal = new AbortController().signal
    await fetchCollectionSkills(signal)
    await createCollectionSkill({ name: '安徽标准', keywordsJson: ['节能'], instruction: '地方标准' })
    await updateCollectionSkill('skill-1', { enabled: false })
    await fetchCollectionDashboard(signal)
    await fetchCollectionTrends('month', signal)
    await fetchCollectionRecords({ keyword: '图集', page: 1, pageSize: 20, sourceId: 'source-1' }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/collection/skills', { signal })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/collection/skills', {
      instruction: '地方标准',
      keywordsJson: ['节能'],
      name: '安徽标准',
    })
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/collection/skills/skill-1', { enabled: false })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/collection/dashboard', { signal })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/collection/trends', {
      params: { granularity: 'month' },
      signal,
    })
    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/collection/records', {
      params: { keyword: '图集', page: 1, pageSize: 20, sourceId: 'source-1' },
      signal,
    })
  })

  it('lists and imports tasks through the independent collection domain', async () => {
    const signal = new AbortController().signal
    await fetchCollectionTasks({ keyword: '安徽', mode: 'MANUAL', page: 1, pageSize: 20, status: 'WAITING_CONFIRM' }, signal)
    await fetchCollectionTask('task-1', signal)
    await importCollectionTaskToKnowledge('task-1')

    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/api/v1/platform/collection/tasks', {
      params: { keyword: '安徽', mode: 'MANUAL', page: 1, pageSize: 20, status: 'WAITING_CONFIRM' },
      signal,
    })
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/api/v1/platform/collection/tasks/task-1', { signal })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/collection/tasks/task-1/import-to-knowledge')
  })
})
