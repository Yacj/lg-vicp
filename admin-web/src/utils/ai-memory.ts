import type { ProjectAiMemoryStatus, ProjectAiMemoryType } from '@/types/ai'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

export const PROJECT_AI_MEMORY_TYPE_LABELS: Record<ProjectAiMemoryType, string> = {
  ASSUMPTION: '假设',
  CONSTRAINT: '约束',
  DECISION: '决策',
  FACT: '事实',
  PREFERENCE: '偏好',
  TODO: '待办',
}

export const PROJECT_AI_MEMORY_STATUS_LABELS: Record<ProjectAiMemoryStatus, string> = {
  ACTIVE: '有效',
  PENDING: '待确认',
  REJECTED: '无效',
  SUPERSEDED: '已替代',
}

export function getProjectAiMemoryTypeLabel(type: ProjectAiMemoryType | string): string {
  return PROJECT_AI_MEMORY_TYPE_LABELS[type as ProjectAiMemoryType] ?? type
}

export function getProjectAiMemoryStatusLabel(status: ProjectAiMemoryStatus | string): string {
  return PROJECT_AI_MEMORY_STATUS_LABELS[status as ProjectAiMemoryStatus] ?? status
}

export function getProjectAiMemoryStatusTone(status: ProjectAiMemoryStatus | string): AppStatus {
  if (status === 'ACTIVE') {
    return 'success'
  }
  if (status === 'PENDING') {
    return 'warning'
  }
  if (status === 'REJECTED') {
    return 'error'
  }
  return 'disabled'
}

export function getProjectAiMemoryVerifiedLabel(verified: boolean): string {
  return verified ? '已确认' : '未确认'
}
