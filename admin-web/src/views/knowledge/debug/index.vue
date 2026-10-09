<script setup lang="ts">
import { computed } from 'vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

const { canAccess } = usePermissionAccess()
const debugEnabled = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))
</script>

<template>
  <AppPage title="知识库检查" description="用于检查提问效果和排序规则。日常校正章节、页码请到知识库详情「更多 → 校正章节和页码」。">
    <AppEmptyState
      v-if="!debugEnabled"
      title="暂无访问权限"
      description="这个页面只对授权人员开放。"
    />
    <section v-else class="knowledge-debug-info">
      <h2>检查提问效果</h2>
      <p>这里用于核对提问找到的章节、内容和排序。章节及页码的日常校正请到知识库详情的“更多”中操作。</p>
    </section>
  </AppPage>
</template>

<style scoped>
.knowledge-debug-info { padding: var(--td-size-4) 0; border-top: 1px solid var(--td-component-stroke); }
.knowledge-debug-info h2 { margin: 0 0 var(--td-size-2); font-size: var(--td-font-size-title-small); }
.knowledge-debug-info p { margin: 0; color: var(--td-text-color-secondary); }
</style>
