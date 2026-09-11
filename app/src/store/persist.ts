/*
 * @Author: weisheng
 * @Date: 2025-06-23 22:23:05
 * @LastEditTime: 2025-06-24 19:03:21
 * @LastEditors: weisheng
 * @Description:
 * @FilePath: /wot-starter/src/store/persist.ts
 * 记得注释
 */
import type { PiniaPluginContext } from 'pinia'
import {
  ASSISTANT_STORE_ID,
  AUTH_STORE_ID,
  discardUserScopedClientState,
  readPersistedAuthUserId,
  shouldDiscardAssistantState,
} from '@/store/user-scoped-state'

function persist({ store }: PiniaPluginContext, excludedIds: string[]) {
  // 检查当前store的id是否在排除列表中
  const isExcluded = excludedIds.includes(store.$id)

  // 如果当前store的id在排除列表中，则不进行持久化
  if (isExcluded) {
    return
  }

  // 暂存State
  let persistState = CommonUtil.deepClone(store.$state)
  // 从缓存中读取
  const storageState = uni.getStorageSync(store.$id)
  if (storageState) {
    persistState = storageState
  }
  store.$state = persistState
  let lastAuthUserId = store.$id === AUTH_STORE_ID
    ? (store.$state as { user?: { id?: string } | null }).user?.id ?? null
    : null
  store.$subscribe(() => {
    if (store.$id === AUTH_STORE_ID) {
      const authState = store.$state as { accessToken?: string, user?: { id?: string } | null }
      const nextUserId = authState.user?.id ?? null
      const signedIn = Boolean(authState.accessToken)
      if (!signedIn || lastAuthUserId !== nextUserId) {
        discardUserScopedClientState()
      }
      lastAuthUserId = nextUserId
    }

    // 在存储变化的时候将store缓存
    uni.setStorageSync(store.$id, CommonUtil.deepClone(store.$state))
  })
  // 流式锁与进行中状态不可跨启动恢复，否则 sendLock/isStreaming 会把输入框永久禁用
  if (store.$id === ASSISTANT_STORE_ID) {
    if (shouldDiscardAssistantState(store.$state, readPersistedAuthUserId())) {
      store.$patch((state) => {
        Object.assign(state, {
          nav: {},
          conversation: null,
          messages: [],
          feedbacks: {},
          loadState: 'idle',
          loadError: '',
        })
      })
    }
    store.$patch((state) => {
      Object.assign(state, {
        sendLock: false,
        isStreaming: false,
        streamMode: 'stream',
        streamingMessageId: null,
        progressStage: null,
        progressMessage: null,
        creatingConversation: null,
        creatingConversationRevision: -1,
        activeAbort: null,
      })
    })
  }
}

export function persistPlugin(context: PiniaPluginContext) {
  // 调用persist函数，并传入排除列表
  persist(context, ['temp'])
}
