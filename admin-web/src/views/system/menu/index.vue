<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, LinkIcon } from 'tdesign-icons-vue-next'
import { computed, h, watch } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppMenuIconPicker from '@/components/business/AppMenuIconPicker.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { SystemMenuForm } from '@/utils/system-menu'
import { getMenuTypeLabel } from '@/utils/system-menu'
import { useMenuManagement } from '@/composables/useMenuManagement'
import type { AppTableAction } from '@/types/crud'
import type { SystemMenuTreeNode } from '@/types/system-management'

const {
  allTreeNodesExpanded,
  dynamicComponentOptions,
  expandedTreeNodes,
  hasExpandableTreeNodes,
  menuDeleteAction,
  menuDrawer,
  menuList,
  menuStatusAction,
  openCreate,
  openCreateChild,
  openCreateSibling,
  openEdit,
  parentOptions,
  runtimeRefreshError,
  toggleAllTreeNodes,
  updateExpandedTreeNodes,
} = useMenuManagement()

const { canAccess } = usePermissionAccess()

const canAddMenu = computed(() => canAccess({ permissions: ['system:menu:add'] }))
const canEditMenu = computed(() => canAccess({ permissions: ['system:menu:edit'] }))
const canRemoveMenu = computed(() => canAccess({ permissions: ['system:menu:remove'] }))
const menuDrawerVisible = menuDrawer.visible
const menuDrawerMode = menuDrawer.mode
const menuDrawerSubmitting = menuDrawer.isSubmitting
const menuRows = menuList.data
const menuTableStatus = menuList.tableStatus
const menuLoading = menuList.isLoading
const menuErrorDescription = computed(() => menuList.error.value
  ? normalizeFeedbackError(menuList.error.value).message
  : '请检查网络连接后重试')
const runtimeErrorDescription = computed(() => runtimeRefreshError.value
  ? normalizeFeedbackError(runtimeRefreshError.value).message
  : '')

// t-auto-complete 的 options 期望可变数组，白名单列表本身是冻结常量
const dynamicComponentOptionList = computed(() => [...dynamicComponentOptions])

const menuRules: FormRules<SystemMenuForm> = {
  name: [
    { message: '请输入菜单名称', required: true },
    { max: 120, message: '菜单名称不能超过 120 个字符' },
  ],
  sortOrder: [{ message: '排序值必须是整数', number: true }],
}

const menuColumns: PrimaryTableCol<TableRowData>[] = [
  {
    cell: (_h, { row }) => h('div', { class: 'menu-management__name-cell' }, [
      h(AppIcon, { class: 'menu-management__icon mr-3', name: row.icon,}),
      h('span', row.name),
    ]),
    colKey: 'name',
    minWidth: 220,
    title: '菜单名称',
  },
  {
    cell: (_h, { row }) => getMenuTypeLabel(row.menuType),
    colKey: 'menuType',
    title: '类型',
    width: 100,
  },
  {
    cell: (_h, { row }) => row.isExternal
      ? h('span', { class: 'menu-management__external-path' }, [h(LinkIcon), row.routePath ?? ''])
      : row.routePath ?? '—',
    colKey: 'routePath',
    ellipsis: true,
    minWidth: 220,
    title: '路由地址',
  },
  { colKey: 'component', ellipsis: true, minWidth: 180, title: '组件白名单键' },
  { colKey: 'permissionCode', ellipsis: true, minWidth: 180, title: '权限码' },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.visible ? '显示' : '隐藏',
      status: row.visible ? 'success' : 'warning',
    }),
    colKey: 'visible',
    title: '可见',
    width: 90,
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.enabled ? '启用' : '停用',
      status: row.enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 95,
  },
  { colKey: 'sortOrder', title: '排序', width: 80 },
]

