import { describe, expect, it } from 'vitest'
import { standardVisibilityMeta, standardVisibilityText } from './standard-visibility'

describe('standardVisibilityMeta', () => {
  it('states user visibility for every review status', () => {
    expect(standardVisibilityMeta('PENDING_REVIEW')).toMatchObject({
      label: '待审核',
      visibility: '用户不可见',
      aiUsage: '不参与 AI / 热工判定',
      status: 'warning',
    })
    expect(standardVisibilityMeta('APPROVED')).toMatchObject({
      label: '审核通过待发布',
      visibility: '用户不可见',
      status: 'info',
    })
    expect(standardVisibilityMeta('PUBLISHED')).toMatchObject({
      label: '已发布',
      visibility: '用户可见',
      aiUsage: 'AI 可使用 / 参与热工判定',
      status: 'success',
    })
    expect(standardVisibilityMeta('DISABLED')).toMatchObject({
      label: '已停用',
      visibility: '用户不可见',
      aiUsage: '新请求不可使用',
    })
  })

  it('treats unknown status codes conservatively as invisible', () => {
    expect(standardVisibilityMeta('WEIRD_CODE')).toMatchObject({ visibility: '用户不可见' })
    expect(standardVisibilityMeta(null)).toMatchObject({ label: '未知状态' })
  })

  it('renders one-line copy for list cells', () => {
    expect(standardVisibilityText('PUBLISHED')).toBe('已发布 · 用户可见')
    expect(standardVisibilityText('PENDING_REVIEW')).toBe('待审核 · 用户不可见')
  })
})
