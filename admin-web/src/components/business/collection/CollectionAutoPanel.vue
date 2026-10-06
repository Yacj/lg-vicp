<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref } from 'vue'
import CollectionSkillDrawer from '@/components/business/collection/CollectionSkillDrawer.vue'
import CollectionSourceDrawer from '@/components/business/collection/CollectionSourceDrawer.vue'
import CollectionTaskDrawer from '@/components/business/collection/CollectionTaskDrawer.vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {
  createCollectionSource,
  disableCollectionSource,
  enableCollectionSource,
  fetchCollectionRecords,
  fetchCollectionSkills,
  fetchCollectionSources,
  fetchCollectionTask,
  fetchCollectionTasks,
  importCollectionTaskToKnowledge,
  updateCollectionSource,
} from '@/api/modules/collection'
import type { AppTableAction } from '@/types/crud'
import type { CollectionSkill, CollectionSource, CollectionTask } from '@/types/collection'
import { COLLECTION_PERMISSIONS } from '@/types/collection'
import { formatDate } from '@/utils/day'

const emit = defineEmits<{
  openKnowledge: [documentId: string]
}>()

const { canAccess } = usePermissionAccess()
const feedback = useAppFeedback()
const canCreate = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.AUTO_CREATE] }))
const canUpdate = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.AUTO_UPDATE] }))
const canToggle = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.AUTO_TOGGLE] }))
const canViewSource = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.AUTO_LIST] }))
const canViewTask = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.TASK_VIEW] }))
const canManageSkills = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.SKILL_LIST] }))

const sources = ref<CollectionSource[]>([])
const skills = ref<CollectionSkill[]>([])
const recordTotals = ref<Record<string, number>>({})
const skillDrawerVisible = ref(false)
const isLoading = ref(false)
const error = ref<unknown>(null)

const skillOptions = computed(() => skills.value.map(item => ({ label: item.name, value: item.id })))

function skillName(skillId: string | null): string {
  if (!skillId) {
    return '—'
  }
  return skills.value.find(item => item.id === skillId)?.name ?? '—'
}

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const [sourceResult, skillResult] = await Promise.all([
      fetchCollectionSources(),
      fetchCollectionSkills().catch(() => ({ items: [] as CollectionSkill[] })),
    ])
    sources.value = sourceResult.items
    skills.value = skillResult.items
    const totals = await Promise.all(sourceResult.items.map(async (source) => {
      try {
        const records = await fetchCollectionRecords({ page: 1, pageSize: 1, sourceId: source.id })
        return [source.id, records.total] as const
      }
      catch {
        return [source.id, 0] as const
      }
    }))
    recordTotals.value = Object.fromEntries(totals)
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

void load()

interface SourceForm extends Record<string, unknown> {
  enabled: boolean
  name: string
  skillId: string
  sourceUrl: string
}

const createDrawer = useCrudDrawer<SourceForm, CollectionSource, CollectionSource>({
  createForm: () => ({ enabled: true, name: '', skillId: '', sourceUrl: '' }),
  editForm: entity => ({
    enabled: entity.enabled,
    name: entity.name,
    skillId: entity.skillId ?? '',
    sourceUrl: entity.sourceUrl,
  }),
  submit: async ({ data, entity, mode }) => {
    const payload = {
      name: data.name.trim(),
      skillId: data.skillId || null,
      sourceUrl: data.sourceUrl.trim(),
    }
    if (mode === 'create') {
      return createCollectionSource({ ...payload, enabled: data.enabled ?? true })
    }
    return updateCollectionSource(entity!.id, payload)
  },
  onSuccess: async () => {
    await feedback.message('success', createDrawer.mode.value === 'create' ? '已保存采集来源' : '已更新采集来源')
    await load()
  },
  onError: cause => void feedback.messageError(cause),
})

const createRules: FormRules<SourceForm> = {
  name: [{ required: true, message: '请输入来源名称' }],
  sourceUrl: [
    { required: true, message: '请输入来源地址' },
    { url: { protocols: ['http', 'https'] }, message: '来源地址格式不正确' },
  ],
}

const selectedSource = ref<CollectionSource | null>(null)
const history = ref<CollectionTask[]>([])
const historyStatus = ref<'ready' | 'loading' | 'error'>('ready')
const historyError = ref('请检查网络连接后重试')
const selectedTask = ref<CollectionTask | null>(null)

async function loadHistory(source: CollectionSource): Promise<void> {
  historyStatus.value = 'loading'
  try {
    const result = await fetchCollectionTasks({
      keyword: source.name,
      mode: 'AUTO',
      page: 1,
      pageSize: 50,
    })
    history.value = result.items.filter(item => item.sourceId === source.id)
    historyStatus.value = 'ready'
  }
  catch (cause) {
    history.value = []
    historyStatus.value = 'error'
    historyError.value = normalizeFeedbackError(cause).message
  }
}

async function openSource(source: CollectionSource): Promise<void> {
  selectedSource.value = source
  await loadHistory(source)
}

async function openTask(task: CollectionTask): Promise<void> {
  if (canViewTask.value) {
    try {
      selectedTask.value = await fetchCollectionTask(task.id)
      return
    }
    catch {
      selectedTask.value = task
      return
    }
  }
  selectedTask.value = task
}

