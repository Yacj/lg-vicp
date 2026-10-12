<script setup lang="ts">
defineProps<{ title: string, source: string, status: 'loading' | 'ready' | 'error' | 'empty', refreshing?: boolean, revision?: number }>()
const emit = defineEmits<{ preview: [], retry: [], imageError: [], imageLoad: [] }>()
</script>

<template>
  <view class="reference-page-image">
    <view class="reference-page-image__title">
      {{ title }}
    </view>
    <view v-if="status === 'loading' || refreshing" class="reference-page-image__loading">
      <wd-loading size="44rpx" color="var(--app-action-primary)" />
      <text class="app-muted mt-3 text-3">
        正在加载图片
      </text>
    </view>
    <template v-else-if="status === 'ready' && source">
      <image :key="revision" :src="source" mode="widthFix" class="reference-page-image__image" @click="emit('preview')" @error="emit('imageError')" @load="emit('imageLoad')" />
      <wd-button block custom-class="mt-5!" @click="emit('preview')">
        全屏查看
      </wd-button>
    </template>
    <wd-empty v-else :icon="status === 'error' ? 'no-result' : 'no-content'" :tip="status === 'error' ? '图片加载失败' : '暂无原页图片'" custom-class="mt-10">
      <template #bottom>
        <view class="mt-4 flex flex-col items-center gap-3">
          <wd-button size="small" @click="emit('retry')">
            重新加载图片
          </wd-button>
          <slot name="fallback" />
        </view>
      </template>
    </wd-empty>
  </view>
</template>

<style scoped lang="scss">
.reference-page-image {
  min-width: 0;
}

.reference-page-image__title {
  margin-bottom: var(--app-space-4);
  color: var(--app-text-primary);
  font-size: var(--app-font-size-lg);
  font-weight: 600;
  line-height: var(--app-line-height-normal);
  overflow-wrap: anywhere;
}

.reference-page-image__image {
  display: block;
  width: 100%;
  height: auto;
}

.reference-page-image__loading {
  display: flex;
  min-height: 420rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
</style>
