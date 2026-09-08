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
    <div class="app-page-header__leading">
      <div
        v-if="$slots.navigation"
        class="app-page-header__navigation"
        :class="{ 'app-page-header__navigation--divided': title }"
      >
        <slot name="navigation" />
      </div>

      <div class="app-page-header__main">
        <p v-if="eyebrow" class="app-page-header__eyebrow">
          {{ eyebrow }}
        </p>
        <h1 v-if="title">{{ title }}</h1>
        <p v-if="description" class="app-page-header__description">
          {{ description }}
        </p>
      </div>
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
  align-items: center;
  justify-content: space-between;
  gap: var(--vicp-page-gap);
  padding: var(--td-comp-paddingTB-m) var(--td-size-6);
  background: var(--vicp-bg-surface);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
}

.app-page-header__leading {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: var(--td-size-5);
}

.app-page-header__navigation {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}

.app-page-header__navigation--divided {
  padding-right: var(--td-size-5);
  border-right: 1px solid var(--td-component-stroke);
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
  line-height: var(--td-line-height-title-medium);
}

.app-page-header__description {
  max-width: 760px;
  margin-top: var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
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
    align-items: flex-start;
    gap: var(--td-size-4);
    padding: var(--td-comp-paddingTB-m) var(--td-size-5);
  }

  .app-page-header__navigation--divided {
    padding-right: 0;
    border-right: none;
  }

  .app-page-header__actions {
    width: 100%;
    justify-content: flex-start;
  }
}
</style>