const toggleAction = useConfirmedCrudAction<CollectionSource, CollectionSource>({
  action: async (source) => source.enabled
    ? disableCollectionSource(source.id)
    : enableCollectionSource(source.id),
  confirm: source => ({
    title: source.enabled ? '停用采集来源' : '启用采集来源',
    content: source.enabled
      ? `停用「${source.name}」后将不再自动采集。`
      : `启用「${source.name}」后将按固定周期采集，新资料仍需确认入库。`,
  }),
  successMessage: (_payload, result) => result.enabled ? '已启用' : '已停用',
  onSuccess: async () => {
    await load()
    if (selectedSource.value) {
      const next = sources.value.find(item => item.id === selectedSource.value?.id)
      if (next) {
        selectedSource.value = next
      }
    }
  },
})

const importAction = useConfirmedCrudAction<CollectionTask, { knowledgeDocumentId: string }>({
  action: async (task) => importCollectionTaskToKnowledge(task.id),
  confirm: task => ({
    title: '确认入库',
    content: `将「${task.name}」入库为知识库，并进入解析流程。知识库名称使用采集名称。`,
  }),
  successMessage: '已入库，正在进入知识库解析流程',
  onSuccess: async (result) => {
    if (selectedSource.value) {
      await loadHistory(selectedSource.value)
    }
    selectedTask.value = null
    emit('openKnowledge', result.knowledgeDocumentId)
  },
})

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', ellipsis: true, minWidth: 180, title: '来源名称' },
  { colKey: 'sourceUrl', ellipsis: true, minWidth: 240, title: '网址' },
  {
    colKey: 'skillId',
    minWidth: 140,
    title: '绑定 Skill',
    cell: (_, { row }) => skillName((row as CollectionSource).skillId),
  },
  {
    colKey: 'enabled',
    minWidth: 80,
    title: '状态',
    cell: (_, { row }) => h(AppStatusTag, {
      label: (row as CollectionSource).enabled ? '启用' : '停用',
      status: (row as CollectionSource).enabled ? 'success' : 'disabled',
    }),
  },
  {
    colKey: 'lastRunAt',
    minWidth: 160,
    title: '最近运行',
    cell: (_, { row }) => {
      const entity = row as CollectionSource
      const value = entity.lastRunAt ?? entity.lastCollectedAt
      return value ? formatDate(new Date(value), 'YYYY-MM-DD HH:mm') : '尚未运行'
    },
  },
  {
    colKey: 'recordTotal',
    minWidth: 100,
    title: '累计数据',
    cell: (_, { row }) => {
      const total = recordTotals.value[(row as CollectionSource).id]
      return total === undefined ? '—' : String(total)
    },
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as CollectionSource
  const actions: AppTableAction[] = []
  if (canViewSource.value) {
    actions.push({ key: 'view', label: '查看', handler: () => void openSource(entity) })
  }
  if (canUpdate.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => createDrawer.openEdit(entity) })
  }
  if (canToggle.value) {
    actions.push({
      key: 'toggle',
      label: entity.enabled ? '停用' : '启用',
      loading: toggleAction.running.value,
      handler: () => toggleAction.run(entity),
    })
  }
  return actions
}

</script>

<template>
  <div class="collection-auto-panel">
    <AppDataTable
      :columns="columns"
      :data="sources"
      empty-description="可新增第一个自动采集来源"
      empty-title="暂无采集来源"
      :error-description="errorDescription"
      :operations-width="140"
      :show-pagination="false"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="sources.length"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canCreate" theme="primary" @click="createDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增来源
        </t-button>
        <t-button v-if="canManageSkills" theme="default" variant="outline" @click="skillDrawerVisible = true">
          Skill 关键词
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :form-data="createDrawer.formData"
      :mode="createDrawer.mode.value"
      :rules="createRules"
      :submitting="createDrawer.isSubmitting.value"
      title="采集来源"
      :visible="createDrawer.visible.value"
      width="min(520px, 92vw)"
      @cancel="createDrawer.close"
      @submit="createDrawer.submit"
      @update:visible="createDrawer.setVisible"
    >
      <t-form-item label="来源名称" name="name" required-mark>
        <t-input v-model="createDrawer.formData.name" maxlength="160" placeholder="如：安徽标准平台" />
      </t-form-item>
      <t-form-item label="来源地址" name="sourceUrl" required-mark>
        <t-input v-model="createDrawer.formData.sourceUrl" maxlength="2000" placeholder="https://…" />
      </t-form-item>
      <t-form-item label="Skill" name="skillId">
        <t-select
          v-model="createDrawer.formData.skillId"
          clearable
          :options="skillOptions"
          placeholder="绑定采集 Skill"
        />
      </t-form-item>
      <t-form-item v-if="createDrawer.mode.value === 'create'" label="状态" name="enabled">
        <t-radio-group
          v-model="createDrawer.formData.enabled"
          :options="[
            { label: '启用', value: true },
            { label: '停用', value: false },
          ]"
        />
      </t-form-item>
    </AppCrudFormDialog>

    <CollectionSourceDrawer
      :history="history"
      :history-error="historyError"
      :history-status="historyStatus"
      :source="selectedSource"
      :visible="selectedSource !== null"
      @close="selectedSource = null"
      @open-task="openTask"
      @retry="selectedSource && loadHistory(selectedSource)"
    />

    <CollectionSkillDrawer
      :visible="skillDrawerVisible"
      @changed="load"
      @close="skillDrawerVisible = false"
    />

    <CollectionTaskDrawer
      :importing="importAction.running.value"
      :task="selectedTask"
      :visible="selectedTask !== null"
      @close="selectedTask = null"
      @import="importAction.run"
      @open-knowledge="emit('openKnowledge', $event)"
    />
  </div>
</template>

<style scoped>
.collection-auto-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}
</style>
