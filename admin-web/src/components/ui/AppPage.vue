<script setup lang="ts">
import AppPageHeader from './AppPageHeader.vue'

withDefaults(defineProps<{
  title?: string
  description?: string
  eyebrow?: string
}>(), {
  title: '',
  description: '',
  eyebrow: '',
})
</script>

<template>
  <section class="app-page">
    <slot name="header">
      <AppPageHeader
        v-if="title || description || eyebrow || $slots.navigation || $slots.actions"
        :description="description"
        :eyebrow="eyebrow"
        :title="title"
      >
        <template v-if="$slots.navigation" #navigation>
          <slot name="navigation" />
        </template>
        <template v-if="$slots.actions" #actions>
          <slot name="actions" />
        </template>
      </AppPageHeader>
    </slot>

    <div v-if="$slots.toolbar" class="app-page__toolbar">
      <slot name="toolbar" />
    </div>

    <div v-if="$slots.search" class="app-page__search">
      <slot name="search" />
    </div>

    <div class="app-page__content">
      <slot />
    </div>

    <footer v-if="$slots.footer" class="app-page__footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<style scoped>
.app-page {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 100%;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}

.app-page__toolbar,
.app-page__search,
.app-page__content,
.app-page__footer {
  min-width: 0;
}

.app-page__content {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}
</style>
