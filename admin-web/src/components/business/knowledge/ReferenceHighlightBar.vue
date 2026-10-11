<script setup lang="ts">
defineProps<{ count: number, index: number, enabled: boolean, unresolved?: boolean }>()
const emit = defineEmits<{ navigate: [offset: number], toggle: [] }>()
</script>

<template>
  <div class="reference-highlight-bar" role="status" aria-live="polite">
    <span v-if="count">命中 {{ count }} 处 <span v-if="enabled">· 当前 {{ index + 1 }} / {{ count }}</span></span>
    <span v-else>命中数据暂无法定位，请查看识别数据或原图。</span>
    <span v-if="unresolved && count">部分命中数据暂无法定位</span>
    <t-space v-if="count" size="small">
      <t-button v-if="count > 1" size="small" variant="outline" @click="emit('navigate', -1)">上一处</t-button>
      <t-button v-if="count > 1" size="small" variant="outline" @click="emit('navigate', 1)">下一处</t-button>
      <t-button size="small" variant="text" @click="emit('toggle')">{{ enabled ? '取消高亮' : '重新显示' }}</t-button>
    </t-space>
  </div>
</template>

<style scoped>
.reference-highlight-bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--td-size-3); padding: var(--td-size-3); background: var(--td-brand-color-light); color: var(--td-text-color-primary); }
</style>
