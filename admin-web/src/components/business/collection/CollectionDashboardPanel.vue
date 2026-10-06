<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import AppChart from '@/components/chart/AppChart.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppMetricCard from '@/components/ui/AppMetricCard.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { createLineOption } from '@/charts/options/line'
import {
  fetchCollectionDashboard,
  fetchCollectionRecords,
  fetchCollectionSources,
  fetchCollectionTrends,
} from '@/api/modules/collection'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useChartTheme } from '@/composables/useChartTheme'
import { useCrudList } from '@/composables/useCrudList'
import type { CollectionDashboardSummary, CollectionRecord, CollectionTrendGranularity } from '@/types/collection'
import { formatDate } from '@/utils/day'

const { tokens } = useChartTheme()

const summary = ref<CollectionDashboardSummary>({ thisMonth: 0, thisYear: 0, today: 0, total: 0 })
const summaryStatus = ref<'loading' | 'ready' | 'error'>('loading')
const summaryError = ref<unknown>(null)
const granularity = ref<CollectionTrendGranularity>('day')
const trendItems = ref<Array<{ period: string, count: number }>>([])
const trendStatus = ref<'loading' | 'ready' | 'error'>('loading')
const selectedRecord = ref<CollectionRecord | null>(null)
const sources = ref<Array<{ label: string, value: string }>>([])

const list = useCrudList<CollectionRecord, { sourceId: string, keyword: string, from: string, to: string }>({
  createQuery: () => ({ from: '', keyword: '', sourceId: '', to: '' }),
  fetcher: async ({ query, page, pageSize, signal }) => {
    const result = await fetchCollectionRecords({
      keyword: query.keyword.trim() || undefined,
      page,
      pageSize,
      sourceId: query.sourceId || undefined,
    }, signal)
    const from = query.from ? Date.parse(query.from) : null
    const to = query.to ? Date.parse(query.to) : null
    if (!from && !to) {
      return result
    }
    const items = result.items.filter((item) => {
      const collected = Date.parse(item.collectedAt)
      if (from && collected < from) return false
      if (to && collected > to) return false
      return true
    })
    return { ...result, items }
  },
  immediate: true,
  rowKey: 'id',
})

const trendOption = computed(() => {
  if (trendItems.value.length === 0) {
    return null
  }
  return createLineOption({
    categories: trendItems.value.map(item => item.period),
    series: [{ data: trendItems.value.map(item => item.count), name: '采集量' }],
    tokens: tokens.value,
  })
})

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'title', ellipsis: true, minWidth: 220, title: '标题' },
  {
    colKey: 'sourceId',
    minWidth: 140,
    title: '来源',
    cell: (_, { row }) => sources.value.find(item => item.value === (row as CollectionRecord).sourceId)?.label || '—',
  },
  {
    colKey: 'publishedAt',
    minWidth: 160,
    title: '发布时间',
    cell: (_, { row }) => {
      const value = (row as CollectionRecord).publishedAt
      return value ? formatDate(new Date(value), 'YYYY-MM-DD HH:mm') : '—'
    },
  },
  {
    colKey: 'collectedAt',
    minWidth: 160,
    title: '采集时间',
    cell: (_, { row }) => formatDate(new Date((row as CollectionRecord).collectedAt), 'YYYY-MM-DD HH:mm'),
  },
  {
    colKey: 'keywordsJson',
    ellipsis: true,
    minWidth: 180,
    title: '命中关键词',
    cell: (_, { row }) => ((row as CollectionRecord).keywordsJson ?? []).join('、') || '—',
  },
]

async function loadSummary(): Promise<void> {
  summaryStatus.value = 'loading'
  summaryError.value = null
  try {
    summary.value = await fetchCollectionDashboard()
    summaryStatus.value = 'ready'
  }
  catch (cause) {
    summaryError.value = cause
    summaryStatus.value = 'error'
  }
}

async function loadTrends(): Promise<void> {
  trendStatus.value = 'loading'
  try {
    const result = await fetchCollectionTrends(granularity.value)
    trendItems.value = result.items
    trendStatus.value = 'ready'
  }
  catch {
    trendStatus.value = 'error'
  }
}

async function loadSources(): Promise<void> {
  try {
    const result = await fetchCollectionSources()
    sources.value = result.items.map(item => ({ label: item.name, value: item.id }))
  }
  catch {
    sources.value = []
  }
}

