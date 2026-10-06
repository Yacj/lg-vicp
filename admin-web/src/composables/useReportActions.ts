import type { ReportArtifactType, ReportItem } from '@/types/report'
import type { CreateShareInput } from '@/types/report'
import {
  approveTemplateReport,
  rejectTemplateReport,
  submitTemplateReportForReview,
} from '@/api/modules/report-center'
import {
  createShare,
  deleteReport,
  disableShare,
  fetchReportDownloadUrl,
  publishReport,
  regenerateReport,
} from '@/api/modules/reports'
import { downloadFromUrl } from '@/utils/download'
import { downloadUrlToBlob } from '@/api/modules/files'
import { useAppFeedback } from './useAppFeedback'
import { useCrudDelete, useConfirmedCrudAction } from './useCrudActions'

export interface UseReportActionsOptions {
  /** 操作成功后的数据刷新回调（列表重新聚合 / 详情重新加载）。 */
  onChanged?: () => void | Promise<void>
}

/**
 * 报告与分享的通用动作（发布 / 重试 / 删除 / 下载 / 创建分享 / 禁用分享）。
 * 列表页与详情页复用同一套动作，动作本身不感知数据来源。
 */
export function useReportActions(options: UseReportActionsOptions = {}) {
  const feedback = useAppFeedback()

  function notifyChanged(): void {
    void options.onChanged?.()
  }

  const publishAction = useConfirmedCrudAction<ReportItem, { message: string }>({
    action: report => publishReport(report.id),
    confirm: () => ({
      content: '发布后，拥有项目查看权限的用户即可访问该报告，确认发布吗？',
      confirmText: '发布',
      danger: false,
      title: '发布报告',
    }),
    onSuccess: notifyChanged,
    successMessage: (_report, result) => result.message,
  })

  const retryAction = useConfirmedCrudAction<ReportItem, { message: string }>({
    action: report => regenerateReport(report.id),
    confirm: () => ({
      content: '将重新加入生成队列，当前报告内容会被覆盖，确认重试吗？',
      confirmText: '重新生成',
      danger: false,
      title: '重试生成报告',
    }),
    onSuccess: notifyChanged,
    successMessage: (_report, result) => result.message,
  })

  const deleteAction = useCrudDelete<Pick<ReportItem, 'id'>, { message: string }>({
    action: report => deleteReport(report.id),
    confirm: () => ({
      content: '删除后报告及其发布状态将被移除，无法恢复，确认删除吗？',
      confirmText: '删除',
      danger: true,
      title: '删除报告',
    }),
    onSuccess: notifyChanged,
    successMessage: (_report, result) => result.message,
  })

  /** 下载报告文件：获取预签名地址 → Blob 下载（真实接口链路）。 */
  async function downloadArtifact(reportId: string, type: ReportArtifactType): Promise<void> {
    try {
      const { url } = await fetchReportDownloadUrl(reportId, type)
      await downloadFromUrl(url, {
        fetchBlob: (targetUrl, context) => downloadUrlToBlob(targetUrl, {
          onProgress: context.onProgress,
          signal: context.signal ?? new AbortController().signal,
        }),
      })
      feedback.message('success', '文件已开始下载')
    }
    catch (cause) {
      feedback.messageError(cause)
    }
  }

  /** 创建分享；成功返回公开访问路径，失败返回 null。 */
  async function runShareAction(input: CreateShareInput): Promise<{ url: string } | null> {
    try {
      const result = await createShare(input)
      feedback.message('success', result.message)
      return { url: result.url }
    }
    catch (cause) {
      feedback.messageError(cause)
      return null
    }
  }

  const submitReviewAction = useConfirmedCrudAction<Pick<ReportItem, 'id'>, unknown>({
    action: report => submitTemplateReportForReview(report.id),
    confirm: () => ({
      content: '提交后进入审核队列，通过后才可发布。确认提交审核吗？',
      confirmText: '提交审核',
      danger: false,
      title: '提交报告审核',
    }),
    onSuccess: notifyChanged,
    successMessage: '已提交审核',
  })

  const approveAction = useConfirmedCrudAction<Pick<ReportItem, 'id'>, unknown>({
    action: report => approveTemplateReport(report.id),
    confirm: () => ({
      content: '通过后该报告可以发布。确认审核通过吗？',
      confirmText: '通过',
      danger: false,
      title: '审核通过',
    }),
    onSuccess: notifyChanged,
    successMessage: '已审核通过',
  })

  const disableShareAction = useConfirmedCrudAction<{ shareId: string, title: string }, { message: string }>({
    action: ({ shareId }) => disableShare(shareId),
    confirm: ({ title }) => ({
      content: `禁用后链接将立即失效，确认禁用分享「${title}」吗？`,
      confirmText: '禁用',
      danger: true,
      title: '禁用分享链接',
    }),
    onSuccess: notifyChanged,
    successMessage: (_share, result) => result.message,
  })

  async function rejectReport(id: string, rejectReason: string): Promise<boolean> {
    try {
      await rejectTemplateReport(id, rejectReason)
      feedback.message('success', '已驳回')
      notifyChanged()
      return true
    }
    catch (cause) {
      feedback.messageError(cause)
      return false
    }
  }

  return {
    approveAction,
    deleteAction,
    disableShareAction,
    downloadArtifact,
    publishAction,
    rejectReport,
    retryAction,
    runShareAction,
    submitReviewAction,
  }
}