<script setup lang="ts">
import type { KnowledgePageRecognitionSummary, KnowledgeVersionIndex, KnowledgeWorkspace } from '@/types/knowledge'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref } from 'vue'
import { rebuildVersionIndex, rebuildVersionIndexMaintenance } from '@/api/modules/knowledge'
import { businessUserError, businessUserMessage } from '@/utils/business-error'
import { buildKnowledgeFlowSteps } from '@/utils/knowledge-lifecycle'
import { buildOverviewFacts, getOverviewNextStep, remainingOverviewBlockers } from '@/utils/knowledge-overview'

const props = withDefaults(defineProps<{
  versionId: string | null
  workspace: KnowledgeWorkspace | null
  /** 当前版本知识索引状态（由页面级 useKnowledgeLifecycle 提供）。 */
  index?: KnowledgeVersionIndex | null
  /** 后端 pageRecognitionSummary（由页面级 useKnowledgeLifecycle 提供）。 */
  recognitionSummary?: KnowledgePageRecognitionSummary | null
  /** 是否允许重建知识索引（权限）。 */
  canRebuildIndex?: boolean
  canTest?: boolean
  canOpenPublish?: boolean
  canUploadPages?: boolean
  canHandleRecognition?: boolean
  /** 当前版本状态；已发布版本走维护式重建。 */
  versionStatus?: string | null
}>(), {
  index: null,
  recognitionSummary: null,
  canRebuildIndex: false,
  canTest: false,
  canOpenPublish: false,
  canUploadPages: false,
  canHandleRecognition: false,
  versionStatus: null,
})

const emit = defineEmits<{ refresh: [], navigate: [tab: string], publish: [] }>()

const rebuilding = ref(false)

