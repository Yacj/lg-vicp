<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import ProductDetailWorkspace from '@/components/business/products/ProductDetailWorkspace.vue'

defineOptions({ name: 'ProductDetailView' })

const route = useRoute()

function queryId(name: string): string | undefined {
  const value = route.query[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const seriesId = computed(() => queryId('seriesId'))
const specId = computed(() => queryId('specId'))
const systemId = computed(() => queryId('systemId'))
</script>

<template>
  <ProductDetailWorkspace
    :key="seriesId ?? 'none'"
    :series-id="seriesId"
    :spec-id="specId"
    :system-id="systemId"
  />
</template>
