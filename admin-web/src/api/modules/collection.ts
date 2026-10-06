import type { PageResult } from '@/types/api'
import type {
  CollectionDashboardSummary,
  CollectionImportResult,
  CollectionRecord,
  CollectionRecordQuery,
  CollectionSkill,
  CollectionSkillInput,
  CollectionSource,
  CollectionSourceInput,
  CollectionTask,
  CollectionTaskQuery,
  CollectionTrendGranularity,
  CollectionTrendResult,
  ManualCollectionInput,
} from '@/types/collection'
import { api } from '@/api/http/client'

const COLLECTION_PREFIX = '/api/v1/platform/collection'

export function createManualCollection(input: ManualCollectionInput): Promise<CollectionTask> {
  return api.post<CollectionTask>(`${COLLECTION_PREFIX}/manual`, input)
}

export function fetchCollectionSources(signal?: AbortSignal): Promise<{ items: CollectionSource[] }> {
  return api.get<{ items: CollectionSource[] }>(`${COLLECTION_PREFIX}/sources`, { signal })
}

export function createCollectionSource(input: CollectionSourceInput): Promise<CollectionSource> {
  return api.post<CollectionSource>(`${COLLECTION_PREFIX}/sources`, input)
}

export function updateCollectionSource(
  id: string,
  input: Partial<Pick<CollectionSourceInput, 'name' | 'sourceUrl' | 'skillId'>>,
): Promise<CollectionSource> {
  return api.put<CollectionSource>(`${COLLECTION_PREFIX}/sources/${encodeURIComponent(id)}`, input)
}

export function enableCollectionSource(id: string): Promise<CollectionSource> {
  return api.post<CollectionSource>(`${COLLECTION_PREFIX}/sources/${encodeURIComponent(id)}/enable`)
}

export function disableCollectionSource(id: string): Promise<CollectionSource> {
  return api.post<CollectionSource>(`${COLLECTION_PREFIX}/sources/${encodeURIComponent(id)}/disable`)
}

export function fetchCollectionTasks(
  query: CollectionTaskQuery,
  signal?: AbortSignal,
): Promise<PageResult<CollectionTask>> {
  return api.get<PageResult<CollectionTask>>(`${COLLECTION_PREFIX}/tasks`, { params: query, signal })
}

export function fetchCollectionTask(id: string, signal?: AbortSignal): Promise<CollectionTask> {
  return api.get<CollectionTask>(`${COLLECTION_PREFIX}/tasks/${encodeURIComponent(id)}`, { signal })
}

export function importCollectionTaskToKnowledge(id: string): Promise<CollectionImportResult> {
  return api.post<CollectionImportResult>(`${COLLECTION_PREFIX}/tasks/${encodeURIComponent(id)}/import-to-knowledge`)
}

export function fetchCollectionSkills(signal?: AbortSignal): Promise<{ items: CollectionSkill[] }> {
  return api.get<{ items: CollectionSkill[] }>(`${COLLECTION_PREFIX}/skills`, { signal })
}

export function createCollectionSkill(input: CollectionSkillInput): Promise<CollectionSkill> {
  return api.post<CollectionSkill>(`${COLLECTION_PREFIX}/skills`, input)
}

export function updateCollectionSkill(
  id: string,
  input: Partial<CollectionSkillInput>,
): Promise<CollectionSkill> {
  return api.put<CollectionSkill>(`${COLLECTION_PREFIX}/skills/${encodeURIComponent(id)}`, input)
}

export function fetchCollectionDashboard(signal?: AbortSignal): Promise<CollectionDashboardSummary> {
  return api.get<CollectionDashboardSummary>(`${COLLECTION_PREFIX}/dashboard`, { signal })
}

export function fetchCollectionTrends(
  granularity: CollectionTrendGranularity,
  signal?: AbortSignal,
): Promise<CollectionTrendResult> {
  return api.get<CollectionTrendResult>(`${COLLECTION_PREFIX}/trends`, { params: { granularity }, signal })
}

export function fetchCollectionRecords(
  query: CollectionRecordQuery,
  signal?: AbortSignal,
): Promise<PageResult<CollectionRecord>> {
  return api.get<PageResult<CollectionRecord>>(`${COLLECTION_PREFIX}/records`, { params: query, signal })
}
