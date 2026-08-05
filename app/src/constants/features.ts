/**
 * 功能开关：控制尚未具备后端能力的功能入口与展示。
 * 值依据后端真实能力设置（见 docs/four-tab-refactor/01-audit.md），
 * 仅用于控制未完成能力，后端补齐后置为 true 并移除开关判断。
 */
export const appFeatures = {
  // 首页模块（阶段 5 接入）
  homeRecentProjects: true,
  homeRecentConversation: true,

  // 项目
  projectListMine: true, // GET /client/projects 已可用
  projectListPublic: true,

  // AI
  aiAttachments: false, // 消息接口暂不接收附件 ID
  aiSources: true, // SSE done 事件携带 sources
  aiModelPicker: false, // 无 C 端模型列表接口

  // 报告 / 收藏
  reportsList: false, // 无报告列表接口
  nodeFavorites: false, // 无收藏接口

  // 专业工具场景（后端未接入，仅作为对话开场）
  smartSelection: false,
  thermalCalculation: false,
  materialComparison: false,
} as const

export type AppFeatureKey = keyof typeof appFeatures

export function isFeatureEnabled(key: AppFeatureKey) {
  return appFeatures[key]
}
