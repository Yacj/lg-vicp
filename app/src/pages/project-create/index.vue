<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'

definePage({
  name: 'project-create',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '新建项目',
  },
})

const router = useRouter()
const { requireLogin } = useAuthGate()
const { warning, info } = useGlobalToast()

const form = reactive({
  name: '',
  region: '',
  buildingType: '',
  description: '',
})

function submit() {
  if (!requireLogin()) {
    return
  }

  if (!form.name.trim()) {
    warning('请先填写项目名称')
    return
  }

  info('项目创建接口待接入，已保留表单结构')
  router.replace({
    name: 'project-detail',
    query: {
      id: 'draft-project',
      name: form.name.trim(),
    },
  })
}
</script>

<template>
  <view class="app-page app-page--immersive">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="新建项目"
      @click-left="router.back"
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
        <wd-icon name="info" size="18px" color="var(--app-ai)" />
        <view class="app-muted text-3 leading-5">
          接口接入后，这些信息会保存到当前渠道用户的租户项目空间。
        </view>
      </view>

      <wd-button type="primary" block @click="submit">
        创建并继续
      </wd-button>
    </view>
  </view>
</template>
