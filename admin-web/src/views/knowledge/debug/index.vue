<script setup lang="ts">
import { computed } from 'vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'

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
    <div v-else class="knowledge-debug-grid">
      <t-card title="可以做什么">
        <p>这里用来检查提问是否找对章节和内容，以及回答排序是否合理。</p>
        <p>日常维护请返回「知识库」。公开资料请使用「公开文库」。</p>
      </t-card>
      <t-card title="使用说明">
        <ul>
          <li>普通知识库详情里不会显示匹配分数和内部编号。</li>
          <li>查看原文件仍通过预览打开。</li>
          <li>已发布资料的阅读不依赖这些检查信息。</li>
        </ul>
      </t-card>
    </div>
  </AppPage>
</template>

<style scoped>
.knowledge-debug-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
</style>
