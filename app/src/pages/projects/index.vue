<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ProjectRecord } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'projects',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '项目',
  },
})

type LoadStatus = 'idle' | 'loading' | 'success' | 'error'
type ProjectScope = 'mine' | 'public'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const { requireLogin, isAuthenticated } = useAuthGate()
const { error: showError } = useGlobalToast()

const keyword = ref('')
const activeFilter = ref<ProjectScope>(route.query.scope === 'public' ? 'public' : 'mine')

const filters = [
  { value: 'mine', label: '我的项目' },
  { value: 'public', label: '公开项目' },
] as const

const items = ref<ProjectRecord[]>([])
const status = ref<LoadStatus>('idle')
const page = ref(1)
const pageSize = 10
const total = ref(0)
const loadingMore = ref(false)

const hasMore = computed(() => items.value.length < total.value)
const canCreate = computed(() => {
  // 未登录：入口可见，点击时引导登录；已登录按后端能力位控制
  if (!isAuthenticated.value) {
    return true
  }
  return authStore.capabilities?.canCreateProject === true
})

const filteredProjects = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  if (!normalizedKeyword) {
    return items.value
  }

  return items.value.filter(project => `${project.name}${project.region ?? ''}${project.buildingType ?? ''}`.toLowerCase().includes(normalizedKeyword))
})

function loadScope(scope: ProjectScope) {
  if (scope === 'mine' && !requireLogin()) {
    return
  }
  activeFilter.value = scope
  void reload()
}

async function reload() {
  page.value = 1
  items.value = []
  total.value = 0
  status.value = 'idle'
  await loadPage(1)
}

async function loadPage(targetPage: number) {
  const scope = activeFilter.value
  if (scope === 'mine' && !authStore.isAuthenticated) {
    return
  }

  if (targetPage === 1) {
    status.value = 'loading'
  }
  else {
    loadingMore.value = true
  }

  try {
    const request = scope === 'mine' ? projectApi.getMy : projectApi.getPublic
    const response = await request({ page: targetPage, pageSize }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
    const data = response.data || { items: [], total: 0 }
    items.value = targetPage === 1 ? (data.items || []) : [...items.value, ...(data.items || [])]
    total.value = data.total || 0
    page.value = targetPage
    status.value = 'success'
  }
  catch {
    if (targetPage === 1) {
      status.value = 'error'
    }
    else {
      showError('加载更多失败，请重试')
    }
  }
  finally {
    loadingMore.value = false
  }
}

// Tab 页每次显示刷新；未登录时 mine 由登录引导兜底
onShow(() => {
  if (status.value === 'idle' || status.value === 'error') {
    void reload()
  }
})

onReachBottom(() => {
  if (status.value !== 'success' || !hasMore.value || loadingMore.value) {
    return
  }
  void loadPage(page.value + 1)
})

function createProject() {
  if (!requireLogin()) {
    return
  }
  if (authStore.capabilities?.canCreateProject === false) {
    showError('当前账号暂无新建项目权限')
    return
  }
  router.push({ name: 'project-create' })
}

function openProject(id: string) {
  if (!requireLogin()) {
    return
  }
  router.push({ name: 'project-detail', query: { id } })
}

function handleLoginPrompt() {
  requireLogin({ showToast: false })
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
  <view class="app-page app-page--immersive">
    <wd-navbar custom-class="app-navbar" safe-area-inset-top title="项目" />

    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="mb-4 flex justify-end">
        <wd-button v-if="canCreate" type="primary" size="small" icon="add" @click="createProject">
          新建项目
        </wd-button>
      </view>

      <wd-search
        v-model="keyword"
        placeholder="搜索项目名称、地区或建筑类型"
        shape="round"
        custom-class="mb-4!"
      />

      <view class="app-panel-flat mb-4 flex p-1">
        <view
          v-for="filter in filters"
          :key="filter.value"
          class="flex-1 rounded-2 py-2.5 text-center text-3.5 transition-colors"
          :class="activeFilter === filter.value ? 'bg-[var(--app-action-primary)] text-white font-bold' : 'app-muted'"
          @click="loadScope(filter.value)"
        >
          {{ filter.label }}
        </view>
      </view>

      <view class="mb-3 flex items-center justify-between">
        <view class="app-section-title">
          {{ activeFilter === 'mine' ? '我的项目' : '公开项目' }}
        </view>
        <view v-if="status === 'success'" class="app-tertiary text-3">
          {{ total }} 个项目
        </view>
      </view>

      <view v-if="activeFilter === 'mine' && !isAuthenticated" class="app-panel-flat flex items-center gap-3 p-4" @click="handleLoginPrompt">
        <view class="h-22 w-22 flex shrink-0 items-center justify-center rounded-2xl bg-[var(--app-action-primary-soft)]">
          <wd-icon name="home" size="40rpx" color="var(--app-action-primary)" />
        </view>
        <view class="min-w-0 flex-1">
          <view class="text-3.5 font-medium">
            登录后查看我的项目
          </view>
          <view class="app-muted mt-0.5 text-2.5">
            项目档案与进度跟进都在这里
          </view>
        </view>
        <wd-icon name="arrow-right" size="32rpx" color="var(--app-text-tertiary)" />
      </view>

      <view v-else-if="status === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-12">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <view class="app-tertiary text-3">
          加载中
        </view>
      </view>

      <view v-else-if="status === 'error'" class="app-panel-flat flex items-center justify-center gap-2 py-12" @click="reload">
        <wd-icon name="refresh" size="32rpx" color="var(--app-text-tertiary)" />
        <view class="app-tertiary text-3">
          加载失败，点击重试
        </view>
      </view>

      <view v-else-if="status === 'success' && !filteredProjects.length" class="py-10">
        <wd-empty
          :icon="keyword ? 'search' : 'public'"
          :tip="keyword ? '没有找到匹配项目' : '暂无项目，点击右上角新建'"
        />
      </view>

      <view v-else class="space-y-3">
        <view
          v-for="project in filteredProjects"
          :key="project.id"
          class="app-panel-flat app-pressable p-4"
          @click="openProject(project.id)"
        >
          <view class="flex items-start justify-between gap-3">
            <view class="min-w-0 flex-1">
              <view class="truncate text-4 font-bold">
                {{ project.name }}
              </view>
              <view class="app-muted mt-1 text-3">
                {{ [project.region, project.buildingType].filter(Boolean).join(' · ') || '未填写地区与建筑类型' }}
              </view>
            </view>
            <wd-tag :type="project.visibility === 'PUBLIC' ? 'primary' : 'info'" custom-class="shrink-0!" plain>
              {{ project.visibility === 'PUBLIC' ? '公开' : '私有' }}
            </wd-tag>
          </view>
          <view class="mt-4 flex items-center justify-between">
            <view class="app-tertiary text-2.5">
              更新于 {{ formatTime(project.updatedAt) }}
            </view>
            <view class="app-primary-text text-2.5 font-bold">
              查看详情
            </view>
          </view>
        </view>

        <view v-if="hasMore" class="flex items-center justify-center gap-2 py-3" @click="loadPage(page + 1)">
          <wd-loading v-if="loadingMore" size="28rpx" color="var(--app-action-primary)" />
          <view class="app-tertiary text-2.5">
            {{ loadingMore ? '加载中' : '点击加载更多' }}
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
