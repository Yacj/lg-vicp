import type { LocalIconOption } from '@/components/ui/menu-icons'
import analyticsSource from './analytics.svg?url'
import knowledgeSource from './knowledge.svg?url'
import projectSource from './project.svg?url'

/** 本地资源必须在这里显式登记，菜单值只保存 local:<key>，不接受运行时路径。 */
const LOCAL_ICON_REGISTRY = [
  {
    keywords: ['analytics', '分析', '本地'],
    label: '分析（本地）',
    source: analyticsSource,
    value: 'local:analytics',
  },
  {
    keywords: ['knowledge', '知识', '本地'],
    label: '知识（本地）',
    source: knowledgeSource,
    value: 'local:knowledge',
  },
  {
    keywords: ['project', '项目', '本地'],
    label: '项目（本地）',
    source: projectSource,
    value: 'local:project',
  },
] as const satisfies readonly LocalIconOption[]

export const LOCAL_ICON_OPTIONS: readonly LocalIconOption[] = Object.freeze(LOCAL_ICON_REGISTRY)

const localIconSources = new Map<string, string>(
  LOCAL_ICON_OPTIONS.map(option => [option.value, option.source] as const),
)

export function resolveLocalIcon(value: string | null | undefined): string | null {
  if (!value?.startsWith('local:')) {
    return null
  }
  return localIconSources.get(value) ?? null
}