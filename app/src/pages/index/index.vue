<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'home',
  layout: 'tabbar',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '首页',
  },
})

const router = useRouter()
const { requireLogin } = useAuthGate()

const recentProjects = [
  {
    id: 'project-001',
    name: '滨江花园住宅项目',
    region: '浙江省 · 杭州市',
    status: '计算待确认',
    statusType: 'warning',
    updatedAt: '今天 10:24',
  },
  {
    id: 'project-002',
    name: '科创园办公楼节能改造',
    region: '江苏省 · 苏州市',
    status: '已生成报告',
    statusType: 'success',
    updatedAt: '昨天 16:08',
  },
]

const pendingTasks = [
  { label: 'AI 参数识别待确认', count: 2, color: 'app-ai-text' },
  { label: '报告生成中', count: 1, color: 'app-primary-text' },
  { label: '文件上传失败', count: 1, color: 'app-danger-text' },
]

function goProjects() {
  router.pushTab({ name: 'projects' })
}

function goAssistant() {
  if (!requireLogin()) {
    return
  }

  router.pushTab({ name: 'assistant' })
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
    <wd-navbar custom-class="app-navbar app-navbar--brand" safe-area-inset-top>
      <template #title>
        <view class="flex items-center gap-2">
          <view class="h-8 w-8 flex items-center justify-center rounded-xl bg-white/15">
            <wd-icon name="home" size="18px" color="#fff" />
          </view>
          <view>
            <view class="text-4 text-white font-bold leading-5">
              蓝格智配
            </view>
            <view class="text-2.5 text-white/70 leading-4">
              建筑节能 AI 智配
            </view>
          </view>
        </view>
      </template>
      <template #right>
        <view class="app-navbar__action">
          <wd-icon name="bell" size="18px" color="#fff" />
        </view>
      </template>
    </wd-navbar>

    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel mb-5 overflow-hidden p-4">
        <view class="flex items-start justify-between">
          <view>
            <view class="app-eyebrow mb-2">
              筑小格 AI 助手
            </view>
            <view class="text-5 font-bold leading-7">
              把项目想法，整理成可确认的参数
            </view>
            <view class="app-muted mt-2 max-w-260rpx text-3 leading-5">
              输入地区、建筑类型和材料信息，先由 AI 识别，再由你确认。
            </view>
          </view>
          <view class="app-ai-soft h-11 w-11 flex shrink-0 items-center justify-center rounded-2xl">
            <wd-icon name="chat" size="24px" color="var(--app-ai)" />
          </view>
        </view>
        <wd-button class="mt-4!" type="primary" block @click="goAssistant">
          开始智能设计
        </wd-button>
      </view>

      <view class="grid grid-cols-3 mb-5 gap-2">
        <view
          v-for="task in pendingTasks"
          :key="task.label"
          class="app-panel-flat min-h-24 p-3"
        >
          <view class="text-6 font-bold" :class="task.color">
            {{ task.count }}
          </view>
          <view class="app-muted mt-1 text-2.5 leading-4">
            {{ task.label }}
          </view>
        </view>
      </view>

      <view class="mb-3 flex items-center justify-between">
        <view class="app-section-title">
          最近项目
        </view>
        <view class="app-section-more" @click="goProjects">
          查看全部
        </view>
      </view>

      <view class="space-y-3">
        <view
          v-for="project in recentProjects"
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
                {{ project.region }}
              </view>
            </view>
            <wd-tag :type="project.statusType" custom-class="shrink-0!" plain>
              {{ project.status }}
            </wd-tag>
          </view>
          <view class="app-divider my-3" />
          <view class="flex items-center justify-between">
            <view class="app-tertiary text-2.5">
              最近更新 {{ project.updatedAt }}
            </view>
            <wd-icon name="arrow-right" size="16px" color="var(--app-text-tertiary)" />
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
