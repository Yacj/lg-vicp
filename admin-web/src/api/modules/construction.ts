import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'
import type { PageResult } from '@/types/api'
import type {
  ConstructionScheme,
  ConstructionSchemeInput,
  ConstructionSchemeQuery,
  InsulationSystem,
  InsulationSystemInput,
  InsulationSystemQuery,
  MutationMessageResponse,
  ValidationResult,
} from '@/types/construction'
import type { WorkflowActionInput } from '@/types/professional'

const CONSTRUCTION_PREFIX = '/api/v1/platform/construction'

function resourcePath(resource: string, id: string): string {
  return `${CONSTRUCTION_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

function workflow<T>(resource: string, id: string, action: WorkflowActionInput): Promise<{ item: T }> {
  return postWorkflow<{ item: T }>(`${CONSTRUCTION_PREFIX}/${resource}`, id, action)
}

// ===== 保温系统 =====

export function fetchInsulationSystems(
  query: InsulationSystemQuery,
  signal?: AbortSignal,
): Promise<PageResult<InsulationSystem>> {
  return api.get<PageResult<InsulationSystem>>(`${CONSTRUCTION_PREFIX}/insulation-systems`, { params: query, signal })
}

export function createInsulationSystem(input: InsulationSystemInput): Promise<InsulationSystem> {
  return api.post<InsulationSystem>(`${CONSTRUCTION_PREFIX}/insulation-systems`, input)
}

export function updateInsulationSystem(
  id: string,
  input: Partial<InsulationSystemInput>,
): Promise<InsulationSystem> {
  return api.patch<InsulationSystem>(resourcePath('insulation-systems', id), input)
}

export function deleteInsulationSystem(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('insulation-systems', id))
}

export function runInsulationSystemWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: InsulationSystem }> {
  return workflow<InsulationSystem>('insulation-systems', id, action)
}

export function fetchPublishedInsulationSystems(
  query: { systemType?: string; keyword?: string },
  signal?: AbortSignal,
): Promise<PageResult<InsulationSystem>> {
  return api.get<PageResult<InsulationSystem>>(`${CONSTRUCTION_PREFIX}/published/insulation-systems`, { params: query, signal })
}

// ===== 构造方案 =====

export function fetchConstructionSchemes(
  query: ConstructionSchemeQuery,
  signal?: AbortSignal,
): Promise<PageResult<ConstructionScheme>> {
  return api.get<PageResult<ConstructionScheme>>(`${CONSTRUCTION_PREFIX}/construction-schemes`, { params: query, signal })
}

export function createConstructionScheme(input: ConstructionSchemeInput): Promise<ConstructionScheme> {
  return api.post<ConstructionScheme>(`${CONSTRUCTION_PREFIX}/construction-schemes`, input)
}

export function updateConstructionScheme(
  id: string,
  input: Partial<ConstructionSchemeInput>,
): Promise<ConstructionScheme> {
  return api.patch<ConstructionScheme>(resourcePath('construction-schemes', id), input)
}

export function deleteConstructionScheme(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('construction-schemes', id))
}

export function runConstructionSchemeWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: ConstructionScheme }> {
  return workflow<ConstructionScheme>('construction-schemes', id, action)
}

export function validateConstructionScheme(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${resourcePath('construction-schemes', id)}/validate`)
}

export function fetchPublishedConstructionSchemes(
  query: { systemId?: string; schemeCode?: string; keyword?: string },
  signal?: AbortSignal,
): Promise<PageResult<ConstructionScheme>> {
  return api.get<PageResult<ConstructionScheme>>(`${CONSTRUCTION_PREFIX}/published/construction-schemes`, { params: query, signal })
}

export function fetchPublishedConstructionSchemeDetail(id: string): Promise<import('@/types/construction').ConstructionSchemeDetail> {
  return api.get<import('@/types/construction').ConstructionSchemeDetail>(
    `${CONSTRUCTION_PREFIX}/published/construction-schemes/${encodeURIComponent(id)}`,
  )
}