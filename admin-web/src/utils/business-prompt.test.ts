import { describe, expect, it } from 'vitest'
import {
  BUSINESS_PROMPT_CAPABILITIES,
  BUSINESS_PROMPT_DUTY_HINT,
  BUSINESS_PROMPT_LIST_ACTION_KEYS,
  BUSINESS_PROMPT_LIST_COLUMN_KEYS,
  BUSINESS_PROMPT_REMOVED_LIST_COLUMN_KEYS,
  BUSINESS_PROMPT_REPEAT_RULE_HINT,
  DEFAULT_BUSINESS_PROMPT_CONTENT,
  DEFAULT_GLOBAL_RESPONSE_POLICY,
  GLOBAL_RESPONSE_POLICY_CONTEXT_HINT,
  GLOBAL_RESPONSE_POLICY_MAX_RULES,
  GLOBAL_RESPONSE_POLICY_PURPOSE,
  GLOBAL_RESPONSE_POLICY_TEST_CASE,
  GLOBAL_RESPONSE_POLICY_TEST_CASES,
  KNOWLEDGE_SEARCH_TEST_CASE,
  PRODUCT_COMPARE_PROMPT_RULES,
  STANDARD_QA_DEFAULT_PROMPT,
  builtinBusinessPromptContent,
  businessPromptDutyTag,
  businessPromptKindLabel,
  businessPromptModifiedLines,
  businessPromptStatusLabel,
  countNumberedPromptRules,
  editorPromptContent,
  evaluateGlobalResponsePolicyCoverage,
  evaluateKnowledgeSearchPromptCoverage,
  isGlobalResponsePolicy,
  projectBusinessPromptRows,
  projectBusinessPromptRowsWithModels,
} from './business-prompt'

describe('business prompt capabilities', () => {
  it('lists global response policy first, then business prompts', () => {
    expect(BUSINESS_PROMPT_CAPABILITIES.map(item => item.name)).toEqual([
      '全局回答规则',
      '基础对话',
      '知识库检索',
      '产品咨询',
      '产品/方案对比',
      '报告生成',
      '项目分析',
      '热工计算',
      '图片理解',
    ])
    expect(BUSINESS_PROMPT_CAPABILITIES[0]).toMatchObject({
      code: 'GLOBAL_RESPONSE_POLICY',
      kind: 'global_response_policy',
      scene: null,
    })
    expect(BUSINESS_PROMPT_DUTY_HINT).toContain('整体表达方式')
    expect(BUSINESS_PROMPT_DUTY_HINT).toContain('回答重点')
    expect(businessPromptKindLabel('global_response_policy')).toBe('全局')
    expect(businessPromptKindLabel('business')).toBe('业务')
    expect(businessPromptDutyTag('GLOBAL_RESPONSE_POLICY')).toBe('全局')
    expect(businessPromptDutyTag('BASE_CHAT')).toBe('基础')
    expect(businessPromptDutyTag('KNOWLEDGE_SEARCH')).toBe('业务')
    expect(businessPromptDutyTag('PRODUCT_COMPARE')).toBe('业务')
    expect(businessPromptDutyTag('REPORT_GENERATION')).toBe('业务')
  })

  it('keeps the admin list to name, purpose, status and config', () => {
    expect([...BUSINESS_PROMPT_LIST_COLUMN_KEYS]).toEqual(['name', 'purpose', 'enabled'])
    expect([...BUSINESS_PROMPT_REMOVED_LIST_COLUMN_KEYS]).toEqual(['kind', 'modelName', 'updatedAt'])
    expect([...BUSINESS_PROMPT_LIST_ACTION_KEYS]).toEqual(['config'])
    expect(businessPromptStatusLabel(true)).toBe('启用')
    expect(businessPromptStatusLabel(false)).toBe('停用')
  })

  it('keeps product consultation and comparison as business prompts', () => {
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'PRODUCT_CONSULTATION')).toMatchObject({
      kind: 'business',
      name: '产品咨询',
      scene: 'product_consultation',
    })
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'PRODUCT_COMPARE')?.purpose)
      .toBe('控制已有对比结果如何解释给用户')
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'PRODUCT_COMPARE')?.note)
      .toContain('回答方式由全局回答规则统一负责')
    expect([...PRODUCT_COMPARE_PROMPT_RULES]).toEqual([
      '关注 ComparisonResult 中已经整理好的差异',
      '不要改写产品数据或筛选逻辑',
      '热工缺失时说明暂不参与比较',
      '不替用户做唯一最终选择',
    ])
  })

  it('does not repeat global response rules in business prompts', () => {
    const business = BUSINESS_PROMPT_CAPABILITIES.filter(item => item.kind === 'business')
    const text = `${JSON.stringify(business)}\n${BUSINESS_PROMPT_REPEAT_RULE_HINT}`
    const businessContent = Object.entries(DEFAULT_BUSINESS_PROMPT_CONTENT)
      .filter(([code]) => code !== 'GLOBAL_RESPONSE_POLICY')
      .map(([, content]) => content)
      .join('\n')
    expect(text).not.toContain('不要复述上下文')
    expect(text).not.toContain('默认精炼')
    expect(text).not.toContain('不要描述工具')
    expect(businessContent).not.toContain('不要编造')
    expect(businessContent).not.toContain('不要 Tool')
    expect(businessContent).not.toContain('结论优先')
    expect(BUSINESS_PROMPT_REPEAT_RULE_HINT).toContain('不必在每条业务 Prompt 重复')
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'PRODUCT_COMPARE')?.purpose)
      .not.toContain('不要复述')
  })

  it('uses one-sentence user-facing purposes and keeps duty tags in the name', () => {
    expect(GLOBAL_RESPONSE_POLICY_PURPOSE).toBe('控制 AI 面向用户时的整体表达方式')
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'KNOWLEDGE_SEARCH')?.purpose)
      .toBe('控制标准、图集等资料类问题的回答重点')
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'PRODUCT_CONSULTATION')?.purpose)
      .toBe('控制产品介绍、优势和适用场景的回答重点')
    expect(BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === 'REPORT_GENERATION')?.purpose)
      .toBe('控制报告内容组织方式')
    const catalog = JSON.stringify(BUSINESS_PROMPT_CAPABILITIES)
    expect(catalog).not.toContain('Scene Code')
    expect(catalog).not.toContain('Tool Chain')
    expect(catalog).not.toContain('Agent Runtime')
    expect(catalog).not.toContain('Model Routing')
    expect(catalog).not.toContain('方案对比Agent')
    expect(catalog).not.toContain('报告Agent')
    expect(catalog).not.toContain('知识Agent')
    expect(catalog).not.toContain('热工Agent')
  })
})

