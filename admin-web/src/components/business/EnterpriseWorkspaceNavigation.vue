<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'

/** 企业信息页内任务导航：保留原路由以兼容收藏与权限粒度。 */
const route = useRoute()
const router = useRouter()

const tabs = [
  { label: '企业简介', value: '/content/profile' },
  { label: '资质证书', value: '/content/certificates' },
] as const

const activePath = computed(() => route.path.startsWith('/content/certificates')
  ? '/content/certificates'
  : '/content/profile')

function handleChange(value: string | number): void {
  if (typeof value === 'string' && value !== route.path) {
    void router.push(value)
  }
}
</script>

<template>
  <t-tabs :value="activePath" class="enterprise-workspace-navigation" @change="handleChange">
    <t-tab-panel
      v-for="tab in tabs"
      :key="tab.value"
      :label="tab.label"
      :value="tab.value"
    />
  </t-tabs>
</template>

<style scoped>
.enterprise-workspace-navigation {
  min-width: 0;
  border-bottom: 1px solid var(--td-component-stroke);
  background: var(--td-bg-color-container);
}
</style>
 