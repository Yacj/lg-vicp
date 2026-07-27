<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'projects',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '项目',
  },
})

const router = useRouter()
const { requireLogin } = useAuthGate()
const keyword = ref('')
const activeFilter = ref('mine')

const filters = [
  { value: 'mine', label: '我的项目' },
  { value: 'public', label: '公开项目' },
]

const projects = [
  {
    id: 'project-001',
    name: '滨江花园住宅项目',
    region: '浙江省 · 杭州市',
    buildingType: '居住建筑',
    status: '计算待确认',
    statusType: 'warning',
    progress: 52,
    updatedAt: '今天 10:24',
  },
  {
    id: 'project-002',
    name: '科创园办公楼节能改造',
    region: '江苏省 · 苏州市',
    buildingType: '公共建筑',
    status: '已生成报告',
    statusType: 'success',
    progress: 100,
    updatedAt: '昨天 16:08',
  },
  {
    id: 'project-003',
    name: '云栖小镇人才公寓',
    region: '浙江省 · 杭州市',
    buildingType: '居住建筑',
    status: '参数录入中',
    statusType: 'primary',
    progress: 24,
    updatedAt: '2026-07-24',
  },
]

const filteredProjects = computed(() => {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  if (!normalizedKeyword) {
    return projects
  }

  return projects.filter(project => `${project.name}${project.region}`.toLowerCase().includes(normalizedKeyword))
})

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

  router.push({ name: 'project-detail', query: { id } })
}
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar custom-class="app-navbar" safe-area-inset-top title="项目" />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="mb-4 flex justify-end">
        <wd-button type="primary" size="small" icon="add" @click="createProject">
          新建项目
        </wd-button>
      </view>

      <wd-search
        v-model="keyword"
        placeholder="搜索项目名称或地区"
        shape="round"
        custom-class="mb-4!"
      />

      <view class="app-panel-flat mb-4 flex p-1">
        <view
          v-for="filter in filters"
          :key="filter.value"
          class="flex-1 rounded-2 py-2.5 text-center text-3.5 transition-colors"
          :class="activeFilter === filter.value ? 'bg-[var(--app-action-primary)] text-white font-bold' : 'app-muted'"
          @click="activeFilter = filter.value"
        >
          {{ filter.label }}
        </view>
      </view>

      <view class="mb-3 flex items-center justify-between">
        <view class="app-section-title">
          {{ activeFilter === 'mine' ? '我的项目' : '公开项目' }}
        </view>
        <view class="app-tertiary text-3">
          {{ filteredProjects.length }} 个项目
        </view>
      </view>

      <view v-if="filteredProjects.length" class="space-y-3">
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
                {{ project.region }} · {{ project.buildingType }}
              </view>
            </view>
            <wd-tag :type="project.statusType" custom-class="shrink-0!" plain>
              {{ project.status }}
            </wd-tag>
          </view>
          <view class="mt-4 flex items-center justify-between">
            <view class="app-tertiary text-2.5">
              更新于 {{ project.updatedAt }}
            </view>
            <view class="flex items-center gap-2">
              <view class="h-1.5 w-18 overflow-hidden rounded-full bg-[var(--app-border-default)]">
                <view
                  class="h-full rounded-full bg-[var(--app-energy)]"
                  :style="{ width: `${project.progress}%` }"
                />
              </view>
              <view class="app-energy-text text-2.5 font-bold">
                {{ project.progress }}%
              </view>
            </view>
          </view>
        </view>
      </view>

      <wd-empty v-else image="search" description="没有找到匹配项目" />
    </view>
  </view>
</template>
