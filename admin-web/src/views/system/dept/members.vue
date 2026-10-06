<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon, ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useDepartmentMembers } from '@/composables/useDepartmentMembers'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { AppTableAction } from '@/types/crud'
import type { DepartmentMemberItem, SystemUserRole, SystemUserStatus } from '@/types/system-management'
import { formatDate } from '@/utils/day'
import { userRoleLabels, userStatusLabels } from '@/utils/system-user'

defineOptions({ name: 'SystemDeptMembers' })

const route = useRoute()
const router = useRouter()
const departmentId = String(route.params.id)
const departmentName = typeof route.query.name === 'string' ? route.query.name : ''

const {
  addMember,
  addVisible,
  addingUserId,
  candidateList,
  candidateRows,
  memberList,
  openAdd,
  removeAction,
  setAddVisible,
} = useDepartmentMembers(departmentId)
const { canAccess } = usePermissionAccess()
const canManageMembers = computed(() => canAccess({ permissions: ['system:user:dept'] }))

const memberRows = memberList.data
const memberCurrent = memberList.current
const memberPageSize = memberList.pageSize
const memberTotal = memberList.total
const memberTableStatus = memberList.tableStatus
const memberLoading = memberList.isLoading
const memberErrorDescription = computed(() => memberList.error.value
  ? normalizeFeedbackError(memberList.error.value).message
  : '请检查网络连接后重试')
const candidateErrorDescription = computed(() => candidateList.error.value
  ? normalizeFeedbackError(candidateList.error.value).message
  : '请检查网络连接后重试')

const memberStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'ACTIVE' },
  { label: '已禁用', value: 'DISABLED' },
]

const memberColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 160, title: '用户昵称' },
  { colKey: 'phone', minWidth: 150, title: '手机号' },
  {
    cell: (_h, { row }) => userRoleLabels[row.role as SystemUserRole] ?? row.role,
    colKey: 'role',
    minWidth: 140,
    title: '账号类型',
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.isPrimary ? '主部门' : '兼属',
      status: row.isPrimary ? 'success' : 'default',
    }),
    colKey: 'isPrimary',
    title: '归属',
    width: 110,
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: userStatusLabels[row.status as SystemUserStatus],
      status: row.status === 'ACTIVE' ? 'success' : 'warning',
    }),
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => formatDate(new Date(row.joinedAt)),
    colKey: 'joinedAt',
    title: '加入时间',
    width: 180,
  },
]

const candidateColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 160, title: '用户' },
  { colKey: 'phone', minWidth: 140, title: '手机号' },
  { colKey: 'email', minWidth: 180, title: '邮箱' },
]

function getMemberActions(row: TableRowData): AppTableAction[] {
  if (!canManageMembers.value) {
    return []
  }
  const member = row as DepartmentMemberItem
  return [{
    handler: () => void removeAction.run(member),
    key: 'remove',
    label: '移除',
    loading: removeAction.running.value,
    theme: 'danger',
  }]
}

function goBack(): void {
  if (window.history.state?.back) {
    router.back()
  }
  else {
    router.push('/system/dept')
  }
}
</script>

<template>
  <AppPage :title="departmentName ? `部门成员 · ${departmentName}` : '部门成员'">
    <template #navigation>
      <t-button theme="default" variant="outline" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回部门列表
      </t-button>
    </template>

    <template #search>
      <AppSearchPanel
        :loading="memberLoading"
        @reset="memberList.reset"
        @search="memberList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="memberList.query.keyword"
            clearable
            placeholder="用户昵称或手机号"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="memberList.query.status" :options="memberStatusOptions" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="memberColumns"
      :current="memberCurrent"
      :data="memberRows"
      empty-description="可添加 C 端普通用户到当前部门"
      empty-title="暂无成员"
      :error-description="memberErrorDescription"
      :page-size="memberPageSize"
      row-key="userId"
      :status="memberTableStatus"
      :total="memberTotal"
      @page-change="memberList.changePage"
      @refresh="memberList.refresh"
      @retry="memberList.retry"
    >
      <template v-if="canManageMembers" #toolbar>
        <t-button theme="primary" @click="openAdd">
          <template #icon>
            <AddIcon />
          </template>
          添加成员
        </t-button>
      </template>
      <template v-if="canManageMembers" #operations="{ row }">
        <AppTableActions :actions="getMemberActions(row)" />
      </template>
    </AppDataTable>

    <t-dialog
      :footer="false"
      header="添加部门成员"
      :visible="addVisible"
      width="min(720px, 92vw)"
      @close="setAddVisible(false)"
    >
      <p class="vicp-dept-member-hint">
        仅可搜索 C 端普通用户。已在当前部门中的账号不可重复添加。
      </p>
      <AppSearchPanel
        :loading="candidateList.isLoading.value"
        @reset="candidateList.reset"
        @search="candidateList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="candidateList.query.keyword"
            clearable
            placeholder="姓名、登录账号或联系方式"
          />
        </t-form-item>
      </AppSearchPanel>
      <AppDataTable
        class="mt-3"
        :columns="candidateColumns"
        :current="candidateList.current.value"
        :data="candidateRows"
        empty-description="没有可添加的普通用户"
        empty-title="暂无候选用户"
        :error-description="candidateErrorDescription"
        :page-size="candidateList.pageSize.value"
        row-key="id"
        :status="candidateList.tableStatus.value"
        :total="candidateList.total.value"
        @page-change="candidateList.changePage"
        @refresh="candidateList.refresh"
        @retry="candidateList.retry"
      >
        <template #operations="{ row }">
          <t-button
            :disabled="row.alreadyAssigned || addingUserId === row.id"
            :loading="addingUserId === row.id"
            size="small"
            theme="primary"
            variant="text"
            @click="addMember(row.id)"
          >
            {{ row.alreadyAssigned ? '已在部门中' : '添加' }}
          </t-button>
        </template>
      </AppDataTable>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.vicp-dept-member-hint {
  margin: 0 0 var(--td-size-4);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}
</style>
