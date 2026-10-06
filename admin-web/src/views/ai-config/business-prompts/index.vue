<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, onMounted, ref } from 'vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { fetchAiModels, fetchAiSceneBindings, fetchBusinessPrompts, resetBusinessPrompt, updateBusinessPrompt } from '@/api/modules/ai'
import { confirmAndRun } from '@/composables/useAppConfirm'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import {
  BUSINESS_PROMPT_DUTY_HINT,
  BUSINESS_PROMPT_REPEAT_RULE_HINT,
  GLOBAL_RESPONSE_POLICY_BOUNDARY_HINT,
  GLOBAL_RESPONSE_POLICY_CONTEXT_HINT,
  GLOBAL_RESPONSE_POLICY_MAX_RULES,
  GLOBAL_RESPONSE_POLICY_RULE_LIMIT_HINT,
  GLOBAL_RESPONSE_POLICY_TEST_CASES,
  KNOWLEDGE_SEARCH_TEST_CASE,
  PRODUCT_COMPARE_PROMPT_RULES,
  businessPromptDutyTag,
  businessPromptDutyTagStatus,
  businessPromptModifiedLines,
  businessPromptStatusLabel,
  countNumberedPromptRules,
  editorPromptContent,
  evaluateGlobalResponsePolicyCoverage,
  evaluateKnowledgeSearchPromptCoverage,
  isGlobalResponsePolicy,
  projectBusinessPromptRowsWithModels,
  type ProjectedBusinessPromptRow,
} from '@/utils/business-prompt'

type PromptRow = ProjectedBusinessPromptRow

const feedback = useAppFeedback()
const { canAccess } = usePermissionAccess()
const canEdit = computed(() => canAccess({ permissions: ['system:ai:prompt:edit'] }))

const rows = ref<PromptRow[]>([])
const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const errorMessage = ref('请检查网络连接后重试')

const editorVisible = ref(false)
const editorSaving = ref(false)
const editing = ref<PromptRow | null>(null)
const editorContent = ref('')
const testPanelOpen = ref<Array<string | number>>(['test'])

const editorRules: FormRules<{ content: string }> = {
  content: [
    { required: true, message: '请输入提示词内容' },
    { min: 10, message: '提示词内容至少需要 10 个字符' },
  ],
}

const editingGlobalPolicy = computed(() => editing.value ? isGlobalResponsePolicy(editing.value.code) : false)
const editingKnowledgeSearch = computed(() => editing.value?.code === 'KNOWLEDGE_SEARCH')
const policyCoverage = computed(() => evaluateGlobalResponsePolicyCoverage(editorContent.value))
const knowledgeCoverage = computed(() => evaluateKnowledgeSearchPromptCoverage(editorContent.value))
const policyRuleCount = computed(() => countNumberedPromptRules(editorContent.value))
const policyRuleOverLimit = computed(() => policyRuleCount.value > GLOBAL_RESPONSE_POLICY_MAX_RULES)
const editorTitle = computed(() => {
  if (!editing.value) {
    return '配置提示词'
  }
  return editingGlobalPolicy.value ? '配置全局回答规则' : `配置「${editing.value.name}」`
})
const editorMetaLines = computed(() => editing.value ? businessPromptModifiedLines(editing.value) : [])
const editorModelName = computed(() => {
  const current = editing.value
  if (!current || isGlobalResponsePolicy(current.code) || current.modelName === '—') {
    return ''
  }
  return current.modelName
})

async function load(): Promise<void> {
  status.value = 'loading'
  try {
    const [promptResult, bindingsResult, modelsResult] = await Promise.all([
      fetchBusinessPrompts(),
      fetchAiSceneBindings().catch(() => ({ items: [] })),
      fetchAiModels().catch(() => ({ items: [] })),
    ])
    const modelNameById = new Map(modelsResult.items.map(item => [item.id, item.displayName]))
    const bindingByScene = new Map(bindingsResult.items.map(item => [item.scene, {
      defaultModelId: item.defaultModelId,
      defaultModelName: item.defaultModelName,
      primaryModelId: item.primaryModelId,
      scene: item.scene,
    }]))
    rows.value = projectBusinessPromptRowsWithModels(promptResult.items, bindingByScene, modelNameById)
    status.value = 'ready'
  }
  catch (cause) {
    errorMessage.value = normalizeFeedbackError(cause).message
    status.value = 'error'
  }
}

function openEditor(row: PromptRow): void {
  editing.value = row
  editorContent.value = editorPromptContent(row.code, row.content)
  testPanelOpen.value = ['test']
  editorVisible.value = true
}

