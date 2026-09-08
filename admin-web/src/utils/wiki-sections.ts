import type { KnowledgeVersionSection } from '@/types/knowledge'

/**
 * Wiki 章节树纯函数：后端 `/versions/:versionId/sections` 返回扁平有序节点，
 * 前端组树 / 按关键词筛选（保留祖先）/ 摊平渲染 / 圈定章节页码范围。
 */

export interface WikiSectionTreeItem {
  id: string
  parentId: string | null
  title: string
  level: number
  sectionPath: string[]
  startPage: number | null
  endPage: number | null
  sortOrder: number
  children: WikiSectionTreeItem[]
}

/** 按 parentId 组树；孤儿节点（父不存在）提升为根，保持后端给定的顺序 */
export function buildSectionTree(nodes: readonly KnowledgeVersionSection[]): WikiSectionTreeItem[] {
  const byId = new Map<string, WikiSectionTreeItem>()
  for (const node of nodes) {
    byId.set(node.id, { ...node, children: [] })
  }

  const roots: WikiSectionTreeItem[] = []
  for (const node of nodes) {
    const item = byId.get(node.id)!
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent && parent !== item) {
      parent.children.push(item)
    }
    else {
      roots.push(item)
    }
  }
  return roots
}

/** 关键词筛选：命中节点保留，其祖先链保留（保证层级可读），未命中分支整体剪掉 */
export function filterSectionTree(
  tree: readonly WikiSectionTreeItem[],
  keyword: string,
): WikiSectionTreeItem[] {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) {
    return [...tree]
  }
  const result: WikiSectionTreeItem[] = []
  for (const node of tree) {
    const children = filterSectionTree(node.children, normalized)
    if (node.title.toLowerCase().includes(normalized) || children.length > 0) {
      result.push({ ...node, children })
    }
  }
  return result
}

export interface WikiSectionFlatItem {
  node: WikiSectionTreeItem
  depth: number
}

/** 树 → 摊平渲染序列（全展开，depth 用于缩进；文档章节层级浅，不做折叠状态） */
export function flattenSectionTree(
  tree: readonly WikiSectionTreeItem[],
  depth = 0,
): WikiSectionFlatItem[] {
  return tree.flatMap(node => [
    { node, depth },
    ...flattenSectionTree(node.children, depth + 1),
  ])
}

export interface WikiSectionPageRef {
  pageNumber: number
  sectionPath: string | null
}

/**
 * 圈定章节覆盖的页码：
 * 1. 优先按 startPage/endPage 区间；
 * 2. 无页码区间时按标题与页面所在章节（page.sectionPath）匹配；
 * 3. 找不到时返回空数组（调用方禁用跳转，不猜测页码）。
 */
export function pagesInSection(
  section: Pick<WikiSectionTreeItem, 'title' | 'sectionPath' | 'startPage' | 'endPage'>,
  pages: readonly WikiSectionPageRef[],
): number[] {
  if (section.startPage != null || section.endPage != null) {
    const start = section.startPage ?? section.endPage!
    const end = section.endPage ?? section.startPage!
    return pages.filter(page => page.pageNumber >= start && page.pageNumber <= end).map(page => page.pageNumber)
  }

  const titles = new Set([section.title, ...section.sectionPath])
  return pages
    .filter(page => page.sectionPath != null && titles.has(page.sectionPath))
    .map(page => page.pageNumber)
}
