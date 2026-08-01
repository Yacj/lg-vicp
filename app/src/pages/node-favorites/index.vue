<script setup lang="ts">
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'node-favorites',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
    navigationBarTitleText: '收藏的节点图',
  },
})

const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const isAuthenticated = ref(false)

onMounted(() => {
  isAuthenticated.value = requireLogin({ showToast: false })
})
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="收藏的节点图"
      @click-left="goBack"
    />

    <view v-if="isAuthenticated" class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel flex flex-col items-center px-5 py-12 text-center">
        <wd-empty icon="picture" tip="暂无收藏的节点图" />
        <view class="app-muted mt-2 max-w-280rpx text-2.5 leading-4">
          在项目的“规范与节点”中收藏后，会集中展示在这里。
        </view>
      </view>
    </view>
  </view>
</template>
