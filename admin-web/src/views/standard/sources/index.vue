<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { StandardSource, StandardSourceInput } from '@/types/standard'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import {
  createStandardSource,
  deleteStandardSource,
  fetchStandardSources,
  runStandardSourceCrawl,
  updateStandardSource,
} from '@/api/modules/standard'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { useCrudDrawer } from '@/composables/useCrudDrawer'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { formatDate } from '@/utils/day'

const { canAccess } = usePermissionAccess()
const canAdd = computed(() => canAccess({ permissions: ['system:standard:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:standard:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:standard:remove'] }))
const canRun = computed(() => canAccess({ permissions: ['system:standard:run'] }))

const list = useCrudList<StandardSource, { enabled?: boolean | '' | 'all', keyword: string }>({
  createQuery: () => ({ enabled: undefined, keyword: '' }),
  fetcher: async ({ query, signal }) => {
    const items = await fetchStandardSources(
      !query.enabled || query.enabled === 'all' ? {} : { enabled: query.enabled },
      signal,
    )
    const keyword = query.keyword.trim()
    const filtered = keyword
      ? items.filter(item => item.provinceName.includes(keyword) || item.officialDomain.includes(keyword))
      : items
    return { items: filtered, total: filtered.length, page: 1, pageSize: filtered.length }
  },
  immediate: true,
  rowKey: 'id',
})

const drawer = useCrudDrawer<StandardSourceInput, StandardSource>({
  createForm: () => ({
    provinceCode: '',
    provinceName: '',
    officialDomain: '',
    crawlScope: 'today',
    enabled: true,
    keywords: { titleKeywords: [], excludeKeywords: [] },
    operatorRemark: '',
  }),
  editForm: entity => ({
    provinceCode: entity.provinceCode,
    provinceName: entity.provinceName,
    officialDomain: entity.officialDomain,
    crawlScope: entity.crawlScope,
    enabled: entity.enabled,
    keywords: {
      titleKeywords: [...entity.keywords.titleKeywords],
      excludeKeywords: [...entity.keywords.excludeKeywords],
    },
    operatorRemark: entity.operatorRemark ?? '',
  }),
  submit: async ({ mode, data, entity }) => {
    return mode === 'create'
      ? await createStandardSource(data)
      : await updateStandardSource(entity!.id, data)
  },
  onSuccess: () => list.refresh(),
})

