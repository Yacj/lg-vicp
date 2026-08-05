<script setup lang="ts">
import type { ApiEnvelope, ProjectRecord } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'project-detail',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '项目详情',
  },
})

const route = useRoute()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { info } = useGlobalToast()
const { openAssistant } = useAssistantNavigation()

const projectId = computed(() => String(route.query.id || ''))
const project = ref<ProjectRecord | null>(null)
const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')

const projectMeta = computed(() => {
  if (!project.value) {
    return ''
  }
  return [project.value.region, project.value.buildingType].filter(Boolean).join(' · ') || '未填写地区与建筑类型'
})

const stages = [
  { title: '项目概况', description: '地区、建筑类型和节能等级' },
  { title: '参数确认', description: '确认 AI 识别出的结构化参数' },
  { title: '热工计算', description: '基于规则版本生成计算结果' },
  { title: '产品与材料推荐', description: '匹配 VICP 保温体系和适用厚度' },
  { title: '规范与节点', description: '关联依据、构造做法和节点图' },
  { title: '文件与报告', description: '生成、预览和导出项目成果' },
]

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void loadDetail()
})

async function loadDetail() {
  if (!projectId.value) {
    status.value = 'error'
    return
  }

  status.value = 'loading'
  try {
    const response = await projectApi.getDetail(projectId.value).send() as ApiEnvelope<{ project: ProjectRecord }>
    project.value = response.data?.project || null
    status.value = project.value ? 'success' : 'error'
  }
  catch {
    status.value = 'error'
  }
}

function askAssistant() {
  if (!requireLogin()) {
    return
  }
  if (!project.value) {
    return
  }

  openAssistant({
    projectId: project.value.id,
    projectName: project.value.name,
  })
}

function showComingSoon(label: string) {
  if (!requireLogin()) {
    return
  }

  info(`${label}接口待接入`)
}

function formatTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
</script>

<template>
  <view class="app-page app-page--immersive box-border pb-6">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="项目详情"
      @click-left="goBack"
    />

    <view class="app-enter box-border px-4 py-4 pb-6">
      <view v-if="status === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <view class="app-tertiary text-3">
          加载中
        </view>
      </view>

      <view v-else-if="status === 'error'" class="app-panel-flat flex items-center justify-center gap-2 py-16" @click="loadDetail">
        <wd-icon name="refresh" size="32rpx" color="var(--app-text-tertiary)" />
        <view class="app-tertiary text-3">
          项目加载失败，点击重试
        </view>
      </view>

      <template v-else-if="project">
        <view class="mb-5">
          <view class="app-eyebrow mb-1">
            PROJECT WORKSPACE
          </view>
          <view class="flex items-start justify-between gap-3">
            <view class="min-w-0 flex-1">
              <view class="truncate text-6 font-bold leading-8">
                {{ project.name }}
              </view>
              <view class="app-muted mt-1 text-3">
                {{ projectMeta }}
              </view>
            </view>
            <wd-tag :type="project.visibility === 'PUBLIC' ? 'primary' : 'info'" custom-class="shrink-0!" plain>
              {{ project.visibility === 'PUBLIC' ? '公开项目' : '私有项目' }}
            </wd-tag>
          </view>
        </view>

        <view class="app-panel mb-5 p-4">
          <view class="mb-3 flex items-center justify-between">
            <view class="app-section-title">
              项目档案
            </view>
            <view class="app-tertiary text-2.5">
              创建于 {{ formatTime(project.createdAt) }}
            </view>
          </view>
          <view class="space-y-3">
            <view class="flex items-start justify-between gap-3">
              <view class="app-tertiary shrink-0 text-3">
                项目名称
              </view>
              <view class="min-w-0 flex-1 text-right text-3 font-medium">
                {{ project.name }}
              </view>
            </view>
            <view class="flex items-start justify-between gap-3">
              <view class="app-tertiary shrink-0 text-3">
                所在地区
              </view>
              <view class="min-w-0 flex-1 text-right text-3 font-medium">
                {{ project.region || '未填写' }}
              </view>
            </view>
            <view class="flex items-start justify-between gap-3">
              <view class="app-tertiary shrink-0 text-3">
                建筑类型
              </view>
              <view class="min-w-0 flex-1 text-right text-3 font-medium">
                {{ project.buildingType || '未填写' }}
              </view>
            </view>
            <view v-if="project.description" class="flex items-start justify-between gap-3">
              <view class="app-tertiary shrink-0 text-3">
                项目说明
              </view>
              <view class="min-w-0 flex-1 text-right text-3 font-medium">
                {{ project.description }}
              </view>
            </view>
          </view>
        </view>

        <view class="mb-3 flex items-center justify-between">
          <view class="app-section-title">
            项目流程
          </view>
          <view class="app-tertiary text-3">
            指引说明
          </view>
        </view>

        <view class="app-panel-flat mb-5 overflow-hidden p-4">
          <view v-for="(stage, index) in stages" :key="stage.title" class="relative flex gap-3">
            <view class="w-7 flex shrink-0 flex-col items-center">
              <view
                class="app-primary-text z-1 h-7 w-7 flex items-center justify-center rounded-full bg-[var(--app-action-primary-soft)] text-3 font-bold"
              >
                {{ index + 1 }}
              </view>
              <view v-if="index < stages.length - 1" class="h-full min-h-8 w-px bg-[var(--app-border-default)]" />
            </view>
            <view class="min-w-0 flex-1 pb-5">
              <view class="text-3.5 font-bold">
                {{ stage.title }}
              </view>
              <view class="app-muted mt-1 text-3 leading-5">
                {{ stage.description }}
              </view>
            </view>
          </view>
        </view>

        <view class="grid grid-cols-2 gap-3">
          <wd-button type="primary" block @click="askAssistant">
            用筑小格继续
          </wd-button>
          <wd-button plain block @click="showComingSoon('项目文件与报告')">
            查看成果
          </wd-button>
        </view>
      </template>
    </view>
  </view>
</template>
