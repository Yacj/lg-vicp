<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useDepartmentMembers } from '@/composables/useDepartmentMembers'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'SystemDeptMembers' })

const route = useRoute()
const router = useRouter()
const departmentId = String(route.params.id)

const { memberList } = useDepartmentMembers(departmentId)

const memberRows = memberList.data
const memberCurrent = memberList.current
const memberPageSize = memberList.pageSize
const memberTotal = memberList.total
const memberTableStatus = memberList.tableStatus
const memberLoading = memberList.isLoading
const memberErrorDescription = computed(() => memberList.error.value
  ? normalizeFeedbackError(memberList.error.value).message
  : '请检查网络连接后重试')

const memberStatusOptions = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'ACTIVE' },
  { label: '已禁用', value: 'DISABLED' },
]

const memberColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 160, title: '用户昵称' },
  { colKey: 'phone', minWidth: 150, title: '手机号' },
  { colKey: 'email', minWidth: 200, title: '邮箱' },
  { colKey: 'role', minWidth: 140, title: '用户角色' },
  {
    cell: (_h, { row }) => h(AppStatusTag, {
      label: row.status === 'ACTIVE' ? '正常' : '已禁用',
      status: row.status === 'ACTIVE' ? 'success' : 'disabled',
    }),
    colKey: 'status',
    title: '状态',
    width: 110,
  },
  {
    cell: (_h, { row }) => formatDate(new Date(row.createdAt)),
    colKey: 'createdAt',
    title: '创建时间',
    width: 180,
  },
]

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
  <AppPage>
    <template #navigation>
      <t-button @click="goBack"  theme="default" variant="outline">
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
            placeholder="用户昵称"
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
      empty-description="当前部门暂无用户"
      empty-title="暂无成员"
      :error-description="memberErrorDescription"
      :page-size="memberPageSize"
      row-key="id"
      :status="memberTableStatus"
      :total="memberTotal"
      @page-change="memberList.changePage"
      @refresh="memberList.refresh"
      @retry="memberList.retry"
    />
  </AppPage>
</template>