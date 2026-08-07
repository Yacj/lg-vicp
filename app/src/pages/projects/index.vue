<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ProjectRecord, ProjectVisibility } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { getPlatformInfo } from '@/services/platform'

definePage({
  name: 'projects',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
  },
})

type ProjectFilter = 'ALL' | ProjectVisibility

interface ProjectFilterOption {
  value: ProjectFilter
  label: string
}

interface ProjectPagingRef {
  reload: (animate?: boolean) => Promise<unknown>
  complete: (data?: ProjectRecord[] | false, success?: boolean) => Promise<unknown>
  completeByTotal: (data: ProjectRecord[], total: number, success?: boolean) => Promise<unknown>
  completeByError: (cause: string) => Promise<unknown>
}

const filters: ProjectFilterOption[] = [
  { value: 'ALL', label: '全部' },
  { value: 'PUBLIC', label: '公开' },
  { value: 'PRIVATE', label: '私有' },
]

const router = useRouter()
const route = useRoute()
const { requireLogin, isAuthenticated } = useAuthGate()

const initialScope = route.query.scope
const activeFilter = ref<ProjectFilter>(
  initialScope === 'public' ? 'PUBLIC' : initialScope === 'private' ? 'PRIVATE' : 'ALL',
)
const keyword = ref('')
const queryKeyword = ref('')
const projects = ref<ProjectRecord[]>([])
const paging = ref<ProjectPagingRef>()
const total = ref(0)
const pageMounted = ref(false)
const hasShown = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | undefined

// custom navigationStyle 下避开状态栏；微信端继续避开右上角胶囊。
const platformInfo = getPlatformInfo()
let projectTopInset = platformInfo.statusBarHeight
  ? `${platformInfo.statusBarHeight}px`
  : 'env(safe-area-inset-top)'

// #ifdef MP-WEIXIN
const menuButtonRect = uni.getMenuButtonBoundingClientRect()
projectTopInset = `${menuButtonRect.bottom + 4}px`
// #endif

const pageStyle = {
  '--project-top-inset': projectTopInset,
}

const pagingStyle = {
  background: 'var(--app-project-page-gradient)',
}

const searchStyle = [
  '--wot-search-padding: 12rpx 32rpx 24rpx',
  '--wot-search-light-bg: transparent',
  '--wot-search-light-block-bg: var(--app-bg-surface)',
  '--wot-search-light-cover-bg: var(--app-bg-surface)',
  '--wot-search-input-height: 72rpx',
  '--wot-search-field-padding: 0 24rpx',
  '--wot-search-block-margin-right: 0',
  '--wot-search-input-font-size: 26rpx',
  '--wot-search-input-color: var(--app-text-primary)',
  '--wot-search-placeholder-color: var(--app-text-tertiary)',
  '--wot-search-placeholder-font-size: 26rpx',
  '--wot-search-icon-color: var(--app-text-tertiary)',
  '--wot-search-clear-icon-color: var(--app-text-tertiary)',
].join(';')

const activeFilterIndex = computed(() => Math.max(filters.findIndex(item => item.value === activeFilter.value), 0))
const tabIndicatorStyle = computed(() => ({
  transform: `translateX(${activeFilterIndex.value * 100}%)`,
}))
const activeFilterLabel = computed(() => filters[activeFilterIndex.value]?.label || '全部')

const emptyTitle = computed(() => {
  if (!isAuthenticated.value) {
    return '登录后查看项目'
  }
  if (keyword.value.trim()) {
    return '没有找到匹配项目'
  }
  if (activeFilter.value === 'PUBLIC') {
    return '暂无公开项目'
  }
  if (activeFilter.value === 'PRIVATE') {
    return '暂无私有项目'
  }
  return '暂无项目'
})

watch(keyword, (value) => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }

  searchTimer = setTimeout(() => {
    searchTimer = undefined
    const normalizedKeyword = value.trim()
    if (normalizedKeyword === queryKeyword.value) {
      return
    }

    queryKeyword.value = normalizedKeyword
    if (pageMounted.value && isAuthenticated.value) {
      void paging.value?.reload()
    }
  }, 300)
})

onMounted(() => {
  pageMounted.value = true
})

onUnmounted(() => {
  if (searchTimer) {
    clearTimeout(searchTimer)
  }
})

// 初次进入由 z-paging 自动查询；从登录、新建或详情页返回时刷新当前筛选。
onShow(() => {
  if (hasShown.value && pageMounted.value && isAuthenticated.value) {
    void paging.value?.reload()
  }
  hasShown.value = true
})