watch(granularity, () => {
  void loadTrends()
})

onMounted(() => {
  void loadSummary()
  void loadTrends()
  void loadSources()
})
</script>

<template>
  <div class="collection-dashboard">
    <section class="collection-dashboard__metrics" aria-label="采集总量">
      <AppErrorState
        v-if="summaryStatus === 'error'"
        :description="summaryError ? normalizeFeedbackError(summaryError).message : '请检查网络连接后重试'"
        title="采集统计加载失败"
        @action="loadSummary"
      />
      <template v-else>
        <AppMetricCard :loading="summaryStatus === 'loading'" label="累计采集" :value="summary.total" />
        <AppMetricCard :loading="summaryStatus === 'loading'" label="今日新增" :value="summary.today" />
        <AppMetricCard :loading="summaryStatus === 'loading'" label="本月新增" :value="summary.thisMonth" />
        <AppMetricCard :loading="summaryStatus === 'loading'" label="今年新增" :value="summary.thisYear" />
      </template>
    </section>

    <t-card title="采集趋势">
      <t-radio-group v-model="granularity" class="mb-3" variant="default-filled">
        <t-radio-button value="day">日</t-radio-button>
        <t-radio-button value="month">月</t-radio-button>
        <t-radio-button value="year">年</t-radio-button>
      </t-radio-group>
      <AppChart
        :error="trendStatus === 'error'"
        :loading="trendStatus === 'loading'"
        :option="trendOption"
        empty-text="暂无趋势数据"
        @retry="loadTrends"
      />
    </t-card>

    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="来源">
        <t-select v-model="list.query.sourceId" clearable :options="sources" placeholder="全部来源" />
      </t-form-item>
      <t-form-item label="关键词">
        <t-input v-model="list.query.keyword" clearable placeholder="标题或网址" />
      </t-form-item>
      <t-form-item label="采集时间">
        <t-date-range-picker
          :value="[list.query.from, list.query.to].filter(Boolean)"
          allow-input
          clearable
          @change="(value: unknown) => {
            const range = Array.isArray(value) ? value : []
            list.query.from = typeof range[0] === 'string' ? range[0] : ''
            list.query.to = typeof range[1] === 'string' ? range[1] : ''
          }"
        />
      </t-form-item>
    </AppSearchPanel>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="采集完成后会在此展示结构化记录"
      empty-title="暂无采集记录"
      :error-description="list.error.value ? normalizeFeedbackError(list.error.value).message : '请检查网络连接后重试'"
      :page-size="list.pageSize.value"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="list.changePage"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #operations="{ row }">
        <t-button size="small" theme="primary" variant="text" @click="selectedRecord = row as CollectionRecord">
          查看
        </t-button>
      </template>
    </AppDataTable>

    <t-drawer
      :footer="false"
      header="采集记录"
      size="min(520px, 92vw)"
      :visible="selectedRecord !== null"
      @close="selectedRecord = null"
    >
      <dl v-if="selectedRecord" class="record-detail">
        <div><dt>标题</dt><dd>{{ selectedRecord.title }}</dd></div>
        <div>
          <dt>网址</dt>
          <dd>
            <a :href="selectedRecord.url" rel="noopener noreferrer" target="_blank">{{ selectedRecord.url }}</a>
          </dd>
        </div>
        <div><dt>命中关键词</dt><dd>{{ (selectedRecord.keywordsJson ?? []).join('、') || '—' }}</dd></div>
        <div><dt>摘要</dt><dd>{{ selectedRecord.summary || '—' }}</dd></div>
      </dl>
    </t-drawer>
  </div>
</template>

<style scoped>
.collection-dashboard,
.record-detail {
  display: grid;
  gap: var(--td-size-4);
}

.collection-dashboard__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-size-3);
}

.collection-dashboard__metrics :deep(.app-error-state) {
  grid-column: 1 / -1;
}

.record-detail {
  margin: 0;
}

.record-detail dt {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.record-detail dd {
  margin: var(--td-size-1) 0 0;
  color: var(--td-text-color-primary);
  word-break: break-all;
}

.record-detail a {
  color: var(--td-brand-color);
}

@media (max-width: 960px) {
  .collection-dashboard__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
