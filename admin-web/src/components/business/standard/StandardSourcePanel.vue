<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { StandardSource, StandardSourceInput } from '@/types/standard'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, ref } from 'vue'
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
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError, useAppFeedback } from '@/composables/useAppFeedback'
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

type CatalogRow = NonNullable<StandardSourceInput['catalogUrls']>[number]
type ExtractRuleRow = NonNullable<StandardSourceInput['extractRules']>[number]

const feedback = useAppFeedback()
const advancedCatalog = ref(false)
const advancedRules = ref(false)

const paginationOptions = [
  { label: '单页（不分页）', value: 'none' },
  { label: '网址翻页', value: 'url' },
  { label: '滚动加载', value: 'scroll' },
]

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
    catalogUrls: [],
    extractRules: [],
    keywords: { titleKeywords: [], excludeKeywords: [] },
    operatorRemark: '',
  }),
  editForm: entity => ({
    provinceCode: entity.provinceCode,
    provinceName: entity.provinceName,
    officialDomain: entity.officialDomain,
    crawlScope: entity.crawlScope,
    enabled: entity.enabled,
    catalogUrls: entity.catalogUrls.map(item => ({ ...item })),
    extractRules: entity.extractRules.map(item => ({ ...item })),
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

const catalogRows = computed<CatalogRow[]>(() => drawer.formData.catalogUrls ?? [])
const extractRuleRows = computed<ExtractRuleRow[]>(() => drawer.formData.extractRules ?? [])

function ensureCatalogRows(): CatalogRow[] {
  if (!drawer.formData.catalogUrls) {
    drawer.formData.catalogUrls = []
  }
  return drawer.formData.catalogUrls
}

function ensureExtractRules(): ExtractRuleRow[] {
  if (!drawer.formData.extractRules) {
    drawer.formData.extractRules = []
  }
  return drawer.formData.extractRules
}

function addCatalogRow(): void {
  ensureCatalogRows().push({ label: '', url: '', paginationMode: 'none' })
  advancedCatalog.value = true
}

function removeCatalogRow(index: number): void {
  ensureCatalogRows().splice(index, 1)
}

function addExtractRule(): void {
  ensureExtractRules().push({ field: '', pattern: '' })
}

function removeExtractRule(index: number): void {
  ensureExtractRules().splice(index, 1)
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value)
}

/** 抓取依赖栏目地址，提交前做业务校验，避免保存出无法抓取的来源 */
function validateSourceForm(): string | null {
  const catalogs = drawer.formData.catalogUrls ?? []
  if (catalogs.length === 0) {
    return '请至少添加一个栏目地址，系统按栏目抓取标准文档。'
  }
  for (const [index, row] of catalogs.entries()) {
    const position = `第 ${index + 1} 个栏目`
    if (!row.label || !row.label.trim()) {
      return `${position}：请填写栏目名称。`
    }
    if (!row.url || !row.url.trim()) {
      return `${position}：请填写栏目地址。`
    }
    if (!isHttpUrl(row.url.trim())) {
      return `${position}：栏目地址需为 http(s) 开头的完整链接。`
    }
    if (row.paginationMode === 'url' && (!row.pageParam || !row.pageParam.trim())) {
      return `${position}：网址翻页需填写翻页参数名（如 page）。`
    }
  }
  const rules = drawer.formData.extractRules ?? []
  for (const [index, rule] of rules.entries()) {
    if (!rule.field || !rule.field.trim() || !rule.pattern || !rule.pattern.trim()) {
      return `第 ${index + 1} 条提取规则：字段名与匹配表达式均需填写。`
    }
  }
  return null
}

function handleSubmit(): void {
  const invalid = validateSourceForm()
  if (invalid) {
    feedback.message('error', invalid)
    return
  }
  void drawer.submit()
}

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
  <div class="vicp-standard-source-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="省份 / 域名" />
      </t-form-item>
      <t-form-item label="启用状态">
        <t-select v-model="list.query.enabled" :options="enabledOptions" />
      </t-form-item>
    </AppSearchPanel>

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
      width="min(880px, 94vw)"
      @cancel="drawer.close"
      @submit="handleSubmit"
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

      <section class="vicp-form-section vicp-form-wide">
        <header class="vicp-form-section__head">
          <span class="vicp-form-section__title">栏目地址</span>
          <span class="vicp-form-section__hint">系统按栏目抓取标准文档，至少配置一个。</span>
          <t-button size="small" variant="text" @click="advancedCatalog = !advancedCatalog">
            {{ advancedCatalog ? '收起高级参数' : '展开高级参数' }}
          </t-button>
          <t-button size="small" variant="outline" @click="addCatalogRow">
            <template #icon>
              <AddIcon />
            </template>
            添加栏目
          </t-button>
        </header>

        <p v-if="catalogRows.length === 0" class="vicp-form-empty">
          尚未配置栏目地址，点击「添加栏目」录入。
        </p>

        <div v-for="(row, index) in catalogRows" :key="index" class="vicp-form-rows">
          <div class="vicp-form-row">
            <t-form-item :label="`栏目名称 ${index + 1}`" required-mark>
              <t-input v-model="row.label" maxlength="120" placeholder="如：地方标准公告" />
            </t-form-item>
            <t-form-item label="栏目地址" required-mark>
              <t-input v-model="row.url" maxlength="1000" placeholder="https://..." />
            </t-form-item>
            <t-form-item label="分页方式">
              <t-select v-model="row.paginationMode" :options="paginationOptions" />
            </t-form-item>
            <t-button class="vicp-form-row__remove" theme="danger" variant="text" @click="removeCatalogRow(index)">
              删除
            </t-button>
          </div>
          <div v-if="advancedCatalog" class="vicp-form-row vicp-form-row--advanced">
            <t-form-item label="翻页参数名">
              <t-input
                v-model="row.pageParam"
                :disabled="row.paginationMode !== 'url'"
                maxlength="80"
                placeholder="如：page"
              />
            </t-form-item>
            <t-form-item label="最多翻页数">
              <t-input-number v-model="row.pageLimit" :max="200" :min="1" placeholder="默认 10" />
            </t-form-item>
            <t-form-item label="列表选择器（CSS）">
              <t-input v-model="row.listSelector" maxlength="300" placeholder="选填" />
            </t-form-item>
            <t-form-item label="链接选择器（CSS）">
              <t-input v-model="row.itemLinkSelector" maxlength="300" placeholder="选填" />
            </t-form-item>
          </div>
        </div>
      </section>
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
      <section class="vicp-form-section vicp-form-wide">
        <header class="vicp-form-section__head">
          <span class="vicp-form-section__title">内容提取规则（选填）</span>
          <span class="vicp-form-section__hint">用于从文档正文中提取标题、文号等字段；留空时使用系统默认规则。</span>
          <t-button size="small" variant="text" @click="advancedRules = !advancedRules">
            {{ advancedRules ? '收起' : '展开' }}
          </t-button>
          <t-button size="small" variant="outline" @click="addExtractRule">
            <template #icon>
              <AddIcon />
            </template>
            添加规则
          </t-button>
        </header>

        <p v-if="!advancedRules" class="vicp-form-empty">
          已配置 {{ extractRuleRows.length }} 条规则，展开可查看与编辑。
        </p>

        <template v-else>
          <p v-if="extractRuleRows.length === 0" class="vicp-form-empty">
            暂无提取规则，点击「添加规则」录入。
          </p>
          <div v-for="(rule, index) in extractRuleRows" :key="index" class="vicp-form-row vicp-form-row--rules">
            <t-form-item :label="`字段名 ${index + 1}`" required-mark>
              <t-input v-model="rule.field" maxlength="80" placeholder="如：title" />
            </t-form-item>
            <t-form-item label="匹配表达式" required-mark>
              <t-input v-model="rule.pattern" maxlength="500" placeholder="正则表达式" />
            </t-form-item>
            <t-form-item label="修饰符">
              <t-input v-model="rule.flags" maxlength="20" placeholder="如：i" />
            </t-form-item>
            <t-button class="vicp-form-row__remove" theme="danger" variant="text" @click="removeExtractRule(index)">
              删除
            </t-button>
          </div>
        </template>
      </section>
    </AppCrudFormDialog>
  </div>
</template>

<style scoped>
.vicp-standard-source-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}
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
.vicp-form-wide {
  grid-column: 1 / -1;
}
.vicp-form-section {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}
.vicp-form-section__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2) var(--td-size-3);
}
.vicp-form-section__title {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-form-section__hint {
  flex: 1 1 240px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-empty {
  margin: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-form-rows + .vicp-form-rows {
  padding-top: var(--td-size-3);
  border-top: 1px dashed var(--td-component-stroke);
}
.vicp-form-row {
  display: grid;
  align-items: start;
  gap: var(--td-size-3);
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1.6fr) minmax(0, 0.9fr) auto;
}
.vicp-form-row--advanced {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.vicp-form-row--rules {
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) minmax(0, 0.7fr) auto;
}
.vicp-form-row__remove {
  align-self: center;
}
@media (max-width: 720px) {
  .vicp-form-row,
  .vicp-form-row--advanced,
  .vicp-form-row--rules {
    grid-template-columns: minmax(0, 1fr);
  }
  .vicp-form-row__remove {
    justify-self: start;
  }
}
</style>
