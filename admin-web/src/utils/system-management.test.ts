import type { SystemDepartmentTreeNode } from '@/types/system-management'
import { describe, expect, it } from 'vitest'
import {
  collectDepartmentSubtreeIds,
  filterDepartmentTree,
  formatMetadataText,
  matchesEnabledFilter,
  parseMetadataText,
  projectClientPage,
  toDepartmentTreeOptions,
} from './system-management'

function department(
  id: string,
  name: string,
  children: SystemDepartmentTreeNode[] = [],
): SystemDepartmentTreeNode {
  return {
    children,
    code: id,
    createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    email: null,
    enabled: true,
    id,
    leader: null,
    name,
    parentId: null,
    phone: null,
    sortOrder: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('system management projections', () => {
  it('projects deterministic client-side filtering and pagination', () => {
    const result = projectClientPage(
      [
        { enabled: true, id: '1' },
        { enabled: false, id: '2' },
        { enabled: true, id: '3' },
      ],
      {
        page: 4,
        pageSize: 1,
        predicate: item => matchesEnabledFilter(item.enabled, 'enabled'),
      },
    )

    expect(result).toEqual({
      items: [{ enabled: true, id: '3' }],
      page: 2,
      pageSize: 1,
      total: 2,
    })
  })

  it('keeps ancestor chains and matched subtrees when filtering departments', () => {
    const source = [
      department('root', '总部', [
        department('rd', '研发中心', [department('platform', '平台组')]),
        department('sales', '销售中心'),
      ]),
    ]

    const childMatch = filterDepartmentTree(source, '平台')
    const parentMatch = filterDepartmentTree(source, '研发')

    expect(childMatch).toHaveLength(1)
    expect(childMatch[0]?.children[0]?.children[0]?.id).toBe('platform')
    expect(childMatch[0]?.children.some(item => item.id === 'sales')).toBe(false)
    expect(parentMatch[0]?.children[0]?.children[0]?.id).toBe('platform')
    expect(source[0]?.children).toHaveLength(2)
  })

  it('removes the current department subtree from parent choices', () => {
    const current = department('rd', '研发中心', [department('platform', '平台组')])
    const source = [
      department('root', '总部', [current, department('sales', '销售中心')]),
    ]

    const excluded = collectDepartmentSubtreeIds(current)
    const options = toDepartmentTreeOptions(source, excluded)

    expect([...excluded]).toEqual(['rd', 'platform'])
    expect(options).toEqual([
      {
        children: [{ label: '销售中心（sales）', value: 'sales' }],
        label: '总部（root）',
        value: 'root',
      },
    ])
  })

  it('accepts only JSON objects as dictionary metadata', () => {
    expect(parseMetadataText('{"color":"green"}')).toEqual({ color: 'green' })
    expect(parseMetadataText('')).toBeUndefined()
    expect(formatMetadataText({ color: 'green' })).toBe('{\n  "color": "green"\n}')
    expect(() => parseMetadataText('[1,2]')).toThrow('JSON 对象')
    expect(() => parseMetadataText('{broken')).toThrow('有效的 JSON 对象')
  })
})