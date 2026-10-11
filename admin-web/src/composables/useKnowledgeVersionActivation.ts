import type { KnowledgeDocumentVersion } from '@/types/knowledge'
import { enableKnowledgeVersion } from '@/api/modules/knowledge'
import { useConfirmedCrudAction } from './useCrudActions'

/** 恢复既有发布版本，确认与提交状态共用，避免连续点击重复启用。 */
export function useKnowledgeVersionActivation(options: { onEnabled: () => void | Promise<void> }) {
  return useConfirmedCrudAction({
    action: (version: Pick<KnowledgeDocumentVersion, 'id' | 'version'>) => enableKnowledgeVersion(version.id),
    confirm: version => ({
      title: '重新启用知识版本',
      content: `确定重新启用 v${version.version}？将恢复该版本的发布状态，保留原版本号和资料内容。如已有其他发布版本，请先停用。`,
      confirmText: '重新启用',
    }),
    successMessage: (_version, result) => result.warnings.length
      ? `已重新启用（提示：${result.warnings.join('；')}）`
      : '已重新启用',
    onSuccess: options.onEnabled,
  })
}
