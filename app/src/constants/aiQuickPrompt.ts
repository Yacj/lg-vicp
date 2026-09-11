import type { AiQuickPromptIcon, AiQuickPromptPosition } from '@/api/types'

/** 筑小格首页 / 项目 AI 快捷提问展示位置，与后端 position 对齐。 */
export const QUICK_PROMPT_POSITION = {
  home: 'AI_HOME',
  project: 'PROJECT_AI',
} as const satisfies Record<string, AiQuickPromptPosition>

/** 横向滑动条最多展示条数，避免运营一次塞满。 */
export const QUICK_PROMPT_MAX_VISIBLE = 12

/** 会话内短缓存，兼顾后台停用后的一致性。 */
export const QUICK_PROMPT_CACHE_TTL_MS = 10 * 60 * 1000

/** 后台 icon key → 现有 wd-icon 名称，视觉保持同一主色。 */
export const QUICK_PROMPT_ICON_MAP: Record<AiQuickPromptIcon, string> = {
  book: 'file',
  project: 'home',
  material: 'folder',
  standard: 'list',
  calc: 'edit',
  compare: 'chart',
  chat: 'chat',
}

export function resolveQuickPromptIcon(icon?: string) {
  if (icon && icon in QUICK_PROMPT_ICON_MAP) {
    return QUICK_PROMPT_ICON_MAP[icon as AiQuickPromptIcon]
  }
  return QUICK_PROMPT_ICON_MAP.chat
}
