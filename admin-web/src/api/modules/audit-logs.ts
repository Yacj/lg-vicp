import type { ProjectAuditLogPageResult } from '@/types/project'
import { api } from '@/api/http/client'

/**
 * 按项目查询操作记录（GET /api/v1/platform/audit-logs?projectId=）。
 * 需 monitor:audit:list 权限或超级管理员，前端入口按权限裁剪，后端仍会校验。
 */
export function fetchProjectAuditLogs(
  projectId: string,
  query: { page?: number, pageSize?: number },
  signal?: AbortSignal,
): Promise<ProjectAuditLogPageResult> {
  return api.get<ProjectAuditLogPageResult>('/api/v1/platform/audit-logs', {
    params: { ...query, projectId },
    signal,
  })
}