/**
 * AI 相关后台权限码常量（与 src/db/seed.ts permissionSeeds 保持一致）。
 * 命名遵循现有 system:ai:* 规范，新增、修改、删除、导出、分配、测试等使用独立权限码。
 * 仅新路由引用本常量；存量路由保持内联字符串，避免无谓重构。
 */
export const AI_PERMISSIONS = {
  PROVIDER_LIST: "system:ai:provider:list",
  PROVIDER_CREATE: "system:ai:provider:add",
  PROVIDER_UPDATE: "system:ai:provider:edit",
  PROVIDER_DELETE: "system:ai:provider:remove",
  PROVIDER_TEST: "system:ai:provider:test",
  MODEL_LIST: "system:ai:model:list",
  MODEL_CREATE: "system:ai:model:add",
  MODEL_UPDATE: "system:ai:model:edit",
  MODEL_DELETE: "system:ai:model:remove",
  MODEL_TEST: "system:ai:model:test",
  SCENE_LIST: "system:ai:scene:list",
  SCENE_UPDATE: "system:ai:scene:edit",
  PROMPT_LIST: "system:ai:prompt:list",
  PROMPT_CREATE: "system:ai:prompt:add",
  PROMPT_EDIT: "system:ai:prompt:edit",
  PROMPT_PUBLISH: "system:ai:prompt:publish",
  PROMPT_DELETE: "system:ai:prompt:remove",
  DEBUG_USE: "system:ai:debug:use",
  CONVERSATION_LIST: "system:ai:conversation:list",
  CONVERSATION_DETAIL: "system:ai:conversation:detail",
  FEEDBACK_LIST: "system:ai:feedback:list",
  FEEDBACK_HANDLE: "system:ai:feedback:handle",
  FILTER_LIST: "system:ai:filter:list",
  FILTER_CREATE: "system:ai:filter:add",
  FILTER_UPDATE: "system:ai:filter:edit",
  FILTER_DELETE: "system:ai:filter:remove"
} as const;

export type AiPermission = (typeof AI_PERMISSIONS)[keyof typeof AI_PERMISSIONS];