const deleteAction = useConfirmedCrudAction<StandardSource, unknown>({
  action: row => deleteStandardSource(row.id),
  confirm: row => ({ title: '删除来源', content: `确定删除「${row.provinceName}」采集来源？`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => list.refresh(),
})

const crawlAction = useConfirmedCrudAction<StandardSource, unknown>({
  action: row => runStandardSourceCrawl(row.id, 'today'),
  confirm: row => ({ title: '触发抓取', content: `确定立即抓取「${row.provinceName}」今日更新？` }),
  successMessage: '已触发抓取',
  onSuccess: () => list.refresh(),
})

const errorDescription = computed(() => list.error.value
  ? normalizeFeedbackError(list.error.value).message
  : '请检查网络连接后重试')

const enabledOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: true },
  { label: '停用', value: false },
]

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => h('div', [
    h('div', { class: 'vicp-src-province' }, row.provinceName),
    h('div', { class: 'vicp-src-code' }, row.provinceCode),
  ]), colKey: 'provinceName', minWidth: 160, title: '地区' },
  { cell: (_, { row }) => h('a', { class: 'vicp-src-domain', href: row.officialDomain, target: '_blank', rel: 'noreferrer' }, row.officialDomain), colKey: 'officialDomain', minWidth: 260, title: '官网域名' },
  { cell: (_, { row }) => (row.enabled ? '启用' : '停用'), colKey: 'enabled', minWidth: 70, title: '是否启用' },
  {
    cell: (_, { row }) => {
      const entity = row as StandardSource
      return h('div', { class: 'vicp-src-last' }, [
        h('span', {}, entity.lastCrawledAt ? formatDate(new Date(entity.lastCrawledAt)) : '未抓取'),
        entity.lastCrawlStatus
          ? h(AppStatusTag, {
              label: entity.lastCrawlStatus === 'SUCCESS' ? '成功' : '失败',
              status: entity.lastCrawlStatus === 'SUCCESS' ? 'success' : 'error',
            })
          : null,
      ])
    },
    colKey: 'lastCrawledAt',
    minWidth: 170,
    title: '最近抓取',
  },
  {
    cell: (_, { row }) => {
      const entity = row as StandardSource
      const summary = entity.lastCrawlSummary
      if (entity.lastCrawlStatus === 'FAILED' && entity.lastErrorMessage) {
        return h('span', { class: 'vicp-src-error' }, entity.lastErrorMessage)
      }
      if (summary && (summary.new != null || summary.changed != null)) {
        const parts: string[] = []
        if (summary.new != null) {
          parts.push(`新增 ${summary.new}`)
        }
        if (summary.changed != null) {
          parts.push(`更新 ${summary.changed}`)
        }
        if (summary.failed != null && summary.failed > 0) {
          parts.push(`失败 ${summary.failed}`)
        }
        return parts.join(' / ') || '—'
      }
      return '—'
    },
    colKey: 'lastCrawlSummary',
    minWidth: 170,
    title: '最近抓到文档',
  },
  {
    cell: (_, { row }) => (row as StandardSource).operatorRemark || '—',
    colKey: 'operatorRemark',
    ellipsis: true,
    minWidth: 160,
    title: '人工备注',
  },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as StandardSource
  const actions: AppTableAction[] = []
  if (canEdit.value) {
    actions.push({ key: 'edit', label: '编辑', handler: () => drawer.openEdit(entity) })
  }
  if (canRun.value) {
    actions.push({
      key: 'crawl',
      label: '触发抓取',
      loading: crawlAction.running.value,
      handler: () => crawlAction.run(entity),
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
</script>

<template>
  <AppPage title="采集来源" description="各省住建/标准主管部门官网抓取源配置；抓取结果进入待审核队列，不自动参与合规判断。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="关键词">
          <t-input v-model="list.query.keyword" clearable placeholder="省份 / 域名" />
        </t-form-item>
        <t-form-item label="启用状态">
          <t-select v-model="list.query.enabled" :options="enabledOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="可新增第一个采集来源"
      empty-title="暂无采集来源"
      :error-description="errorDescription"
      :operations-width="220"
      :page-size="list.pageSize.value"
      :show-pagination="false"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="list.changePage"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="drawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增采集来源
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :form-data="drawer.formData"
      :mode="drawer.mode.value"
      :submitting="drawer.isSubmitting.value"
      :title="drawer.mode.value === 'create' ? '新增采集来源' : '编辑采集来源'"
      :visible="drawer.visible.value"
      width="min(720px, 92vw)"
      @cancel="drawer.close"
      @submit="drawer.submit"
      @update:visible="drawer.setVisible"
    >
      <t-form-item label="省份编码" name="provinceCode" required-mark>
        <t-input v-model="drawer.formData.provinceCode" maxlength="40" placeholder="如：110000" />
      </t-form-item>
      <t-form-item label="省份名称" name="provinceName" required-mark>
        <t-input v-model="drawer.formData.provinceName" maxlength="120" placeholder="如：北京市" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="官网域名" name="officialDomain" required-mark>
        <t-input v-model="drawer.formData.officialDomain" maxlength="255" placeholder="https://..." />
      </t-form-item>
      <t-form-item label="抓取范围" name="crawlScope">
        <t-radio-group
          v-model="drawer.formData.crawlScope"
          :options="[
            { label: '仅今日更新', value: 'today' },
            { label: '全量', value: 'all' },
          ]"
        />
      </t-form-item>
      <t-form-item label="启用" name="enabled">
        <t-switch v-model="drawer.formData.enabled" />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="人工备注" name="operatorRemark">
        <t-textarea
          v-model="drawer.formData.operatorRemark"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :maxlength="1000"
          placeholder="记录来源说明、联系渠道等运营信息（选填）"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="标题命中关键词" name="keywords.titleKeywords">
        <t-select
          v-model="drawer.formData.keywords.titleKeywords"
          :options="[]"
          allow-create
          clearable
          multiple
          placeholder="输入后回车创建，命中标题的关键词"
        />
      </t-form-item>
      <t-form-item class="vicp-form-wide" label="排除关键词" name="keywords.excludeKeywords">
        <t-select
          v-model="drawer.formData.keywords.excludeKeywords"
          :options="[]"
          allow-create
          clearable
          multiple
          placeholder="输入后回车创建，命中即排除"
        />
      </t-form-item>
      <p class="vicp-form-hint vicp-form-wide">
        栏目 URL 与提取规则的高级配置暂未开放编辑，后续批次补齐。
      </p>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.vicp-src-province {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-src-code {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-src-domain {
  color: var(--td-brand-color);
  text-decoration: none;
}
.vicp-src-last {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}
.vicp-src-error {
  color: var(--td-error-color);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-hint {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-wide {
  grid-column: 1 / -1;
}
</style>
