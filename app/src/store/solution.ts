import type { SolutionAction, SolutionActionBody, SolutionComparisonResult, SolutionSnapshotDto, SolutionStateDto, SolutionUpdate } from '@/api/solution-types'
import type { ApiEnvelope } from '@/api/types'
import { solutionActionBody, solutionClientState, solutionErrorCode, solutionErrorMessages } from '@/utils/aiSolution'

export function solutionInitialState() {
  return {
    solutionState: null as SolutionStateDto | null,
    solutionComparison: null as SolutionComparisonResult | null,
    solutionSnapshot: null as SolutionSnapshotDto | null,
    solutionActionLoading: false,
    solutionActionCandidateIds: [] as string[],
    solutionPendingAction: null as SolutionAction | null,
    solutionSnapshotLoading: false,
    solutionNotice: '',
    solutionRequestRevision: 0,
    solutionRetiredStateIds: [] as string[],
  }
}

interface SolutionContext extends ReturnType<typeof solutionInitialState> {
  conversation: { id: string } | null
  loadRevision: number
  clearSolution: () => void
  applySolutionState: (update: SolutionUpdate) => boolean
  restoreSolutionState: (state: SolutionStateDto | null) => void
  refreshSolutionState: () => Promise<void>
}

interface SolutionApi {
  getSolution: (id: string) => { send: () => PromiseLike<unknown> }
  solutionAction: (id: string, body: SolutionActionBody) => { send: () => PromiseLike<unknown> }
  getSolutionSnapshot: (id: string, snapshotId: string) => { send: () => PromiseLike<unknown> }
}

/** 与 assistant 同属一个 Pinia store；拆出动作以便独立验证会话隔离和并发。 */
export function createSolutionActions(api: SolutionApi) {
  return {
    clearSolution(this: SolutionContext) {
      const revision = this.solutionRequestRevision + 1
      Object.assign(this, solutionInitialState(), { solutionRequestRevision: revision })
    },

    applySolutionState(this: SolutionContext, update: SolutionUpdate) {
      const state = solutionClientState(update.solutionState)
      if (state.conversationId !== this.conversation?.id)
        return false
      if (this.solutionRetiredStateIds.includes(state.id))
        return false
      // REST 迟到响应不能倒退已由 SSE 更新的版本。
      const current = this.solutionState
      if (current?.id === state.id && current.version > state.version)
        return false
      if (current && current.id !== state.id)
        this.solutionRetiredStateIds = [...this.solutionRetiredStateIds, current.id]
      if (current?.id !== state.id || current.version !== state.version || current.candidateSetRevision !== state.candidateSetRevision) {
        this.solutionComparison = null
        this.solutionNotice = ''
      }
      if (current?.id !== state.id || !state.confirmedSnapshotId)
        this.solutionSnapshot = null
      this.solutionState = state
      if (update.comparison)
        this.solutionComparison = update.comparison
      if (update.snapshot?.conversationId === state.conversationId && update.snapshot.id === state.confirmedSnapshotId)
        this.solutionSnapshot = update.snapshot
      return true
    },

    restoreSolutionState(this: SolutionContext, state: SolutionStateDto | null) {
      this.clearSolution()
      if (state)
        this.applySolutionState({ solutionState: state })
    },

    async refreshSolutionState(this: SolutionContext) {
      const id = this.conversation?.id
      if (!id)
        return
      const revision = this.solutionRequestRevision
      const loadRevision = this.loadRevision
      const stateId = this.solutionState?.id
      const response = await api.getSolution(id).send() as ApiEnvelope<SolutionStateDto | null>
      if (this.conversation?.id !== id || revision !== this.solutionRequestRevision || loadRevision !== this.loadRevision)
        return
      if (this.solutionState?.id !== stateId)
        return
      if (response.data)
        this.applySolutionState({ solutionState: response.data })
      else
        this.restoreSolutionState(null)
    },

    async performSolutionAction(this: SolutionContext, action: SolutionAction, candidateIds: string[] = []) {
      const state = this.solutionState
      const id = this.conversation?.id
      if (!state || !id || state.conversationId !== id || this.solutionActionLoading)
        return false
      const revision = this.solutionRequestRevision
      const loadRevision = this.loadRevision
      const isCurrent = () => this.conversation?.id === id && revision === this.solutionRequestRevision && loadRevision === this.loadRevision
      this.solutionActionLoading = true
      this.solutionPendingAction = action
      this.solutionActionCandidateIds = [...candidateIds]
      this.solutionNotice = ''
      try {
        const response = await api.solutionAction(id, solutionActionBody(state, action, candidateIds)).send() as ApiEnvelope<SolutionUpdate>
        if (!isCurrent())
          return false
        // REVISE/START_NEW 明确返回新的 active id。其他动作不能覆盖 SSE 已切换的新一轮。
        if (this.solutionState?.id !== state.id)
          return false
        return this.applySolutionState(response.data)
      }
      catch (error) {
        if (!isCurrent())
          return false
        const code = solutionErrorCode(error)
        const versionConflict = ['SOLUTION_VERSION_CONFLICT', 'SOLUTION_REVISION_CONFLICT'].includes(code)
          || (error instanceof Error && error.message.includes('候选列表已变化'))
        if (versionConflict || code === 'SOLUTION_SOURCE_CHANGED') {
          this.solutionNotice = versionConflict ? '方案已更新，正在刷新…' : solutionErrorMessages.SOLUTION_SOURCE_CHANGED
          try {
            await this.refreshSolutionState()
            if (isCurrent())
              this.solutionNotice = versionConflict ? '方案已更新，请重新确认刚才的操作' : solutionErrorMessages.SOLUTION_SOURCE_CHANGED
          }
          catch {
            if (isCurrent())
              this.solutionNotice = '方案刷新失败，请点击刷新方案后重新操作'
          }
        }
        else {
          this.solutionNotice = solutionErrorMessages[code] || (error instanceof Error ? error.message : '方案操作失败，请重试')
        }
        return false
      }
      finally {
        if (isCurrent()) {
          this.solutionActionLoading = false
          this.solutionActionCandidateIds = []
          this.solutionPendingAction = null
        }
      }
    },

    async loadSolutionSnapshot(this: SolutionContext) {
      const id = this.conversation?.id
      const snapshotId = this.solutionState?.confirmedSnapshotId
      if (!id || !snapshotId || this.solutionSnapshotLoading)
        return false
      const revision = this.solutionRequestRevision
      const isCurrent = () => this.conversation?.id === id && this.solutionRequestRevision === revision && this.solutionState?.confirmedSnapshotId === snapshotId
      this.solutionSnapshotLoading = true
      try {
        const response = await api.getSolutionSnapshot(id, snapshotId).send() as ApiEnvelope<SolutionSnapshotDto>
        if (!isCurrent() || response.data.conversationId !== id || response.data.id !== snapshotId)
          return false
        this.solutionSnapshot = response.data
        return true
      }
      catch (error) {
        if (isCurrent())
          this.solutionNotice = error instanceof Error ? error.message : '已确认方案加载失败，请重试'
        return false
      }
      finally {
        if (this.conversation?.id === id && this.solutionRequestRevision === revision)
          this.solutionSnapshotLoading = false
      }
    },
  }
}
