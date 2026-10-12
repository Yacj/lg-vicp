import type { SolutionCandidateCard, SolutionSnapshotDto, SolutionStateDto } from '@/api/solution-types'

export function solutionCandidate(id: string, position: number | null, overrides: Partial<SolutionCandidateCard> = {}): SolutionCandidateCard {
  return { candidateId: id, sourceType: 'REFERENCE', title: `构造${id}`, position, status: 'AVAILABLE', selected: false, final: false, conflict: false, conflictMessages: [], constructionCode: `构造${id}`, systemName: 'I型 VICP 薄抹灰', thicknessMm: 18, productThermalResistance: 2.880, totalThermalResistance: 3.297, kValue: 0.303, sourceDocumentId: 'document', sourcePageId: 'page', sourcePageLabel: '22', optionId: `${id}-18`, ...overrides }
}

export function solutionFixture(overrides: Partial<SolutionStateDto> = {}): SolutionStateDto {
  return { id: 'state-1', conversationId: 'conversation-1', stage: 'CANDIDATE_SELECTION', version: 5, candidateSetRevision: 2, poolCandidateIds: ['A', 'B', 'C'], selectedCandidateIds: [], finalCandidateIds: [], rejectedCandidateIds: [], recommendedCandidateIds: [], keptForComparisonIds: [], conflicts: [], candidateCards: ['A', 'B', 'C'].map((id, i) => solutionCandidate(id, i + 1)), ...overrides }
}

export function snapshotFixture(): SolutionSnapshotDto {
  return { id: 'snapshot-1', solutionStateId: 'state-1', conversationId: 'conversation-1', confirmedAt: '2026-10-12T08:00:00.000Z', payload: { schemaVersion: 1, candidates: [solutionCandidate('A', null)], alternatives: [solutionCandidate('C', null)], selectedCandidateIds: ['A', 'C'], finalCandidateIds: ['A'], recommendedCandidateIds: ['A'], warnings: ['备选方案有厚度冲突'], referencePages: [] } }
}
