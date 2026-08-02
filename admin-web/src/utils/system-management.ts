import type { PageResult } from '@/types/api'
import type { SystemDepartmentTreeNode } from '@/types/system-management'

export type EnabledFilter = 'all' | 'enabled' | 'disabled'

export interface DepartmentTreeOption {
  value: string
  label: string
  disabled?: boolean
  children?: DepartmentTreeOption[]
}

export interface ClientPageOptions<T> {
  page: number
  pageSize: number
  predicate?: (item: T) => boolean
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export function matchesKeyword(keyword: string, values: readonly unknown[]): boolean {
  const normalized = keyword.trim().toLocaleLowerCase()
  if (!normalized) {
    return true
  }
  return values.some(value => String(value ?? '').toLocaleLowerCase().includes(normalized))
}

export function matchesEnabledFilter(enabled: boolean, filter: EnabledFilter): boolean {
  return filter === 'all' || (filter === 'enabled' ? enabled : !enabled)
}

export function projectClientPage<T>(
  items: readonly T[],
  options: ClientPageOptions<T>,
): PageResult<T> {
  const pageSize = positiveInteger(options.pageSize, 20)
  const filtered = options.predicate ? items.filter(options.predicate) : [...items]
  const total = filtered.length
  const lastPage = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(positiveInteger(options.page, 1), lastPage)
  const start = (page - 1) * pageSize

  return {
    items: filtered.slice(start, start + pageSize),
    page,
    pageSize,
    total,
  }
}

function cloneDepartmentTree(nodes: readonly SystemDepartmentTreeNode[]): SystemDepartmentTreeNode[] {
  return nodes.map(node => ({
    ...node,
    children: cloneDepartmentTree(node.children),
  }))
}

export function filterDepartmentTree(
  nodes: readonly SystemDepartmentTreeNode[],
  keyword: string,
): SystemDepartmentTreeNode[] {
  const normalized = keyword.trim()
  if (!normalized) {
    return cloneDepartmentTree(nodes)
  }

  return nodes.flatMap((node) => {
    if (matchesKeyword(normalized, [node.name, node.code, node.leader])) {
      return [{ ...node, children: cloneDepartmentTree(node.children) }]
    }

    const children = filterDepartmentTree(node.children, normalized)
    return children.length > 0 ? [{ ...node, children }] : []
  })
}

export function collectDepartmentSubtreeIds(
  node: SystemDepartmentTreeNode,
): Set<string> {
  const ids = new Set<string>([node.id])
  node.children.forEach((child) => {
    collectDepartmentSubtreeIds(child).forEach(id => ids.add(id))
  })
  return ids
}

export function toDepartmentTreeOptions(
  nodes: readonly SystemDepartmentTreeNode[],
  excludedIds: ReadonlySet<string> = new Set(),
): DepartmentTreeOption[] {
  return nodes.flatMap((node) => {
    if (excludedIds.has(node.id)) {
      return []
    }
    const children = toDepartmentTreeOptions(node.children, excludedIds)
    return [{
      value: node.id,
      label: `${node.name}（${node.code}）`,
      ...(!node.enabled ? { disabled: true } : {}),
      ...(children.length > 0 ? { children } : {}),
    }]
  })
}

export function countDepartmentNodes(nodes: readonly SystemDepartmentTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countDepartmentNodes(node.children), 0)
}

export function parseMetadataText(value: string): Record<string, unknown> | undefined {
  const normalized = value.trim()
  if (!normalized) {
    return undefined
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  }
  catch {
    throw new TypeError('元数据必须是有效的 JSON 对象')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('元数据必须是 JSON 对象')
  }
  return parsed as Record<string, unknown>
}

export function formatMetadataText(metadata: Record<string, unknown> | null): string {
  return metadata ? JSON.stringify(metadata, null, 2) : ''
}

export function trimToUndefined(value: string): string | undefined {
  const normalized = value.trim()
  return normalized || undefined
}

export function trimToNull(value: string): string | null {
  return value.trim() || null
}