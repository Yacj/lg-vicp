<script setup lang="ts">
import { useBackNavigation } from '@/composables/useBackNavigation'

definePage({
  name: 'reports',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const { goBack } = useBackNavigation()
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      fixed
      title="我的报告"
      @click-left="goBack"
    />
    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-section-title mb-3">
        报告归档
      </view>
      <view class="app-panel-flat overflow-hidden px-4 py-8">
        <wd-empty image="search" description="暂无已生成报告" />
      </view>
    </view>
  </view>
</template>
