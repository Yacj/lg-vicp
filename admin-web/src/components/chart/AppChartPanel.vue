<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
}>(), {
  title: '',
  description: '',
})
</script>

<template>
  <section class="app-chart-panel">
    <header v-if="title || description || $slots.actions" class="app-chart-panel__header">
      <div class="app-chart-panel__heading">
        <strong v-if="title">{{ title }}</strong>
        <span v-if="description">{{ description }}</span>
      </div>
      <div v-if="$slots.actions" class="app-chart-panel__actions">
        <slot name="actions" />
      </div>
    </header>

    <div class="app-chart-panel__body">
      <slot />
    </div>
  </section>
</template>

<style scoped>
.app-chart-panel {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-chart-panel__header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
}

.app-chart-panel__heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.app-chart-panel__heading strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.app-chart-panel__heading span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-chart-panel__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-2);
}

.app-chart-panel__body {
  min-width: 0;
}

@media (max-width: 640px) {
  .app-chart-panel__header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>