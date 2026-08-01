<script setup lang="ts">
withDefaults(defineProps<{
  title: string
  description?: string
  eyebrow?: string
}>(), {
  description: '',
  eyebrow: '',
})
</script>

<template>
  <header class="app-page-header">
    <div class="app-page-header__main">
      <p v-if="eyebrow" class="app-page-header__eyebrow">
        {{ eyebrow }}
      </p>
      <h1>{{ title }}</h1>
      <p v-if="description" class="app-page-header__description">
        {{ description }}
      </p>
    </div>

    <div v-if="$slots.actions" class="app-page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.app-page-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--vicp-page-gap);
}

.app-page-header__main {
  min-width: 0;
}

.app-page-header__eyebrow,
.app-page-header__description,
.app-page-header h1 {
  margin: 0;
}

.app-page-header__eyebrow {
  margin-bottom: var(--td-size-2);
  color: var(--td-brand-color);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
  letter-spacing: 0.04em;
}

.app-page-header h1 {
  color: var(--td-text-color-primary);
  font-size: var(--vicp-page-title-size);
  font-weight: 600;
  line-height: var(--td-line-height-title-large);
}

.app-page-header__description {
  max-width: 760px;
  margin-top: var(--td-size-2);
  color: var(--td-text-color-secondary);
  line-height: var(--td-line-height-body-medium);
}

.app-page-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-size-3);
}

@media (max-width: 640px) {
  .app-page-header {
    flex-direction: column;
  }

  .app-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
