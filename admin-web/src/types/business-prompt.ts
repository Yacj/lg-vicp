export const GLOBAL_RESPONSE_POLICY_CODE = 'GLOBAL_RESPONSE_POLICY' as const

export const BUSINESS_PROMPT_CODES = [
  GLOBAL_RESPONSE_POLICY_CODE,
  'BASE_CHAT',
  'KNOWLEDGE_SEARCH',
  'PRODUCT_CONSULTATION',
  'PRODUCT_COMPARE',
  'REPORT_GENERATION',
  'PROJECT_ANALYSIS',
  'THERMAL_CALCULATION',
  'VISION_UNDERSTANDING',
] as const

export type BusinessPromptCode = (typeof BUSINESS_PROMPT_CODES)[number]

export type BusinessPromptKind = 'global_response_policy' | 'business'

/** 业务提示词列表项。不暴露 sceneCode、版本 ID、Diff 或变量。 */
export interface BusinessPromptItem {
  id: string
  code: BusinessPromptCode | string
  name: string
  description: string
  content: string
  enabled: boolean
  updatedBy: string | null
  updatedAt: string
}

export interface BusinessPromptMutationResult {
  message: string
  prompt: BusinessPromptItem
}