async function saveEditor(): Promise<void> {
  const current = editing.value
  if (!current || editorSaving.value) {
    return
  }
  editorSaving.value = true
  try {
    await updateBusinessPrompt(current.code, { content: editorContent.value.trim() })
    await feedback.message('success', editingGlobalPolicy.value ? '全局回答规则已保存' : '业务提示词已保存')
    editorVisible.value = false
    await load()
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
  finally {
    editorSaving.value = false
  }
}

async function restoreDefault(): Promise<void> {
  const current = editing.value
  if (!current) {
    return
  }
  const result = await confirmAndRun({
    title: '恢复默认',
    content: editingGlobalPolicy.value
      ? '确认将全局回答规则恢复为系统内置默认内容吗？当前编辑内容会被覆盖。'
      : `确认将「${current.name}」恢复为默认提示词吗？当前编辑内容会被覆盖。`,
    confirmText: '恢复默认',
  }, async () => {
    const restored = await resetBusinessPrompt(current.code)
    editorContent.value = editorPromptContent(current.code, restored.prompt.content)
    await feedback.message('success', restored.message)
    await load()
    return restored
  })
  void result
}

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    colKey: 'name',
    minWidth: 180,
    title: '名称',
    cell: (_, { row }) => {
      const item = row as PromptRow
      const duty = businessPromptDutyTag(item.code, item.kind)
      return h('div', { class: 'prompt-page__name-cell' }, [
        h('span', { class: 'prompt-page__name' }, item.name),
        h(AppStatusTag, {
          label: duty,
          status: businessPromptDutyTagStatus(duty),
        }),
      ])
    },
  },
  {
    colKey: 'purpose',
    minWidth: 280,
    title: '用途',
    cell: (_, { row }) => h('p', { class: 'prompt-page__purpose' }, (row as PromptRow).purpose),
  },
  {
    colKey: 'enabled',
    title: '状态',
    width: 88,
    cell: (_, { row }) => h(AppStatusTag, {
      label: businessPromptStatusLabel((row as PromptRow).enabled),
      status: (row as PromptRow).enabled ? 'success' : 'disabled',
    }),
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  return [{
    handler: () => openEditor(row as PromptRow),
    key: 'config',
    label: '配置',
    theme: 'primary',
  }]
}

onMounted(() => {
  void load()
})
</script>

