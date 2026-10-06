import type { AiScene } from '@/types/ai'
import {
  GLOBAL_RESPONSE_POLICY_CODE,
  type BusinessPromptCode,
  type BusinessPromptItem,
  type BusinessPromptKind,
} from '@/types/business-prompt'
import { formatDate } from '@/utils/day'

export interface BusinessPromptCapability {
  code: BusinessPromptCode
  name: string
  purpose: string
  kind: BusinessPromptKind
  scene: AiScene | null
  note?: string
}

export const GLOBAL_RESPONSE_POLICY_NAME = '全局回答规则'

export const GLOBAL_RESPONSE_POLICY_PURPOSE
  = '控制 AI 面向用户时的整体表达方式'

export const GLOBAL_RESPONSE_POLICY_CONTEXT_HINT
  = '全局回答规则控制回答风格和表达。历史对话、项目资料和项目记忆仍会作为 AI 判断依据，只是默认不复述。'

export const GLOBAL_RESPONSE_POLICY_BOUNDARY_HINT
  = '本页只调整表达方式。详细安全约束由服务端保证，不必把“不要编造 / 不要 Tool / 权限规则”写进这里。'

export const BUSINESS_PROMPT_DUTY_HINT
  = '全局回答规则控制整体表达方式，其余条目控制各业务的回答重点。'

export const BUSINESS_PROMPT_REPEAT_RULE_HINT
  = '不必在每条业务 Prompt 重复：不要复述、不要 Tool、不要编造、精炼、结论优先。这些由全局回答规则和服务端约束负责。'

export const GLOBAL_RESPONSE_POLICY_RULE_LIMIT_HINT
  = '建议只保留 8～10 条核心表达规则。更细的安全约束由服务端强制，不用展示给普通管理员。'

export const GLOBAL_RESPONSE_POLICY_MAX_RULES = 10

/** 面向管理员的默认表达规则，控制在 8～10 条。 */
export const DEFAULT_GLOBAL_RESPONSE_POLICY = [
  '1. 直接回答用户当前问题，结论优先。',
  '2. 不先描述准备做什么。',
  '3. 历史对话和项目资料只作为判断依据，默认不复述。',
  '4. 不重复上一轮已经完整回答过的内容。',
  '5. 用户追问某一点时，只回答这一点及必要新增信息。',
  '6. 默认使用普通用户容易理解的语言，保持精炼。',
  '7. 资料不足时直接说明缺少什么以及因此不能确定什么。',
  '8. 来源可以展示，但不要说明内部如何检索。',
  '9. 除非用户明确要求详细说明，否则不要展开过长背景。',
  '10. 不向用户解释系统规则或内部能力，直接给出答案。',
].join('\n')

export const PRODUCT_COMPARE_PROMPT_RULES = [
  '关注 ComparisonResult 中已经整理好的差异',
  '不要改写产品数据或筛选逻辑',
  '热工缺失时说明暂不参与比较',
  '不替用户做唯一最终选择',
] as const

export const PRODUCT_COMPARE_PROMPT_NOTE
  = '用于控制 AI 如何解释系统已经整理好的产品对比结果。不会改变产品数据、计算规则、热工结果或筛选逻辑。回答方式由全局回答规则统一负责。'

export const STANDARD_QA_DEFAULT_PROMPT
  = '关注与用户问题直接相关的标准、条文和技术要求。有可靠资料时给出关键结论及对应出处；资料不足时直接说明目前不能确定的部分。'

