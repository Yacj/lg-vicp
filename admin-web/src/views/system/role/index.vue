<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import RolePermissionDrawer from '@/components/business/RolePermissionDrawer.vue'
import RoleUserDrawer from '@/components/business/RoleUserDrawer.vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppPermissionSelector from '@/components/business/AppPermissionSelector.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useRoleManagement } from '@/composables/useRoleManagement'
import { useRolePermissionScope } from '@/composables/useRolePermissionScope'
import { useRoleUsers } from '@/composables/useRoleUsers'
import type { RoleForm } from '@/composables/useRoleManagement'
import type { AppTableAction } from '@/types/crud'
import type { SystemRole } from '@/types/system-management'
import { getDataScopeLabel } from '@/utils/system-role'
import { formatDate } from '@/utils/day'

const {
  permissionCount,
  permissionLoadError,
  permissionLoadStatus,
  permissionTree,
  permissionValues,
  roleDeleteAction,
  roleDrawer,
  roleList,
  roleStatusAction,
  selectedPermissionCount,
  setPermissionValues,
} = useRoleManagement()
const permissionScope = useRolePermissionScope({
  onScopeSaved: () => void roleList.refresh(),
})
const roleUsers = useRoleUsers()
const { canAccess } = usePermissionAccess()

const permissionLoadErrorText = computed(() =>
  permissionLoadError.value
    ? normalizeFeedbackError(permissionLoadError.value).message
    : '请稍后重试')

const rows = roleList.data
const current = roleList.current
const pageSize = roleList.pageSize
const total = roleList.total
const tableStatus = roleList.tableStatus
const drawerVisible = roleDrawer.visible
const drawerMode = roleDrawer.mode
const drawerSubmitting = roleDrawer.isSubmitting
const statusRunning = roleStatusAction.running
const deleteRunning = roleDeleteAction.running

const canAddRole = computed(() => canAccess({ permissions: ['system:role:add'] }))
const canEditRole = computed(() => canAccess({ permissions: ['system:role:edit'] }))
const canRemoveRole = computed(() => canAccess({ permissions: ['system:role:remove'] }))
const canManageScope = computed(() => canAccess({ permissions: ['system:role:data-scope'] }))
const canAssignUsers = computed(() =>
  canAccess({ permissions: ['system:user:role', 'system:user:list'], permissionMatch: 'all' }))

const statusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '启用', value: 'enabled' },
  { label: '停用', value: 'disabled' },
]

