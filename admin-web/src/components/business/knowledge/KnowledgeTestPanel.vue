<script setup lang="ts">
import type {
  KnowledgeQaSource,
  KnowledgeQaSseEvent,
  KnowledgeReferencePageBlock,
  KnowledgeUserTestSource,
  KnowledgeVersionTestInspectResult,
} from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import { inspectKnowledgeVersionTest, postKnowledgeVersionTestQa } from '@/api/modules/knowledge'
import KnowledgeOriginalPageViewer from '@/components/business/knowledge/KnowledgeOriginalPageViewer.vue'
import AppMarkdown from '@/components/ui/AppMarkdown.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError } from '@/utils/business-error'
import { knowledgePageLabel } from '@/utils/knowledge-user'

interface TestResult {
  query: string
  answer: string
  retrievalType: string
  sources: KnowledgeUserTestSource[]
  referencePages: KnowledgeReferencePageBlock[]
}

type TestMode = 'NORMAL' | 'DEBUG'

const props = withDefaults(defineProps<{
  versionId: string | null
  /** 是否允许进入高级调试（system:knowledge:debug）。无权限时只保留常规测试。 */
  canDebug?: boolean
}>(), {
  canDebug: false,
})

const mode = ref<TestMode>('NORMAL')
const { canAccess } = usePermissionAccess()
const canViewOriginal = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))
const query = ref('')
const sending = ref(false)
const result = ref<TestResult | null>(null)
const debugLoading = ref(false)
const debugResult = ref<KnowledgeVersionTestInspectResult | null>(null)
const debugError = ref<unknown>(null)
const viewerVisible = ref(false)
const viewerPage = ref<{ imageUrl: string | null, pageId: string | null, versionId: string | null, physicalPageNumber: number | null, pageLabel: string | null, title: string }>({ imageUrl: null, pageId: null, versionId: null, physicalPageNumber: null, pageLabel: null, title: '原始页面' })
let abortController: AbortController | null = null

const isDebugMode = computed(() => props.canDebug && mode.value === 'DEBUG')
const busy = computed(() => sending.value || debugLoading.value)
const canSend = computed(() => query.value.trim().length > 0 && !busy.value && Boolean(props.versionId))

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
    pageImageUrl: userSource.pageImageUrl ?? null,
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

