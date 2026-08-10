import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'
import type { PageResult } from '@/types/api'
import type {
  ComparisonDimension,
  ComparisonVersion,
  ComparisonVersionInput,
  ComparisonVersionQuery,
  MutationMessageResponse,
  ValidationResult,
} from '@/types/comparison'
import type { WorkflowActionInput } from '@/types/professional'

const COMPARISON_PREFIX = '/api/v1/platform/comparison'

function resourcePath(resource: string, id: string): string {
  return `${COMPARISON_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

function workflow<T>(resource: string, id: string, action: WorkflowActionInput): Promise<{ item: T }> {
  return postWorkflow<{ item: T }>(`${COMPARISON_PREFIX}/${resource}`, id, action)
}

// ===== 对比版本 =====

export function fetchComparisonVersions(
  query: ComparisonVersionQuery,
  signal?: AbortSignal,
): Promise<PageResult<ComparisonVersion>> {
  return api.get<PageResult<ComparisonVersion>>(`${COMPARISON_PREFIX}/versions`, { params: query, signal })
}

export function createComparisonVersion(input: ComparisonVersionInput): Promise<ComparisonVersion> {
  return api.post<ComparisonVersion>(`${COMPARISON_PREFIX}/versions`, input)
}

export function updateComparisonVersion(
  id: string,
  input: Partial<ComparisonVersionInput>,
): Promise<ComparisonVersion> {
  return api.patch<ComparisonVersion>(resourcePath('versions', id), input)
}

export function deleteComparisonVersion(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('versions', id))
}

export function runComparisonVersionWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: ComparisonVersion }> {
  return workflow<ComparisonVersion>('versions', id, action)
}

export function validateComparisonVersion(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${resourcePath('versions', id)}/validate`)
}

// ===== 维度（只读参考，五维固定） =====

export function fetchComparisonDimensions(signal?: AbortSignal): Promise<{ items: ComparisonDimension[] }> {
  return api.get<{ items: ComparisonDimension[] }>(`${COMPARISON_PREFIX}/dimensions`, { signal })
}