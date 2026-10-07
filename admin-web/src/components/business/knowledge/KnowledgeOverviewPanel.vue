<script setup lang="ts">
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'
import type {
  KnowledgeContentSource,
  KnowledgeIndexStatus,
  KnowledgePageRecognitionSummary,
  KnowledgeVersionIndex,
  KnowledgeWorkspace,
} from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { fetchVersionIndex, fetchVersionPages, rebuildVersionIndex, rebuildVersionIndexMaintenance } from '@/api/modules/knowledge'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { knowledgeUserMessage, knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'

const props = withDefaults(defineProps<{
  versionId: string | null
  workspace: KnowledgeWorkspace | null
  /** 是否允许重建知识索引（权限）。 */
  canRebuildIndex?: boolean
  /** 是否允许查看发布阻断原因（仅用于文案，不改变展示）。 */
  canPublish?: boolean
  /** 当前版本状态；已发布版本走维护式重建。 */
  versionStatus?: string | null
}>(), {
  canRebuildIndex: false,
  canPublish: false,
  versionStatus: null,
})

const emit = defineEmits<{ refresh: [] }>()

const index = ref<KnowledgeVersionIndex | null>(null)
const recognition = ref<KnowledgePageRecognitionSummary | null>(null)
const indexLoading = ref(false)
const rebuilding = ref(false)
const error = ref<unknown>(null)
let pollTimer: ReturnType<typeof setInterval> | null = null

const summary = computed(() => props.workspace?.summary ?? null)
const userStatus = computed(() => props.workspace?.currentVersion?.userStatus ?? null)
const statusMeta = computed(() => knowledgeUserStatusMetaFor(userStatus.value))

const contentSourceLabel = computed(() => {
  const map: Record<KnowledgeContentSource, string> = {
    ORIGINAL_FILE: '原始文件解析',
    PAGE_DRIVEN: '资料页面识别',
    NOT_READY: '尚未就绪',
  }
  const source = summary.value?.contentSource
  return source ? map[source] : '尚未就绪'
})

const indexMeta = computed<{ label: string, status: AppStatus, hint: string }>(() => {
  if (!index.value) {
    return { label: '读取中', status: 'processing', hint: '' }
  }
  const map: Record<KnowledgeIndexStatus, { label: string, status: AppStatus }> = {
    INDEX_PENDING: { label: '待构建', status: 'warning' },
    INDEXING: { label: '构建中', status: 'processing' },
    INDEX_READY: { label: '已就绪', status: 'success' },
    INDEX_FAILED: { label: '构建失败', status: 'error' },
  }
  const base = map[index.value.indexStatus]
  const stale = index.value.indexDirty || index.value.indexRevision !== index.value.contentRevision
  if (base.status === 'success' && stale) {
    return { label: '需要更新', status: 'warning', hint: '页面内容已发生变化，需要更新知识索引。' }
  }
  if (base.status === 'warning' && index.value.indexStatus === 'INDEX_PENDING' && index.value.indexBuiltAt) {
    return { ...base, hint: '页面内容已发生变化，需要更新知识索引。' }
  }
  if (index.value.indexStatus === 'INDEX_FAILED') {
    return { ...base, hint: '知识索引构建失败，请重新构建。' }
  }
  return { ...base, hint: '' }
})

const builtAtLabel = computed(() => {
  const value = index.value?.indexBuiltAt
  if (!value) {
    return '尚未构建'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
})

const publishBlockers = computed(() => summary.value?.publishBlockers ?? [])

interface FlowStep {
  label: string
  detail: string
  state: 'done' | 'active' | 'todo' | 'error'
}

const flowSteps = computed<FlowStep[]>(() => {
  const pageCount = summary.value?.pageCount ?? 0
  const rec = recognition.value
  const idx = index.value
  const published = props.workspace?.currentVersion?.status === 'PUBLISHED'

  const uploaded = pageCount > 0
  const recDone = Boolean(rec && rec.total > 0 && rec.confirmed === rec.total)
  const recFailed = Boolean(rec && rec.failed > 0)
  const indexReady = Boolean(idx && idx.indexStatus === 'INDEX_READY' && !idx.indexDirty && idx.indexRevision === idx.contentRevision)

  return [
    {
      label: '上传资料',
      detail: uploaded ? `${pageCount} 页` : '待上传',
      state: uploaded ? 'done' : 'active',
    },
    {
      label: 'AI 识别',
      detail: rec ? `${rec.confirmed + rec.reviewRequired + rec.processing + rec.pending + rec.failed} 页` : '—',
      state: recFailed ? 'error' : uploaded ? (recDone ? 'done' : 'active') : 'todo',
    },
    {
      label: '内容校验',
      detail: rec ? `${rec.confirmed} / ${rec.total}` : '—',
      state: recFailed ? 'error' : recDone ? 'done' : uploaded ? 'active' : 'todo',
    },
    {
      label: '知识索引',
      detail: indexReady ? '已就绪' : indexMeta.value.label,
      state: idx?.indexStatus === 'INDEX_FAILED' ? 'error' : indexReady ? 'done' : uploaded ? 'active' : 'todo',
    },
    {
      label: '发布',
      detail: published ? '已发布' : summary.value?.canPublish ? '可发布' : '未完成',
      state: published ? 'done' : summary.value?.canPublish ? 'active' : 'todo',
    },
  ]
})

function stopPoll(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
function startPoll(): void {
  stopPoll()
  pollTimer = setInterval(() => {
    void loadIndex(false)
  }, 3000)
  setTimeout(stopPoll, 120000)
}

async function loadIndex(showLoading = true): Promise<void> {
  if (!props.versionId) {
    index.value = null
    return
  }
  if (showLoading) {
    indexLoading.value = true
  }
  try {
    index.value = await fetchVersionIndex(props.versionId)
    if (index.value.indexStatus === 'INDEXING') {
      startPoll()
    }
    else {
      stopPoll()
    }
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    indexLoading.value = false
  }
}

async function loadRecognition(): Promise<void> {
  if (!props.versionId) {
    recognition.value = null
    return
  }
  try {
    const result = await fetchVersionPages(props.versionId, 1, 1)
    recognition.value = result.pageRecognitionSummary
  }
  catch {
    recognition.value = null
  }
}

async function loadAll(): Promise<void> {
  error.value = null
  await Promise.all([loadIndex(), loadRecognition()])
}

async function rebuild(): Promise<void> {
  if (!props.versionId || rebuilding.value) {
    return
  }
  rebuilding.value = true
  try {
    // 常规重建仅允许草稿/已审核版本；已发布版本走维护式重建。
    const useMaintenance = props.versionStatus === 'PUBLISHED'
    if (useMaintenance) {
      await rebuildVersionIndexMaintenance(props.versionId)
    }
    else {
      await rebuildVersionIndex(props.versionId)
    }
    MessagePlugin.success('已提交重建，正在构建知识索引')
    await loadIndex(false)
    emit('refresh')
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
  finally {
    rebuilding.value = false
  }
}

watch(() => props.versionId, () => void loadAll())
watch(() => props.workspace?.summary.pageCount, () => void loadRecognition())
onMounted(() => void loadAll())
onUnmounted(stopPoll)
</script>

<template>
  <section class="knowledge-overview">
    <ol class="knowledge-overview__flow">
      <li
        v-for="(step, stepIndex) in flowSteps"
        :key="step.label"
        class="knowledge-overview__flow-step"
        :class="`is-${step.state}`"
      >
        <span class="knowledge-overview__flow-index">{{ stepIndex + 1 }}</span>
        <span class="knowledge-overview__flow-body">
          <strong>{{ step.label }}</strong>
          <small>{{ step.detail }}</small>
        </span>
      </li>
    </ol>

    <div class="knowledge-overview__grid">
      <t-card title="资料状态" :bordered="true">
        <div class="knowledge-overview__facts">
          <div class="knowledge-overview__fact">
            <span>当前版本</span>
            <strong>{{ workspace?.currentVersion ? `v${workspace.currentVersion.versionNo}` : '—' }}</strong>
          </div>
          <div class="knowledge-overview__fact">
            <span>版本状态</span>
            <AppStatusTag :label="statusMeta.label" :status="statusMeta.status" />
          </div>
          <div class="knowledge-overview__fact">
            <span>资料来源</span>
            <strong>{{ contentSourceLabel }}</strong>
          </div>
          <div class="knowledge-overview__fact">
            <span>资料页数</span>
            <strong>{{ summary?.pageCount ?? 0 }} 页</strong>
          </div>
        </div>
      </t-card>

      <t-card title="识别进度" :bordered="true">
        <template v-if="recognition && recognition.total > 0">
          <t-progress
            :label="false"
            :percentage="recognition.total ? Math.round((recognition.confirmed / recognition.total) * 100) : 0"
            :stroke-width="8"
            theme="line"
          />
          <div class="knowledge-overview__stats">
            <span>已确认 <strong>{{ recognition.confirmed }}</strong></span>
            <span>待校验 <strong>{{ recognition.reviewRequired }}</strong></span>
            <span>识别中 <strong>{{ recognition.processing }}</strong></span>
            <span>排队中 <strong>{{ recognition.pending }}</strong></span>
            <span :class="{ 'is-error': recognition.failed > 0 }">识别失败 <strong>{{ recognition.failed }}</strong></span>
          </div>
        </template>
        <p v-else class="knowledge-overview__empty">
          还没有资料页面。上传完整页面图片后，系统会自动识别内容。
        </p>
      </t-card>

      <t-card title="知识索引" :bordered="true">
        <div class="knowledge-overview__index-head">
          <AppStatusTag :label="indexMeta.label" :status="indexMeta.status" />
          <t-button
            v-if="canRebuildIndex"
            :disabled="!versionId || rebuilding || index?.indexStatus === 'INDEXING'"
            :loading="rebuilding"
            size="small"
            theme="primary"
            variant="outline"
            @click="rebuild"
          >
            重新构建索引
          </t-button>
        </div>
        <p v-if="indexMeta.hint" class="knowledge-overview__hint">
          {{ indexMeta.hint }}
        </p>
        <p class="knowledge-overview__meta">最近构建：{{ builtAtLabel }}</p>
      </t-card>

      <t-card title="发布与 AI 可用性" :bordered="true">
        <div class="knowledge-overview__facts">
          <div class="knowledge-overview__fact">
            <span>可以发布</span>
            <AppStatusTag
              :label="summary?.canPublish ? '可以发布' : '暂不可发布'"
              :status="summary?.canPublish ? 'success' : 'warning'"
            />
          </div>
          <div class="knowledge-overview__fact">
            <span>可用于 AI 问答</span>
            <AppStatusTag
              :label="summary?.canAskAi ? '可用于 AI 问答' : '暂不可用于 AI'"
              :status="summary?.canAskAi ? 'success' : 'default'"
            />
          </div>
        </div>
        <div v-if="publishBlockers.length" class="knowledge-overview__blockers">
          <p class="knowledge-overview__blockers-title">还需要完成：</p>
          <ul>
            <li v-for="(blocker, blockerIndex) in publishBlockers" :key="blockerIndex">
              {{ blocker }}
            </li>
          </ul>
        </div>
      </t-card>
    </div>

    <t-alert v-if="error" theme="error" :message="knowledgeUserMessage(normalizeFeedbackError(error).message)" />
  </section>
</template>

<style scoped>
.knowledge-overview {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--td-size-4) 0;
}

.knowledge-overview__flow {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--td-size-3);
  margin: 0;
  padding: 0;
  list-style: none;
}

.knowledge-overview__flow-step {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.knowledge-overview__flow-index {
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: var(--td-radius-circle);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__flow-body {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.knowledge-overview__flow-body small {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__flow-step.is-done .knowledge-overview__flow-index {
  background: var(--td-success-color-1);
  color: var(--td-success-color);
}

.knowledge-overview__flow-step.is-active .knowledge-overview__flow-index {
  background: var(--td-brand-color-1);
  color: var(--td-brand-color);
}

.knowledge-overview__flow-step.is-error .knowledge-overview__flow-index {
  background: var(--td-error-color-1);
  color: var(--td-error-color);
}

.knowledge-overview__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--td-size-4);
}

.knowledge-overview__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--td-size-3);
}

.knowledge-overview__fact {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.knowledge-overview__fact span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-4);
  margin-top: var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__stats strong {
  color: var(--td-text-color-primary);
}

.knowledge-overview__stats .is-error,
.knowledge-overview__stats .is-error strong {
  color: var(--td-error-color);
}

.knowledge-overview__index-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.knowledge-overview__hint {
  margin: var(--td-size-3) 0 0;
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__meta,
.knowledge-overview__empty {
  margin: var(--td-size-3) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-overview__blockers {
  margin-top: var(--td-size-4);
  padding-top: var(--td-size-3);
  border-top: 1px dashed var(--td-component-stroke);
}

.knowledge-overview__blockers-title {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.knowledge-overview__blockers ul {
  margin: 0;
  padding-left: 18px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

@media (max-width: 1366px) {
  .knowledge-overview__flow {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .knowledge-overview__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
