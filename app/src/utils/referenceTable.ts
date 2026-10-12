import type { AiReferencePage, ReferenceHighlight } from '@/api/reference-page'
import type { SolutionSnapshotDto } from '@/api/solution-types'
import { normalizeReferencePages } from './referencePage'

export function snapshotReferencePages(snapshot: SolutionSnapshotDto | null): AiReferencePage[] {
  return (snapshot?.payload.referencePages || []).map(page => ({
    type: 'REFERENCE_PAGE',
    page: { documentId: page.documentId, pageId: page.sourcePageId, documentTitle: page.documentTitle || '冻结来源', pageLabel: page.pageLabel, imageUrl: snapshot?.referenceImages?.find(image => image.sourcePageId === page.sourcePageId)?.imageUrl || '' },
    renderModel: page.renderModel,
    matches: [...(snapshot?.payload.candidates || []), ...(snapshot?.payload.alternatives || [])]
      .filter(candidate => candidate.sourcePageId === page.sourcePageId)
      .map(candidate => ({ pageId: page.sourcePageId, optionId: candidate.optionId, candidateId: candidate.candidateId })),
  }))
}

export function referenceTableLocation(page: AiReferencePage, origin: { referenceMessageId?: string, referenceSnapshotId?: string }, preferred?: ReferenceHighlight, highlightEnabled = true) {
  const params: Record<string, string> = { documentId: page.page.documentId, pageId: page.page.pageId }
  for (const [key, value] of Object.entries({ ...origin, constructionId: preferred?.constructionId, optionId: preferred?.optionId })) {
    if (value)
      params[key] = value
  }
  if (!highlightEnabled)
    params.highlight = '0'
  return { name: 'reference-table', params }
}

/** 必须匹配原消息/冻结快照和资料页，不用相同参数或其他消息替代。 */
export function resolveReferenceTablePage(messages: Array<{ id: string, referencePages?: AiReferencePage[] }>, snapshot: SolutionSnapshotDto | null, query: Record<string, string | undefined>): AiReferencePage | undefined {
  if (!query.documentId || !query.pageId || Boolean(query.referenceMessageId) === Boolean(query.referenceSnapshotId))
    return undefined
  const pages = query.referenceMessageId
    ? normalizeReferencePages(messages.find(message => message.id === query.referenceMessageId)?.referencePages)
    : snapshot?.id === query.referenceSnapshotId ? snapshotReferencePages(snapshot) : []
  return pages.find(page => page.page.documentId === query.documentId && page.page.pageId === query.pageId)
}
