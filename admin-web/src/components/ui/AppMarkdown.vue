<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '@/utils/ai'

const props = defineProps<{
  content?: string
  html?: string
}>()

const renderedHtml = computed(() => {
  if (typeof props.html === 'string') {
    return props.html
  }
  return renderMarkdown(props.content ?? '')
})
</script>

<template>
  <div class="app-markdown" v-html="renderedHtml" />
</template>

<style scoped>
.app-markdown {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  line-height: var(--td-line-height-body-medium);
  word-break: break-word;
}

.app-markdown :deep(> :first-child) {
  margin-top: 0;
}

.app-markdown :deep(> :last-child) {
  margin-bottom: 0;
}

.app-markdown :deep(h1),
.app-markdown :deep(h2),
.app-markdown :deep(h3),
.app-markdown :deep(h4),
.app-markdown :deep(h5),
.app-markdown :deep(h6) {
  margin: var(--td-comp-margin-l) 0 var(--td-comp-margin-s);
  color: var(--td-text-color-primary);
  font-weight: 600;
  line-height: var(--td-line-height-title-medium);
}

.app-markdown :deep(h1) {
  font-size: var(--td-font-size-title-large);
}

.app-markdown :deep(h2) {
  font-size: var(--td-font-size-title-medium);
}

.app-markdown :deep(h3),
.app-markdown :deep(h4),
.app-markdown :deep(h5),
.app-markdown :deep(h6) {
  font-size: var(--td-font-size-title-small);
}

.app-markdown :deep(p) {
  margin: 0 0 var(--td-comp-margin-s);
}

.app-markdown :deep(ul),
.app-markdown :deep(ol) {
  margin: 0 0 var(--td-comp-margin-s);
  padding-left: var(--td-comp-paddingLR-l);
}

.app-markdown :deep(li + li) {
  margin-top: var(--td-size-1);
}

.app-markdown :deep(blockquote) {
  margin: 0 0 var(--td-comp-margin-s);
  padding: 0 0 0 var(--td-comp-paddingLR-s);
  color: var(--td-text-color-secondary);
  border-left: 2px solid var(--td-component-border);
}

.app-markdown :deep(hr) {
  margin: var(--td-comp-margin-m) 0;
  border: none;
  border-top: 1px solid var(--td-component-border);
}

.app-markdown :deep(a) {
  color: var(--td-brand-color);
}

.app-markdown :deep(pre) {
  margin: 0 0 var(--td-comp-margin-s);
  padding: var(--td-comp-paddingTB-s) var(--td-comp-paddingLR-s);
  overflow: auto;
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.app-markdown :deep(code) {
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
}

.app-markdown :deep(:not(pre) > code) {
  padding: 0 var(--td-size-1);
  background: var(--td-bg-color-secondarycontainer);
  border-radius: var(--td-radius-small);
}

.app-markdown :deep(table) {
  width: 100%;
  margin: 0 0 var(--td-comp-margin-s);
  border-collapse: collapse;
}

.app-markdown :deep(th),
.app-markdown :deep(td) {
  padding: var(--td-comp-paddingTB-xs) var(--td-comp-paddingLR-s);
  border: 1px solid var(--td-component-border);
  text-align: left;
}

.app-markdown :deep(th) {
  background: var(--td-bg-color-secondarycontainer);
  font-weight: 600;
}

.app-markdown :deep(img) {
  max-width: 100%;
}
</style>