describe('global response policy defaults', () => {
  it('keeps the builtin policy to 8-10 core style rules', () => {
    expect(isGlobalResponsePolicy('GLOBAL_RESPONSE_POLICY')).toBe(true)
    expect(isGlobalResponsePolicy('BASE_CHAT')).toBe(false)
    expect(builtinBusinessPromptContent('GLOBAL_RESPONSE_POLICY')).toBe(DEFAULT_GLOBAL_RESPONSE_POLICY)
    const ruleCount = countNumberedPromptRules(DEFAULT_GLOBAL_RESPONSE_POLICY)
    expect(ruleCount).toBeGreaterThanOrEqual(8)
    expect(ruleCount).toBeLessThanOrEqual(GLOBAL_RESPONSE_POLICY_MAX_RULES)
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('直接回答用户当前问题，结论优先')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('不先描述准备做什么')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('只作为判断依据，默认不复述')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('不重复上一轮已经完整回答过的内容')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('只回答这一点及必要新增信息')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('普通用户容易理解的语言')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('缺少什么以及因此不能确定什么')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('不要说明内部如何检索')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('不要展开过长背景')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).toContain('不向用户解释系统规则或内部能力')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).not.toContain('专业/创意')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY).not.toContain('Temperature')
    expect(DEFAULT_GLOBAL_RESPONSE_POLICY.split('\n')).toHaveLength(ruleCount)
    expect(GLOBAL_RESPONSE_POLICY_CONTEXT_HINT).toContain('回答风格和表达')
  })

  it('covers follow-up price and insulation scheme preview tests', () => {
    expect(GLOBAL_RESPONSE_POLICY_TEST_CASE.input).toContain('价格呢')
    expect(GLOBAL_RESPONSE_POLICY_TEST_CASE.expected).toContain('只回答价格相关内容')
    expect(KNOWLEDGE_SEARCH_TEST_CASE.input).toBe('保温薄抹灰系统传热系数0.3的方案')
    expect(KNOWLEDGE_SEARCH_TEST_CASE.expected).toContain('我先查一下')
    expect(KNOWLEDGE_SEARCH_TEST_CASE.expected).toContain('工具说明')
    expect(KNOWLEDGE_SEARCH_TEST_CASE.expected).toContain('系统规则自我声明')
    expect(GLOBAL_RESPONSE_POLICY_TEST_CASES).toHaveLength(2)
    const coverage = evaluateGlobalResponsePolicyCoverage(DEFAULT_GLOBAL_RESPONSE_POLICY)
    expect(coverage.passed).toBe(true)
    expect(coverage.checks.map(item => item.id)).toEqual([
      'direct',
      'no-prep-talk',
      'no-tool-talk',
      'no-rule-declaration',
      'context-for-reasoning',
      'no-repeat',
      'follow-up',
    ])
    expect(evaluateGlobalResponsePolicyCoverage('随便写点风格').passed).toBe(false)
  })
})

