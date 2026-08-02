<script setup lang="ts">
import type { FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { PostForm } from '@/composables/usePostManagement'
import { usePostManagement } from '@/composables/usePostManagement'
import type { AppTableAction } from '@/types/crud'
import type { SystemPost } from '@/types/system-management'
import { formatDate } from '@/utils/day'

const { postDeleteAction, postDrawer, postList, postStatusAction } = usePostManagement()
const { canAccess } = usePermissionAccess()

const rows = postList.data
const current = postList.current
const pageSize = postList.pageSize
const total = postList.total
const tableStatus = postList.tableStatus
const drawerVisible = postDrawer.visible
const drawerMode = postDrawer.mode
const drawerSubmitting = postDrawer.isSubmitting
const statusRunning = postStatusAction.running
const deleteRunning = postDeleteAction.running

const canAddPost = computed(() => canAccess({ permissions: ['system:post:add'] }))
const canEditPost = computed(() => canAccess({ permissions: ['system:post:edit'] }))
const canRemovePost = computed(() => canAccess({ permissions: ['system:post:remove'] }))

const rules: FormRules<PostForm> = {
  code: [
    { message: '请输入岗位编码', required: true },
    { message: '编码应以小写字母开头，仅包含小写字母、数字、点、下划线或连字符', pattern: /^[a-z][a-z0-9_.-]{1,79}$/ },
  ],
  name: [
    { message: '请输入岗位名称', required: true },
    { max: 120, message: '名称不能超过 120 个字符' },
  ],
  remark: [{ max: 1000, message: '备注不能超过 1000 个字符' }],
  sortOrder: [{ message: '排序值必须是整数', number: true }],
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 180, title: '岗位名称' },
  { colKey: 'code', minWidth: 180, title: '岗位编码' },
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
  { colKey: 'remark', ellipsis: true, minWidth: 220, title: '备注' },
  {
    cell: (_h, { row }) => formatDate(new Date(row.updatedAt)),
    colKey: 'updatedAt',
    title: '更新时间',
    width: 180,
  },
]

const errorDescription = computed(() => postList.error.value
  ? normalizeFeedbackError(postList.error.value).message
  : '请检查网络连接后重试')

function getActions(row: TableRowData): AppTableAction[] {
  const post = row as SystemPost
  const actions: AppTableAction[] = []
  if (canEditPost.value) {
    actions.push(
      {
        handler: () => postDrawer.openEdit(post),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => postStatusAction.run({ enabled: !post.enabled, post }),
        key: 'status',
        label: post.enabled ? '停用' : '启用',
        loading: statusRunning.value,
        theme: post.enabled ? 'warning' : 'success',
      },
    )
  }
  if (canRemovePost.value) {
    actions.push({
      handler: () => postDeleteAction.run(post),
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
  <AppPage
  >
    <AppDataTable
      :columns="columns"
      :current="current"
      :data="rows"
      empty-description="可新增第一个岗位"
      empty-title="暂无岗位"
      :error-description="errorDescription"
      :page-size="pageSize"
      row-key="id"
      :status="tableStatus"
      :total="total"
      @page-change="postList.changePage"
      @refresh="postList.refresh"
      @retry="postList.retry"
    >
      <template v-if="canAddPost" #toolbar>
        <t-button theme="primary" @click="postDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增岗位
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <AppCrudFormDialog
      :columns="2"
      description="岗位编码创建后可修改，注意保持全局唯一。"
      :form-data="postDrawer.formData"
      :mode="drawerMode"
      :rules="rules"
      :submitting="drawerSubmitting"
      :title="drawerMode === 'create' ? '新增岗位' : '编辑岗位'"
      :visible="drawerVisible"
      @cancel="postDrawer.close"
      @submit="postDrawer.submit"
      @update:visible="postDrawer.setVisible"
    >
      <t-form-item label="岗位名称" name="name">
        <t-input v-model="postDrawer.formData.name" maxlength="120" placeholder="请输入岗位名称" />
      </t-form-item>
      <t-form-item label="岗位编码" name="code">
        <t-input
          v-model="postDrawer.formData.code"
          maxlength="80"
          placeholder="例如 operation_director"
        />
      </t-form-item>
      <t-form-item label="排序" name="sortOrder">
        <t-input-number
          v-model="postDrawer.formData.sortOrder"
          :decimal-places="0"
          placeholder="数值越小越靠前"
          theme="column"
        />
      </t-form-item>
      <t-form-item label="状态" name="enabled">
        <t-switch v-model="postDrawer.formData.enabled" :label="['启用', '停用']" size="large"/>
      </t-form-item>
      <t-form-item class="vicp-form-grid-item--wide" label="备注" name="remark">
        <t-textarea
          v-model="postDrawer.formData.remark"
          :autosize="{ minRows: 3, maxRows: 6 }"
          maxlength="1000"
          placeholder="选填，说明岗位职责或适用范围"
        />
      </t-form-item>
    </AppCrudFormDialog>
  </AppPage>
</template>