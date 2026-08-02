<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type {
  DepartmentForm,
} from '@/composables/useDepartmentManagement'
import { useDepartmentManagement } from '@/composables/useDepartmentManagement'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { SystemDepartmentTreeNode } from '@/types/system-management'

const {
  allTreeNodesExpanded,
  departmentDeleteAction,
  departmentDrawer,
  departmentList,
  departmentStatusAction,
  expandedTreeNodes,
  hasExpandableTreeNodes,
  parentOptions,
  toggleAllTreeNodes,
  updateExpandedTreeNodes,
} = useDepartmentManagement()
const { canAccess } = usePermissionAccess()

const departmentRows = departmentList.data
const departmentTableStatus = departmentList.tableStatus
const departmentLoading = departmentList.isLoading
const departmentTotal = departmentList.total
const departmentDrawerVisible = departmentDrawer.visible
const departmentDrawerMode = departmentDrawer.mode
const departmentDrawerSubmitting = departmentDrawer.isSubmitting
const departmentErrorDescription = computed(() => departmentList.error.value
  ? normalizeFeedbackError(departmentList.error.value).message
  : '请检查网络连接后重试')

const canAddDepartment = computed(() => canAccess({ permissions: ['system:dept:add'] }))
const canEditDepartment = computed(() => canAccess({ permissions: ['system:dept:edit'] }))
const canRemoveDepartment = computed(() => canAccess({ permissions: ['system:dept:remove'] }))
const canViewMembers = computed(() => canAccess({ permissions: ['system:user:list'] }))
const router = useRouter()

const departmentRules: FormRules<DepartmentForm> = {
  code: [
    { message: '请输入部门编码', required: true },
    { max: 80, message: '部门编码不能超过 80 个字符' },
  ],
  email: [{ email: true, message: '邮箱格式不正确' }],
  name: [
    { message: '请输入部门名称', required: true },
    { max: 120, message: '部门名称不能超过 120 个字符' },
  ],
  phone: [{ max: 32, message: '联系电话不能超过 32 个字符' }],
  sortOrder: [{ message: '排序值必须是整数', number: true }],
}

const departmentColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 220, title: '部门名称' },
  { colKey: 'code', minWidth: 160, title: '部门编码' },
  { colKey: 'leader', minWidth: 120, title: '负责人' },
  { colKey: 'phone', minWidth: 150, title: '联系电话' },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.enabled ? '启用' : '停用',
      status: row.enabled ? 'success' : 'disabled',
    }),
    colKey: 'enabled',
    title: '状态',
    width: 100,
  },
  { colKey: 'sortOrder', title: '排序', width: 90 },
]

function getDepartmentActions(row: TableRowData): AppTableAction[] {
  const department = row as SystemDepartmentTreeNode
  const actions: AppTableAction[] = [{
    handler: () => {
      if (!canViewMembers.value) {
        return
      }
      void router.push({
        name: 'SystemDeptMembers',
        params: { id: department.id },
        query: { name: department.name },
      })
    },
    key: 'members',
    label: '成员',
    ...(canViewMembers.value ? {} : { disabled: true }),
  }]
  if (canEditDepartment.value) {
    actions.push(
      {
        handler: () => departmentDrawer.openEdit(department),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => departmentStatusAction.run({
          department,
          enabled: !department.enabled,
        }),
        key: 'status',
        label: department.enabled ? '停用' : '启用',
        theme: department.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemoveDepartment.value) {
    actions.push({
      handler: () => departmentDeleteAction.run(department),
      key: 'remove',
      label: '删除',
      theme: 'danger',
    })
  }
  return actions
}
</script>

<template>
  <AppPage
  >
    <template #search>
      <AppSearchPanel
        :loading="departmentLoading"
        @reset="departmentList.reset"
        @search="departmentList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="departmentList.query.keyword"
            clearable
            placeholder="部门名称、编码或负责人"
          />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="departmentColumns"
      :data="departmentRows"
      empty-title="暂无部门"
      :error-description="departmentErrorDescription"
      :expanded-tree-nodes="expandedTreeNodes"
      row-key="id"
      :status="departmentTableStatus"
      :total="departmentTotal"
      :tree="{ childrenKey: 'children', expandTreeNodeOnClick: true }"
      @expanded-tree-nodes-change="updateExpandedTreeNodes"
      @refresh="departmentList.refresh"
      @retry="departmentList.retry"
    >
      <template #toolbar>
        <t-button v-if="canAddDepartment" theme="primary" @click="departmentDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增部门
        </t-button>
        <t-button
          :disabled="departmentLoading || !hasExpandableTreeNodes"
          theme="default"
          variant="outline"
          @click="toggleAllTreeNodes"
        >
          {{ allTreeNodesExpanded ? '全部收起' : '全部展开' }}
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getDepartmentActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      :description="departmentDrawerMode === 'create' ? '新增接口只接受基础层级字段；负责人、电话和邮箱可在编辑时维护。' : '编辑时可调整上级、负责人、联系方式和状态。'"
      :form-data="departmentDrawer.formData"
      :mode="departmentDrawerMode"
      :rules="departmentRules"
      :submitting="departmentDrawerSubmitting"
      :title="departmentDrawerMode === 'create' ? '新增部门' : '编辑部门'"
      :visible="departmentDrawerVisible"
      @cancel="departmentDrawer.close"
      @submit="departmentDrawer.submit"
      @update:visible="departmentDrawer.setVisible"
    >
      <t-form-item class="vicp-form-grid-item--wide" label="上级部门" name="parentId">
        <t-tree-select
          v-model="departmentDrawer.formData.parentId"
          clearable
          :data="parentOptions"
          placeholder="请选择上级部门，留空表示根部门"
        />
      </t-form-item>
      <t-form-item label="部门名称" name="name">
        <t-input v-model="departmentDrawer.formData.name" maxlength="120" placeholder="请输入部门名称" />
      </t-form-item>
      <t-form-item label="部门编码" name="code">
        <t-input v-model="departmentDrawer.formData.code" maxlength="80" placeholder="请输入唯一编码" />
      </t-form-item>
      <t-form-item label="负责人" name="leader">
        <t-input v-model="departmentDrawer.formData.leader" maxlength="120" placeholder="编辑时可选填" />
      </t-form-item>
      <t-form-item label="联系电话" name="phone">
        <t-input v-model="departmentDrawer.formData.phone" maxlength="32" placeholder="编辑时可选填" />
      </t-form-item>
      <t-form-item label="邮箱" name="email">
        <t-input v-model="departmentDrawer.formData.email" maxlength="255" placeholder="编辑时可选填" />
      </t-form-item>
      <t-form-item label="排序" name="sortOrder">
        <t-input-number
          v-model="departmentDrawer.formData.sortOrder"
          :decimal-places="0"
          placeholder="数值越小越靠前"
          theme="column"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-switch v-model="departmentDrawer.formData.enabled" :label="['启用', '停用']" size="large"/>
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>