<script lang="ts">
export interface ProductRelationLink {
  description: string
  label: string
  path: string
  permission?: string
}
</script>

<script setup lang="ts">
import { ArrowRightIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

/**
 * 产品详情中的关联工作区入口面板：
 * 后端尚无产品与构造 / 热工 / 节点 / 对比的直接关联查询时，
 * 以受权限控制的任务入口承载，不做假数据列表。
 */
const props = defineProps<{
  description: string
  links: readonly ProductRelationLink[]
}>()

const router = useRouter()
const { canAccess } = usePermissionAccess()

const visibleLinks = computed(() => props.links.filter(link => !link.permission || canAccess({ permissions: [link.permission] })))

function open(link: ProductRelationLink): void {
  void router.push(link.path)
}
</script>

<template>
  <div class="vicp-relation-panel">
    <p class="vicp-relation-description">
      {{ description }}
    </p>
    <div class="vicp-relation-list">
      <t-button
        v-for="link in visibleLinks"
        :key="link.path"
        block
        class="vicp-relation-item"
        theme="default"
        variant="outline"
        @click="open(link)"
      >
        <span class="vicp-relation-item__inner">
          <span class="vicp-relation-item__body">
            <span class="vicp-relation-item__label">{{ link.label }}</span>
            <span class="vicp-relation-item__description">{{ link.description }}</span>
          </span>
          <ArrowRightIcon class="vicp-relation-item__arrow" />
        </span>
      </t-button>
    </div>
  </div>
</template>

<style scoped>
.vicp-relation-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--td-comp-margin-l);
  max-width: 720px;
}
.vicp-relation-description {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-medium);
  margin: 0;
}
.vicp-relation-list {
  display: flex;
  flex-direction: column;
}
.vicp-relation-item {
  height: auto;
  padding: var(--td-comp-paddingTB-m) var(--td-comp-paddingLR-l);
  text-align: left;
}
.vicp-relation-item + .vicp-relation-item {
  margin-top: -1px;
}
.vicp-relation-item__inner {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--td-comp-margin-s);
}
.vicp-relation-item__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 2px;
  text-align: left;
}
.vicp-relation-item__label {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}
.vicp-relation-item__description {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
.vicp-relation-item__arrow {
  color: var(--td-text-color-placeholder);
}
</style>
