<script setup lang="ts">
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{
  variant?: 'inline' | 'page'
  code?: string
  title?: string
  description?: string
  actionText?: string
}>(), {
  variant: 'inline',
  code: '',
  title: '加载失败',
  description: '',
  actionText: '',
})

const emit = defineEmits<{
  action: []
}>()

const titleId = useId()
const resolvedActionText = computed(() => props.actionText || (props.variant === 'page' ? '返回工作台' : '重试'))
</script>

<template>
  <section
    class="app-error-state"
    :class="`is-${variant}`"
    :aria-labelledby="titleId"
  >
    <t-empty :description="description" :size="variant === 'page' ? 'large' : 'medium'" type="fail">
      <template v-if="variant === 'page' && code" #image>
        <span class="app-error-state__code" aria-hidden="true">{{ code }}</span>
      </template>
      <template #title>
        <component :is="variant === 'page' ? 'h1' : 'h3'" :id="titleId">
          {{ title }}
        </component>
      </template>
      <template #action>
        <slot name="action">
          <t-button :theme="variant === 'page' ? 'primary' : 'danger'" :variant="variant === 'page' ? 'base' : 'text'" @click="emit('action')">
            {{ resolvedActionText }}
          </t-button>
        </slot>
      </template>
    </t-empty>
  </section>
</template>

<style scoped>
.app-error-state {
  display: grid;
  min-height: var(--vicp-state-min-height);
  padding: var(--vicp-panel-padding);
  place-content: center;
}

.app-error-state.is-page {
  min-height: 100vh;
}

.app-error-state__code {
  color: var(--td-brand-color);
  font-size: clamp(80px, 16vw, 150px);
  font-weight: 800;
  line-height: 1;
  opacity: 0.18;
}

.app-error-state h1,
.app-error-state h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-weight: 600;
}

.app-error-state h1 {
  font-size: 30px;
}

.app-error-state h3 {
  font-size: var(--td-font-size-title-medium);
}
</style>
