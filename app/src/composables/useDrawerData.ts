import type { ApiEnvelope, ApiPage, ConversationRecord, ProjectRecord } from '@/api/types'
import { aiApi, projectApi } from '@/api'

export type DrawerLoadStatus = 'idle' | 'loading' | 'success' | 'error'

export interface DrawerListState<T> {
  status: DrawerLoadStatus
  items: T[]
  total: number
}

function createListState<T>(): DrawerListState<T> {
  return {
    status: 'idle',
    items: [],
    total: 0,
  }
}

function getPageData<T>(response: unknown) {
  const envelope = response as ApiEnvelope<ApiPage<T>>
  return envelope.data || { items: [], total: 0, page: 1, pageSize: 0 }
}

export function useDrawerData() {
  const authStore = useAuthStore()
  const myProjects = ref<DrawerListState<ProjectRecord>>(createListState())
  const publicProjects = ref<DrawerListState<ProjectRecord>>(createListState())
  const conversations = ref<DrawerListState<ConversationRecord>>(createListState())

  async function loadPublicProjects(force = false) {
    if (!force && ['loading', 'success'].includes(publicProjects.value.status)) {
      return
    }

    publicProjects.value.status = 'loading'
    try {
      const response = await projectApi.getPublic({ page: 1, pageSize: 3 }).send()
      const data = getPageData<ProjectRecord>(response)
      publicProjects.value = { status: 'success', items: data.items || [], total: data.total || 0 }
    }
    catch {
      publicProjects.value.status = 'error'
    }
  }

  async function loadConversations(force = false) {
    if (!authStore.isAuthenticated) {
      conversations.value = createListState()
      return
    }
    if (!force && ['loading', 'success'].includes(conversations.value.status)) {
      return
    }

    conversations.value.status = 'loading'
    try {
      const response = await aiApi.listConversations({ clientApp: 'c_app', page: 1, pageSize: 3 }).send()
      const data = getPageData<ConversationRecord>(response)
      conversations.value = { status: 'success', items: data.items || [], total: data.total || 0 }
    }
    catch {
      conversations.value.status = 'error'
    }
  }

  async function loadAll() {
    await Promise.all([
      loadPublicProjects(),
      loadConversations(),
    ])
  }

  function resetPrivateData() {
    myProjects.value = createListState()
    conversations.value = createListState()
  }

  return {
    myProjects,
    publicProjects,
    conversations,
    loadAll,
    loadPublicProjects,
    loadConversations,
    resetPrivateData,
  }
}
