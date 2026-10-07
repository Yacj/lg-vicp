import { describe, expect, it } from 'vitest'
import {
  countPromptChars,
  diffPromptVersions,
  extractPromptVariables,
  getAiAuditActionLabel,
  getAiClientAppLabel,
  getAiFeedbackReactionLabel,
  getAiMessageRoleLabel,
  getAiMessageStatusLabel,
  getAiReasoningModeLabel,
  getAiSceneLabel,
  getQuickPromptIconLabel,
  getQuickPromptPositionLabel,
  summarizeQuickPromptStats,
  renderMarkdown,
  toUserFacingAiMessage,
} from './ai'

describe('ai scene labels', () => {
  it('maps every scene enum to a label', () => {
    expect(getAiSceneLabel('general_chat')).toBe('通用问答')
    expect(getAiSceneLabel('project_design')).toBe('项目分析')
    expect(getAiSceneLabel('material_compare')).toBe('材料对比')
    expect(getAiSceneLabel('product_consultation')).toBe('产品咨询')
    expect(getAiSceneLabel('standard_qa')).toBe('规范查询')
    expect(getAiSceneLabel('report_generate')).toBe('报告生成')
    expect(getAiSceneLabel('information_extract')).toBe('信息抽取')
    expect(getAiSceneLabel('conversation_title')).toBe('会话标题生成')
    expect(getAiSceneLabel('knowledge_qa')).toBe('知识查询')
  })

  it('falls back to the raw value for unknown scenes', () => {
    expect(getAiSceneLabel('unknown_scene')).toBe('unknown_scene')
  })
})

describe('ai client app / feedback labels', () => {
  it('maps client apps and reactions', () => {
    expect(getAiClientAppLabel('pc_ai')).toBe('PC AI 工作台')
    expect(getAiClientAppLabel('b_admin')).toBe('B 端管理台')
    expect(getAiClientAppLabel('c_app')).toBe('C 端应用')
    expect(getAiFeedbackReactionLabel('LIKE')).toBe('点赞')
    expect(getAiFeedbackReactionLabel('DISLIKE')).toBe('点踩')
    expect(getAiFeedbackReactionLabel('UNKNOWN')).toBe('UNKNOWN')
  })
})

describe('ai message labels', () => {
  it('maps roles and statuses', () => {
    expect(getAiMessageRoleLabel('USER')).toBe('用户')
    expect(getAiMessageRoleLabel('ASSISTANT')).toBe('助手')
    expect(getAiMessageRoleLabel('TOOL')).toBe('工具')
    expect(getAiMessageStatusLabel('COMPLETED')).toBe('已完成')
    expect(getAiMessageStatusLabel('FAILED')).toBe('失败')
    expect(getAiMessageStatusLabel('STOPPED')).toBe('已停止')
  })

  it('maps reasoning modes', () => {
    expect(getAiReasoningModeLabel('ON')).toBe('深度思考')
    expect(getAiReasoningModeLabel('OFF')).toBe('快速回答')
  })

  it('maps conversation audit actions and falls back to the raw code', () => {
    expect(getAiAuditActionLabel('ai.message_stopped')).toBe('停止生成')
    expect(getAiAuditActionLabel('ai.message_blocked')).toBe('内容拦截')
    expect(getAiAuditActionLabel('ai.message_sent')).toBe('发送消息')
    expect(getAiAuditActionLabel('unknown.action')).toBe('unknown.action')
  })
})

describe('prompt variable extraction', () => {
  it('extracts unique {{variables}} in order of appearance', () => {
    const prompt = '项目：{{projectName}}，地区：{{ region }}，{{projectName}} 的概况。'
    expect(extractPromptVariables(prompt)).toEqual(['projectName', 'region'])
  })

  it('ignores empty placeholders and returns [] for plain text', () => {
    expect(extractPromptVariables('你是一名建筑节能顾问。')).toEqual([])
    expect(extractPromptVariables('{{}} {{  }}')).toEqual([])
  })
})

describe('prompt char count', () => {
  it('counts trimmed characters', () => {
    expect(countPromptChars('你是一名建筑节能顾问。')).toBe(11)
    expect(countPromptChars('  \n abc \n ')).toBe(3)
  })
})

describe('prompt version diff', () => {
  it('marks inserted and removed lines with positions', () => {
    const diff = diffPromptVersions('第一行\n被删除行\n保留行', '第一行\n新增行\n保留行')

    expect(diff).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, text: '第一行' },
      { kind: 'removed', oldLine: 2, newLine: null, text: '被删除行' },
      { kind: 'added', oldLine: null, newLine: 2, text: '新增行' },
      { kind: 'equal', oldLine: 3, newLine: 3, text: '保留行' },
    ])
  })

  it('returns all equal for identical text', () => {
    const diff = diffPromptVersions('a\nb', 'a\nb')

    expect(diff).toEqual([
      { kind: 'equal', oldLine: 1, newLine: 1, text: 'a' },
      { kind: 'equal', oldLine: 2, newLine: 2, text: 'b' },
    ])
  })

  it('handles append and prepend', () => {
    const appended = diffPromptVersions('a', 'a\nb')
    expect(appended.at(-1)).toEqual({ kind: 'added', oldLine: null, newLine: 2, text: 'b' })

    const prepended = diffPromptVersions('b', 'a\nb')
    expect(prepended[0]).toEqual({ kind: 'added', oldLine: null, newLine: 1, text: 'a' })
  })
})

describe('quick prompt labels and stats', () => {
  it('maps positions and icons to business labels', () => {
    expect(getQuickPromptPositionLabel('AI_HOME')).toBe('筑小格首页')
    expect(getQuickPromptPositionLabel('PROJECT_AI')).toBe('项目AI')
    expect(getQuickPromptIconLabel('book')).toBe('图集')
    expect(getQuickPromptIconLabel('project')).toBe('项目')
  })

  it('counts enabled prompts by position', () => {
    expect(summarizeQuickPromptStats([
      { enabled: true, position: 'AI_HOME' },
      { enabled: true, position: 'AI_HOME' },
      { enabled: false, position: 'AI_HOME' },
      { enabled: true, position: 'PROJECT_AI' },
    ])).toEqual({
      enabledCount: 3,
      homeCount: 2,
      projectCount: 1,
    })
  })
})


describe('user facing AI messages', () => {
  it('hides technical error codes and keeps Chinese backend messages', () => {
    expect(toUserFacingAiMessage('QUICK_PROMPT_CREATE_FAILED')).toBe('保存失败，请稍后重试。')
    expect(toUserFacingAiMessage('同一展示位置已存在相同标题的快捷提问')).toBe('同一展示位置已存在相同标题的快捷提问')
  })
})

describe('renderMarkdown', () => {
  it('parses gfm markdown after escaping html', () => {
    const html = renderMarkdown('## 保温\n\n**限值** 与 <script>document.cookie</script>')

    expect(html).toContain('<h2>')
    expect(html).toContain('<strong>限值</strong>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('keeps line breaks in plain paragraphs', () => {
    expect(renderMarkdown('第一行\n第二行')).toContain('<br')
  })
})
