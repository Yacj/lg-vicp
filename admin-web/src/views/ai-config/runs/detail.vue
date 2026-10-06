<script setup lang="ts">
import type { ConversationOpsDetail } from '@/types/ai'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPlatformConversationDetail } from '@/api/modules/ai'
import KnowledgeSourceReader from '@/components/business/KnowledgeSourceReader.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { normalizeAiSource, resolveAiSourceLocator } from '@/types/ai-source'
import type { AiSourceLocatorQuery } from '@/types/ai-source'
import {
  GLOBAL_RESPONSE_POLICY_APPLIED_LABEL,
  formatAgentDuration,
  formatJsonPreview,
  getAgentRunStatusLabel,
  getAgentRunStatusTone,
  projectAgentRunsFromConversation,
  resolveRunPromptIndicators,
  toAgentErrorDisplay,
} from '@/utils/ai-agent'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'AiConfigRunDetail' })

const route = useRoute()
const router = useRouter()
const { canAccess } = usePermissionAccess()
const conversationId = String(route.params.id)
const titleFromQuery = String(route.query.title ?? '')

const canViewToolJson = computed(() => canAccess({ permissions: ['system:ai:conversation:detail'] }))

const detail = ref<ConversationOpsDetail | null>(null)
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const error = ref<unknown>(null)

async function load(): Promise<void> {
  status.value = 'loading'
  error.value = null
  try {
    detail.value = await fetchPlatformConversationDetail(conversationId)
    status.value = 'ready'
  }
  catch (cause) {
    error.value = cause
    status.value = 'error'
  }
}

