import type { PageResult } from '@/types/api'
import type { WorkflowActionInput } from '@/types/professional'
import type {
  MutationMessageResponse,
  ThermalCalcRecord,
  ThermalCalcRecordQuery,
  ThermalCalcRule,
  ThermalCalcRuleInput,
  ThermalCalcRuleQuery,
  ThermalCandidateQuery,
  ThermalCandidateQueryResult,
  ThermalImportJob,
  ThermalImportJobQuery,
  ThermalRow,
  ThermalRowQuery,
  ThermalSet,
  ThermalSetInput,
  ThermalSetQuery,
  ThermalStandardLimit,
  ThermalStandardLimitInput,
  ThermalStandardLimitQuery,
  ValidationResult,
} from '@/types/thermal'
import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'

const THERMAL_PREFIX = '/api/v1/platform/thermal'

function resourcePath(resource: string, id: string): string {
  return `${THERMAL_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

function workflow<T>(resource: string, id: string, action: WorkflowActionInput): Promise<{ item: T }> {
  return postWorkflow<{ item: T }>(`${THERMAL_PREFIX}/${resource}`, id, action)
}

// ===== 图集参考表 =====

export function fetchThermalSets(
  query: ThermalSetQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalSet>> {
  return api.get<PageResult<ThermalSet>>(`${THERMAL_PREFIX}/sets`, { params: query, signal })
}

export function createThermalSet(input: ThermalSetInput): Promise<ThermalSet> {
  return api.post<ThermalSet>(`${THERMAL_PREFIX}/sets`, input)
}

export function updateThermalSet(
  id: string,
  input: Partial<ThermalSetInput>,
): Promise<ThermalSet> {
  return api.patch<ThermalSet>(resourcePath('sets', id), input)
}

export function deleteThermalSet(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('sets', id))
}

export function runThermalSetWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: ThermalSet }> {
  return workflow<ThermalSet>('sets', id, action)
}

export function validateThermalSet(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${resourcePath('sets', id)}/validate`)
}

export function fetchThermalSetRows(
  setId: string,
  query: ThermalRowQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalRow>> {
  return api.get<PageResult<ThermalRow>>(`${resourcePath('sets', setId)}/rows`, { params: query, signal })
}

export function fetchPublishedThermalSets(
  query: { schemeId?: string, productSpecId?: string, keyword?: string },
  signal?: AbortSignal,
): Promise<PageResult<ThermalSet>> {
  return api.get<PageResult<ThermalSet>>(`${THERMAL_PREFIX}/published/sets`, { params: query, signal })
}

// ===== 计算规则 =====

export function fetchThermalCalcRules(
  query: ThermalCalcRuleQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalCalcRule>> {
  return api.get<PageResult<ThermalCalcRule>>(`${THERMAL_PREFIX}/calc-rules`, { params: query, signal })
}

export function createThermalCalcRule(input: ThermalCalcRuleInput): Promise<ThermalCalcRule> {
  return api.post<ThermalCalcRule>(`${THERMAL_PREFIX}/calc-rules`, input)
}

export function updateThermalCalcRule(
  id: string,
  input: Partial<ThermalCalcRuleInput>,
): Promise<ThermalCalcRule> {
  return api.patch<ThermalCalcRule>(resourcePath('calc-rules', id), input)
}

export function deleteThermalCalcRule(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('calc-rules', id))
}

export function runThermalCalcRuleWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: ThermalCalcRule }> {
  return workflow<ThermalCalcRule>('calc-rules', id, action)
}

export function validateThermalCalcRule(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${resourcePath('calc-rules', id)}/validate`)
}

// ===== 标准限值 =====

export function fetchThermalStandardLimits(
  query: ThermalStandardLimitQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalStandardLimit>> {
  return api.get<PageResult<ThermalStandardLimit>>(`${THERMAL_PREFIX}/standard-limits`, { params: query, signal })
}

export function createThermalStandardLimit(input: ThermalStandardLimitInput): Promise<ThermalStandardLimit> {
  return api.post<ThermalStandardLimit>(`${THERMAL_PREFIX}/standard-limits`, input)
}

export function updateThermalStandardLimit(
  id: string,
  input: Partial<ThermalStandardLimitInput>,
): Promise<ThermalStandardLimit> {
  return api.patch<ThermalStandardLimit>(resourcePath('standard-limits', id), input)
}

export function deleteThermalStandardLimit(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('standard-limits', id))
}

export function runThermalStandardLimitWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: ThermalStandardLimit }> {
  return workflow<ThermalStandardLimit>('standard-limits', id, action)
}

export function validateThermalStandardLimit(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${resourcePath('standard-limits', id)}/validate`)
}

// ===== 计算记录（只读快照） =====

export function fetchThermalCalcRecords(
  query: ThermalCalcRecordQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalCalcRecord>> {
  return api.get<PageResult<ThermalCalcRecord>>(`${THERMAL_PREFIX}/calc-records`, { params: query, signal })
}

export function fetchThermalCalcRecord(id: string): Promise<ThermalCalcRecord> {
  return api.get<ThermalCalcRecord>(resourcePath('calc-records', id))
}

// ===== 导入任务 =====

export function fetchThermalImportJobs(
  query: ThermalImportJobQuery,
  signal?: AbortSignal,
): Promise<PageResult<ThermalImportJob>> {
  return api.get<PageResult<ThermalImportJob>>(`${THERMAL_PREFIX}/import-jobs`, { params: query, signal })
}

export function fetchThermalImportJob(id: string): Promise<ThermalImportJob> {
  return api.get<ThermalImportJob>(resourcePath('import-jobs', id))
}

// ===== 候选方案试算（K ≤ 目标且最接近目标优先，返回多候选供选择） =====

export function queryThermalCandidates(
  query: ThermalCandidateQuery,
  signal?: AbortSignal,
): Promise<ThermalCandidateQueryResult> {
  return api.post<ThermalCandidateQueryResult>(`${THERMAL_PREFIX}/candidates/query`, query, { signal })
}
