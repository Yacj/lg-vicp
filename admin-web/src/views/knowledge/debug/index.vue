<script setup lang="ts">
import { computed } from 'vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'

const { canAccess } = usePermissionAccess()
const debugEnabled = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))
</script>

<template>
  <AppPage title="高级调试" description="仅供具备知识高级调试权限的人员排查页面映射、内容块和检索问题。">
    <AppEmptyState
      v-if="!debugEnabled"
      title="暂无访问权限"
      description="高级调试区域仅对授权人员开放。"
    />
    <div v-else class="knowledge-debug-grid">
      <t-card title="调试能力说明">
        <p>这里集中放置页面映射、机器识别、内容块和检索排序等技术维护能力。</p>
        <p>普通资料维护请返回“知识资料”，公开资料请使用“公开文库”。</p>
      </t-card>
      <t-card title="当前安全边界">
        <ul>
          <li>检索结果中的分数、命中原因和内部标识仅在本区域及授权请求中返回。</li>
          <li>正式原文仍通过受控文件预览打开。</li>
          <li>已发布资料的业务阅读流程不依赖调试字段。</li>
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
