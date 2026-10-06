<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ProjectRecord } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import ProjectVisibilityBadge from '@/components/project/ProjectVisibilityBadge.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useSelectableDepartments } from '@/composables/useSelectableDepartments'

definePage({
  name: 'public-projects',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    enablePullDownRefresh: true,
  },
})

const PAGE_SIZE = 10

const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin, isAuthenticated } = useAuthGate()
const { load: loadDepartments, nameOf } = useSelectableDepartments()

const items = ref<ProjectRecord[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('loading')
const page = ref(1)
const total = ref(0)
const loadingMore = ref(false)
const loadMoreFailed = ref(false)
const canLoadMore = computed(() => items.value.length < total.value)

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadDepartments()
  void reload()
})

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
  return await projectApi.getPublic({
    page: targetPage,
    pageSize: PAGE_SIZE,
  }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
}

async function reload() {
  status.value = 'loading'
  loadMoreFailed.value = false
  try {
    const response = await requestPage(1)
    items.value = response.data?.items || []
    total.value = response.data?.total || 0
    page.value = 1
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

async function loadMore() {
  if (status.value !== 'success' || loadingMore.value || !canLoadMore.value) {
    return
  }

  loadingMore.value = true
  loadMoreFailed.value = false
  try {
    const response = await requestPage(page.value + 1)
    items.value = [...items.value, ...(response.data?.items || [])]
    total.value = response.data?.total || total.value
    page.value += 1
  }
  catch {
    loadMoreFailed.value = true
  }
  finally {
    loadingMore.value = false
  }
}

function openProject(id: string) {
  if (!requireLogin()) {
    return
  }
  router.push({ name: 'project-detail', params: { id } })
}

function departmentNameOf(project: ProjectRecord) {
  return nameOf(project.visibleDepartmentId, project.visibleDepartmentName)
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
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      placeholder
      safe-area-inset-top
      left-arrow
      :fixed="true"
      title="公开项目"
      @click-left="goBack"
    />

    <view class="public-projects-page box-border px-4 pb-8 pt-3">
      <view v-if="status === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <text class="app-tertiary text-3">
          正在加载公开项目
        </text>
      </view>

      <view
        v-else-if="status === 'error' || !isAuthenticated"
        class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center"
      >
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          {{ isAuthenticated ? '公开项目加载失败' : '登录后查看公开项目' }}
        </text>
        <wd-button v-if="isAuthenticated" size="small" plain custom-class="mt-4!" @click="reload">
          重新加载
        </wd-button>
      </view>

      <view v-else-if="!items.length" class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center">
        <wd-empty tip="暂无公开或部门可见项目">
          <template #icon>
            <wd-icon name="search" size="48rpx" color="var(--app-action-primary)" />
          </template>
        </wd-empty>
      </view>

      <template v-else>
        <view class="public-projects-summary mb-2 flex items-center justify-between px-1">
          <text>公开 / 部门可见项目</text>
          <text>共 {{ total }} 个</text>
        </view>

        <view
          v-for="project in items"
          :key="project.id"
          class="project-row app-pressable mb-2 flex items-center gap-3"
          @click="openProject(project.id)"
        >
          <view class="min-w-0 flex-1">
            <view class="flex items-center gap-2">
              <text class="project-row__name truncate">
                {{ project.name }}
              </text>
              <ProjectVisibilityBadge
                class="shrink-0"
                :visibility="project.visibility"
                :department-name="departmentNameOf(project)"
                :include-child-departments="project.includeChildDepartments"
              />
            </view>
            <view class="project-row__meta mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <text>更新于 {{ formatTime(project.updatedAt) }}</text>
              <text v-if="!project.canManage">
                只读
              </text>
            </view>
          </view>
          <wd-icon name="arrow-right" size="30rpx" color="var(--app-text-tertiary)" />
        </view>

        <view class="mt-3 py-3 text-center">
          <text v-if="loadingMore" class="app-tertiary text-2.5">
            正在加载更多
          </text>
          <text v-else-if="loadMoreFailed" class="app-primary-text app-pressable text-2.5" @click="loadMore">
            加载失败，点击重试
          </text>
          <text v-else-if="!canLoadMore" class="app-tertiary text-2.5">
            没有更多项目了
          </text>
        </view>
      </template>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.public-projects-page {
  width: 100%;
  max-width: 750px;
  margin: 0 auto;
}

.public-projects-summary {
  color: var(--app-text-tertiary);
  font-size: 24rpx;
}

.project-row {
  min-height: 144rpx;
  padding: 0 28rpx;
  border-radius: var(--app-radius-sm);
  background: var(--app-bg-surface);
}

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
</style>