async function queryProjects(pageNo: number, pageSize: number) {
  if (!isAuthenticated.value) {
    total.value = 0
    await paging.value?.complete([])
    return
  }

  try {
    const response = await projectApi.getMy({
      page: pageNo,
      pageSize,
      visibility: activeFilter.value === 'ALL' ? undefined : activeFilter.value,
      keyword: queryKeyword.value || undefined,
    }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
    const data = response.data || { items: [], total: 0 }

    total.value = data.total || 0
    await paging.value?.completeByTotal(data.items || [], total.value)
  }
  catch {
    if (pageNo === 1) {
      total.value = 0
    }
    await paging.value?.completeByError('项目加载失败，请稍后重试')
  }
}

function selectFilter(filter: ProjectFilter) {
  if (filter === activeFilter.value) {
    return
  }
  if (!requireLogin()) {
    return
  }

  activeFilter.value = filter
  void paging.value?.reload()
}

function clearSearch() {
  if (!keyword.value) {
    return
  }
  keyword.value = ''
}

function createProject() {
  if (!requireLogin()) {
    return
  }
  router.push({ name: 'project-create' })
}

function openProject(id: string) {
  if (!requireLogin()) {
    return
  }
  console.log(id)
  router.push({ name: 'project-detail', params: { id } })
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return '最近更新'
  }

  return `${date.getMonth() + 1}月${date.getDate()}日 ${date.toTimeString().slice(0, 5)}`
}
</script>

<template>
  <view class="app-page projects-page" :style="pageStyle">
    <z-paging
      ref="paging"
      v-model="projects"
      :default-page-size="10"
      :paging-style="pagingStyle"
      :use-page-scroll="true"
      loading-more-no-more-text="没有更多项目了"
      @query="queryProjects"
    >
      <template #top>
        <view class="projects-top">
          <view class="projects-top__safe" />
          <view class="projects-top__inner">
            <view class="projects-tabs relative flex items-end">
              <view
                v-for="filter in filters"
                :key="filter.value"
                class="projects-tab app-pressable flex-1 text-center"
                :class="{ 'projects-tab--active': activeFilter === filter.value }"
                @click="selectFilter(filter.value)"
              >
                <text>{{ filter.label }}</text>
              </view>
              <view class="projects-tab-indicator" :style="tabIndicatorStyle">
                <view class="projects-tab-indicator__line" />
              </view>
            </view>

            <wd-search
              v-model="keyword"
              hide-cancel
              placeholder-left
              variant="light"
              placeholder="搜索项目名称、地区或建筑类型"
              :custom-style="searchStyle"
              class="mt-2"
              @clear="clearSearch"
            />
          </view>
        </view>
      </template>

      <view v-if="projects.length" class="projects-content">
        <view class="projects-summary flex items-center justify-between">
          <text>{{ activeFilterLabel }}项目</text>
          <text>共 {{ total }} 个</text>
        </view>

        <view class="projects-list">
          <view
            v-for="project in projects"
            :key="project.id"
            class="project-row app-pressable flex items-center gap-3"
            @click="openProject(project.id)"
          >
            <view class="min-w-0 flex-1">
              <view class="flex items-center gap-2">
                <text class="project-row__name truncate">
                  {{ project.name }}
                </text>
                <text
                  class="project-visibility shrink-0"
                  :class="project.visibility === 'PUBLIC' ? 'project-visibility--public' : 'project-visibility--private'"
                >
                  {{ project.visibility === 'PUBLIC' ? '公开' : '私有' }}
                </text>
              </view>
              <view class="project-row__meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <!-- <text>{{ [project.region, project.buildingType].filter(Boolean).join(' · ') || '未填写地区与建筑类型' }}</text> -->
                <text class="project-row__divider">
                  ·
                </text>
                <text>更新于 {{ formatTime(project.updatedAt) }}</text>
              </view>
            </view>
            <wd-icon name="arrow-right" size="30rpx" color="var(--app-text-tertiary)" />
          </view>
        </view>
      </view>

      <template #empty="{ isLoadFailed }">
        <!-- <view class="projects-empty flex flex-col items-center text-center">
          <view class="projects-empty__icon flex items-center justify-center">
            <wd-icon
              :name="isLoadFailed ? 'refresh' : keyword ? 'search' : 'home'"
              size="48rpx"
              color="var(--app-action-primary)"
            />
          </view>
          <view class="projects-empty__title">
            {{ isLoadFailed ? '项目加载失败' : emptyTitle }}
          </view>
          <view class="projects-empty__description">
            {{ isLoadFailed ? '请检查网络后重新加载' : emptyDescription }}
          </view>
          <view
            class="projects-empty__action app-pressable"
            @click="handleEmptyAction(isLoadFailed)"
          >
            {{ emptyActionLabel(isLoadFailed) }}
          </view>
        </view> -->
        <wd-empty :tip="isLoadFailed ? '项目加载失败' : emptyTitle">
          <template #icon>
            <wd-icon name="search" size="48rpx" color="var(--app-action-primary)" />
          </template>
        </wd-empty>
      </template>
    </z-paging>

    <view
      class="projects-fab app-pressable flex items-center justify-center"
      role="button"
      aria-label="新建项目"
      @click="createProject"
    >
      <wd-icon name="plus" size="44rpx" color="var(--app-text-inverse)" />
    </view>
  </view>
