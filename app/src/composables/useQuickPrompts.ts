import type { AiQuickPromptPosition, ApiEnvelope, ClientQuickPrompt } from '@/api/types'
import { aiApi } from '@/api/modules/ai'
import { QUICK_PROMPT_CACHE_TTL_MS, QUICK_PROMPT_MAX_VISIBLE } from '@/constants/aiQuickPrompt'
import { useAuthStore } from '@/store/auth'

interface QuickPromptCacheEntry {
  items: ClientQuickPrompt[]
  fetchedAt: number
}

const cache = new Map<AiQuickPromptPosition, QuickPromptCacheEntry>()

export function clearQuickPromptCache() {
  cache.clear()
}

function takeVisible(items: ClientQuickPrompt[]) {
  return items.slice(0, QUICK_PROMPT_MAX_VISIBLE)
}

async function requestQuickPrompts(position: AiQuickPromptPosition) {
  const response = await aiApi.listQuickPrompts({ position }).send() as ApiEnvelope<{ items: ClientQuickPrompt[] }>
  return takeVisible(response.data?.items || [])
}

/** 项目位没有运营配置时回落到首页快捷提问，避免输入框上方整条轨道消失。 */
async function resolveVisibleItems(position: AiQuickPromptPosition, primary: ClientQuickPrompt[]) {
  if (primary.length || position === 'AI_HOME') {
    return primary
  }

  const homeCached = cache.get('AI_HOME')
  if (homeCached && Date.now() - homeCached.fetchedAt < QUICK_PROMPT_CACHE_TTL_MS) {
    return homeCached.items
  }

  const home = await requestQuickPrompts('AI_HOME')
  cache.set('AI_HOME', { items: home, fetchedAt: Date.now() })
  return home
}

/**
 * 筑小格快捷提问：失败静默降级，绝不阻塞输入框。
 * 已登录才请求；未登录或接口失败时区域隐藏。
 */
export function useQuickPrompts() {
  const authStore = useAuthStore()
  const items = ref<ClientQuickPrompt[]>([])
  const loading = ref(false)
  const position = ref<AiQuickPromptPosition>('AI_HOME')

  async function load(nextPosition: AiQuickPromptPosition, options: { force?: boolean } = {}) {
    position.value = nextPosition
    if (!authStore.isAuthenticated) {
      items.value = []
      loading.value = false
      return
    }

    const cached = cache.get(nextPosition)
    const cacheValid = Boolean(cached && Date.now() - cached.fetchedAt < QUICK_PROMPT_CACHE_TTL_MS)
    if (cached && cacheValid && !options.force) {
      items.value = await resolveVisibleItems(nextPosition, cached.items)
      return
    }

    if (cached && !options.force) {
      items.value = await resolveVisibleItems(nextPosition, cached.items)
    }

    const showSkeleton = !cached
    if (showSkeleton) {
      loading.value = true
    }

    try {
      const next = await requestQuickPrompts(nextPosition)
      cache.set(nextPosition, { items: next, fetchedAt: Date.now() })
      if (position.value === nextPosition) {
        items.value = await resolveVisibleItems(nextPosition, next)
      }
    }
    catch {
      try {
        const next = await requestQuickPrompts(nextPosition)
        cache.set(nextPosition, { items: next, fetchedAt: Date.now() })
        if (position.value === nextPosition) {
          items.value = await resolveVisibleItems(nextPosition, next)
        }
      }
      catch {
        if (!cached && position.value === nextPosition) {
          items.value = await resolveVisibleItems(nextPosition, [])
        }
      }
    }
    finally {
      if (position.value === nextPosition) {
        loading.value = false
      }
    }
  }

  return {
    items,
    loading,
    load,
  }
}
