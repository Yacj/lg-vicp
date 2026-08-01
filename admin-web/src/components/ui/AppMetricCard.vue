<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { ArrowRightIcon } from 'tdesign-icons-vue-next'
import { useRouter } from 'vue-router'

type MetricStatus = 'default' | 'info' | 'success' | 'warning' | 'error'

const props = withDefaults(defineProps<{
  label: string
  value?: string | number | null
  secondaryText?: string
  status?: MetricStatus
  icon?: Component
  clickable?: boolean
  loading?: boolean
  route?: string
}>(), {
  value: null,
  secondaryText: '',
  status: 'default',
  icon: undefined,
  clickable: false,
  loading: false,
  route: '',
})

const router = useRouter()

const displayValue = computed(() => props.value ?? '--')

function handleClick(): void {
  if (props.clickable && props.route) {
    void router.push(props.route)
  }
}
</script>

<template>
  <section
    class="app-metric-card"
    :class="[`is-${status}`, { 'is-clickable': clickable && Boolean(route) }]"
    :tabindex="clickable && route ? 0 : undefined"
    :aria-label="clickable && route ? `${label}，点击跳转` : undefined"
    @click="handleClick"
    @keydown.enter="handleClick"
  >
    <div class="app-metric-card__header">
      <span class="app-metric-card__label">{{ label }}</span>
      <span v-if="icon" class="app-metric-card__icon">
        <component :is="icon" />
      </span>
    </div>

    <div v-if="loading" class="app-metric-card__value">
      <t-skeleton animation="gradient" :row-col="[{ width: '56%', height: '32px' }]" />
    </div>
    <div v-else class="app-metric-card__value">
      <strong>{{ displayValue }}</strong>
      <span v-if="secondaryText" class="app-metric-card__secondary">{{ secondaryText }}</span>
      <ArrowRightIcon v-if="clickable && route" class="app-metric-card__arrow" />
    </div>
  </section>
</template>

<style scoped>
.app-metric-card {
  display: flex;
  min-width: 0;
  min-height: var(--vicp-metric-min-height);
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-metric-card.is-clickable {
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.app-metric-card.is-clickable:hover,
.app-metric-card.is-clickable:focus-visible {
  border-color: var(--td-brand-color);
  background: var(--td-bg-color-container-hover);
  outline: none;
}

.app-metric-card__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.app-metric-card__label {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
}

.app-metric-card__icon {
  display: grid;
  width: var(--td-comp-size-m);
  height: var(--td-comp-size-m);
  flex: 0 0 auto;
  border-radius: var(--td-radius-default);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  place-content: center;
}

.app-metric-card.is-success .app-metric-card__icon {
  color: var(--td-success-color);
  background: var(--td-success-color-light);
}

.app-metric-card.is-warning .app-metric-card__icon {
  color: var(--td-warning-color);
  background: var(--td-warning-color-light);
}

.app-metric-card.is-error .app-metric-card__icon {
  color: var(--td-error-color);
  background: var(--td-error-color-light);
}

.app-metric-card__value {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: var(--td-size-2);
  margin-top: auto;
}

.app-metric-card__value strong {
  color: var(--td-text-color-primary);
  font-size: var(--vicp-metric-value-size);
  font-weight: 600;
  line-height: 1.2;
}

.app-metric-card__secondary {
  overflow: hidden;
  min-width: 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-metric-card__arrow {
  flex: 0 0 auto;
  margin-left: auto;
  color: var(--td-text-color-placeholder);
}
</style>