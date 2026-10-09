import { describe, expect, it } from 'vitest'
import { BusinessError } from '@/types/error'
import { businessErrorCode, businessUserError, businessUserMessage } from './business-error'

function businessError(message: string, details?: unknown): BusinessError {
  return new BusinessError({ code: 400, message, details }, 'req-1')
}

describe('businessErrorCode', () => {
  it('reads the stable code from details.errorCode', () => {
    expect(businessErrorCode(businessError('x', { errorCode: 'KNOWLEDGE_VERSION_EMPTY' }))).toBe('KNOWLEDGE_VERSION_EMPTY')
  })

  it('returns null when the code is absent or the error is not a business error', () => {
    expect(businessErrorCode(businessError('x'))).toBeNull()
    expect(businessErrorCode(businessError('x', { errorCode: '   ' }))).toBeNull()
    expect(businessErrorCode(businessError('x', 'not-an-object'))).toBeNull()
    expect(businessErrorCode(new Error('boom'))).toBeNull()
    expect(businessErrorCode(null)).toBeNull()
  })
})

describe('businessUserError', () => {
  it('prefers the stable code mapping over the raw message', () => {
    const error = businessError('内部措辞可能变化', { errorCode: 'THERMAL_CALC_RULE_NOT_PUBLISHED' })
    expect(businessUserError(error)).toBe('还没有可用的热工计算规则，请先配置并发布计算规则。')
  })

  it('falls back to message terminology replacement when no code is present', () => {
    expect(businessUserError(businessError('缺少 ORIGINAL 正式原文件，不能发布 AI 可引用版本')))
      .toBe('还没有知识文件，不能发布给提问使用。')
  })

  it('falls back to the generic copy for unknown errors', () => {
    expect(businessUserError(null)).toBe('操作失败，请稍后重试。')
    expect(businessUserError(undefined, '自定义兜底')).toBe('自定义兜底')
    expect(businessUserError(businessError(''))).toBe('操作失败，请稍后重试。（请求编号：req-1）')
    expect(businessUserError(businessError('unknownField: failed'))).toContain('请求编号：req-1')
  })
})

describe('businessUserMessage terminology', () => {
  it('rewrites knowledge base gate messages', () => {
    expect(businessUserMessage('原文件没有文本层且不存在 SEARCH_SOURCE 文本源，不能进入 AI 检索'))
      .toBe('当前文件读不出文字，请先补充可搜索文字版本。')
    expect(businessUserMessage('仅审核通过的版本可以发布')).toBe('请先审核通过，再发布给提问使用。')
    expect(businessUserMessage('有 12 页仅使用物理页码回退（FALLBACK），未识别到可靠印刷页码'))
      .toBe('有 12 页没有识别到印刷页码，会用文件页码代替。')
  })

  it('rewrites page recognition messages that arrive without an errorCode', () => {
    expect(businessUserMessage('该页面已有识别任务正在排队或执行')).toBe('这一页已有识别任务在处理中，请稍后再试。')
    expect(businessUserMessage('确认前需要页面全文（fullText/parsedText）')).toBe('这一页还没有识别出文字内容，请先识别再确认。')
    expect(businessUserMessage('人工选择的构造方案与识别数据不兼容')).toBe('选择的构造方案和这一页的识别结果对不上，请重新选择。')
    expect(businessUserMessage('人工选择的产品规格不存在、未发布或不属于该构造方案'))
      .toBe('选择的产品规格不存在、未发布，或不属于该构造方案，请重新选择。')
  })

  it('rewrites thermal reference set messages without double-substituting jargon', () => {
    expect(businessUserMessage('参考行唯一约束冲突，导入已整体回滚'))
      .toBe('导入的数据有重复项，已全部撤销，请修正后重新导入。')
    expect(businessUserMessage('图集热工参考集结构校验未通过'))
      .toBe('热工参考集的文件结构不符合要求，请检查后重新导入。')
    expect(businessUserMessage('参考集最新版本状态不允许应用导入，请先派生新版本草稿'))
      .toBe('当前参考集版本状态不允许导入，请先创建一个新版本草稿。')
    expect(businessUserMessage('该地区没有已发布且生效中的标准限值，合格判定暂缺'))
      .toBe('这个地区还没有可用的标准限值，暂时无法判断是否满足要求。')
  })

  it('maps bare business codes that leak into technical text', () => {
    expect(businessUserMessage('PAGE_RECOGNITION_BUSY')).toBe('该页正在识别，请稍后再试。')
    expect(businessUserMessage('THERMAL_REFERENCE_SET_NOT_EDITABLE')).toBe('当前热工参考集已发布，本次确认不会修改正式热工数据。')
  })

  it('collapses jargon enums and abbreviations', () => {
    expect(businessUserMessage('当前状态为 REVIEW_REQUIRED，索引 INDEXING'))
      .toBe('当前状态为 待校验，索引 问答内容更新中')
  })

  it('returns safe copy for empty or stack-like input', () => {
    expect(businessUserMessage('')).toBe('操作失败，请稍后重试。')
    expect(businessUserMessage(null)).toBe('操作失败，请稍后重试。')
    expect(businessUserMessage('TypeError: boom at worker traceback')).toBe('系统在处理时遇到问题，请稍后重试。')
  })

  it('keeps backend field and table names out of customer messages', () => {
    expect(businessUserMessage('未提供 thermalSetId：已确认页面与 chunks，未同步 thermal_reference_rows'))
      .toBe('页面已确认，但热工数据尚未同步。请到“核对识别结果”检查热工参考集设置。')
    expect(businessUserMessage('unknownField: thermal_reference_rows failed'))
      .not.toMatch(/unknownField|thermal_reference_rows/)
  })

  it('turns publish blockers into an action the customer can take', () => {
    expect(businessUserMessage('版本正式索引尚未完成（或页面变更后未重建），请先执行版本索引重建'))
      .toBe('问答内容尚未准备好，或资料修改后尚未更新。请点击“更新问答内容”。')
    expect(businessUserMessage('离线页图版本有 3 页识别结果待人工确认，不能发布为 AI_ENABLED'))
      .toBe('有 3 页识别结果待核对。请到“核对识别结果”确认后再发布。')
    expect(businessUserMessage('当前版本还没有可被 AI 检索的内容（chunks = 0），不能发布为 AI_ENABLED'))
      .toBe('这份资料还没有可供问答查找的内容。请核对页面文字，再更新问答内容。')
  })
})
