<script setup lang="ts">
withDefaults(defineProps<{
  title?: string
  description?: string
  divided?: boolean
}>(), {
  title: '',
  description: '',
  divided: false,
})
</script>

<template>
  <section class="app-page-toolbar" :class="{ 'is-divided': divided }">
    <div v-if="title || description" class="app-page-toolbar__heading">
      <strong v-if="title">{{ title }}</strong>
      <span v-if="description">{{ description }}</span>
    </div>

    <div v-if="$slots.default" class="app-page-toolbar__content">
      <slot />
    </div>

    <div v-if="$slots.actions" class="app-page-toolbar__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.app-page-toolbar {
  display: flex;
  min-width: 0;
  min-height: var(--vicp-toolbar-height);
  align-items: center;
  gap: var(--td-size-4);
}

.app-page-toolbar.is-divided {
  padding-bottom: var(--td-size-3);
  border-bottom: 1px solid var(--td-component-stroke);
}

.app-page-toolbar__heading {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.app-page-toolbar__heading strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.app-page-toolbar__heading span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-page-toolbar__content {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: var(--td-size-3);
}

.app-page-toolbar__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-2);
  margin-left: auto;
}

@media (max-width: 640px) {
  .app-page-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .app-page-toolbar__actions {
    width: 100%;
    margin-left: 0;
  }
}
</style>