export const DEFAULT_BUSINESS_PROMPT_CONTENT: Record<BusinessPromptCode, string> = {
  BASE_CHAT: '关注用户当前问题。寒暄直接回应；涉及产品、标准、项目或报告时按对应业务处理。',
  GLOBAL_RESPONSE_POLICY: DEFAULT_GLOBAL_RESPONSE_POLICY,
  KNOWLEDGE_SEARCH: STANDARD_QA_DEFAULT_PROMPT,
  PRODUCT_COMPARE: '关注结构化对比结果中的差异。只解释 ComparisonResult 中已经整理好的差异，不要改写产品数据或筛选逻辑。不要打分、排名或替用户做唯一选择。热工缺失时说明暂不参与比较。',
  PRODUCT_CONSULTATION: '关注单产品的性能、适用场景和优势。用户只给出产品名时，自然追问想了解哪一方面，例如性能、适用场景、产品优势，或和其他产品做对比。资料足够则给出结论、必要条件和来源。',
  PROJECT_ANALYSIS: '关注当前项目条件对方案或产品选择的影响。缺失条件时询问，不要补造项目参数。',
  REPORT_GENERATION: '关注已确认选择或已固化材料。聊天里只需简短确认已按所选内容生成，具体内容进入报告。',
  THERMAL_CALCULATION: '关注确定性热工计算结果。先给结果，再给简短解释；计算过程仅在用户询问时展开。没有结果时说明这部分暂时不参与比较。',
  VISION_UNDERSTANDING: '只描述图片中可见的内容。不确定处明确说明，不把观察结果当作已发布标准或计算结果。',
}

/** 按业务能力展示，不暴露 sceneCode / 版本 / Diff / 变量。 */
export const BUSINESS_PROMPT_CAPABILITIES: readonly BusinessPromptCapability[] = [
  {
    code: GLOBAL_RESPONSE_POLICY_CODE,
    kind: 'global_response_policy',
    name: GLOBAL_RESPONSE_POLICY_NAME,
    note: `${GLOBAL_RESPONSE_POLICY_CONTEXT_HINT} ${GLOBAL_RESPONSE_POLICY_BOUNDARY_HINT}`,
    purpose: GLOBAL_RESPONSE_POLICY_PURPOSE,
    scene: null,
  },
  {
    code: 'BASE_CHAT',
    kind: 'business',
    name: '基础对话',
    purpose: '控制日常问答的回答重点',
    scene: 'general_chat',
  },
  {
    code: 'KNOWLEDGE_SEARCH',
    kind: 'business',
    name: '知识库检索',
    purpose: '控制标准、图集等资料类问题的回答重点',
    scene: 'knowledge_qa',
  },
  {
    code: 'PRODUCT_CONSULTATION',
    kind: 'business',
    name: '产品咨询',
    purpose: '控制产品介绍、优势和适用场景的回答重点',
    scene: 'product_consultation',
  },
  {
    code: 'PRODUCT_COMPARE',
    kind: 'business',
    name: '产品/方案对比',
    note: PRODUCT_COMPARE_PROMPT_NOTE,
    purpose: '控制已有对比结果如何解释给用户',
    scene: 'material_compare',
  },
  {
    code: 'REPORT_GENERATION',
    kind: 'business',
    name: '报告生成',
    purpose: '控制报告内容组织方式',
    scene: 'report_generate',
  },
  {
    code: 'PROJECT_ANALYSIS',
    kind: 'business',
    name: '项目分析',
    purpose: '控制结合当前项目条件时的回答重点',
    scene: 'project_design',
  },
  {
    code: 'THERMAL_CALCULATION',
    kind: 'business',
    name: '热工计算',
    note: '热工是可选能力，不是产品对比的前置步骤。不必在这里配置公式或评分规则。',
    purpose: '控制热工计算结果如何解释给用户',
    scene: 'thermal_calculation',
  },
  {
    code: 'VISION_UNDERSTANDING',
    kind: 'business',
    name: '图片理解',
    purpose: '控制图片内容如何描述给用户',
    scene: 'vision_understanding',
  },
]

export const GLOBAL_RESPONSE_POLICY_TEST_CASES = [
  {
    id: 'follow-up-price',
    input: '上一轮已经介绍过项目资料，本轮用户只问“价格呢？”',
    expected: '只回答价格相关内容，不要重复项目背景。',
  },
  {
    id: 'insulation-scheme',
    input: '保温薄抹灰系统传热系数0.3的方案',
    expected: '第一屏直接给结果或必要的一个澄清问题。不出现“我先查一下”、工具说明或系统规则自我声明。',
  },
] as const

