import { describe, expect, it } from 'vitest'
import {
  evidenceLevelLabels,
  mdReviewStatusMeta,
  mdReviewStatusMetaFor,
  professionalReviewStatusMeta,
  professionalReviewStatusMetaFor,
} from './professional-status'

describe('professional-status 状态映射', () => {
  it('mdReviewStatusMeta 覆盖全部六个审核状态', () => {
    expect(Object.keys(mdReviewStatusMeta)).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'APPROVED',
      'PUBLISHED',
      'DISABLED',
      'REJECTED',
    ])
    expect(mdReviewStatusMeta.PUBLISHED).toEqual({ label: '已发布', status: 'success' })
    expect(mdReviewStatusMeta.PENDING_REVIEW).toEqual({ label: '待审核', status: 'warning' })
    expect(mdReviewStatusMeta.REJECTED).toEqual({ label: '已驳回', status: 'error' })
  })

  it('professionalReviewStatusMeta 覆盖三个决议状态', () => {
    expect(Object.keys(professionalReviewStatusMeta)).toEqual([
      'PENDING_REVIEW',
      'APPROVED',
      'REJECTED',
    ])
  })

  it('未知审核状态回退为原文，不吞掉原始值', () => {
    expect(mdReviewStatusMetaFor('ARCHIVED')).toEqual({ label: 'ARCHIVED', status: 'default' })
    expect(mdReviewStatusMetaFor(null)).toEqual({ label: '未知', status: 'default' })
    expect(mdReviewStatusMetaFor('PUBLISHED')).toEqual(mdReviewStatusMeta.PUBLISHED)
  })

  it('未知决议状态同样回退为原文', () => {
    expect(professionalReviewStatusMetaFor('QUEUED')).toEqual({ label: 'QUEUED', status: 'default' })
    expect(professionalReviewStatusMetaFor('APPROVED')).toEqual(professionalReviewStatusMeta.APPROVED)
  })

  it('证据等级标签派生自业务语义，覆盖 A/B/C', () => {
    expect(evidenceLevelLabels.A).toBe('A · 标准规范')
    expect(evidenceLevelLabels.B).toBe('B · 检测认证')
    expect(evidenceLevelLabels.C).toBe('C · 厂商资料')
  })
})