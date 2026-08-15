<script setup lang="ts">
import { HelpCircleIcon } from 'tdesign-icons-vue-next'
import { evidenceLevelMeta, evidenceLevels } from '@/types/professional'

/**
 * 「来源与可信度」列头：标题 + 资料可信度说明图标。
 * 悬浮展示 A/B/C 三级释义与系统行为（A 级在知识检索排序中加权）。
 */
withDefaults(defineProps<{ title?: string }>(), {
  title: '来源与可信度',
})
</script>

<template>
  <div class="app-evidence-column-header">
    <span class="app-evidence-column-header__title">{{ title }}</span>
    <t-tooltip placement="bottom" show-arrow>
      <HelpCircleIcon class="app-evidence-column-header__icon" />
      <template #content>
        <div class="app-evidence-column-header__tip">
          <p class="app-evidence-column-header__lead">标注资料出处可信度，供 AI 知识检索排序加权参考。</p>
          <ul class="app-evidence-column-header__list">
            <li v-for="level in evidenceLevels" :key="level" class="app-evidence-column-header__item">
              <span class="app-evidence-column-header__item-title">
                {{ level }} · {{ evidenceLevelMeta[level].name }}
              </span>
              <span class="app-evidence-column-header__item-desc">
                {{ evidenceLevelMeta[level].description }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </t-tooltip>
  </div>
</template>

<style scoped>
.app-evidence-column-header {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-2);
}

.app-evidence-column-header__icon {
  font-size: var(--td-font-size-body-medium);
  color: var(--td-text-color-placeholder);
  cursor: help;
  transition: color var(--td-transition-duration-standard) ease;
}

.app-evidence-column-header__icon:hover {
  color: var(--td-brand-color);
}

.app-evidence-column-header__tip {
  max-width: 280px;
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  color: var(--td-text-color-primary);
}

.app-evidence-column-header__lead {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
}

.app-evidence-column-header__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: var(--td-size-2);
}

.app-evidence-column-header__item {
  display: grid;
  gap: 2px;
}

.app-evidence-column-header__item-title {
  font-weight: var(--td-font-weight-medium);
}

.app-evidence-column-header__item-desc {
  color: var(--td-text-color-secondary);
}
</style>