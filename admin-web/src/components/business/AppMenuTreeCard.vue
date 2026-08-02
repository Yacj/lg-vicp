<script setup lang="ts">
import { ChevronDownIcon } from 'tdesign-icons-vue-next'
import type { SystemMenuTreeNode } from '@/types/system-management'
import { getMenuTypeLabel } from '@/utils/system-menu'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'

defineOptions({ name: 'AppMenuTreeCard' })

const props = defineProps<{
  nodes: readonly SystemMenuTreeNode[]
  expandedNodeIds: readonly string[]
  canAdd: boolean
  canEdit: boolean
  canRemove: boolean
}>()

const emit = defineEmits<{
  createChild: [menu: SystemMenuTreeNode]
  createSibling: [menu: SystemMenuTreeNode]
  edit: [menu: SystemMenuTreeNode]
  remove: [menu: SystemMenuTreeNode]
  toggle: [menu: SystemMenuTreeNode]
  toggleExpand: [id: string]
}>()

function isExpanded(menu: SystemMenuTreeNode): boolean {
  return props.expandedNodeIds.includes(menu.id)
}

function toggleExpanded(menu: SystemMenuTreeNode): void {
  emit('toggleExpand', menu.id)
}
</script>

<template>
  <div class="app-menu-tree-card">
    <article v-for="menu in nodes" :key="menu.id" class="app-menu-tree-card__item">
      <div class="app-menu-tree-card__header">
        <div class="app-menu-tree-card__identity">
          <AppIcon :name="menu.icon" class="app-menu-tree-card__icon" />
          <div class="app-menu-tree-card__name">
            <strong>{{ menu.name }}</strong>
            <span>{{ getMenuTypeLabel(menu.menuType) }} · 排序 {{ menu.sortOrder }}</span>
          </div>
        </div>
        <div class="app-menu-tree-card__status">
          <t-button
            v-if="menu.children.length > 0"
            :aria-label="isExpanded(menu) ? `收起${menu.name}` : `展开${menu.name}`"
            shape="square"
            size="small"
            theme="default"
            variant="text"
            @click="toggleExpanded(menu)"
          >
            <template #icon>
              <ChevronDownIcon :class="{ 'is-expanded': isExpanded(menu) }" />
            </template>
          </t-button>
          <AppStatusTag :label="menu.enabled ? '启用' : '停用'" :status="menu.enabled ? 'success' : 'disabled'" />
          <AppStatusTag v-if="!menu.visible" label="隐藏" status="warning" />
        </div>
      </div>

      <dl class="app-menu-tree-card__details">
        <template v-if="menu.routePath">
          <dt>地址</dt>
          <dd>{{ menu.routePath }}</dd>
        </template>
        <template v-if="menu.component">
          <dt>组件</dt>
          <dd>{{ menu.component }}</dd>
        </template>
        <template v-if="menu.permissionCode">
          <dt>权限</dt>
          <dd>{{ menu.permissionCode }}</dd>
        </template>
      </dl>

      <div class="app-menu-tree-card__actions">
        <t-button v-if="canAdd && menu.menuType !== 'BUTTON'" size="small" theme="primary" variant="text" @click="emit('createChild', menu)">
          新增子级
        </t-button>
        <t-button v-if="canAdd" size="small" theme="default" variant="text" @click="emit('createSibling', menu)">
          新增同级
        </t-button>
        <t-button v-if="canEdit" size="small" theme="primary" variant="text" @click="emit('edit', menu)">
          编辑
        </t-button>
        <t-button v-if="canEdit" size="small" :theme="menu.enabled ? 'warning' : 'success'" variant="text" @click="emit('toggle', menu)">
          {{ menu.enabled ? '停用' : '启用' }}
        </t-button>
        <t-button v-if="canRemove" size="small" theme="danger" variant="text" @click="emit('remove', menu)">
          删除
        </t-button>
      </div>

      <AppMenuTreeCard
        v-if="isExpanded(menu) && menu.children.length > 0"
        :can-add="canAdd"
        :can-edit="canEdit"
        :can-remove="canRemove"
        :expanded-node-ids="expandedNodeIds"
        :nodes="menu.children"
        @create-child="emit('createChild', $event)"
        @create-sibling="emit('createSibling', $event)"
        @edit="emit('edit', $event)"
        @remove="emit('remove', $event)"
        @toggle="emit('toggle', $event)"
        @toggle-expand="emit('toggleExpand', $event)"
      />
    </article>
  </div>
</template>

<style scoped>
.app-menu-tree-card {
  display: grid;
  gap: var(--td-size-3);
}

.app-menu-tree-card__item {
  display: grid;
  gap: var(--td-size-3);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-menu-tree-card .app-menu-tree-card {
  margin-top: var(--td-size-1);
  margin-left: var(--td-size-4);
  padding-left: var(--td-size-3);
  border-left: 2px solid var(--td-brand-color-light);
}

.app-menu-tree-card__header,
.app-menu-tree-card__identity,
.app-menu-tree-card__status,
.app-menu-tree-card__actions {
  display: flex;
  align-items: center;
}

.app-menu-tree-card__header {
  justify-content: space-between;
  gap: var(--td-size-3);
}

.app-menu-tree-card__identity {
  min-width: 0;
  gap: var(--td-size-2);
}

.app-menu-tree-card__icon {
  flex: 0 0 auto;
  color: var(--td-brand-color);
  font-size: var(--td-font-size-title-medium);
}

.app-menu-tree-card__name {
  display: grid;
  min-width: 0;
  gap: var(--td-size-1);
}

.app-menu-tree-card__name strong,
.app-menu-tree-card__name span,
.app-menu-tree-card__details dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-menu-tree-card__name span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-menu-tree-card__status {
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--td-size-1);
}

.app-menu-tree-card__status .is-expanded {
  transform: rotate(180deg);
}

.app-menu-tree-card__details {
  display: grid;
  margin: 0;
  grid-template-columns: auto minmax(0, 1fr);
  gap: var(--td-size-1) var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-menu-tree-card__details dt {
  color: var(--td-text-color-placeholder);
}

.app-menu-tree-card__details dd {
  min-width: 0;
  margin: 0;
  color: var(--td-text-color-primary);
}

.app-menu-tree-card__actions {
  flex-wrap: wrap;
  gap: var(--td-size-1);
}

@media (max-width: 480px) {
  .app-menu-tree-card__header {
    align-items: flex-start;
    flex-direction: column;
  }

  .app-menu-tree-card__status {
    justify-content: flex-start;
  }
}
</style>