<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { inspectKnowledgeVersionTest, postKnowledgeVersionTestQa } from '@/api/modules/knowledge'
import AppMarkdown from '@/components/ui/AppMarkdown.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type {
  KnowledgeQaSource,
  KnowledgeQaSseEvent,
  KnowledgeReferencePageBlock,
  KnowledgeUserTestSource,
  KnowledgeVersionTestInspectResult,
} from '@/types/knowledge'
import { knowledgePageLabel, knowledgeUserMessage } from '@/utils/knowledge-user'

interface TestResult {
  query: string
  answer: string
  retrievalType: string
  sources: KnowledgeUserTestSource[]
  referencePages: KnowledgeReferencePageBlock[]
}

const props = defineProps<{
  versionId: string | null
}>()

const emit = defineEmits<{
  openGalleryPage: [physicalPageNumber: number]
}>()

const query = ref('薄抹灰保温系统传热系数0.3的方案有么')
const sending = ref(false)
const result = ref<TestResult | null>(null)
const debugExpanded = ref(false)
const debugLoading = ref(false)
const debugResult = ref<KnowledgeVersionTestInspectResult | null>(null)
const debugError = ref<unknown>(null)
let abortController: AbortController | null = null

const canSend = computed(() => query.value.trim().length > 0 && !sending.value && Boolean(props.versionId))

function toUserTestSource(item: KnowledgeQaSource | KnowledgeUserTestSource): KnowledgeUserTestSource {
  const debugSource = item as KnowledgeQaSource
  const userSource = item as KnowledgeUserTestSource
  return {
    documentId: debugSource.documentId ?? userSource.documentId ?? '',
    versionId: item.versionId,
    title: item.title,
    tocPath: userSource.tocPath ?? debugSource.sectionPath ?? null,
    sectionTitle: userSource.sectionTitle ?? debugSource.section ?? debugSource.chapter ?? null,
    pageLabel: item.pageLabel ?? null,
    physicalPageNumber: item.physicalPageNumber ?? debugSource.pageNumber ?? debugSource.page ?? null,
    matchedText: item.matchedText ?? debugSource.snippet ?? null,
    pageId: debugSource.pageId ?? userSource.pageId ?? null,
  }
}

function inferRetrievalType(referencePages: KnowledgeReferencePageBlock[], sources: KnowledgeUserTestSource[]): string {
  if (referencePages.length > 0) {
    return 'REFERENCE_LOOKUP'
  }
  if (sources.length > 0) {
    return 'KNOWLEDGE'
  }
  return 'DIRECT'
}

/** 匹配方案标签：优先展示产品层热阻 / 总热阻双 R，仅在缺失时兼容旧 R。 */
function matchSchemeLabel(block: KnowledgeReferencePageBlock): string {
  const matches = block.matches?.length ? block.matches : [{ summary: block.summary, highlights: block.highlights ?? [] }]
  return matches.map((match) => {
    const summary = match.summary
    const totalR = summary.totalThermalResistance ?? summary.rValue ?? null
    const parts = [
      summary.systemType,
      summary.constructionCode,
      summary.productSpecName,
      summary.thicknessMm != null ? `${summary.thicknessMm}mm` : null,
      summary.productThermalResistance != null ? `产品层 R=${summary.productThermalResistance}` : null,
      totalR != null ? `总 R=${totalR}` : null,
      summary.kValue != null ? `K=${summary.kValue}` : null,
    ].filter(Boolean)
    return parts.join(' / ') || '匹配方案'
  }).join('；')
}

