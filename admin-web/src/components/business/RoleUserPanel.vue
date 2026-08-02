<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h, ref } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { useRoleUsers } from '@/composables/useRoleUsers'
import type { RoleUserRow } from '@/composables/useRoleUsers'

export type RoleUserDrawerInstance = ReturnType<typeof useRoleUsers>

const props = defineProps<{
  users: RoleUserDrawerInstance
}>()

const activeTab = ref<'assigned' | 'candidates'>('assigned')

const assignedColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 140, title: '用户' },
  { colKey: 'phone', minWidth: 140, title: '手机号' },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.status === 'ACTIVE' ? '正常' : '已禁用',
      status: row.status === 'ACTIVE' ? 'success' : 'warning',
    }),
    colKey: 'status',
    title: '状态',
    width: 90,
  },
]

const candidateColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 140, title: '用户' },
  { colKey: 'phone', minWidth: 140, title: '手机号' },
  {
    cell: (_h, { row }) => row.alreadyAssigned
      ? h(AppStatusTag, { label: '已分配', status: 'default' })
      : '—',
    colKey: 'alreadyAssigned',
    title: '分配状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.status === 'ACTIVE' ? '正常' : '已禁用',
      status: row.status === 'ACTIVE' ? 'success' : 'warning',
    }),
    colKey: 'status',
    title: '状态',
    width: 90,
  },
]

const assignedErrorDescription = computed(() => props.users.assignedList.error.value
  ? normalizeFeedbackError(props.users.assignedList.error.value).message
  : '请检查网络连接后重试')
const candidateErrorDescription = computed(() => props.users.candidateList.error.value
  ? normalizeFeedbackError(props.users.candidateList.error.value).message
  : '请检查网络连接后重试')

function removeOne(row: TableRowData): void {
  const user = row as RoleUserRow
  void props.users.removeAction.run([user.id])
}
</script>

<template>
  <t-tabs v-model="activeTab" class="role-user-panel__tabs">
    <t-tab-panel :label="`已分配用户（${users.assignedCount.value}）`" value="assigned">
      <div class="role-user-panel__tab mt-5">
        <AppSearchPanel
          :loading="users.assignedList.isLoading.value"
          @reset="users.assignedList.reset"
          @search="users.assignedList.search"
        >
          <t-form-item label="关键词">
            <t-input
              v-model="users.assignedList.query.keyword"
              clearable
              placeholder="用户昵称或手机号"
            />
          </t-form-item>
        </AppSearchPanel>

        <AppDataTable
          :columns="assignedColumns"
          :current="users.assignedList.current.value"
          :data="users.assignedRows.value"
          empty-description="可切换到“未分配用户”标签分配"
          empty-title="暂无已分配用户"
          :error-description="assignedErrorDescription"
          :page-size="users.assignedList.pageSize.value"
          row-key="id"
          :row-selection-type="'multiple'"
          :selected-row-keys="[...users.assignedList.selectedRowKeys.value]"
          :status="users.assignedList.tableStatus.value"
          :total="users.assignedList.total.value"
          @page-change="users.assignedList.changePage"
          @refresh="users.assignedList.refresh"
          @retry="users.assignedList.retry"
          @selection-change="users.syncAssignedSelection"
        >
          <template #toolbar>
            <t-button
              :disabled="users.assignedList.selectedRowKeys.value.length === 0
                || users.assignAction.running.value
                || users.removeAction.running.value"
              :loading="users.removeAction.running.value"
              theme="danger"
              variant="outline"
              @click="users.removeAction.run(users.assignedList.selectedRowKeys.value)"
            >
              批量移除（{{ users.assignedList.selectedRowKeys.value.length }}）
            </t-button>
          </template>
          <template #operations="{ row }">
            <t-button
              :disabled="users.assignAction.running.value || users.removeAction.running.value"
              size="small"
              theme="danger"
              variant="text"
              @click="removeOne(row)"
            >
              移除
            </t-button>
          </template>
        </AppDataTable>
      </div>
    </t-tab-panel>

    <t-tab-panel label="未分配用户" value="candidates">
      <div class="role-user-panel__tab mt-5">
        <AppSearchPanel
          :loading="users.candidateList.isLoading.value"
          @reset="users.candidateList.reset"
          @search="users.candidateList.search"
        >
          <t-form-item label="关键词">
            <t-input
              v-model="users.candidateList.query.keyword"
              clearable
              placeholder="用户昵称或手机号"
            />
          </t-form-item>
        </AppSearchPanel>

        <AppDataTable
          :columns="candidateColumns"
          :current="users.candidateList.current.value"
          :data="users.candidateRows.value"
          empty-description="所有用户均已分配该角色"
          empty-title="暂无未分配用户"
          :error-description="candidateErrorDescription"
          :page-size="users.candidateList.pageSize.value"
          row-key="id"
          :row-selection-type="'multiple'"
          :selected-row-keys="[...users.candidateList.selectedRowKeys.value]"
          :selection-disabled="row => row.alreadyAssigned"
          :status="users.candidateList.tableStatus.value"
          :total="users.candidateList.total.value"
          @page-change="users.candidateList.changePage"
          @refresh="users.candidateList.refresh"
          @retry="users.candidateList.retry"
          @selection-change="users.syncCandidateSelection"
        >
          <template #toolbar>
            <t-button
              :disabled="users.candidateList.selectedRowKeys.value.length === 0
                || users.assignAction.running.value
                || users.removeAction.running.value"
              :loading="users.assignAction.running.value"
              theme="primary"
              @click="users.assignAction.run(users.candidateList.selectedRowKeys.value)"
            >
              批量分配（{{ users.candidateList.selectedRowKeys.value.length }}）
            </t-button>
          </template>
        </AppDataTable>
      </div>
    </t-tab-panel>
  </t-tabs>
</template>

<style scoped>
.role-user-panel__tabs {
  min-width: 0;
}

.role-user-panel__tab {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.role-user-panel__tab :deep(.app-data-table) {
  flex: 1 1 auto;
}
</style>