<script setup lang="ts">
import { computed } from 'vue'
import type { KnowledgeChapterTreeNode } from '@/types/knowledge'
import { flattenChapterTree, knowledgePageLabel } from '@/utils/knowledge-user'

const props = defineProps<{
  items: KnowledgeChapterTreeNode[]
  selectedId?: string | null
  loading?: boolean
}>()

const emit = defineEmits<{
  select: [node: KnowledgeChapterTreeNode]
}>()

const rows = computed(() => flattenChapterTree(props.items))
</script>

<template>
  <aside class="knowledge-chapter-tree">
    <div class="knowledge-chapter-tree__head">
      章节
    </div>
    <t-loading :loading="loading" size="small" text="正在加载章节">
      <ul v-if="rows.length > 0" class="knowledge-chapter-tree__list">
        <li
          v-for="{ node, depth } in rows"
          :key="node.id"
          class="knowledge-chapter-tree__item"
          :class="{ 'is-active': node.id === selectedId }"
          :style="{ paddingLeft: `${12 + depth * 16}px` }"
          role="button"
          tabindex="0"
          @click="emit('select', node)"
          @keydown.enter="emit('select', node)"
        >
          <span>{{ node.title }}</span>
          <em>{{ knowledgePageLabel(node.pageLabel, node.physicalPageNumber) }}</em>
        </li>
      </ul>
      <p v-else-if="!loading" class="knowledge-chapter-tree__empty">
        暂未识别到章节
      </p>
    </t-loading>
  </aside>
</template>

<style scoped>
.knowledge-chapter-tree {
  display: flex;
  width: 300px;
  min-width: 240px;
  max-width: 320px;
  min-height: 0;
  flex: 0 0 auto;
  flex-direction: column;
  border-right: 1px solid var(--td-component-stroke);
  background: var(--td-bg-color-container);
}

.knowledge-chapter-tree__head {
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: 600;
}

.knowledge-chapter-tree__list {
  margin: 0;
  padding: 0 0 var(--td-size-4);
  overflow: auto;
  list-style: none;
}

.knowledge-chapter-tree__item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: 8px 12px 8px 12px;
  cursor: pointer;
  color: var(--td-text-color-primary);
}

.knowledge-chapter-tree__item span {
  min-width: 0;
  flex: 1;
  line-height: 1.5;
}

.knowledge-chapter-tree__item em {
  flex: 0 0 auto;
  color: var(--td-text-color-placeholder);
  font-style: normal;
  font-size: var(--td-font-size-body-small);
}

.knowledge-chapter-tree__item:hover,
.knowledge-chapter-tree__item.is-active {
  background: var(--td-brand-color-light);
}

.knowledge-chapter-tree__item.is-active {
  color: var(--td-brand-color);
}

.knowledge-chapter-tree__empty {
  padding: var(--td-comp-paddingTB-xl) var(--td-comp-paddingLR-l);
  color: var(--td-text-color-placeholder);
}

@media (max-width: 1280px) {
  .knowledge-chapter-tree {
    width: 240px;
  }
}
</style>
