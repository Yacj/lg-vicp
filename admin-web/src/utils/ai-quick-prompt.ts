import type { AiQuickPrompt, AiQuickPromptIcon, AiQuickPromptPosition } from '@/types/ai'

/** 平台预置快捷提问。content 必须是用户会说的自然问题，不能写成 System Prompt。 */
export interface DefaultQuickPromptTemplate {
  title: string
  description: string
  content: string
  icon: AiQuickPromptIcon
  position: AiQuickPromptPosition
  sortOrder: number
}

export const DEFAULT_QUICK_PROMPTS: readonly DefaultQuickPromptTemplate[] = [
  {
    title: '查询图集',
    description: '查询相关图集做法和出处',
    content: '帮我查一下和当前问题相关的图集做法，并告诉我出处。',
    icon: 'book',
    position: 'AI_HOME',
    sortOrder: 10,
  },
  {
    title: '分析当前项目',
    description: '结合当前项目看看需要注意什么',
    content: '结合当前项目，帮我看看这个问题需要注意什么。',
    icon: 'project',
    position: 'AI_HOME',
    sortOrder: 20,
  },
  {
    title: '匹配保温方案',
    description: '按当前条件找可参考的保温方案',
    content: '根据当前条件，帮我找几个可以参考的保温方案，并附上依据。',
    icon: 'material',
    position: 'AI_HOME',
    sortOrder: 30,
  },
  {
    title: '查询节能标准',
    description: '查询相关节能标准和出处',
    content: '帮我查一下和当前问题相关的节能标准，告诉我关键要求和出处。',
    icon: 'standard',
    position: 'AI_HOME',
    sortOrder: 40,
  },
]

/** 历史 seed 文案。匹配到这些内容时才允许被推荐文案覆盖。 */
export const LEGACY_QUICK_PROMPT_CONTENTS = [
  '请根据当前已发布的知识资料，帮助我查询与问题相关的图集内容，并给出对应章节、页码和原文来源。',
  '请结合当前项目的真实资料，分析与我问题相关的项目情况和注意事项。如果会话尚未关联项目，请明确提示我先选择项目。',
  '请根据当前已发布的知识资料和构造做法，帮助我匹配合适的保温方案，并给出对应章节、页码和原文来源。',
  '请根据当前已发布的知识资料，帮助我查询相关节能标准和技术要求，并给出对应章节、页码和原文来源。找不到可靠依据时请明确说明，不要编造标准号或条文。',
] as const

export const QUICK_PROMPT_USER_START_HINT
  = '快捷提问是用户问题起点，点击后会作为用户消息发送，不是 System Prompt。'

export const QUICK_PROMPT_SYSTEM_WORDING_HINT
  = '不要写入“当前已发布 / 必须调用 / 不要编造 / 不得杜撰 / 只允许知识库 / Tool / Agent / 来源可靠性 / 权限规则”。这些由服务端执行策略控制。'

export const QUICK_PROMPT_STOCK_UPDATE_HINT
  = '预置提问来自数据库。若发送内容仍像系统指令，请点「按推荐文案更新」或编辑后保存。管理员已改写成其他问题的记录不会被覆盖。'

const SYSTEM_WORDING_PATTERN
  = /当前已发布|必须调用|不要编造|不得杜撰|只允许知识库|\bTool\b|\bAgent\b|来源可靠性|权限规则|找不到可靠依据|给出对应章节[、,，]页码和原文来源|如果会话尚未关联项目/

export function isSystemWordingQuickPrompt(content: string): boolean {
  const value = content.trim()
  if (!value) {
    return false
  }
  if ((LEGACY_QUICK_PROMPT_CONTENTS as readonly string[]).includes(value)) {
    return true
  }
  return SYSTEM_WORDING_PATTERN.test(value)
}

export function findDefaultQuickPromptByTitle(title: string): DefaultQuickPromptTemplate | undefined {
  return DEFAULT_QUICK_PROMPTS.find(item => item.title === title.trim())
}

export function systemWordingQuickPromptMessage(content: string): string | null {
  return isSystemWordingQuickPrompt(content)
    ? '请改成用户会说的自然问题，不要写成系统指令。'
    : null
}

export function collectLegacySystemWordingQuickPrompts<T extends Pick<AiQuickPrompt, 'title' | 'content'>>(
  items: readonly T[],
): T[] {
  return items.filter((item) => {
    const recommended = findDefaultQuickPromptByTitle(item.title)
    return Boolean(recommended) && isSystemWordingQuickPrompt(item.content)
  })
}

export const QUICK_PROMPT_LIST_COLUMN_KEYS = ['prompt', 'enabled'] as const

export const QUICK_PROMPT_REMOVED_LIST_COLUMN_KEYS = ['position', 'sortOrder'] as const

export const QUICK_PROMPT_EDITOR_FIELD_KEYS = ['title', 'content', 'positions', 'enabled'] as const

export const QUICK_PROMPT_SORT_STEP = 10

export function nextQuickPromptSortOrder(items: readonly { sortOrder: number }[]): number {
  const max = items.reduce((current, item) => Math.max(current, item.sortOrder), 0)
  return max + QUICK_PROMPT_SORT_STEP
}

export function applyDragSortedOrders<T extends { id: string, sortOrder: number }>(
  previous: readonly T[],
  nextOrder: readonly T[],
): T[] {
  const previousOrders = previous.map(item => item.sortOrder)
  return nextOrder.map((item, index) => ({
    ...item,
    sortOrder: previousOrders[index] ?? (index + 1) * QUICK_PROMPT_SORT_STEP,
  }))
}

export function diffQuickPromptSortOrders<T extends { id: string, sortOrder: number }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const previousById = new Map(previous.map(item => [item.id, item.sortOrder]))
  return next.filter(item => previousById.get(item.id) !== item.sortOrder)
}
