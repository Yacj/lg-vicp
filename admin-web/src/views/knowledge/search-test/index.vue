<script setup lang="ts">
import type { AiSourceRef } from '@/types/ai-source'
import type { KnowledgeQaSseEvent, KnowledgeSearchHit } from '@/types/knowledge'
import { ChatIcon, StopCircleIcon } from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref } from 'vue'
import { postKnowledgeQa, searchKnowledge } from '@/api/modules/knowledge'
import { KnowledgeHitCard } from '@/components/business'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { normalizeAiSource, aiSourceRefFromSearchHit } from '@/types/ai-source'
import { renderMarkdown } from '@/utils/ai'

const { canAccess } = usePermissionAccess()
const canAnswer = computed(() => canAccess({ permissions: ['system:knowledge:search:answer'] }))
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))

const query = ref('')

// ===== 普通检索结果 =====
const searchQuery = ref('')
const searchLoading = ref(false)
const searchError = ref<string | null>(null)
const searchSearched = ref(false)
const searchHits = ref<KnowledgeSearchHit[]>([])
const searchTook = ref(0)

async function runSearch(): Promise<void> {
  const text = searchQuery.value.trim()
  if (!text || searchLoading.value) {
    if (!text) MessagePlugin.warning('请输入检索关键词')
    return
  }
  searchLoading.value = true
  searchError.value = null
  try {
    const result = await searchKnowledge({ query: text, limit: 20 })
    searchHits.value = result.items
    searchTook.value = result.took
    searchSearched.value = true
  }
  catch (cause) {
    searchError.value = normalizeFeedbackError(cause).message
  }
  finally {
    searchLoading.value = false
  }
}

const searchSources = computed(() => searchHits.value.map(hit => aiSourceRefFromSearchHit(hit)))


const answerVisible = ref(false)
const answerStage = ref('')
const answerStageMessage = ref('')
const answerText = ref('')
const answerSources = ref<AiSourceRef[]>([])
const answering = ref(false)
const answerError = ref<string | null>(null)
let abortController: AbortController | null = null

// ===== 引用定位 =====
const activeSourceIndex = ref<number | null>(null)

/** done.sources 已是统一 AiSourceRef；防御式兼容历史扁平来源结构 */
function absorbSources(values: unknown): AiSourceRef[] {
  if (!Array.isArray(values)) {
    return []
  }
  return values
    .map((value) => {
      if (typeof value === 'object' && value !== null && 'sourceType' in value && 'title' in value) {
        return value as AiSourceRef
      }
      return normalizeAiSource(value)
    })
    .filter((value): value is AiSourceRef => value !== null)
}

function resetAnswer(): void {
  answerVisible.value = true
  answerStage.value = ''
  answerStageMessage.value = ''
  answerText.value = ''
  answerSources.value = []
  answerError.value = null
  activeSourceIndex.value = null
}

async function runAnswer(): Promise<void> {
  const text = query.value.trim()
  if (!text) {
    MessagePlugin.warning('请输入问题')
    return
  }
  if (answering.value) {
    return
  }
  resetAnswer()
  answering.value = true
  abortController = new AbortController()
  try {
    await postKnowledgeQa(
      { query: text, reasoningMode: 'OFF' },
      {
        signal: abortController.signal,
        onEvent: (event: KnowledgeQaSseEvent) => {
          switch (event.type) {
            case 'progress':
              answerStage.value = event.data.stage
              answerStageMessage.value = event.data.message
              break
            case 'delta':
              answerText.value += event.data.text
              break
            case 'done':
              answerSources.value = absorbSources(event.data.sources)
              break
            case 'stopped':
              answerStage.value = 'stopped'
              answerStageMessage.value = '回答已停止'
              break
            case 'error':
              answerError.value = `${event.data.message}（${event.data.code}）`
              answerStage.value = 'error'
              break
            default:
              break
          }
        },
      },
    )
  }
  catch (cause) {
    if (abortController.signal.aborted) {
      answerStage.value = 'stopped'
      answerStageMessage.value = '回答已停止'
    }
    else {
      answerError.value = normalizeFeedbackError(cause).message
      answerStage.value = 'error'
    }
  }
  finally {
    answering.value = false
    abortController = null
  }
}

function stopAnswer(): void {
  abortController?.abort()
}

/** 引用标注渲染：安全转义后解析 Markdown，再把 [资料N] 标记为可点击引用。 */
const answerHtml = computed(() => {
  const html = renderMarkdown(answerText.value)
  return html.replace(/\[资料(\d+)\]/g, (_, index: string) => {
    const idx = Number(index)
    return `<span class="vicp-citation" data-idx="${idx - 1}" style="cursor:pointer">[资料${idx}]</span>`
  })
})

