import { getActivePinia } from 'pinia'
import { clearQuickPromptCache } from '@/composables/useQuickPrompts'
import { useAssistantStore } from '@/store/assistant'

export const AUTH_STORE_ID = 'auth'
export const ASSISTANT_STORE_ID = 'assistant'

interface PersistedAuthState {
  accessToken?: string
  user?: { id?: string } | null
}

interface PersistedAssistantState {
  conversation?: { userId?: string } | null
}

export function readPersistedAuthUserId(): string | null {
  try {
    const authState = uni.getStorageSync(AUTH_STORE_ID) as PersistedAuthState | undefined
    const userId = authState?.user?.id
    return typeof userId === 'string' && userId ? userId : null
  }
  catch {
    return null
  }
}

/**
 * 本地会话只属于当前登录用户。
 * 未登录、或会话 userId 与当前账号不一致时，必须丢弃，否则会拿别人的 conversationId 发消息。
 */
export function shouldDiscardAssistantState(
  state: PersistedAssistantState | undefined,
  authUserId: string | null,
): boolean {
  const conversation = state?.conversation
  if (!conversation) {
    return false
  }
  if (!authUserId) {
    return true
  }
  return conversation.userId !== authUserId
}

/**
 * 退出登录或切换账号时清理账号级内存/持久化状态。
 * 主题、隐私同意等设备偏好不在此列。
 */
export function discardUserScopedClientState() {
  clearQuickPromptCache()

  if (!getActivePinia()) {
    uni.removeStorageSync(ASSISTANT_STORE_ID)
    return
  }

  useAssistantStore().resetForAccountChange()
}
