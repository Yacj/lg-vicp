<script setup lang="ts">
import { ChevronDownIcon, ChevronUpIcon, SearchIcon } from 'tdesign-icons-vue-next'

const props = withDefaults(defineProps<{
  expanded?: boolean
  collapsible?: boolean
  loading?: boolean
  resetText?: string
  searchText?: string
}>(), {
  expanded: false,
  collapsible: false,
  loading: false,
  resetText: '重置',
  searchText: '查询',
})

const emit = defineEmits<{
  'search': []
  'reset': []
  'update:expanded': [expanded: boolean]
}>()

function toggleExpanded(): void {
  emit('update:expanded', !props.expanded)
}

function handleEnter(event: KeyboardEvent): void {
  if (event.key !== 'Enter'
    || event.isComposing
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLButtonElement) {
    return
  }
  event.preventDefault()
  emit('search')
}
</script>

<template>
  <section class="app-search-panel" @keydown="handleEnter">
    <t-form layout="inline" prevent-submit-default @reset="emit('reset')" @submit="emit('search')">
      <div class="app-search-panel__fields">
        <slot />
        <slot v-if="expanded" name="advanced" />

        <div class="app-search-panel__actions">
          <slot name="actions" />
          <t-button :loading="loading" theme="primary" type="button" @click="emit('search')">
            <template #icon>
              <SearchIcon />
            </template>
            {{ searchText }}
          </t-button>
          <t-button :disabled="loading" theme="default" type="reset" variant="outline">
            {{ resetText }}
          </t-button>
          <t-button v-if="collapsible" theme="default" type="button" variant="text" @click="toggleExpanded">
            {{ expanded ? '收起' : '展开' }}
            <template #suffix>
              <ChevronUpIcon v-if="expanded" />
              <ChevronDownIcon v-else />
            </template>
          </t-button>
        </div>
      </div>
    </t-form>
  </section>
</template>

<style scoped>
.app-search-panel {
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-search-panel :deep(.t-form) {
  display: grid;
  min-width: 0;
  gap: var(--td-size-4);
}

.app-search-panel__fields {
  display: grid;
  min-width: 0;
  align-items: start;
  gap: var(--td-size-4);
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.app-search-panel__fields :deep(.t-form__item) {
  min-width: 0;
  margin: 0;
}

.app-search-panel__fields :deep(.t-form__controls) {
  min-width: 0;
}

.app-search-panel__fields :deep(.t-input),
.app-search-panel__fields :deep(.t-select__wrap) {
  width: 100%;
  min-width: 0;
}

.app-search-panel__actions {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: var(--td-size-2);
  grid-column: 4;
}

@media (max-width: 1200px) {
  .app-search-panel__fields {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .app-search-panel__actions {
    grid-column: 3;
  }
}

@media (max-width: 900px) {
  .app-search-panel__fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .app-search-panel__actions {
    grid-column: 2;
  }
}

@media (max-width: 640px) {
  .app-search-panel__fields {
    grid-template-columns: minmax(0, 1fr);
  }

  .app-search-panel__actions {
    flex-wrap: wrap;
    justify-content: flex-start;
    grid-column: 1;
  }
}
</style>