describe('standard_qa / knowledge search defaults', () => {
  it('uses a natural knowledge prompt instead of citation mandates', () => {
    expect(STANDARD_QA_DEFAULT_PROMPT).toBe(
      '关注与用户问题直接相关的标准、条文和技术要求。有可靠资料时给出关键结论及对应出处；资料不足时直接说明目前不能确定的部分。',
    )
    expect(builtinBusinessPromptContent('KNOWLEDGE_SEARCH')).toBe(STANDARD_QA_DEFAULT_PROMPT)
    expect(STANDARD_QA_DEFAULT_PROMPT).not.toContain('必须引用')
    expect(STANDARD_QA_DEFAULT_PROMPT).not.toContain('明确拒绝下结论')
    expect(evaluateKnowledgeSearchPromptCoverage(STANDARD_QA_DEFAULT_PROMPT).passed).toBe(true)
    expect(evaluateKnowledgeSearchPromptCoverage('回答必须引用资料，没有来源时明确拒绝下结论，不要编造。').passed)
      .toBe(false)
  })
})

describe('business prompt projection', () => {
  it('projects backend items onto the capability catalog', () => {
    const rows = projectBusinessPromptRows([
      {
        code: 'BASE_CHAT',
        content: '默认对话',
        description: 'x',
        enabled: true,
        id: '1',
        name: '基础对话',
        updatedAt: '2026-09-18T00:00:00.000Z',
        updatedBy: null,
      },
    ])
    expect(rows).toHaveLength(9)
    expect(rows[0]).toMatchObject({
      code: 'GLOBAL_RESPONSE_POLICY',
      content: DEFAULT_GLOBAL_RESPONSE_POLICY,
      enabled: true,
      modelName: '全部场景',
    })
    expect(rows[1]).toMatchObject({ code: 'BASE_CHAT', content: '默认对话', enabled: true, updatedBy: null })
    expect(rows.find(item => item.code === 'KNOWLEDGE_SEARCH')).toMatchObject({
      content: builtinBusinessPromptContent('KNOWLEDGE_SEARCH'),
      enabled: false,
    })
    expect(editorPromptContent('GLOBAL_RESPONSE_POLICY', '')).toBe(DEFAULT_GLOBAL_RESPONSE_POLICY)
    expect(businessPromptModifiedLines({
      updatedAt: '2026-09-21T01:10:00.000Z',
      updatedBy: '张三',
    })).toEqual([
      expect.stringMatching(/^最后修改：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/),
      '修改人：张三',
    ])
    expect(businessPromptModifiedLines({ updatedAt: '', updatedBy: null })).toEqual(['最后修改：—'])
  })

  it('joins scene models for business prompts and keeps global policy scene-agnostic', () => {
    const rows = projectBusinessPromptRowsWithModels(
      [{
        code: 'PRODUCT_COMPARE',
        content: '解释 ComparisonResult',
        description: 'x',
        enabled: true,
        id: '2',
        name: '产品/方案对比',
        updatedAt: '2026-09-18T00:00:00.000Z',
        updatedBy: null,
      }],
      new Map([
        ['material_compare', {
          defaultModelId: 'model-1',
          defaultModelName: '对比模型',
          primaryModelId: 'model-1',
          scene: 'material_compare',
        }],
      ]),
      new Map([['model-1', 'DeepSeek Chat']]),
    )
    expect(rows.find(item => item.code === 'GLOBAL_RESPONSE_POLICY')?.modelName).toBe('全部场景')
    expect(rows.find(item => item.code === 'PRODUCT_COMPARE')).toMatchObject({
      content: '解释 ComparisonResult',
      modelName: 'DeepSeek Chat',
    })
  })
})
