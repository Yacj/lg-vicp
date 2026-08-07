import type { AiScene } from '@/api/types'

/**
 * 入口语义 → AI 场景。
 *
 * 场景的实际能力（是否注入项目上下文、是否检索项目知识库）由后端 ai_scenes 表的
 * requireProject / allowKnowledgeSearch 开关决定，前端只负责表达「从哪个入口发起」，
 * 不在页面里散落硬编码的场景字符串。
 */
export const ENTRY_SCENE = {
  /** 项目详情等携带项目上下文的入口 */
  project: 'project_design',
  /** 首页、历史记录等无项目上下文的入口 */
  general: 'general_chat',
} as const satisfies Record<string, AiScene>

/** 后端未启用目标场景时的兜底，保证入口不会整体不可用 */
export const FALLBACK_SCENE: AiScene = ENTRY_SCENE.general

/**
 * 本次启动内已确认「后端未开放」的场景。
 * 后端场景开关是运行时配置，前端没有场景列表接口可查，
 * 只能由首次创建会话失败来发现；记住结果可避免每次都先失败再降级。
 */
const unavailableScenes = new Set<AiScene>()

export function markSceneUnavailable(scene: AiScene) {
  if (scene !== FALLBACK_SCENE) {
    unavailableScenes.add(scene)
  }
}

export function resolveScene(scene?: AiScene): AiScene {
  if (!scene || unavailableScenes.has(scene)) {
    return FALLBACK_SCENE
  }
  return scene
}