async function send(): Promise<void> {
  const text = query.value.trim()
  if (!text || !props.versionId || sending.value) {
    return
  }
  sending.value = true
  debugResult.value = null
  debugError.value = null
  result.value = {
    query: text,
    answer: '',
    retrievalType: '…',
    sources: [],
    referencePages: [],
  }
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller
  try {
    await postKnowledgeVersionTestQa(props.versionId, { query: text, reasoningMode: 'OFF', limit: 5 }, {
      signal: controller.signal,
      onEvent: (event: KnowledgeQaSseEvent) => {
        if (!result.value) {
          return
        }
        if (event.type === 'delta') {
          result.value.answer += event.data.text
        }
        if (event.type === 'reference_pages') {
          result.value.referencePages = (event.data.referencePages ?? []) as KnowledgeReferencePageBlock[]
          result.value.retrievalType = inferRetrievalType(result.value.referencePages, result.value.sources)
        }
        if (event.type === 'sources') {
          result.value.sources = (event.data.sources ?? []).map(item => toUserTestSource(item))
          result.value.retrievalType = inferRetrievalType(result.value.referencePages, result.value.sources)
        }
        if (event.type === 'done') {
          result.value.sources = (event.data.sources ?? []).map(item => toUserTestSource(item))
          if (event.data.referencePages?.length) {
            result.value.referencePages = event.data.referencePages
          }
          result.value.retrievalType = inferRetrievalType(result.value.referencePages, result.value.sources)
        }
        if (event.type === 'error') {
          result.value.answer = event.data.message || '测试失败'
        }
      },
    })
  }
  catch (cause) {
    if (!controller.signal.aborted) {
      MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
      if (result.value && !result.value.answer) {
        result.value.answer = knowledgeUserMessage(normalizeFeedbackError(cause).message)
      }
    }
  }
  finally {
    if (abortController === controller) {
      sending.value = false
    }
  }
}

/** 高级调试：非流式检索调试，返回命中文段 / 页图 / 热工行；answer 恒为 null，属正常。 */
async function runInspect(): Promise<void> {
  const text = query.value.trim()
  if (!text || !props.versionId || debugLoading.value) {
    return
  }
  debugLoading.value = true
  debugError.value = null
  try {
    debugResult.value = await inspectKnowledgeVersionTest(props.versionId, { query: text, limit: 8 })
  }
  catch (cause) {
    debugError.value = cause
    debugResult.value = null
  }
  finally {
    debugLoading.value = false
  }
}

function onDebugExpand(value: unknown): void {
  debugExpanded.value = Array.isArray(value) ? value.includes('debug') : value === 'debug'
  if (debugExpanded.value && !debugResult.value) {
    void runInspect()
  }
}

function clearResult(): void {
  abortController?.abort()
  sending.value = false
  result.value = null
  debugResult.value = null
  debugError.value = null
}

function openPage(physicalPageNumber?: number | null): void {
  if (physicalPageNumber == null) {
    return
  }
  emit('openGalleryPage', physicalPageNumber)
}

watch(() => props.versionId, () => clearResult())
</script>

