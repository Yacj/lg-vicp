import type { ApiEnvelope, ClientSelectableDepartment } from '@/api/types'
import { profileApi } from '@/api/modules/profile'
import { resolveDepartmentName } from '@/utils/projectVisibility'

export function useSelectableDepartments() {
  const departments = ref<ClientSelectableDepartment[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  async function load() {
    if (loading.value) {
      return
    }
    loading.value = true
    try {
      const response = await profileApi.getMyDepartments().send() as ApiEnvelope<{ items: ClientSelectableDepartment[] }>
      departments.value = response.data?.items || []
    }
    catch {
      departments.value = []
    }
    finally {
      loading.value = false
      loaded.value = true
    }
  }

  function nameOf(departmentId?: string | null, fallbackName?: string | null) {
    return resolveDepartmentName(departmentId, departments.value, fallbackName)
  }

  return {
    departments,
    loading,
    loaded,
    load,
    nameOf,
  }
}