export const GLOBAL_RESPONSE_POLICY_TEST_CASE = GLOBAL_RESPONSE_POLICY_TEST_CASES[0]

export const KNOWLEDGE_SEARCH_TEST_CASE = GLOBAL_RESPONSE_POLICY_TEST_CASES[1]

export interface GlobalResponsePolicyCoverageCheck {
  id: string
  label: string
  passed: boolean
}

export const BUSINESS_PROMPT_LIST_COLUMN_KEYS = ['name', 'purpose', 'enabled'] as const

export const BUSINESS_PROMPT_REMOVED_LIST_COLUMN_KEYS = ['kind', 'modelName', 'updatedAt'] as const

export const BUSINESS_PROMPT_LIST_ACTION_KEYS = ['config'] as const

export type BusinessPromptDutyTag = '全局' | '基础' | '业务'

export function isGlobalResponsePolicy(code: string): boolean {
  return code === GLOBAL_RESPONSE_POLICY_CODE
}

export function businessPromptDutyTag(code: string, kind?: BusinessPromptKind): BusinessPromptDutyTag {
  if (kind === 'global_response_policy' || isGlobalResponsePolicy(code)) {
    return '全局'
  }
  if (code === 'BASE_CHAT') {
    return '基础'
  }
  return '业务'
}

export function businessPromptDutyTagStatus(tag: BusinessPromptDutyTag): 'info' | 'default' {
  return tag === '全局' ? 'info' : 'default'
}

export function businessPromptKindLabel(kind: BusinessPromptKind): string {
  return kind === 'global_response_policy' ? '全局' : '业务'
}

export function businessPromptStatusLabel(enabled: boolean): '启用' | '停用' {
  return enabled ? '启用' : '停用'
}

export function formatBusinessPromptModifiedAt(updatedAt: string): string {
  if (!updatedAt.trim()) {
    return '—'
  }
  const date = new Date(updatedAt)
  if (Number.isNaN(date.getTime())) {
    return '—'
  }
  return formatDate(date, 'YYYY-MM-DD HH:mm')
}

export function businessPromptModifiedLines(item: Pick<BusinessPromptItem, 'updatedAt' | 'updatedBy'>): string[] {
  const lines = [`最后修改：${formatBusinessPromptModifiedAt(item.updatedAt)}`]
  const updatedBy = item.updatedBy?.trim()
  if (updatedBy) {
    lines.push(`修改人：${updatedBy}`)
  }
  return lines
}

export function builtinBusinessPromptContent(code: BusinessPromptCode | string): string {
  if (code in DEFAULT_BUSINESS_PROMPT_CONTENT) {
    return DEFAULT_BUSINESS_PROMPT_CONTENT[code as BusinessPromptCode]
  }
  return ''
}

export function businessPromptCapability(code: string): BusinessPromptCapability | undefined {
  return BUSINESS_PROMPT_CAPABILITIES.find(item => item.code === code)
}

export function editorPromptContent(code: string, content: string): string {
  const current = content.trim()
  return current || builtinBusinessPromptContent(code)
}

export function countNumberedPromptRules(content: string): number {
  return content.split('\n').filter(line => /^\d+\./.test(line.trim())).length
}

