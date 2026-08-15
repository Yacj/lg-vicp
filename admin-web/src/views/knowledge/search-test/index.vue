<script setup lang="ts">
import type { KnowledgeQaSource, KnowledgeQaSseEvent } from '@/types/knowledge'
import { ChatIcon, StopCircleIcon } from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref } from 'vue'
import { postKnowledgeQa } from '@/api/modules/knowledge'
import AppPage from '@/components/ui/AppPage.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { renderMarkdown } from '@/utils/ai'

const { canAccess } = usePermissionAccess()
const canAnswer = computed(() => canAccess({ permissions: ['system:knowledge:search:answer'] }))

const query = ref('')

// ===== AI 回答（SSE） =====
const answerVisible = ref(false)
const answerStage = ref('')
const answerStageMessage = ref('')
const answerText = ref('')
const answerSources = ref<KnowledgeQaSource[]>([])
const answering = ref(false)
const answerError = ref<string | null>(null)
let abortController: AbortController | null = null

// ===== 引用定位 =====
const activeSourceIndex = ref<number | null>(null)

const evidenceLevelLabels: Record<string, string> = {
  A: '权威依据',
  B: '推荐依据',
  C: '参考依据',
}

const referenceItems = computed(() =>
  answerSources.value.map(source => ({
    key: source.chunkId,
    title: source.title,
    section: source.section,
    page: source.page,
    evidenceLevel: source.evidenceLevel,
  })),
)

function evidenceTheme(level: string | null): 'primary' | 'default' {
  return level === 'A' ? 'primary' : 'default'
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
              answerSources.value = event.data.sources
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
  if (Number.isNaN(idx) || idx < 0 || idx >= referenceItems.value.length) {
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
        <t-button v-if="answering" variant="outline" theme="danger" @click="stopAnswer">
          <template #icon>
            <StopCircleIcon />
          </template>
          停止
        </t-button>
      </div>
    </div>

    <div class="vicp-workspace">
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

      <!-- 参考依据 -->
      <section class="vicp-panel">
        <header class="vicp-panel-header">
          <span class="vicp-panel-title">参考依据</span>
          <span v-if="referenceItems.length > 0" class="vicp-panel-meta">共 {{ referenceItems.length }} 条</span>
        </header>

        <div v-if="referenceItems.length === 0" class="vicp-empty">
          回答时会在右侧列出引用的资料依据。
        </div>
        <div v-else class="vicp-ref-list">
          <div
            v-for="(item, index) in referenceItems"
            :id="`vicp-ref-${index}`"
            :key="item.key"
            class="vicp-ref-card"
            :class="{ 'vicp-ref-active': activeSourceIndex === index }"
          >
            <div class="vicp-ref-head">
              <span class="vicp-ref-index">[资料{{ index + 1 }}]</span>
              <span class="vicp-ref-title">{{ item.title }}</span>
            </div>
            <div class="vicp-ref-meta">
              <span v-if="item.section">章节：{{ item.section }}</span>
              <span v-if="item.page != null">第 {{ item.page }} 页</span>
              <t-tag v-if="item.evidenceLevel" size="small" variant="light" :theme="evidenceTheme(item.evidenceLevel)">
                {{ evidenceLevelLabels[item.evidenceLevel] ?? item.evidenceLevel }}
              </t-tag>
            </div>
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
.vicp-ref-card {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-small);
  padding: 12px;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.vicp-ref-active {
  border-color: var(--td-brand-color);
  box-shadow: 0 0 0 1px var(--td-brand-color);
}
.vicp-ref-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.vicp-ref-index {
  color: var(--td-brand-color);
  font-weight: var(--td-font-weight-medium);
  white-space: nowrap;
}
.vicp-ref-title {
  font-weight: var(--td-font-weight-medium);
}
.vicp-ref-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  margin-top: 4px;
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
