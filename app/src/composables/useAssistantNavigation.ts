import type { AssistantNavContext } from '@/store/assistant'
import { useAssistantStore } from '@/store/assistant'

export type AssistantNavOptions = AssistantNavContext

/**
 * 首页、项目详情、对话记录等入口统一跳转筑小格：
 * 使用 Tab 切换，参数经 Pinia 一次性上下文传递，消费后清理，
 * 避免依赖跨端不稳定的 Tab 页 query，也防止重复自动发送。
 */
export function useAssistantNavigation() {
  const router = useRouter()
  const assistantStore = useAssistantStore()

  function openAssistant(options: AssistantNavOptions = {}) {
    assistantStore.setNavContext(options)
    router.pushTab({ name: 'assistant' })
  }

  return {
    openAssistant,
  }
}
