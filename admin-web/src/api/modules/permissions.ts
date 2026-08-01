import type { CurrentPermissionInfo } from '@/types/user'
import { api } from '@/api/http/client'

export function fetchMyPermissions(): Promise<CurrentPermissionInfo> {
  return api.get<CurrentPermissionInfo>('/api/v1/permissions/me')
}
