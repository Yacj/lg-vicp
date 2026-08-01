<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
  size?: 'small' | 'medium' | 'large'
}>(), {
  title: '暂无数据',
  description: '',
  size: 'medium',
})
</script>

<template>
  <div class="app-empty-state">
    <t-empty :description="description" :size="size" :title="title" type="empty">
      <template v-if="$slots.image" #image>
        <slot name="image" />
      </template>
      <template v-if="$slots.action" #action>
        <slot name="action" />
      </template>
    </t-empty>
  </div>
</template>

<style scoped>
.app-empty-state {
  display: grid;
  min-height: var(--vicp-state-min-height);
  padding: var(--vicp-panel-padding);
  place-content: center;
}
</style>
