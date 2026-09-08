<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeCrawlerSource, KnowledgeCrawlerSourceInput, KnowledgeDocType } from '@/types/knowledge'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, ref } from 'vue'
import {
  createKnowledgeCrawlerSource,
  deleteKnowledgeCrawlerSource,
  fetchKnowledgeCrawlerSources,
  runKnowledgeCrawlerSource,
  updateKnowledgeCrawlerSource,
} from '@/api/modules/knowledge'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import {

  knowledgeDocTypes,
} from '@/types/knowledge'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:crawler:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:knowledge:crawler:edit'] }))
const canRun = computed(() => canAccess({ permissions: ['system:knowledge:crawler:run'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:crawler:remove'] }))

const feedback = useAppFeedback()

const sources = ref<KnowledgeCrawlerSource[]>([])
const isLoading = ref(false)
const error = ref<unknown>(null)

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const result = await fetchKnowledgeCrawlerSources({})
    sources.value = result.items
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

const drawer = useCrudDrawer<KnowledgeCrawlerSourceInput, KnowledgeCrawlerSource>({
  createForm: () => ({ name: '', baseUrl: '', downloadUrlPattern: '', docType: 'OTHER', enabled: true, operatorRemark: '' }),
  editForm: entity => ({
    name: entity.name,
    baseUrl: entity.baseUrl,
    downloadUrlPattern: entity.downloadUrlPattern,
    docType: entity.docType,
    enabled: entity.enabled,
    operatorRemark: entity.operatorRemark ?? '',
  }),
  submit: async ({ mode, data, entity }) => {
    if (mode === 'create') {
      return (await createKnowledgeCrawlerSource(data)).source
    }
    return (await updateKnowledgeCrawlerSource(entity!.id, data)).source
  },
  onSuccess: () => load(),
})

const deleteAction = useConfirmedCrudAction<KnowledgeCrawlerSource, unknown>({
  action: async (row) => {
    await deleteKnowledgeCrawlerSource(row.id)
  },
  confirm: row => ({ title: '删除抓取源', content: `确定删除「${row.name}」？`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})

const runAction = useConfirmedCrudAction<KnowledgeCrawlerSource, string>({
  action: async (row) => {
    const result = await runKnowledgeCrawlerSource(row.id)
    return result.message
  },
  confirm: row => ({ title: '手动触发抓取', content: `立即对「${row.name}」执行一次抓取任务？` }),
  successMessage: (_payload, result) => result,
})

async function toggleEnabled(row: KnowledgeCrawlerSource): Promise<void> {
  try {
    await updateKnowledgeCrawlerSource(row.id, { enabled: !row.enabled })
    await feedback.message('success', row.enabled ? '已停用' : '已启用')
    await load()
  }
  catch (cause) {
    await feedback.messageError(cause)
  }
}

const errorDescription = computed(() => error.value
  ? normalizeFeedbackError(error.value).message
  : '请检查网络连接后重试')

const docTypeLabel: Record<KnowledgeDocType, string> = {
  SPECIFICATION: '产品规范',
  DETAIL_ATLAS: '图集',
  STANDARD: '标准',
  APPLICATION_GUIDE: '应用指南',
  MATERIAL_COMPARISON: '材料对比',
  COMPANY_PROFILE: '企业资料',
  THERMAL_FORMULA: '热工公式',
  OTHER: '其他',
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-src-name' }, row.name),
    h('div', { class: 'vicp-src-url' }, row.baseUrl),
  ]), colKey: 'name', minWidth: 260, title: '抓取源' },
  { cell: (_, { row }) => docTypeLabel[row.docType as KnowledgeDocType] ?? row.docType, colKey: 'docType', minWidth: 100, title: '数据类型' },
  { cell: (_, { row }) => (row.enabled ? '启用' : '停用'), colKey: 'enabled', minWidth: 70, title: '状态' },
  {
    cell: (_, { row }) => {
      const entity = row as KnowledgeCrawlerSource
      return h('div', { class: 'vicp-src-crawl' }, [
        h('span', {}, entity.lastCrawledAt ? formatDate(new Date(entity.lastCrawledAt), 'MM-DD HH:mm') : '未抓取'),
        entity.lastCrawlStatus
          ? h(AppStatusTag, {
              label: entity.lastCrawlStatus === 'SUCCESS' ? '成功' : '失败',
              status: entity.lastCrawlStatus === 'SUCCESS' ? 'success' : 'error',
            })
          : null,
      ])
    },
    colKey: 'lastCrawledAt',
    minWidth: 140,
    title: '最近抓取',
  },
  {
    cell: (_, { row }) => {
      const entity = row as KnowledgeCrawlerSource
      if (entity.lastCrawlStatus === 'FAILED' && entity.lastErrorMessage) {
        return h('span', { class: 'vicp-src-error', title: entity.lastErrorMessage }, entity.lastErrorMessage)
      }
      return entity.operatorRemark || '—'
    },
    colKey: 'lastErrorMessage',
    ellipsis: true,
    minWidth: 180,
    title: '失败原因 / 备注',
  },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt), 'YYYY-MM-DD'), colKey: 'createdAt', minWidth: 110, title: '创建时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeCrawlerSource
  const actions: AppTableAction[] = []
  if (canEdit.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
    actions.push({
      key: 'toggle',
      label: entity.enabled ? '停用' : '启用',
      handler: () => void toggleEnabled(entity),
    })
  }
  if (canRun.value) {
    actions.push({
      key: 'run',
      label: '抓取',
      loading: runAction.running.value,
      handler: () => runAction.run(entity),
    })
  }
  if (canRemove.value) {
    actions.push({
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
      handler: () => deleteAction.run(entity),
    })
  }
  return actions
}

onMounted(load)
</script>

<template>
  <AppPage title="知识抓取源" description="定期抓取外部标准/图集来源的配置；「抓取」按钮手动触发一次抓取任务。">
    <AppDataTable
      :columns="columns"
      :data="sources"
      empty-description="可新增第一个抓取源"
      empty-title="暂无抓取源"
      :error-description="errorDescription"
      :operations-width="200"
      :show-pagination="false"
      row-key="id"
      :status="isLoading ? 'loading' : error ? 'error' : 'ready'"
      :total="sources.length"
      @refresh="load"
      @retry="load"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增抓取源
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="1"
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '新增抓取源' : '编辑抓取源'"
      :visible="drawer.visible.value"
      width="min(560px, 92vw)"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="名称" name="name" required-mark>
        <t-input v-model="drawer.formData.name" maxlength="120" placeholder="如：住建部标准全文公开" />
      </t-form-item>
      <t-form-item label="基础地址" name="baseUrl" required-mark>
        <t-input v-model="drawer.formData.baseUrl" maxlength="500" placeholder="https://…" />
      </t-form-item>
      <t-form-item label="下载地址模式" name="downloadUrlPattern" required-mark>
        <t-input v-model="drawer.formData.downloadUrlPattern" maxlength="500" placeholder="匹配附件下载链接的正则/模式" />
      </t-form-item>
      <t-form-item label="文档类型" name="docType">
        <t-select
          v-model="drawer.formData.docType"
          :options="knowledgeDocTypes.map((value) => ({ label: docTypeLabel[value], value }))"
        />
      </t-form-item>
      <t-form-item label="人工备注" name="operatorRemark">
        <t-textarea
          v-model="drawer.formData.operatorRemark"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :maxlength="1000"
          placeholder="记录来源可信度、抓取频率约定等运营信息（选填）"
        />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-src-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-src-url {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}
.vicp-src-crawl {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.vicp-src-error {
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
}
</style>