<template>
  <AppPage
    :description="`${BUSINESS_PROMPT_DUTY_HINT} 计算、检索范围和权限仍由服务端保证。`"
    title="提示词配置"
  >
    <AppDataTable
      :columns="columns"
      :data="rows"
      empty-description="提示词目录由平台预置"
      empty-title="暂无提示词"
      :error-description="errorMessage"
      :operations-width="88"
      :show-pagination="false"
      row-key="code"
      :status="status === 'loading' ? 'loading' : status === 'error' ? 'error' : 'ready'"
      :total="rows.length"
      @refresh="load"
      @retry="load"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" :max-visible="1" />
      </template>
    </AppDataTable>

    <t-drawer
      :close-btn="true"
      :footer="true"
      :header="editorTitle"
      size="min(720px, 96vw)"
      :visible="editorVisible"
      @close="editorVisible = false"
      @update:visible="(value: boolean) => { editorVisible = value }"
    >
      <div v-if="editing" class="prompt-editor">
        <p class="prompt-editor__purpose">{{ editing.purpose }}</p>
        <div class="prompt-editor__meta">
          <p v-for="line in editorMetaLines" :key="line">{{ line }}</p>
          <p v-if="editorModelName">当前模型：{{ editorModelName }}</p>
        </div>
        <t-alert
          v-if="editingGlobalPolicy"
          theme="info"
          :message="GLOBAL_RESPONSE_POLICY_CONTEXT_HINT"
        />
        <t-alert
          v-if="editingGlobalPolicy"
          theme="warning"
          :message="`${GLOBAL_RESPONSE_POLICY_BOUNDARY_HINT} ${GLOBAL_RESPONSE_POLICY_RULE_LIMIT_HINT}`"
        />
        <t-alert
          v-else
          theme="info"
          :message="BUSINESS_PROMPT_REPEAT_RULE_HINT"
        />
        <p v-if="!editingGlobalPolicy && editing.note" class="prompt-editor__note">{{ editing.note }}</p>
        <ul v-if="editing.code === 'PRODUCT_COMPARE'" class="prompt-editor__rules">
          <li v-for="rule in PRODUCT_COMPARE_PROMPT_RULES" :key="rule">{{ rule }}</li>
        </ul>
        <t-form :data="{ content: editorContent }" :rules="editorRules" @submit="saveEditor">
          <t-form-item :label="editingGlobalPolicy ? '全局回答规则' : '提示词内容'" name="content">
            <t-textarea
              v-model="editorContent"
              :autosize="{ minRows: 14, maxRows: 22 }"
              maxlength="20000"
              :placeholder="editingGlobalPolicy
                ? '请输入 8～10 条面向用户的表达规则'
                : '请输入该业务场景要关注什么，不必重复全局回答规则'"
            />
          </t-form-item>
        </t-form>
        <p v-if="editingGlobalPolicy" class="prompt-editor__rule-count">
          当前 {{ policyRuleCount }} 条核心规则
          <span v-if="policyRuleOverLimit">，已超过 {{ GLOBAL_RESPONSE_POLICY_MAX_RULES }} 条建议上限</span>
        </p>

        <t-collapse
          v-if="editingGlobalPolicy || editingKnowledgeSearch"
          v-model="testPanelOpen"
          class="prompt-editor__test"
          expand-icon-placement="right"
        >
          <t-collapse-panel header="测试" value="test">
            <template v-if="editingGlobalPolicy">
              <dl
                v-for="item in GLOBAL_RESPONSE_POLICY_TEST_CASES"
                :key="item.id"
                class="prompt-editor__test-case"
              >
                <dt>测试输入</dt>
                <dd>{{ item.input }}</dd>
                <dt>预期回答</dt>
                <dd>{{ item.expected }}</dd>
              </dl>
              <p class="prompt-editor__test-hint">
                当前规则覆盖测试场景：{{ policyCoverage.passed ? '已覆盖' : '需补充' }}
              </p>
              <ul class="prompt-editor__test-checks">
                <li v-for="check in policyCoverage.checks" :key="check.id">
                  {{ check.passed ? '已覆盖' : '缺失' }} · {{ check.label }}
                </li>
              </ul>
            </template>
            <template v-else>
              <dl class="prompt-editor__test-case">
                <dt>测试输入</dt>
                <dd>{{ KNOWLEDGE_SEARCH_TEST_CASE.input }}</dd>
                <dt>预期回答</dt>
                <dd>{{ KNOWLEDGE_SEARCH_TEST_CASE.expected }}</dd>
              </dl>
              <p class="prompt-editor__test-hint">
                当前关注点覆盖该测试：{{ knowledgeCoverage.passed ? '已覆盖' : '需补充' }}
              </p>
              <ul class="prompt-editor__test-checks">
                <li v-for="check in knowledgeCoverage.checks" :key="check.id">
                  {{ check.passed ? '已覆盖' : '缺失' }} · {{ check.label }}
                </li>
              </ul>
            </template>
          </t-collapse-panel>
        </t-collapse>
      </div>
      <template #footer>
        <t-space>
          <t-button :disabled="editorSaving" theme="default" variant="outline" @click="restoreDefault">
            恢复默认
          </t-button>
          <t-button :disabled="!canEdit" :loading="editorSaving" theme="primary" @click="saveEditor">
            保存
          </t-button>
        </t-space>
      </template>
    </t-drawer>
  </AppPage>
</template>

<style scoped>
.prompt-page__name-cell {
  display: inline-flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.prompt-page__name {
  font-weight: 500;
}

.prompt-page__purpose {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--td-text-color-secondary);
  line-height: var(--td-line-height-body-medium);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.prompt-editor {
  display: grid;
  gap: var(--td-size-4);
}

.prompt-editor__purpose,
.prompt-editor__note {
  margin: 0;
  color: var(--td-text-color-secondary);
  line-height: var(--td-line-height-body-medium);
}

.prompt-editor__meta {
  display: grid;
  gap: var(--td-size-1);
  color: var(--td-text-color-placeholder);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.prompt-editor__meta p {
  margin: 0;
}

.prompt-editor__note {
  padding: var(--td-size-3);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
}

.prompt-editor__rules,
.prompt-editor__test-checks {
  margin: 0;
  padding-left: var(--td-size-5);
  color: var(--td-text-color-secondary);
  line-height: var(--td-line-height-body-medium);
}

.prompt-editor__test-case {
  display: grid;
  gap: var(--td-size-1);
  margin: 0 0 var(--td-size-3);
}

.prompt-editor__test-case dt {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.prompt-editor__test-case dd {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  line-height: var(--td-line-height-body-medium);
}

.prompt-editor__test-hint {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-primary);
}

.prompt-editor__rule-count {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>