<template>
  <section class="knowledge-test-panel">
    <header class="knowledge-test-panel__header">
      <div>
        <h2>知识库测试</h2>
        <p>以真实提问验证当前资料：先看 AI 回答与匹配方案，需要时再展开高级调试信息核对检索细节。</p>
      </div>
    </header>

    <div class="knowledge-test-panel__composer">
      <t-textarea
        v-model="query"
        :autosize="{ minRows: 3, maxRows: 6 }"
        maxlength="500"
        placeholder="例如：薄抹灰保温系统传热系数0.3的方案有么"
        @keydown.enter.exact.prevent="send"
      />
      <div class="knowledge-test-panel__composer-actions">
        <t-button theme="default" variant="text" @click="clearResult">
          清空
        </t-button>
        <t-button :disabled="!canSend" :loading="sending" theme="primary" @click="send">
          开始测试
        </t-button>
      </div>
    </div>

    <div v-if="result" class="knowledge-test-panel__result">
      <section class="knowledge-test-panel__block">
        <h3>AI 回答</h3>
        <p v-if="!result.answer && sending" class="knowledge-test-panel__muted">
          正在生成…
        </p>
        <AppMarkdown v-else-if="result.answer" :content="result.answer" />
        <p v-else class="knowledge-test-panel__muted">
          暂无回答
        </p>
      </section>

      <section class="knowledge-test-panel__block">
        <h3>检索类型</h3>
        <t-tag theme="primary" variant="light">
          {{ result.retrievalType }}
        </t-tag>
      </section>

      <section v-if="result.referencePages.length" class="knowledge-test-panel__block">
        <h3>匹配方案</h3>
        <div class="knowledge-test-panel__schemes">
          <article v-for="(block, index) in result.referencePages" :key="`${block.page.pageId}-${index}`" class="knowledge-test-panel__scheme">
            <header>{{ matchSchemeLabel(block) }}</header>
            <div class="knowledge-test-panel__scheme-meta">
              <span>{{ block.page.documentTitle }}</span>
              <em>{{ knowledgePageLabel(block.page.pageLabel, block.page.physicalPageNumber ?? block.page.pageNumber) }}</em>
            </div>
          </article>
        </div>
      </section>

      <section v-if="result.sources.length" class="knowledge-test-panel__block">
        <h3>引用来源</h3>
        <div class="knowledge-test-panel__sources">
          <article v-for="(source, index) in result.sources" :key="`${source.documentId}-${index}`" class="knowledge-test-panel__source">
            <header>
              <strong>{{ source.title }}</strong>
              <span>资料页码 {{ source.pageLabel || '—' }}</span>
              <span>文件页序 {{ source.physicalPageNumber ?? '—' }}</span>
            </header>
            <blockquote v-if="source.matchedText">
              {{ source.matchedText }}
            </blockquote>
            <t-button
              v-if="source.physicalPageNumber != null"
              size="small"
              theme="primary"
              variant="text"
              @click="openPage(source.physicalPageNumber)"
            >
              打开页面图库
            </t-button>
          </article>
        </div>
      </section>

      <section v-if="result.referencePages.length" class="knowledge-test-panel__block">
        <h3>原始页面</h3>
        <div class="knowledge-test-panel__pages">
          <figure
            v-for="(block, index) in result.referencePages"
            :key="`page-${block.page.pageId}-${index}`"
            class="knowledge-test-panel__page"
            role="button"
            tabindex="0"
            @click="openPage(block.page.physicalPageNumber ?? block.page.pageNumber)"
            @keydown.enter="openPage(block.page.physicalPageNumber ?? block.page.pageNumber)"
          >
            <img
              v-if="block.page.imageUrl"
              :alt="knowledgePageLabel(block.page.pageLabel, block.page.physicalPageNumber)"
              :src="block.page.imageUrl"
              loading="lazy"
            >
            <div v-else class="knowledge-test-panel__page-empty">
              暂无页面图
            </div>
            <figcaption>
              {{ knowledgePageLabel(block.page.pageLabel, block.page.physicalPageNumber ?? block.page.pageNumber) }}
            </figcaption>
          </figure>
        </div>
      </section>

      <t-collapse class="knowledge-test-panel__debug" :value="debugExpanded ? ['debug'] : []" @change="onDebugExpand">
        <t-collapse-panel header="高级调试信息" value="debug">
          <p class="knowledge-test-panel__muted">
            检索调试用于核对命中过程，不生成回答，因此「回答」为空属于正常现象。
          </p>
          <div class="knowledge-test-panel__debug-actions">
            <t-button :disabled="debugLoading || !query.trim()" size="small" variant="outline" @click="runInspect">
              重新运行检索调试
            </t-button>
          </div>
          <t-loading v-if="debugLoading" text="正在检索调试" />
          <t-alert
            v-else-if="debugError"
            theme="error"
            :message="normalizeFeedbackError(debugError).message"
          />
          <template v-else-if="debugResult">
            <t-descriptions bordered :column="2" size="small">
              <t-descriptions-item label="任务类型">
                {{ debugResult.taskType || '检索调试' }}
              </t-descriptions-item>
              <t-descriptions-item label="命中文段数">
                {{ debugResult.retrievedChunks.length }}
              </t-descriptions-item>
              <t-descriptions-item label="命中热工行数">
                {{ debugResult.matchedReferenceRows.length }}
              </t-descriptions-item>
              <t-descriptions-item label="引用页面数">
                {{ debugResult.referencePages.length }}
              </t-descriptions-item>
            </t-descriptions>

            <h4 class="knowledge-test-panel__debug-title">
              命中文段
            </h4>
            <div v-if="debugResult.retrievedChunks.length" class="knowledge-test-panel__chunks">
              <div v-for="(chunk, index) in debugResult.retrievedChunks" :key="`chunk-${index}`" class="knowledge-test-panel__chunk">
                <strong>[{{ index + 1 }}] {{ chunk.pageLabel || chunk.physicalPageNumber || '未标注页码' }}</strong>
                <span>{{ chunk.retrievalUnit || chunk.sourceType || '—' }}<template v-if="chunk.score != null"> · 相关度 {{ chunk.score }}</template></span>
                <p>{{ chunk.content || '—' }}</p>
              </div>
            </div>
            <p v-else class="knowledge-test-panel__muted">
              本次没有命中文段。
            </p>

            <h4 class="knowledge-test-panel__debug-title">
              命中热工行
            </h4>
            <div v-if="debugResult.matchedReferenceRows.length" class="knowledge-test-panel__chunks">
              <div v-for="row in debugResult.matchedReferenceRows" :key="row.id" class="knowledge-test-panel__chunk">
                <strong>{{ row.sourcePageLabel || '—' }} · {{ row.thicknessMm }} mm</strong>
                <span>产品层 R {{ row.productThermalResistance }} · 总 R {{ row.totalThermalResistance }} · K {{ row.kValue }}</span>
              </div>
            </div>
            <p v-else class="knowledge-test-panel__muted">
              本次没有命中热工行。
            </p>
          </template>
        </t-collapse-panel>
      </t-collapse>
    </div>
  </section>