</template>

<style lang="scss" scoped>
.projects-page {
  min-height: 100vh;
  background: var(--app-project-page-gradient);
}

.projects-top {
  // border-bottom: 1px solid var(--app-border-default);
  background: transparent;
}

.projects-top__safe {
  height: var(--project-top-inset);
}

.projects-top__inner,
.projects-content {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
}

.projects-tabs {
  height: 88rpx;
  padding: 0 48rpx;
}

.projects-tab {
  height: 88rpx;
  color: var(--app-text-tertiary);
  font-size: 30rpx;
  font-weight: 500;
  line-height: 88rpx;
}

.projects-tab--active {
  color: var(--app-text-primary);
  font-weight: 700;
}

.projects-tab-indicator {
  position: absolute;
  bottom: 0;
  left: 48rpx;
  width: calc((100% - 96rpx) / 3);
  height: 6rpx;
  pointer-events: none;
  transition: transform var(--app-transition-base) ease;
}

.projects-tab-indicator__line {
  width: 40rpx;
  height: 6rpx;
  margin: 0 auto;
  border-radius: 3rpx;
  background: var(--app-action-primary);
}

.projects-content {
  padding: 24rpx 32rpx calc(var(--app-current-tabbar-offset) + 112rpx);
}

.projects-summary {
  padding: 0 4rpx 16rpx;
  color: var(--app-text-tertiary);
  font-size: 24rpx;
}

.projects-list {

}

.project-row {
  min-height: 144rpx;
  padding:0 28rpx;
  // border-bottom: 1px solid var(--app-border-default);
  background: var(--app-bg-surface);
  border-radius: var(--app-radius-sm);
  margin-bottom: 16rpx;
}

// .project-row:last-child {
//   border-bottom: 0;
// }

.project-row__name {
  max-width: 430rpx;
  color: var(--app-text-primary);
  font-size: 30rpx;
  font-weight: 600;
  line-height: 42rpx;
}

.project-row__meta {
  color: var(--app-text-tertiary);
  font-size: 23rpx;
  line-height: 34rpx;
}

.project-row__divider {
  color: var(--app-text-disabled);
}

.project-visibility {
  padding: 4rpx 10rpx;
  border: 1px solid transparent;
  border-radius: 6rpx;
  font-size: 20rpx;
  line-height: 28rpx;
}

.project-visibility--public {
  border-color: var(--app-action-primary-soft);
  color: var(--app-action-primary);
  background: var(--app-action-primary-soft);
}

.project-visibility--private {
  border-color: var(--app-border-default);
  color: var(--app-text-tertiary);
  background: var(--app-bg-drawer);
}

.projects-empty {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
  padding: 144rpx 48rpx calc(var(--app-current-tabbar-offset) + 80rpx);
}

.projects-empty__icon {
  width: 88rpx;
  height: 88rpx;
  border: 1px solid var(--app-border-default);
  border-radius: 12rpx;
  background: var(--app-action-primary-soft);
}

.projects-empty__title {
  margin-top: 28rpx;
  color: var(--app-text-primary);
  font-size: 30rpx;
  font-weight: 600;
  line-height: 42rpx;
}

.projects-empty__description {
  margin-top: 12rpx;
  color: var(--app-text-tertiary);
  font-size: 24rpx;
  line-height: 36rpx;
}

.projects-empty__action {
  min-width: 176rpx;
  margin-top: 32rpx;
  padding: 16rpx 28rpx;
  border: 1px solid var(--app-action-primary);
  border-radius: 12rpx;
  color: var(--app-action-primary);
  font-size: 26rpx;
  line-height: 34rpx;
}

.projects-fab {
  position: fixed;
  z-index: 100;
  right: 32rpx;
  bottom: calc(var(--app-current-tabbar-offset) + 32rpx);
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: var(--app-action-primary);
  box-shadow: var(--app-shadow-float);
}

@media screen and (min-width: 751px) {
  .projects-fab {
    right: calc(50% - 343px);
  }
}
</style>