const rules: FormRules<RoleForm> = {
  code: [
    { message: '请输入角色编码', required: true },
    { message: '编码应以小写字母开头，仅包含小写字母、数字、点、下划线或连字符，至少 3 个字符', pattern: /^[a-z][a-z0-9_.-]{2,79}$/ },
  ],
  name: [
    { message: '请输入角色名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
  description: [{ max: 1000, message: '描述不能超过 1000 个字符' }],
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 160, title: '角色名称' },
  {
    cell: (_h, { row }) => h('code', { class: 'role-page__code' }, row.code),
    colKey: 'code',
    minWidth: 160,
    title: '角色编码',
  },
  {
    cell: (_h, { row }) => getDataScopeLabel(row.dataScope),
    colKey: 'dataScope',
    minWidth: 140,
    title: '数据范围',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.enabled ? '启用' : '停用',
      status: row.enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 100,
  },
  { colKey: 'description', ellipsis: true, minWidth: 220, title: '描述' },
  {
    cell: (_h, { row }) => formatDate(new Date(row.updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

const errorDescription = computed(() => roleList.error.value
  ? normalizeFeedbackError(roleList.error.value).message
  : '请检查网络连接后重试')

function getActions(row: TableRowData): AppTableAction[] {
  const role = row as SystemRole
  const actions: AppTableAction[] = []
  if (canManageScope.value) {
    actions.push({
      handler: () => permissionScope.open(role),
      key: 'scope',
      label: '数据范围',
    })
  }
  if (canAssignUsers.value) {
    actions.push({
      handler: () => roleUsers.open(role),
      key: 'users',
      label: '用户分配',
    })
  }
  if (canEditRole.value) {
    actions.push(
      {
        handler: () => roleDrawer.openEdit(role),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => roleStatusAction.run({ enabled: !role.enabled, role }),
        key: 'status',
        label: role.enabled ? '停用' : '启用',
        loading: statusRunning.value,
        theme: role.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveRole.value) {
    actions.push({
      handler: () => roleDeleteAction.run(role),
      key: 'remove',
      label: '删除',
      loading: deleteRunning.value,
      theme: 'danger',
    })
  }
  return actions
}
</script>

<template>
  <AppPage>
    <template #search>
      <AppSearchPanel
        :loading="roleList.isLoading.value"
        @reset="roleList.reset"
        @search="roleList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="roleList.query.keyword"
            clearable
            placeholder="角色名称、编码或描述"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="roleList.query.status" :options="statusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      empty-description="可新增第一个角色"
      empty-title="暂无角色"
      :error-description="errorDescription"
      :page-size="pageSize"
      row-key="id"
      :status="tableStatus"
      :total="total"
      @page-change="roleList.changePage"
      @refresh="roleList.refresh"
      @retry="roleList.retry"
    >
      <template v-if="canAddRole" #toolbar>
        <t-button theme="primary" @click="roleDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增角色
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      description="角色编码创建后可修改，注意保持全局唯一；菜单权限在保存角色时一并写入。"
      :form-data="roleDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增角色' : '编辑角色'"
      :visible="drawerVisible"
      :width="'min(720px, 92vw)'"
      @cancel="roleDrawer.close"
      @submit="roleDrawer.submit"
      @update:visible="roleDrawer.setVisible"
    >
      <t-form-item label="角色名称" name="name">
        <t-input v-model="roleDrawer.formData.name" maxlength="120" placeholder="例如：项目经理" />
      </t-form-item>
      <t-form-item label="角色编码" name="code">
        <t-input
          v-model="roleDrawer.formData.code"
          maxlength="80"
          placeholder="例如 project_manager"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-radio-group v-model="roleDrawer.formData.enabled" variant="default-filled">
          <t-radio :value="true">启用</t-radio>
          <t-radio :value="false">停用</t-radio>
        </t-radio-group>
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="描述" name="description">
        <t-textarea
          v-model="roleDrawer.formData.description"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="1000"
          placeholder="选填，说明角色职责或适用范围"
        />
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="菜单权限">
        <div class="role-page__permission-field">
          <t-alert
            v-if="permissionLoadStatus === 'unavailable'"
            class="role-page__permission-notice"
            theme="warning"
            title="当前账号没有配置角色权限的权限（system:role:permission），保存角色时将不修改其权限。"
          />
          <t-alert
            v-else-if="permissionLoadStatus === 'error'"
            class="role-page__permission-notice"
            theme="error"
            title="权限树加载失败，保存角色时将不修改其权限。"
          >
            {{ permissionLoadErrorText }}
          </t-alert>
          <t-alert
            v-else-if="drawerMode === 'edit'"
            class="role-page__permission-notice"
            theme="info"
            title="保存将用当前勾选覆盖该角色的全部权限；未勾选即清空。"
          />
          <div v-if="permissionLoadStatus !== 'unavailable'" class="role-page__permission-count">
            已选 {{ selectedPermissionCount }} / 共 {{ permissionCount }} 项
          </div>
          <AppPermissionSelector
            :model-value="permissionValues"
            :disabled="drawerSubmitting || permissionLoadStatus === 'loading' || permissionLoadStatus === 'error' || permissionLoadStatus === 'unavailable'"
            :loading="permissionLoadStatus === 'loading'"
            :options="permissionTree"
            search-placeholder="按权限名称或编码搜索"
            select-all-text="全选"
            :show-count="false"
            @update:model-value="setPermissionValues"
          />
        </div>
      </t-form-item>
    </AppCrudFormDialog>

    <RolePermissionDrawer :scope="permissionScope" />
    <RoleUserDrawer :users="roleUsers" />
  </AppPage>
</template>

<style scoped>
.role-page__code {
  padding: 0 var(--td-size-1);
  color: var(--td-brand-color);
  background: var(--td-brand-color-light);
  border-radius: var(--td-radius-small);
  font-family: var(--td-font-family-mono);
}

.role-page__permission-field {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.role-page__permission-notice {
  width: 100%;
}

.role-page__permission-count {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>