function retrievalTypeLabel(value: string): string {
  return { REFERENCE_LOOKUP: '图集参考方案', KNOWLEDGE: '知识内容', DIRECT: '直接回答' }[value] ?? '检索中'
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
      MessagePlugin.error(businessUserError(cause))
      if (result.value && !result.value.answer) {
        result.value.answer = businessUserError(cause)
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

function run(): void {
  if (isDebugMode.value) {
    void runInspect()
    return
  }
  void send()
}

function clearResult(): void {
  abortController?.abort()
  sending.value = false
  result.value = null
  debugResult.value = null
  debugError.value = null
}

function openSource(source: KnowledgeUserTestSource): void {
  viewerPage.value = { imageUrl: source.pageImageUrl ?? null, pageId: source.pageId ?? null, versionId: source.versionId || null, physicalPageNumber: source.physicalPageNumber ?? null, pageLabel: source.pageLabel ?? null, title: source.title || '引用原页' }
  viewerVisible.value = true
}

function openReferencePage(block: KnowledgeReferencePageBlock): void {
  if (!block.page.imageUrl && !canViewOriginal.value) return
  viewerPage.value = { imageUrl: block.page.imageUrl ?? null, pageId: block.page.pageId, versionId: null, physicalPageNumber: block.page.physicalPageNumber ?? block.page.pageNumber ?? null, pageLabel: block.page.pageLabel ?? null, title: block.page.documentTitle || '参考原页' }
  viewerVisible.value = true
}

watch(() => props.versionId, () => clearResult())
// 权限收回时强制退出调试模式，避免停留在无权限界面。
watch(() => props.canDebug, (value) => {
  if (!value) {
    mode.value = 'NORMAL'
    debugResult.value = null
    debugError.value = null
  }
})
</script>

<template>
  <section class="knowledge-test-panel">
    <header class="knowledge-test-panel__header">
      <div>
        <h2>问答测试</h2>
        <p v-if="isDebugMode">
          检索调试只核对命中过程，不生成回答，因此没有 AI 回答属于正常现象。
        </p>
        <p v-else>
          {{ canDebug ? '输入问题，检查回答、匹配方案与引用原页；需要排障时可切换高级调试。' : '输入问题，检查回答是否正确，并核对引用的原始页面。' }}
        </p>
      </div>
      <t-radio-group v-if="canDebug" v-model="mode" variant="default-filled">
        <t-radio-button value="NORMAL">
          常规测试
        </t-radio-button>
        <t-radio-button value="DEBUG">
          高级调试
        </t-radio-button>
      </t-radio-group>
    </header>

    <div class="knowledge-test-panel__composer">
      <t-textarea
        v-model="query"
        :autosize="{ minRows: 3, maxRows: 6 }"
        maxlength="500"
        placeholder="例如：薄抹灰保温系统传热系数0.3的方案有么"
        @keydown.enter.exact.prevent="run"
      />
      <div class="knowledge-test-panel__composer-actions">
        <t-button theme="default" variant="text" @click="clearResult">
          清空
        </t-button>
        <t-button :disabled="!canSend" :loading="busy" theme="primary" @click="run">
          {{ isDebugMode ? '运行检索调试' : '开始测试' }}
        </t-button>
      </div>
    </div>

    <template v-if="!isDebugMode">
      <div v-if="result" class="knowledge-test-panel__result">
        <section class="knowledge-test-panel__block">
          <h3>AI 回答</h3>
          <p v-if="!result.answer && sending" class="knowledge-test-panel__muted">
            正在生成…
          </p>
          <AppMarkdown v-else-if="result.answer" :content="result.answer" />
          <p v-else class="knowledge-test-panel__muted">
            未生成回答。请检查问题和资料内容后重试。
          </p>
        </section>

        <section class="knowledge-test-panel__block">
          <h3>回答依据</h3>
          <t-tag theme="primary" variant="light">
            {{ retrievalTypeLabel(result.retrievalType) }}
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
                v-if="source.pageImageUrl || (canViewOriginal && (source.pageId || (source.versionId && source.physicalPageNumber != null)))"
                size="small"
                theme="primary"
                variant="text"
                @click="openSource(source)"
              >
                查看来源原页
              </t-button>
              <span v-else-if="source.pageId || source.physicalPageNumber != null" class="knowledge-test-panel__muted">当前账号无原页查看权限</span>
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
              @click="openReferencePage(block)"
              @keydown.enter="openReferencePage(block)"
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
      </div>
    </template>

    <template v-else>
      <div class="knowledge-test-panel__result">
        <t-loading v-if="debugLoading" text="正在检索调试" />
        <t-alert
          v-else-if="debugError"
          theme="error"
          :message="businessUserError(debugError)"
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

          <section class="knowledge-test-panel__block">
            <h3>命中文段</h3>
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
          </section>

          <section class="knowledge-test-panel__block">
            <h3>命中热工行</h3>
            <div v-if="debugResult.matchedReferenceRows.length" class="knowledge-test-panel__chunks">
              <div v-for="row in debugResult.matchedReferenceRows" :key="row.id" class="knowledge-test-panel__chunk">
                <strong>{{ row.sourcePageLabel || '—' }} · {{ row.thicknessMm }} mm</strong>
                <span>产品层 R {{ row.productThermalResistance }} · 总 R {{ row.totalThermalResistance }} · K {{ row.kValue }}</span>
              </div>
            </div>
            <p v-else class="knowledge-test-panel__muted">
              本次没有命中热工行。
            </p>
          </section>
        </template>
        <p v-else class="knowledge-test-panel__muted">
          输入问题后点击「运行检索调试」，查看命中文段、热工行与引用页面。
        </p>
      </div>
    </template>
    <KnowledgeOriginalPageViewer
      v-model:visible="viewerVisible"
      :image-url="viewerPage.imageUrl"
      :page-id="viewerPage.pageId"
      :version-id="viewerPage.versionId"
      :physical-page-number="viewerPage.physicalPageNumber"
      :page-label="viewerPage.pageLabel"
      :title="viewerPage.title"
    />
  </section>
</template>

<style scoped>
.knowledge-test-panel {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
}

.knowledge-test-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
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
  padding: var(--td-size-4) 0;
  border-top: 1px solid var(--td-component-stroke);
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
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
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

@media (max-width: 900px) {
  .knowledge-test-panel__pages {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
