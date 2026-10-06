<script setup lang="ts">
definePage({
  name: 'library',
  layout: 'default',
  style: {
    navigationBarTitleText: '公开文库',
  },
})
</script>

<template>
  <view class="app-page box-border min-h-screen flex flex-col">
    <view class="flex flex-1 items-center justify-center">
      <wd-empty icon="no-content" tip="暂无数据" />
    </view>
  </view>
</template>
