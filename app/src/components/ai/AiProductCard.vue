<script setup lang="ts">
import type { ProductCardItem } from '@/utils/aiComparison'

defineProps<{
  products: ProductCardItem[]
}>()
</script>

<template>
  <view v-if="products.length" class="ai-product-cards mt-2 space-y-2">
    <view
      v-for="product in products"
      :key="product.id"
      class="ai-product-card app-panel-flat rounded-3 px-3.5 py-3"
    >
      <view class="text-3.5 font-semibold leading-5.5">
        {{ product.name }}
      </view>
      <view v-if="product.summary" class="app-muted mt-1 text-2.5 leading-4.5">
        {{ product.summary }}
      </view>
    </view>
  </view>
</template>

<style lang="scss" scoped>
.ai-product-card {
  background: var(--app-bg-elevated);
  border: 1px solid var(--app-border-default);
}
</style>