const summary = computed(() => props.workspace?.summary ?? null)
const flowSteps = computed(() => buildKnowledgeFlowSteps({
  workspace: props.workspace,
  index: props.index,
  recognitionSummary: props.recognitionSummary,
}))
const builtAtLabel = computed(() => {
  const value = props.index?.indexBuiltAt
  if (!value) {
    return '尚未更新'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
})

const publishBlockers = computed(() => (summary.value?.publishBlockers ?? []).map(businessUserMessage))
const published = computed(() => props.workspace?.currentVersion?.status === 'PUBLISHED')
const canPublish = computed(() => Boolean(summary.value?.canPublish))
const canAskAi = computed(() => Boolean(summary.value?.canAskAi))
const isPageDriven = computed(() => summary.value?.contentSource !== 'ORIGINAL_FILE')
const nextStep = computed(() => getOverviewNextStep({
  published: published.value,
  canAskAi: canAskAi.value,
  canPublish: canPublish.value,
  pageCount: summary.value?.pageCount ?? 0,
  isPageDriven: isPageDriven.value,
  recognitionSummary: props.recognitionSummary,
  parseStatus: props.workspace?.currentVersion?.parseStatus,
  index: props.index,
  canTest: props.canTest,
  canUploadPages: props.canUploadPages,
  canHandleRecognition: props.canHandleRecognition,
  canRebuildIndex: props.canRebuildIndex,
  canOpenPublish: props.canOpenPublish,
}))
const facts = computed(() => buildOverviewFacts(summary.value?.pageCount ?? 0, props.recognitionSummary, isPageDriven.value))
const remainingBlockers = computed(() => remainingOverviewBlockers(publishBlockers.value, nextStep.value.reason))

function followNextStep(): void {
  if (nextStep.value.tab === 'index') {
    void rebuild()
    return
  }
  if (nextStep.value.tab === 'publish') {
    emit('publish')
    return
  }
  if (nextStep.value.tab) {
    emit('navigate', nextStep.value.tab)
  }
}

async function rebuild(): Promise<void> {
  if (!props.versionId || rebuilding.value) {
    return
  }
  rebuilding.value = true
  try {
    // 常规重建仅允许草稿/已审核版本；已发布/已停用版本走维护式重建。
    if (props.versionStatus === 'PUBLISHED' || props.versionStatus === 'DISABLED') {
      await rebuildVersionIndexMaintenance(props.versionId)
    }
    else {
      await rebuildVersionIndex(props.versionId)
    }
    MessagePlugin.success('问答内容已更新')
    emit('refresh')
  }
  catch (cause) {
    MessagePlugin.error(businessUserError(cause))
  }
  finally {
    rebuilding.value = false
  }
}
</script>

<template>
  <section class="knowledge-overview">
    <div class="knowledge-overview__next">
      <div class="knowledge-overview__next-copy">
        <h2>{{ nextStep.reason === 'published' ? '已发布' : '下一步' }}</h2>
        <p>{{ nextStep.text }}</p>
      </div>
      <t-button v-if="nextStep.action" theme="primary" @click="followNextStep">
        {{ nextStep.action }}
      </t-button>
    </div>

    <dl v-if="facts.length" class="knowledge-overview__facts" aria-label="资料处理概况">
      <div v-for="fact in facts" :key="fact.key" class="knowledge-overview__fact" :class="[`is-${fact.tone}`, `is-${fact.key}`]">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
    </dl>
    <div class="knowledge-overview__details-content">
      <section class="knowledge-overview__section" aria-label="资料处理步骤">
        <h3>处理步骤</h3>
        <ol class="knowledge-overview__flow">
          <li v-for="step in flowSteps" :key="step.label" class="knowledge-overview__flow-step" :class="`is-${step.state}`">
            <span class="knowledge-overview__flow-mark" aria-hidden="true" />
            <strong>{{ step.label }}</strong>
            <span class="knowledge-overview__flow-detail">{{ step.state === 'done' ? '已完成' : step.detail }}</span>
          </li>
        </ol>
      </section>

      <section class="knowledge-overview__section knowledge-overview__readiness" aria-label="发布与问答条件">
        <h3>发布与问答</h3>
        <dl class="knowledge-overview__readiness-list">
          <div>
            <dt>发布</dt>
            <dd :class="published || canPublish ? 'is-ready' : 'is-pending'">{{ published ? '已发布' : canPublish ? '可以发布' : '尚未满足条件' }}</dd>
          </div>
          <div>
            <dt>问答</dt>
            <dd :class="canAskAi ? 'is-ready' : 'is-pending'">{{ canAskAi ? '可以使用' : '暂不能使用' }}</dd>
          </div>
        </dl>
        <div v-if="remainingBlockers.length" class="knowledge-overview__blockers">
          <h4>还需完成</h4>
          <ul>
            <li v-for="(blocker, blockerIndex) in remainingBlockers" :key="blockerIndex">
              {{ blocker }}
            </li>
          </ul>
        </div>
        <p v-if="index?.indexBuiltAt" class="knowledge-overview__updated">
          问答内容上次更新：{{ builtAtLabel }}
        </p>
        <t-button
          v-if="canRebuildIndex && nextStep.reason !== 'index'"
          :disabled="!versionId || rebuilding || index?.indexStatus === 'INDEXING'"
          :loading="rebuilding"
          size="small"
          variant="outline"
          @click="rebuild"
        >
          更新问答内容
        </t-button>
      </section>
    </div>
  </section>
</template>

<style scoped>
.knowledge-overview {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--td-size-4) 0;
  container-type: inline-size;
}

.knowledge-overview__next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-5);
  padding: var(--td-size-4) var(--td-size-5);
  border-left: 3px solid var(--td-brand-color);
  background: var(--td-brand-color-1);
}

.knowledge-overview__next-copy { min-width: 0; }
.knowledge-overview__next h2,
.knowledge-overview__section h3,
.knowledge-overview__blockers h4 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: 600;
}
.knowledge-overview__next p {
  margin: var(--td-size-1) 0 0;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}
.knowledge-overview__next :deep(.t-button) { flex: 0 0 auto; }


