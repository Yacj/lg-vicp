import type { WorkflowActionInput } from '@/types/professional'
import { api } from '@/api/http/client'

/**
 * 专业数据工作流请求：POST {base}/:id/{submit|approve|reject|publish|disable|new-version}。
 * body 契约与后端 workflow-routes 一致：approve 带可选 approvalNote，reject 必填 rejectReason，
 * new-version 带可选 changeNote；submit/publish/disable 无 body。
 */
export function postWorkflow<T>(
  base: string,
  id: string,
  action: WorkflowActionInput,
): Promise<T> {
  const endpoint = `${base}/${encodeURIComponent(id)}/${action.type}`
  if (action.type === 'approve') {
    return api.post<T>(endpoint, { approvalNote: action.approvalNote })
  }
  if (action.type === 'reject') {
    return api.post<T>(endpoint, { rejectReason: action.rejectReason })
  }
  if (action.type === 'new-version') {
    return api.post<T>(endpoint, { changeNote: action.changeNote })
  }
  return api.post<T>(endpoint)
}