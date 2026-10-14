<script setup lang="ts">
import type { ApiEnvelope, ApiPage, MyReportItem } from '@/api/types'
import type { ReportListViewItem } from '@/utils/aiReportTask'
import { onBeforeUnmount } from 'vue'
import { reportApi } from '@/api/modules/reports'
import ReportListCard from '@/components/report/ReportListCard.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useAuthStore } from '@/store/auth'
import { useReportTypeStore } from '@/store/reportTypes'
import { readReportListStatus, reportErrorMessage } from '@/utils/aiReportTask'

definePage({
  name: 'reports',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    enablePullDownRefresh: true,
  },
})

const PAGE_SIZE = 20

const route = useRoute()
const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()

const filterProjectId = computed(() => String(route.query.projectId || route.params.projectId || ''))
const items = ref<ReportListViewItem[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('loading')
const page = ref(1)
const total = ref(0)
const loadingMore = ref(false)
const loadMoreFailed = ref(false)
const errorMessage = ref('')
const auth = useAuthStore()
let visible = false
let revision = 0

const canLoadMore = computed(() => items.value.length < total.value)
const pageTitle = computed(() => filterProjectId.value ? '项目报告' : '我的报告')

onShow(() => {
  visible = true
  if (requireLogin({ showToast: false })) {
    void useReportTypeStore().ensureLoaded()
    void reload()
  }
})

function stopPage() {
  visible = false
  revision++
  loadingMore.value = false
}
onHide(stopPage)
onUnload(stopPage)
onBeforeUnmount(stopPage)

watch([filterProjectId, () => auth.user?.id], () => {
  revision++
  items.value = []
  loadingMore.value = false
  if (visible && requireLogin({ showToast: false }))
    void reload()
})

function requestContext(sequence: number, projectId: string, userId: string | undefined) {
  return () => visible && revision === sequence && filterProjectId.value === projectId && auth.user?.id === userId
}

onPullDownRefresh(async () => {
  if (requireLogin({ showToast: false })) {
    await reload()
  }
  uni.stopPullDownRefresh()
})

onReachBottom(() => {
  void loadMore()
})

async function requestPage(targetPage: number) {
  return await reportApi.listMy({
    page: targetPage,
    pageSize: PAGE_SIZE,
    projectId: filterProjectId.value || undefined,
  }).send() as ApiEnvelope<ApiPage<MyReportItem>>
}

async function reload() {
  const sequence = ++revision
  const current = requestContext(sequence, filterProjectId.value, auth.user?.id)
  status.value = 'loading'
  loadingMore.value = false
  loadMoreFailed.value = false
  errorMessage.value = ''
  try {
    const response = await requestPage(1)
    if (!current())
      return
    items.value = response.data?.items || []
    total.value = response.data?.total || 0
    page.value = 1
    status.value = 'success'
    const enriched = await readReportListStatus(items.value, async id => (await reportApi.getDetail(id).send(true)).data, current)
    if (current()) {
      const indexed = new Map(enriched.map(item => [item.id, item]))
      items.value = items.value.map(item => indexed.get(item.id) ?? item)
    }
  }
  catch (error) {
    if (current()) {
      errorMessage.value = reportErrorMessage(error)
      status.value = 'error'
    }
  }
}

async function loadMore() {
  if (!visible || status.value !== 'success' || loadingMore.value || !canLoadMore.value) {
    return
  }
  loadingMore.value = true
  loadMoreFailed.value = false
  const nextPage = page.value + 1
  const current = requestContext(revision, filterProjectId.value, auth.user?.id)
  try {
    const response = await requestPage(nextPage)
    if (!current())
      return
    const nextItems = response.data?.items || []
    const indexed = new Map(items.value.map(item => [item.id, item]))
    nextItems.forEach(item => indexed.set(item.id, item))
    items.value = [...indexed.values()]
    total.value = response.data?.total || total.value
    page.value = nextPage
    const enriched = await readReportListStatus(nextItems, async id => (await reportApi.getDetail(id).send(true)).data, current)
    if (current()) {
      const updated = new Map(enriched.map(item => [item.id, item]))
      items.value = items.value.map(item => updated.get(item.id) ?? item)
    }
  }
  catch (error) {
    if (current()) {
      errorMessage.value = reportErrorMessage(error)
      loadMoreFailed.value = true
    }
  }
  finally {
    if (current())
      loadingMore.value = false
  }
}

function openReport(item: MyReportItem) {
  router.push({ name: 'report-detail', params: { id: item.id } })
}

function openProject(projectId: string) {
  router.push({ name: 'project-detail', params: { id: projectId } })
}
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar

      safe-area-inset-top left-arrow placeholder fixed
      :title="pageTitle"
      @click-left="goBack"
    />

    <view class="app-enter reports-page box-border px-4 py-4 pb-8">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-16">
        <wd-loading size="48rpx" color="var(--app-action-primary)" />
        <view class="app-muted mt-3 text-3">
          正在加载报告
        </view>
      </view>

      <view v-else-if="status === 'error'" class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center">
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          报告加载失败
        </text>
        <text class="app-muted mt-1 text-2.5">
          {{ errorMessage || '请检查网络后重试' }}
        </text>
        <wd-button size="small" custom-class="mt-4!" @click="reload">
          重新加载
        </wd-button>
      </view>

      <view v-else-if="!items.length" class="app-panel-flat py-12">
        <wd-empty icon="content" :tip="filterProjectId ? '当前项目还没有报告' : '暂无报告，可在对话中生成'" />
      </view>

      <template v-else>
        <ReportListCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          @open="openReport"
          @open-project="openProject"
        />
        <view class="app-muted flex items-center justify-center py-5 text-2.5">
          <template v-if="loadingMore">
            <wd-loading size="30rpx" color="var(--app-action-primary)" />
            <text class="ml-2">
              加载更多报告
            </text>
          </template>
          <text v-else-if="loadMoreFailed" class="app-danger-text" @click="loadMore">
            加载失败，点击重试
          </text>
          <text v-else-if="canLoadMore">
            继续上拉加载
          </text>
          <text v-else>
            已显示全部 {{ total }} 份报告
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.reports-page {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}
</style>