onMounted(() => {
  void load()
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const runs = computed(() => detail.value ? projectAgentRunsFromConversation(detail.value) : [])
const promptIndicators = computed(() => detail.value
  ? resolveRunPromptIndicators(detail.value)
  : { appliedCodes: ['GLOBAL_RESPONSE_POLICY'], globalResponsePolicyApplied: true, systemPromptExposed: false as const })
const pageTitle = computed(() => detail.value?.conversation.title || titleFromQuery || '运行详情')

const readerVisible = ref(false)
const readerLocator = ref<AiSourceLocatorQuery | null>(null)

function openSource(title: string, documentId: string | null, chunkId: string | null, sourcePage: number | null): void {
  const source = normalizeAiSource({
    chunkId: chunkId ?? undefined,
    documentId: documentId ?? undefined,
    sourcePage,
    title,
  })
  const locator = source ? resolveAiSourceLocator(source) : null
  if (!locator) {
    return
  }
  readerLocator.value = locator
  readerVisible.value = true
}

function goBack(): void {
  void router.push('/ai-config/runs')
}

function jsonPanelValue(runId: string, toolId: string, kind: 'input' | 'output'): string {
  return `${runId}:${toolId}:${kind}`
}
</script>

<template>
  <AppPage :title="pageTitle" description="展示 Agent 状态、工具调用、业务结果、错误和来源，不展示模型私有推理。">
    <template #navigation>
      <t-button theme="default" variant="outline" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回运行记录
      </t-button>
    </template>

    <div v-if="status === 'loading'" class="ai-run-detail__center">
      <t-loading text="正在加载运行详情..." />
    </div>

    <div v-else-if="status === 'error'" class="ai-run-detail__center">
      <t-alert theme="error" :title="errorDescription" />
      <t-button theme="primary" @click="load">
        重新加载
      </t-button>
    </div>

    <template v-else-if="detail">
      <t-card :bordered="false" class="ai-run-detail__card" title="会话信息">
        <t-descriptions bordered :column="4" size="medium">
          <t-descriptions-item label="用户">
            {{ detail.user.displayName }}
          </t-descriptions-item>
          <t-descriptions-item label="项目">
            {{ detail.project?.name ?? '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="Conversation">
            {{ detail.conversation.title || '未命名会话' }}
          </t-descriptions-item>
          <t-descriptions-item label="更新时间">
            {{ formatDate(new Date(detail.conversation.updatedAt)) }}
          </t-descriptions-item>
          <t-descriptions-item label="提示词">
            <AppStatusTag
              v-if="promptIndicators.globalResponsePolicyApplied"
              :label="GLOBAL_RESPONSE_POLICY_APPLIED_LABEL"
              status="info"
            />
          </t-descriptions-item>
        </t-descriptions>
      </t-card>

      <AppEmptyState
        v-if="runs.length === 0"
        description="该会话尚未产生工具调用或失败记录。"
        title="暂无 Agent 运行"
      />

      <article
        v-for="run in runs"
        :key="run.id"
        class="ai-run-detail__run"
      >
        <header class="ai-run-detail__run-header">
          <h2 class="ai-run-detail__run-title">
            运行详情
          </h2>
          <AppStatusTag
            :label="getAgentRunStatusLabel(run.status)"
            :status="getAgentRunStatusTone(run.status)"
          />
        </header>

        <t-descriptions bordered :column="2" size="medium">
          <t-descriptions-item :span="2" label="用户问题">
            {{ run.userQuestion }}
          </t-descriptions-item>
          <t-descriptions-item label="最终状态">
            {{ getAgentRunStatusLabel(run.status) }}
          </t-descriptions-item>
          <t-descriptions-item label="总耗时">
            {{ formatAgentDuration(run.durationMs) }}
          </t-descriptions-item>
          <t-descriptions-item label="模型">
            {{ run.model || '—' }}
          </t-descriptions-item>
          <t-descriptions-item label="Tool次数">
            {{ run.toolCalls.length }}
          </t-descriptions-item>
          <t-descriptions-item label="提示词">
            <AppStatusTag
              v-if="run.globalResponsePolicyApplied"
              :label="GLOBAL_RESPONSE_POLICY_APPLIED_LABEL"
              status="info"
            />
          </t-descriptions-item>
        </t-descriptions>

        <section v-if="run.errorCode || run.errorMessage" class="ai-run-detail__block">
          <h3 class="ai-run-detail__block-title">
            错误
          </h3>
          <t-alert
            theme="error"
            :title="toAgentErrorDisplay(run.errorCode, run.errorMessage, { toolFailed: run.toolCalls.some(item => !item.success) }).label"
          >
            <p class="ai-run-detail__error-code">
              {{ toAgentErrorDisplay(run.errorCode, run.errorMessage).sourceCode }}
            </p>
            <p>{{ toAgentErrorDisplay(run.errorCode, run.errorMessage).description }}</p>
          </t-alert>
        </section>

        <section class="ai-run-detail__block">
          <h3 class="ai-run-detail__block-title">
            Tool 执行顺序
          </h3>
          <div v-if="run.toolCalls.length === 0" class="ai-run-detail__muted">
            本次运行没有工具调用。
          </div>
          <ol v-else class="ai-run-detail__tools">
            <li v-for="tool in run.toolCalls" :key="tool.id" class="ai-run-detail__tool">
              <div class="ai-run-detail__tool-row">
                <strong>{{ tool.label }}</strong>
                <span class="ai-run-detail__muted">{{ formatAgentDuration(tool.durationMs) }}</span>
                <AppStatusTag
                  :label="tool.success ? '成功' : '失败'"
                  :status="tool.success ? 'success' : 'error'"
                />
                <span v-if="tool.errorMessage" class="ai-run-detail__muted">
                  {{ toAgentErrorDisplay(null, tool.errorMessage, { toolFailed: true }).label }}
                  · {{ tool.errorMessage }}
                </span>
              </div>
              <t-collapse
                v-if="canViewToolJson"
                :expand-mutex="false"
                expand-icon-placement="right"
              >
                <t-collapse-panel
                  :value="jsonPanelValue(run.id, tool.id, 'input')"
                  header="inputJson"
                >
                  <pre class="ai-run-detail__json">{{ formatJsonPreview(tool.inputJson) }}</pre>
                </t-collapse-panel>
                <t-collapse-panel
                  :value="jsonPanelValue(run.id, tool.id, 'output')"
                  header="outputJson"
                >
                  <pre class="ai-run-detail__json">{{ formatJsonPreview(tool.outputJson) }}</pre>
                </t-collapse-panel>
              </t-collapse>
            </li>
          </ol>
        </section>

        <section class="ai-run-detail__block">
          <h3 class="ai-run-detail__block-title">
            Sources
          </h3>
          <div v-if="run.sources.length === 0" class="ai-run-detail__muted">
            本次运行没有知识来源。
          </div>
          <ul v-else class="ai-run-detail__sources">
            <li v-for="source in run.sources" :key="source.id">
              <span>{{ source.sourceTitle ?? '未知来源' }}</span>
              <span v-if="source.sourcePage !== null" class="ai-run-detail__muted">
                第 {{ source.sourcePage }} 页
              </span>
              <span
                v-if="source.documentId || source.chunkId"
                class="ai-run-detail__link"
                role="button"
                tabindex="0"
                @click="openSource(source.sourceTitle ?? '未知来源', source.documentId, source.chunkId, source.sourcePage)"
                @keydown.enter="openSource(source.sourceTitle ?? '未知来源', source.documentId, source.chunkId, source.sourcePage)"
              >
                查看来源
              </span>
            </li>
          </ul>
        </section>
      </article>

      <t-drawer
        v-model:visible="readerVisible"
        attach="body"
        header="原文阅读"
        placement="right"
        :prevent-scroll-through="true"
        size="min(760px, 96vw)"
        :footer="false"
      >
        <KnowledgeSourceReader v-if="readerLocator && readerVisible" :locator="readerLocator" />
      </t-drawer>
    </template>
  </AppPage>
</template>

<style scoped>
.ai-run-detail__center {
  display: flex;
  min-height: 280px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--td-size-4);
}

.ai-run-detail__card,
.ai-run-detail__run {
  margin-bottom: var(--td-size-5);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-border);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.ai-run-detail__run-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  margin-bottom: var(--td-size-4);
}

.ai-run-detail__run-title,
.ai-run-detail__block-title {
  margin: 0;
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.ai-run-detail__block {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin-top: var(--td-size-4);
}

.ai-run-detail__tools,
.ai-run-detail__sources {
  margin: 0;
  padding: 0;
  list-style: none;
}

.ai-run-detail__tool {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  padding: var(--td-size-3) 0;
  border-bottom: 1px dashed var(--td-component-border);
}

.ai-run-detail__tool-row,
.ai-run-detail__sources li {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.ai-run-detail__json {
  margin: 0;
  overflow: auto;
  max-height: 280px;
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  white-space: pre-wrap;
  word-break: break-word;
}

.ai-run-detail__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.ai-run-detail__error-code {
  margin: 0 0 var(--td-size-1);
  font-family: var(--td-font-family-mono);
}

.ai-run-detail__link {
  color: var(--td-brand-color);
  cursor: pointer;
  font-size: var(--td-font-size-body-small);
}
</style>
