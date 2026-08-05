<script setup lang="ts">
import type { ApiEnvelope } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'project-create',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '新建项目',
  },
})

const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { warning, error: showError } = useGlobalToast()
const globalLoading = useGlobalLoading()

const form = reactive({
  name: '',
  region: '',
  buildingType: '',
  description: '',
})

async function submit() {
  if (!requireLogin()) {
    return
  }

  const name = form.name.trim()
  if (!name) {
    warning('请先填写项目名称')
    return
  }

  globalLoading.loading('正在创建项目...')
  try {
    const response = await projectApi.create({
      name,
      region: form.region.trim() || undefined,
      buildingType: form.buildingType.trim() || undefined,
      description: form.description.trim() || undefined,
    }).send() as ApiEnvelope<{ project: { id: string } }>

    const projectId = response.data?.project?.id
    router.replace({
      name: 'project-detail',
      query: projectId ? { id: projectId } : {},
    })
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '创建失败，请重试')
  }
  finally {
    globalLoading.close()
  }
}
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="新建项目"
      @click-left="goBack"
    />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="mb-5">
        <view class="app-eyebrow mb-1">
          NEW PROJECT
        </view>
        <view class="text-6 font-bold leading-8">
          创建项目
        </view>
        <view class="app-muted mt-1 text-3.5">
          先建立项目档案，再逐步补齐计算参数。
        </view>
      </view>

      <view class="app-panel-flat mb-4 overflow-hidden p-4">
        <view class="mb-4">
          <view class="mb-2 text-3.5 font-bold">
            项目名称 <text class="text-red-500">
              *
            </text>
          </view>
          <wd-input v-model="form.name" placeholder="例如：滨江花园住宅项目" clearable no-border />
        </view>
        <view class="mb-4">
          <view class="mb-2 text-3.5 font-bold">
            项目地区
          </view>
          <wd-input v-model="form.region" placeholder="例如：浙江省·杭州市" clearable no-border />
        </view>
        <view class="mb-4">
          <view class="mb-2 text-3.5 font-bold">
            建筑类型
          </view>
          <wd-input v-model="form.buildingType" placeholder="例如：居住建筑、公共建筑" clearable no-border />
        </view>
        <view>
          <view class="mb-2 text-3.5 font-bold">
            项目说明
          </view>
          <wd-textarea v-model="form.description" placeholder="补充项目背景、节能等级或其他备注" no-border />
        </view>
      </view>

      <view class="app-ai-soft mb-5 flex gap-3 rounded-3 p-3">
        <wd-icon name="info" size="36rpx" color="var(--app-ai)" />
        <view class="app-muted text-3 leading-5">
          创建后可继续在筑小格中整理项目参数与节能方案。
        </view>
      </view>

      <wd-button type="primary" block @click="submit">
        创建并继续
      </wd-button>
    </view>
  </view>
</template>