</template>

<style scoped>
.knowledge-test-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.knowledge-test-panel__header h2 {
  margin: 0 0 6px;
  color: var(--td-text-color-primary);
  font-size: 18px;
}

.knowledge-test-panel__header p,
.knowledge-test-panel__muted {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test-panel__composer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.knowledge-test-panel__composer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.knowledge-test-panel__result {
  display: grid;
  gap: 16px;
}

.knowledge-test-panel__block {
  padding: 14px 16px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.knowledge-test-panel__block h3 {
  margin: 0 0 10px;
  color: var(--td-text-color-primary);
  font-size: 15px;
}

.knowledge-test-panel__schemes,
.knowledge-test-panel__sources,
.knowledge-test-panel__chunks {
  display: grid;
  gap: 10px;
}

.knowledge-test-panel__scheme,
.knowledge-test-panel__source,
.knowledge-test-panel__chunk {
  padding: 10px 12px;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.knowledge-test-panel__scheme header,
.knowledge-test-panel__source header,
.knowledge-test-panel__chunk strong {
  color: var(--td-text-color-primary);
}

.knowledge-test-panel__scheme-meta,
.knowledge-test-panel__source header,
.knowledge-test-panel__chunk span {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test-panel__scheme-meta em {
  font-style: normal;
}

.knowledge-test-panel__source blockquote,
.knowledge-test-panel__chunk p {
  margin: 8px 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  white-space: pre-wrap;
}

.knowledge-test-panel__pages {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.knowledge-test-panel__page {
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  cursor: pointer;
}

.knowledge-test-panel__page img,
.knowledge-test-panel__page-empty {
  display: grid;
  width: 100%;
  aspect-ratio: 0.76;
  place-items: center;
  object-fit: contain;
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-test-panel__page-empty {
  color: var(--td-text-color-placeholder);
}

.knowledge-test-panel__page figcaption {
  padding: 8px 10px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-test-panel__debug-actions {
  display: flex;
  justify-content: flex-end;
  margin: 10px 0;
}

.knowledge-test-panel__debug-title {
  margin: 16px 0 8px;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

@media (max-width: 900px) {
  .knowledge-test-panel__pages {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
