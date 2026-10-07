import type { Ref } from 'vue'
import { computed, unref } from 'vue'
import type { KnowledgeVersionStatus } from '@/types/knowledge'

/** 已发布/审核中的知识版本统一提示：不再让用户点到 409 才知道不可编辑。 */
export const KNOWLEDGE_VERSION_LOCKED_HINT = '当前知识版本已发布，如需修改，请创建新版本。'

/** 热工参考集已发布时的提示：页面可确认，但不会同步正式热工数据。 */
export const KNOWLEDGE_THERMAL_SET_LOCKED_HINT
  = '当前热工参考集已发布，本次确认不会修改正式热工数据。请创建新的热工参考版本后再同步。'

export interface KnowledgeVersionEditableInput {
  /** 版本状态；null 视为不可编辑。 */
  status?: KnowledgeVersionStatus | null
  /** 后端返回的 versionEditable；缺省时按 status===DRAFT 推导。 */
  versionEditable?: boolean | null
  /** 后端返回的 thermalSetEditable；null 表示当前页未关联热工参考集。 */
  thermalSetEditable?: boolean | null
  /** 当前用户是否具备对应操作权限。 */
  permission?: boolean
}

export interface KnowledgeVersionEditableState {
  /** 权限 + 后端状态同时满足才可编辑。 */
  editable: boolean
  /** 仅权限判断结果，便于提示「有权限但已发布」。 */
  permitted: boolean
  /** 因版本已发布而锁定。 */
  versionLocked: boolean
  /** 热工参考集不可编辑（页面本身可能仍可确认）。 */
  thermalSetLocked: boolean
  /** 版本锁定时的统一提示文案。 */
  lockedHint: string
  /** 热工集锁定时的统一提示文案。 */
  thermalLockedHint: string
}

function resolveVersionEditable(input: KnowledgeVersionEditableInput): boolean {
  if (input.versionEditable === true || input.versionEditable === false) {
    return input.versionEditable
  }
  return input.status === 'DRAFT'
}

/**
 * 统一的知识版本可编辑判断。
 * 页面图库 / 识别校验 / 结构化数据等 Tab 必须复用同一判断，避免同一 Version 出现不同编辑态。
 */
export function useKnowledgeVersionEditable(
  input: Ref<KnowledgeVersionEditableInput> | KnowledgeVersionEditableInput,
): Readonly<Ref<KnowledgeVersionEditableState>> {
  return computed<KnowledgeVersionEditableState>(() => {
    const source = unref(input)
    const permitted = source.permission !== false
    const versionEditable = resolveVersionEditable(source)
    const versionLocked = !versionEditable
    const thermalSetLocked = source.thermalSetEditable === false
    return {
      editable: permitted && versionEditable,
      permitted,
      versionLocked,
      thermalSetLocked,
      lockedHint: KNOWLEDGE_VERSION_LOCKED_HINT,
      thermalLockedHint: KNOWLEDGE_THERMAL_SET_LOCKED_HINT,
    }
  })
}