export function evaluateGlobalResponsePolicyCoverage(content: string): {
  passed: boolean
  checks: GlobalResponsePolicyCoverageCheck[]
} {
  const text = content
  const checks: GlobalResponsePolicyCoverageCheck[] = [
    {
      id: 'direct',
      label: '第一屏直接给结果或必要澄清，结论优先',
      passed: /直接回答|结论优先/.test(text),
    },
    {
      id: 'no-prep-talk',
      label: '不出现“我先查一下”一类准备说明',
      passed: /不先描述准备做什么|不描述准备做什么/.test(text),
    },
    {
      id: 'no-tool-talk',
      label: '不向用户说明工具或内部检索过程',
      passed: /不要说明内部如何检索|不向用户解释内部|不解释内部|不描述准备做什么或内部执行/.test(text),
    },
    {
      id: 'no-rule-declaration',
      label: '不出现系统规则自我声明',
      passed: /不向用户解释系统规则|不向用户解释系统能力|不主动解释/.test(text),
    },
    {
      id: 'context-for-reasoning',
      label: '历史对话和项目资料只作为判断依据',
      passed: /判断依据/.test(text),
    },
    {
      id: 'no-repeat',
      label: '不重复上一轮已经完整回答过的内容',
      passed: /不重复上一轮|不要重写上一轮/.test(text),
    },
    {
      id: 'follow-up',
      label: '追问时只回答该点及必要新增信息',
      passed: /只回答这一点|只回答该点/.test(text),
    },
  ]
  return {
    checks,
    passed: checks.every(item => item.passed),
  }
}

export function evaluateKnowledgeSearchPromptCoverage(content: string): {
  passed: boolean
  checks: GlobalResponsePolicyCoverageCheck[]
} {
  const text = content
  const checks: GlobalResponsePolicyCoverageCheck[] = [
    {
      id: 'focus',
      label: '关注与问题直接相关的标准、条文和技术要求',
      passed: /标准|条文|技术要求/.test(text),
    },
    {
      id: 'cite-when-available',
      label: '有可靠资料时给出关键结论及出处',
      passed: /有可靠资料时|对应出处/.test(text),
    },
    {
      id: 'admit-gap',
      label: '资料不足时说明目前不能确定的部分',
      passed: /资料不足|不能确定/.test(text),
    },
    {
      id: 'not-system-instruction',
      label: '不写成必须引用或明确拒绝下结论的系统指令',
      passed: !/必须引用|明确拒绝下结论|不要编造|不得杜撰/.test(text),
    },
  ]
  return {
    checks,
    passed: checks.every(item => item.passed),
  }
}

export interface BusinessPromptSceneBinding {
  scene: AiScene
  primaryModelId?: string | null
  defaultModelId?: string | null
  defaultModelName?: string | null
}

export function resolveBusinessPromptModelName(
  capability: BusinessPromptCapability,
  bindingByScene: ReadonlyMap<AiScene, BusinessPromptSceneBinding>,
  modelNameById: ReadonlyMap<string, string>,
): string {
  if (capability.kind === 'global_response_policy' || !capability.scene) {
    return '全部场景'
  }
  const binding = bindingByScene.get(capability.scene)
  const modelId = binding?.primaryModelId ?? binding?.defaultModelId ?? null
  return (modelId ? modelNameById.get(modelId) : null)
    ?? binding?.defaultModelName
    ?? '—'
}

export type ProjectedBusinessPromptRow = BusinessPromptCapability
  & Pick<BusinessPromptItem, 'content' | 'enabled' | 'updatedAt' | 'updatedBy'>
  & { modelName: string }

export function projectBusinessPromptRows(items: readonly BusinessPromptItem[]): ProjectedBusinessPromptRow[] {
  return projectBusinessPromptRowsWithModels(items, new Map(), new Map())
}

export function projectBusinessPromptRowsWithModels(
  items: readonly BusinessPromptItem[],
  bindingByScene: ReadonlyMap<AiScene, BusinessPromptSceneBinding>,
  modelNameById: ReadonlyMap<string, string>,
): ProjectedBusinessPromptRow[] {
  const byCode = new Map(items.map(item => [item.code, item]))
  return BUSINESS_PROMPT_CAPABILITIES.map((capability) => {
    const current = byCode.get(capability.code)
    return {
      ...capability,
      content: current?.content?.trim()
        ? current.content
        : builtinBusinessPromptContent(capability.code),
      enabled: current?.enabled ?? isGlobalResponsePolicy(capability.code),
      modelName: resolveBusinessPromptModelName(capability, bindingByScene, modelNameById),
      updatedAt: current?.updatedAt ?? '',
      updatedBy: current?.updatedBy ?? null,
    }
  })
}
