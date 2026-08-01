import type { RouterMenuResult } from '@/types/menu'
import { api } from '@/api/http/client'

export function fetchDynamicRouters(): Promise<RouterMenuResult> {
  return api.get<RouterMenuResult>('/api/v1/auth/b/getRouters')
}
