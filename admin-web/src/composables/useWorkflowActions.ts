import { reactive, readonly, ref } from 'vue'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import type { WorkflowActionInput, WorkflowActionType } from '@/types/professional'

/**
 * 专业数据统一工作流动作（submit/approve/reject/publish/disable/new-version）。
 * - submit/publish/disable/new-version：确认框 + 成功反馈 + 列表刷新（useConfirmedCrudAction）。
 * - approve/reject：独立弹窗收集审核意见/驳回原因（rejectReason 后端必填），提交后同样刷新。
 * - 状态机与后端 md-workflow.service 一致：submit(DRAFT/REJECTED)、approve/reject(PENDING_REVIEW)、
 *   publish(APPROVED)、disable(PUBLISHED)、new-version(PUBLISHED/DISABLED)。
 */

export interface WorkflowTarget {
  id: string
  /** 展示名（弹窗标题/确认文案用） */
  label: string
}

export interface UseWorkflowActionsOptions<TResult> {
  /** 实体名（如「保温系统」），用于确认与反馈文案 */
  entityName: string
  /** 执行工作流请求（各模块 API 包装 run*Workflow） */
  run: (id: string, action: WorkflowActionInput) => Promise<TResult>
  /** 成功后刷新列表 */
  onSuccess?: (result: TResult) => void | Promise<void>
}

/** 各状态可用的工作流动作（与后端状态机一致） */
export function workflowActionsForStatus(status: string | null | undefined): WorkflowActionType[] {
  switch (status) {
    case 'DRAFT':
    case 'REJECTED':
      return ['submit']
    case 'PENDING_REVIEW':
      return ['approve', 'reject']
    case 'APPROVED':
      return ['publish']
    case 'PUBLISHED':
      return ['disable', 'new-version']
    case 'DISABLED':
      return ['new-version']
    default:
      return []
  }
}

export function useWorkflowActions<TResult>(options: UseWorkflowActionsOptions<TResult>) {
  const feedback = useAppFeedback()
  const { entityName, run, onSuccess } = options

  async function afterSuccess(result: TResult): Promise<void> {
    await onSuccess?.(result)
  }

  function buildAction(
    type: WorkflowActionType,
    confirm: { title: string; content: string; danger?: boolean; successText: string },
  ) {
    return useConfirmedCrudAction<WorkflowTarget, TResult>({
      action: (target) => run(target.id, { type } as WorkflowActionInput),
      confirm: (target) => ({
        danger: confirm.danger,
        title: confirm.title,
        content: `${confirm.content}「${target.label}」？`,
      }),
      successMessage: (target) => `${entityName}「${target.label}」${confirm.successText}`,
      onSuccess: afterSuccess,
    })
  }

  const submit = buildAction('submit', { title: '提交审核', content: '确定将', successText: '已提交审核' })
  const publish = buildAction('publish', { title: '发布', content: '确定发布', successText: '已发布' })
  const disable = buildAction('disable', {
    title: '停用',
    content: '确定停用',
    danger: true,
    successText: '已停用',
  })
  const newVersion = buildAction('new-version', {
    title: '派生新版本',
    content: '确定基于当前版本派生新草稿',
    successText: '已派生新版本',
  })

  // ---- approve / reject 弹窗（审核决议需收集意见/原因） ----

  const approveDialog = reactive({
    note: '',
    submitting: false,
    target: null as WorkflowTarget | null,
    visible: false,
  })
  const rejectDialog = reactive({
    reason: '',
    submitting: false,
    target: null as WorkflowTarget | null,
    visible: false,
  })
  const approveRunning = ref(false)
  const rejectRunning = ref(false)

  function openApprove(target: WorkflowTarget): void {
    approveDialog.target = target
    approveDialog.note = ''
    approveDialog.visible = true
  }

  function openReject(target: WorkflowTarget): void {
    rejectDialog.target = target
    rejectDialog.reason = ''
    rejectDialog.visible = true
  }

  function closeApprove(): void {
    if (!approveDialog.submitting) {
      approveDialog.visible = false
    }
  }

  function closeReject(): void {
    if (!rejectDialog.submitting) {
      rejectDialog.visible = false
    }
  }

  async function submitApprove(): Promise<void> {
    const target = approveDialog.target
    if (!target || approveDialog.submitting) {
      return
    }
    approveDialog.submitting = true
    approveRunning.value = true
    try {
      const result = await run(target.id, {
        type: 'approve',
        approvalNote: approveDialog.note.trim() || undefined,
      })
      approveDialog.visible = false
      await feedback.message('success', `${entityName}「${target.label}」已审核通过`)
      await afterSuccess(result)
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      approveDialog.submitting = false
      approveRunning.value = false
    }
  }

  async function submitReject(): Promise<void> {
    const target = rejectDialog.target
    if (!target || rejectDialog.submitting) {
      return
    }
    const reason = rejectDialog.reason.trim()
    if (!reason) {
      await feedback.message('warning', '请填写驳回原因')
      return
    }
    rejectDialog.submitting = true
    rejectRunning.value = true
    try {
      const result = await run(target.id, { type: 'reject', rejectReason: reason })
      rejectDialog.visible = false
      await feedback.message('success', `${entityName}「${target.label}」已驳回`)
      await afterSuccess(result)
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      rejectDialog.submitting = false
      rejectRunning.value = false
    }
  }

  return {
    approveDialog: readonly(approveDialog),
    approveRunning: readonly(approveRunning),
    closeApprove,
    closeReject,
    disable,
    newVersion,
    openApprove,
    openReject,
    publish,
    rejectDialog: readonly(rejectDialog),
    rejectRunning: readonly(rejectRunning),
    submit,
    submitApprove,
    submitReject,
  }
}

export type WorkflowActions = ReturnType<typeof useWorkflowActions>