function focusSource(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const idx = Number(target.dataset.idx)
  if (Number.isNaN(idx) || idx < 0 || idx >= answerSources.value.length) {
    return
  }
  activeSourceIndex.value = idx
  const el = document.getElementById(`vicp-ref-${idx}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}
</script>

<template>
  <AppPage title="知识问答" description="输入问题，基于已发布的规范、图集与标准资料给出答案，并标注引用依据。">
    <div class="vicp-ask-bar">
      <t-textarea
        v-model="query"
        :autosize="{ minRows: 2, maxRows: 6 }"
        maxlength="500"
        placeholder="输入问题，例如：岩棉板外墙外保温系统传热系数限值是多少？"
      />
      <div class="vicp-ask-actions">
        <t-button v-if="canAnswer" theme="primary" :loading="answering" @click="runAnswer">
          <template #icon>
            <ChatIcon />
          </template>
          {{ answering ? '回答中...' : '获取答案' }}
        </t-button>
        <t-button v-if="canAnswer" variant="outline" :loading="searchLoading" @click="runSearch">
          执行检索
        </t-button>
        <t-button v-if="answering" variant="outline" theme="danger" @click="stopAnswer">
          <template #icon>
            <StopCircleIcon />
          </template>
          停止
        </t-button>
      </div>
    </div>

    <div class="vicp-workspace">
      <div class="vicp-search-results">
      <div class="vicp-panel-header">
        <span class="vicp-panel-title">检索结果</span>
        <span v-if="searchSearched" class="vicp-panel-meta">耗时 {{ searchTook }}ms · {{ searchHits.length }} 条</span>
      </div>
      <t-input v-model="searchQuery" clearable placeholder="单独测试检索结果（不生成 AI 回答）" @enter="runSearch" />
      <t-alert v-if="searchError" theme="error" :message="searchError" />
      <div v-if="searchSources.length > 0" class="vicp-ref-list">
        <KnowledgeHitCard v-for="(source, index) in searchSources" :key="`${index}-${source.documentId ?? source.title}`" :debug-enabled="canDebug" :index="index + 1" :source="source" />
      </div>
      <div v-else-if="searchSearched" class="vicp-empty">没有命中已发布资料。</div>
      <div v-else class="vicp-empty">可单独执行真实检索，结果按文档、章节、页面、内容块路径展示。</div>
      </div>

      <!-- AI 回答 -->
      <section class="vicp-panel">
        <header class="vicp-panel-header">
          <span class="vicp-panel-title">AI 回答</span>
        </header>

        <t-alert v-if="answerError" theme="error" :message="answerError" style="margin-bottom: 12px" />

        <div v-if="!answerVisible" class="vicp-empty">
          输入问题，我将基于已发布资料给出回答并标注引用依据。
        </div>
        <template v-else>
          <div v-if="answerStage && answerStage !== 'completed'" class="vicp-stage">
            <t-loading size="small" />
            <span>{{ answerStageMessage || answerStage }}</span>
          </div>

          <div v-if="answerText" class="vicp-answer">
            <div class="vicp-answer-markdown" @click="focusSource" v-html="answerHtml" />
            <div class="vicp-answer-footer">
              <span v-if="answerStage === 'stopped'" class="vicp-answer-stopped">（已停止，以上为部分内容）</span>
              <span v-else-if="answerStage === 'error'" class="vicp-answer-stopped">（生成失败）</span>
            </div>
          </div>

          <div v-if="!answerText && !answering && !answerError" class="vicp-empty">
            暂无回答内容。
          </div>
        </template>
      </section>

      <!-- 参考依据（层级检索路径） -->
      <section class="vicp-panel">
        <header class="vicp-panel-header">
          <span class="vicp-panel-title">参考依据</span>
          <span v-if="answerSources.length > 0" class="vicp-panel-meta">共 {{ answerSources.length }} 条</span>
        </header>

        <div v-if="answerSources.length === 0" class="vicp-empty">
          回答时会在右侧列出引用的资料依据，可逐条查看完整原文。
        </div>
        <div v-else class="vicp-ref-list">
          <div
            v-for="(source, index) in answerSources"
            :id="`vicp-ref-${index}`"
            :key="`${index}-${source.documentId ?? ''}-${source.chunkId ?? source.pageId ?? source.title}`"
            class="vicp-ref-active-wrap"
            :class="{ 'is-active': activeSourceIndex === index }"
          >
            <KnowledgeHitCard :debug-enabled="canDebug" :index="index + 1" :source="source" />
          </div>
        </div>
      </section>
    </div>
  </AppPage>
</template>

<style scoped>
.vicp-ask-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  margin-bottom: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}
.vicp-ask-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vicp-workspace {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  gap: 16px;
  align-items: start;
}
@media (max-width: 1100px) {
  .vicp-workspace {
    grid-template-columns: 1fr;
  }
}
.vicp-panel {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
  padding: 16px;
  min-height: 200px;
}
.vicp-panel-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
}
.vicp-panel-title {
  font-weight: var(--td-font-weight-medium);
}
.vicp-panel-meta {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-empty {
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  text-align: center;
  padding: 48px 0;
}
.vicp-stage {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  margin-bottom: 12px;
}
.vicp-answer-markdown {
  line-height: 1.75;
  word-break: break-word;
}
.vicp-answer-markdown :deep(p) {
  margin: 0 0 8px;
}
.vicp-answer-markdown :deep(pre) {
  background: var(--td-bg-color-component);
  border-radius: var(--td-radius-small);
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.vicp-answer-markdown :deep(code) {
  font-family: var(--td-font-family-mono);
  font-size: 13px;
}
.vicp-answer-footer {
  margin-top: 8px;
}
.vicp-answer-stopped {
  color: var(--td-warning-color);
  font-size: var(--td-font-size-body-small);
}
.vicp-ref-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.vicp-ref-active-wrap {
  border-radius: var(--td-radius-medium);
  transition: box-shadow 0.2s;
}
.vicp-ref-active-wrap.is-active :deep(.ks-hit-card) {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 1px var(--td-brand-color);
}
.vicp-ref-active-wrap.is-active {
  box-shadow: 0 0 0 1px var(--td-brand-color);
}
</style>

<style>
.vicp-citation {
  color: var(--td-brand-color);
  font-weight: var(--td-font-weight-medium);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