.knowledge-overview__facts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--td-size-4);
  margin: 0;
}
.knowledge-overview__fact {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}
.knowledge-overview__fact dt {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
}
.knowledge-overview__fact dt::before {
  content: '';
  width: var(--td-size-2);
  height: var(--td-size-2);
  border-radius: var(--td-radius-circle);
  background: var(--td-brand-color);
}
.knowledge-overview__fact dd {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--vicp-metric-value-size);
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
}
.knowledge-overview__fact.is-warning dd { color: var(--td-warning-color); }
.knowledge-overview__fact.is-warning dt::before { background: var(--td-warning-color); }
.knowledge-overview__fact.is-confirmed dd { color: var(--td-success-color); }
.knowledge-overview__fact.is-confirmed dt::before { background: var(--td-success-color); }
.knowledge-overview__details-content {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  align-items: stretch;
  gap: var(--td-size-4);
}
.knowledge-overview__section {
  min-width: 0;
  padding: var(--td-size-5);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}
.knowledge-overview__section h3 {
  margin-bottom: var(--td-size-4);
  padding-bottom: var(--td-size-3);
  border-bottom: 1px solid var(--td-component-stroke);
  font-size: var(--td-font-size-title-medium);
}
.knowledge-overview__flow,
.knowledge-overview__blockers ul { margin: 0; padding: 0; list-style: none; }
.knowledge-overview__flow-step {
  display: grid;
  grid-template-columns: var(--td-size-4) minmax(0, 1fr) minmax(80px, auto);
  align-items: center;
  gap: var(--td-size-3);
  min-height: var(--td-comp-size-m);
}
.knowledge-overview__flow-step strong { font-weight: 500; }
.knowledge-overview__flow-detail {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-align: right;
  overflow-wrap: anywhere;
}
.knowledge-overview__flow-step.is-error .knowledge-overview__flow-detail { color: var(--td-error-color); }
.knowledge-overview__flow-step.is-active .knowledge-overview__flow-detail { color: var(--td-brand-color); }
.knowledge-overview__flow-mark {
  width: var(--td-size-2);
  height: var(--td-size-2);
  border-radius: var(--td-radius-circle);
  background: var(--td-text-color-placeholder);
}
.knowledge-overview__flow-step.is-done .knowledge-overview__flow-mark { background: var(--td-success-color); }
.knowledge-overview__flow-step.is-active .knowledge-overview__flow-mark { background: var(--td-brand-color); }
.knowledge-overview__flow-step.is-error .knowledge-overview__flow-mark { background: var(--td-error-color); }
.knowledge-overview__readiness-list { margin: 0; }
.knowledge-overview__readiness-list div {
  display: flex;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--td-size-2) 0;
}
.knowledge-overview__readiness-list dt { color: var(--td-text-color-secondary); }
.knowledge-overview__readiness-list dd { margin: 0; text-align: right; font-weight: 500; }
.knowledge-overview__readiness-list .is-ready { color: var(--td-success-color); }
.knowledge-overview__readiness-list .is-pending { color: var(--td-warning-color); }
.knowledge-overview__blockers { margin-top: var(--td-size-4); }
.knowledge-overview__blockers h4 { margin-bottom: var(--td-size-2); }
.knowledge-overview__blockers li {
  padding: var(--td-size-1) 0;
  color: var(--td-text-color-secondary);
  overflow-wrap: anywhere;
}
.knowledge-overview__updated {
  margin: var(--td-size-4) 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.knowledge-overview__readiness :deep(.t-button) { margin-top: var(--td-size-3); }

@container (max-width: 760px) {
  .knowledge-overview__details-content { grid-template-columns: minmax(0, 1fr); }
}
@container (max-width: 580px) {
  .knowledge-overview__next { align-items: flex-start; flex-direction: column; }
  .knowledge-overview__facts { gap: var(--td-size-2); }
  .knowledge-overview__fact { padding: var(--td-size-3); }
  .knowledge-overview__fact dd { font-size: var(--td-font-size-title-large); }
  .knowledge-overview__flow-step { grid-template-columns: var(--td-size-4) minmax(0, 1fr); }
  .knowledge-overview__flow-detail { grid-column: 2; text-align: left; padding-bottom: var(--td-size-2); }
}
</style>