function getMenuActions(row: TableRowData): AppTableAction[] {
  const menu = row as SystemMenuTreeNode
  const actions: AppTableAction[] = []
  if (canAddMenu.value) {
    if (menu.menuType !== 'BUTTON') {
      actions.push({
        handler: () => openCreateChild(menu),
        key: 'create-child',
        label: '新增子级',
      })
    }
    actions.push({
      handler: () => openCreateSibling(menu),
      key: 'create-sibling',
      label: '新增同级',
    })
  }
  if (canEditMenu.value) {
    actions.push(
      {
        handler: () => openEdit(menu),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => menuStatusAction.run({ menu, enabled: !menu.enabled }),
        key: 'status',
        label: menu.enabled ? '停用' : '启用',
        loading: menuStatusAction.running.value,
        theme: menu.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveMenu.value) {
    actions.push({
      handler: () => menuDeleteAction.run(menu),
      key: 'remove',
      label: '删除',
      loading: menuDeleteAction.running.value,
      theme: 'danger',
    })
  }
  return actions
}

function resetTypeFields(type: SystemMenuForm['menuType']): void {
  if (type === 'BUTTON') {
    menuDrawer.formData.routePath = ''
    menuDrawer.formData.component = ''
    menuDrawer.formData.icon = null
    menuDrawer.formData.isExternal = false
  }
  else if (type === 'DIRECTORY') {
    menuDrawer.formData.component = ''
    menuDrawer.formData.isExternal = false
  }
}

watch(() => menuDrawer.formData.menuType, type => resetTypeFields(type))
</script>

<template>
  <AppPage
  >
    <template #search>
      <AppSearchPanel
        :loading="menuLoading"
        @reset="menuList.reset"
        @search="menuList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="menuList.query.keyword"
            clearable
            placeholder="名称、路径、组件或权限码"
          />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <t-alert
      v-if="runtimeRefreshError"
      class="menu-management__notice"
      theme="warning"
      title="菜单数据已保存，但运行时菜单未能同步。"
    >
      {{ runtimeErrorDescription }}
    </t-alert>

    <AppDataTable
      :columns="menuColumns"
      :data="menuRows"
      empty-description="可新增第一个目录或菜单"
      empty-title="暂无菜单"
      :error-description="menuErrorDescription"
      :expanded-tree-nodes="expandedTreeNodes"
      :show-pagination="false"
      :show-toolbar="true"
      row-key="id"
      :status="menuTableStatus"
      :tree="{ childrenKey: 'children', expandTreeNodeOnClick: true }"
      @expanded-tree-nodes-change="updateExpandedTreeNodes"
      @refresh="menuList.refresh"
      @retry="menuList.retry"
    >
      <template #toolbar>
        <t-button v-if="canAddMenu" theme="primary" @click="openCreate()">
        <template #icon>
          <AddIcon />
        </template>
        新增菜单
      </t-button>
        <t-button
          :disabled="menuLoading || !hasExpandableTreeNodes"
          theme="default"
          variant="outline"
          @click="toggleAllTreeNodes"
        >
          {{ allTreeNodesExpanded ? '全部收起' : '全部展开' }}
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getMenuActions(row)" :max-visible="2" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :description="menuDrawerMode === 'create' ? '菜单类型决定可配置字段；内部菜单组件只能从本地白名单选择。' : '修改菜单后会重新获取当前用户的运行时菜单。'"
      :form-data="menuDrawer.formData"
      :mode="menuDrawerMode"
      :rules="menuRules"
      :width="'min(760px, 92vw)'"
      :submitting="menuDrawerSubmitting"
      :title="menuDrawerMode === 'create' ? '新增菜单' : '编辑菜单'"
      :visible="menuDrawerVisible"
      @cancel="menuDrawer.close"
      @submit="menuDrawer.submit"
      @update:visible="menuDrawer.setVisible"
    >
      <t-form-item label="上级菜单" name="parentId">
        <t-tree-select
          v-model="menuDrawer.formData.parentId"
          clearable
          :data="parentOptions"
          placeholder="请选择上级；留空表示根节点"
        />
      </t-form-item>

      <t-form-item label="菜单类型" name="menuType">
        <t-select
          v-model="menuDrawer.formData.menuType"
          :disabled="menuDrawerMode === 'edit' && Boolean(menuDrawer.entity)"
          :options="[
            { label: '目录', value: 'DIRECTORY' },
            { label: '菜单', value: 'MENU' },
            { label: '按钮', value: 'BUTTON' },
          ]"
        />
      </t-form-item>

      <t-form-item label="名称" name="name">
        <t-input v-model="menuDrawer.formData.name" maxlength="120" placeholder="请输入菜单名称" />
      </t-form-item>

      <t-form-item v-if="menuDrawer.formData.menuType !== 'BUTTON'" label="图标" name="icon">
        <AppMenuIconPicker v-model="menuDrawer.formData.icon" :disabled="menuDrawerSubmitting" />
      </t-form-item>

      <t-form-item v-if="menuDrawer.formData.menuType === 'DIRECTORY'" class="vicp-form-grid-item--wide" label="目录路径" name="routePath">
        <t-input v-model="menuDrawer.formData.routePath" placeholder="可选，例如 /system" />
      </t-form-item>

      <template v-if="menuDrawer.formData.menuType === 'MENU'">
        <t-form-item label="外链菜单" name="isExternal">
          <t-switch v-model="menuDrawer.formData.isExternal" :label="['外链', '内部']" />
        </t-form-item>
        <t-form-item class="vicp-form-grid-item--wide" :label="menuDrawer.formData.isExternal ? 'HTTP(S) 地址' : '内部路由路径'" name="routePath">
          <t-input
            v-model="menuDrawer.formData.routePath"
            :placeholder="menuDrawer.formData.isExternal ? 'https://example.com' : '/system/menu'"
          />
        </t-form-item>
        <t-form-item
          class="vicp-form-grid-item--wide"
          label="组件白名单"
          name="component"
          tips="可选择完整页面路径；提交时会转换为安全白名单 key，例如 @/views/system/dept/members.vue → system/dept/members。"
        >
          <t-auto-complete
            v-model="menuDrawer.formData.component"
            clearable
            :options="dynamicComponentOptionList"
            placeholder="输入内部 key 或 @/views/...vue 路径"
          />
        </t-form-item>
      </template>

      <t-form-item
        class="vicp-form-grid-item--wide"
        label="权限码"
        name="permissionCode"
        tips="可选；按钮必须填写。通常使用小写模块:资源:动作格式，不要带空格，例如 system:dept:list、system:dept:add；项目与 AI 现有权限也包含 project.create、ai.chat。"
      >
        <t-input
          v-model="menuDrawer.formData.permissionCode"
          clearable
          maxlength="120"
          placeholder="请输入权限码，例如 system:dept:list"
        />
      </t-form-item>

      <t-form-item label="排序" name="sortOrder">
        <t-input-number v-model="menuDrawer.formData.sortOrder" :decimal-places="0" theme="column" />
      </t-form-item>
      <t-form-item v-if="menuDrawer.formData.menuType !== 'BUTTON'" label="可见性" name="visible">
        <t-switch v-model="menuDrawer.formData.visible" :label="['显示', '隐藏']" />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-switch v-model="menuDrawer.formData.enabled" :label="['启用', '停用']" />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>

<style scoped>
.menu-management__notice {
  margin-bottom: var(--td-size-4);
}

.menu-management__external-path {
  display: inline-flex;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-brand-color);
}

.menu-management__name-cell {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
}

.menu-management__name-cell span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.menu-management__icon {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-title-medium);
}
</style>