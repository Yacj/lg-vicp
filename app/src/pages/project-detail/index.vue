<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'project-detail',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '项目详情',
  },
})

const route = useRoute()
const router = useRouter()
const { requireLogin } = useAuthGate()
const { info } = useGlobalToast()

const projectName = computed(() => String(route.query.name || '滨江花园住宅项目'))
const projectId = computed(() => String(route.query.id || 'project-001'))

const stages = [
  { title: '项目概况', description: '地区、建筑类型和节能等级', state: 'done' },
  { title: '参数确认', description: '确认 AI 识别出的结构化参数', state: 'current' },
  { title: '热工计算', description: '基于规则版本生成计算结果', state: 'pending' },
  { title: '产品与材料推荐', description: '匹配 VICP 保温体系和适用厚度', state: 'pending' },
  { title: '规范与节点', description: '关联依据、构造做法和节点图', state: 'pending' },
  { title: '文件与报告', description: '生成、预览和导出项目成果', state: 'pending' },
]

function openAssistant() {
  if (!requireLogin()) {
    return
  }

  router.pushTab({ name: 'assistant' })
}

function showComingSoon(label: string) {
  if (!requireLogin()) {
    return
  }

  info(`${label}接口待接入`)
}
</script>

<template>
  <view class="app-page app-page--immersive box-border pb-6">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="项目详情"
      @click-left="router.back"
    />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="mb-5">
        <view class="app-eyebrow mb-1">
          PROJECT WORKSPACE
        </view>
        <view class="flex items-start justify-between gap-3">
          <view class="min-w-0 flex-1">
            <view class="truncate text-6 font-bold leading-8">
              {{ projectName }}
            </view>
            <view class="app-muted mt-1 text-3">
              项目编号 {{ projectId }}
            </view>
          </view>
          <wd-tag type="warning" plain>
            计算待确认
          </wd-tag>
        </view>
      </view>

      <view class="app-panel mb-5 p-4">
        <view class="flex items-center justify-between">
          <view>
            <view class="app-muted text-3">
              当前完成度
            </view>
            <view class="app-primary-text mt-1 text-8 font-bold leading-10">
              52%
            </view>
          </view>
          <view class="text-right">
            <view class="app-muted text-3">
              下一步
            </view>
            <view class="mt-1 text-3.5 font-bold">
              确认项目参数
            </view>
          </view>
        </view>
        <view class="mt-4 h-2 overflow-hidden rounded-full bg-[var(--app-border-default)]">
          <view class="h-full w-1/2 rounded-full bg-[var(--app-action-primary)]" />
        </view>
      </view>

      <view class="mb-3 flex items-center justify-between">
        <view class="app-section-title">
          项目流程
        </view>
        <view class="app-tertiary text-3">
          一期基础骨架
        </view>
      </view>

      <view class="app-panel-flat mb-5 overflow-hidden p-4">
        <view v-for="(stage, index) in stages" :key="stage.title" class="relative flex gap-3">
          <view class="w-7 flex shrink-0 flex-col items-center">
            <view
              class="z-1 h-7 w-7 flex items-center justify-center rounded-full text-3 font-bold"
              :class="stage.state === 'done' ? 'bg-[var(--app-energy)] text-white' : stage.state === 'current' ? 'bg-[var(--app-action-primary)] text-white' : 'bg-[var(--app-action-primary-soft)] app-primary-text'"
            >
              <wd-icon v-if="stage.state === 'done'" name="check" size="14px" color="#fff" />
              <text v-else>
                {{ index + 1 }}
              </text>
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
            <wd-tag v-if="stage.state === 'current'" class="mt-2!" type="primary" plain>
              当前步骤
            </wd-tag>
          </view>
        </view>
      </view>

      <view class="grid grid-cols-2 gap-3">
        <wd-button type="primary" block @click="openAssistant">
          用筑小格继续
        </wd-button>
        <wd-button plain block @click="showComingSoon('项目文件与报告')">
          查看成果
        </wd-button>
      </view>
    </view>
  </view>
</template>
