<script setup lang="ts">
import type { FormInstanceFunctions, FormRules, PrimaryTableCol, TableRowData, TreeProps } from 'tdesign-vue-next'
import { AddIcon, ChevronDownIcon, DownloadIcon, SearchIcon, UploadIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref, watch } from 'vue'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
import AppImportUpload from '@/components/business/AppImportUpload.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { useResponsiveShell } from '@/composables/useResponsiveShell'
import {
  useUserManagement,
  type UserForm,
  type UserTableRow,
} from '@/composables/useUserManagement'
import type { AppTableAction } from '@/types/crud'
import type {
  SystemUserDetail,
  SystemUserRole,
  SystemUserStatus,
} from '@/types/system-management'
import { formatDate } from '@/utils/day'
import { type DepartmentTreeOption } from '@/utils/system-management'
import {
  channelTypeLabels,
  channelTypeOptions,
  isChannelUserRole,
  userGenderOptions,
  userRoleLabels,
  userRoleOptions,
  userStatusLabels,
} from '@/utils/system-user'
import { USER_IMPORT_TIPS } from '@/utils/user-csv'

const {
  closeDetail,
  closeImport,
  deleteAction,
  departmentOptions,
  detailState,
  downloadImportTemplate,
  exportAction,
  handleImportFile,
  importState,
  loadReferenceOptions,
  openDetail,
  openImport,
  openResetPassword,
  openRoleAssign,
  openUserEdit,
  postOptions,
  referenceLoading,
  resetPassword,
  restoreAction,
  roleAssign,
  roleOptions,
  setResetPasswordVisible,
  setRoleAssignVisible,
  statusAction,
  submitResetPassword,
  submitRoleAssign,
  userDrawer,
  userList,
} = useUserManagement()
const { canAccess } = usePermissionAccess()
const { isMobile } = useResponsiveShell()

const canList = computed(() => canAccess({ permissions: ['system:user:list'] }))
const canAdd = computed(() => canAccess({ permissions: ['system:user:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:user:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:user:remove'] }))
const canResetPassword = computed(() => canAccess({ permissions: ['system:user:reset-password'] }))
const canImport = computed(() => canAccess({ permissions: ['system:user:import'] }))
const canExport = computed(() => canAccess({ permissions: ['system:user:export'] }))
const canAssignRole = computed(() => canAccess({ permissions: ['system:user:role'] }))

const searchExpanded = ref(false)

// ---------- 左侧部门树 ----------

const departmentKeyword = ref('')
const activedDepartmentIds = ref<Array<string | number>>([])
// 移动端部门面板默认折叠，展开时自动隐藏
const deptCollapsed = ref(true)

function toggleDeptPanel(): void {
  if (isMobile.value) {
    deptCollapsed.value = !deptCollapsed.value
  }
}

/** 过滤命中节点自身或其祖先，避免父节点被隐藏后子树不可见 */
const departmentTreeFilter: TreeProps['filter'] = (node) => {
  const keyword = departmentKeyword.value.trim()
  if (!keyword) {
    return true
  }
  return node.getPath().some((item) => {
    const label = item.label
    return typeof label === 'string' && label.includes(keyword)
  })
}

function isAllDepartments(): boolean {
  return !userList.query.departmentId
}

function selectAllDepartments(): void {
  userList.query.departmentId = ''
  activedDepartmentIds.value = []
  void userList.search()
}

function onDepartmentClick(context: Parameters<NonNullable<TreeProps['onClick']>>[0]): void {
  const id = String(context.node.data.value)
  if (id === userList.query.departmentId) {
    selectAllDepartments()
    return
  }
  userList.query.departmentId = id
  activedDepartmentIds.value = [id]
  void userList.search()
}

const dialogWidth = computed<string>(() => (isMobile.value ? '92vw' : 'min(720px, 92vw)'))
const detailDrawerSize = computed<string>(() => (isMobile.value ? '100%' : '520px'))

watch(isMobile, (mobile) => {
  if (mobile) {
    searchExpanded.value = false
  }
})

watch(importState, (state) => {
  if (!state.visible) {
    importUploadRef.value?.clear()
  }
})

const importUploadRef = ref<InstanceType<typeof AppImportUpload> | null>(null)

// ---------- 列表列 ----------

function renderAccount(row: TableRowData): string {
  return row.phone ?? row.email ?? '—'
}

function renderRole(_h: unknown, { row }: { row: TableRowData }) {
  const role = row.role as SystemUserRole
  return h(AppStatusTag, {
    label: userRoleLabels[role],
    status: role === 'SUPER_ADMIN' ? 'processing' : role === 'CHANNEL_USER' ? 'info' : 'default',
  })
}

function renderChannel(_h: unknown, { row }: { row: TableRowData }) {
  return row.channelType ? channelTypeLabels[row.channelType as keyof typeof channelTypeLabels] : '—'
}

function renderStatus(_h: unknown, { row }: { row: TableRowData }) {
  if (row.deletedAt) {
    return h(AppStatusTag, { label: '已删除', status: 'error' })
  }
  return h(AppStatusTag, {
    label: userStatusLabels[row.status as SystemUserStatus],
    status: row.status === 'ACTIVE' ? 'success' : 'warning',
  })
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'displayName', minWidth: 160, title: '用户姓名' },
  { cell: renderAccount, colKey: 'phone', minWidth: 180, title: '登录账号 / 手机号' },
  { cell: renderRole, colKey: 'role', minWidth: 120, title: '账号类型' },
  { cell: renderChannel, colKey: 'channelType', minWidth: 110, title: '渠道类型' },
  { cell: renderStatus, colKey: 'status', title: '状态', width: 110 },
  {
    cell: (_h, { row }) => formatDate(new Date(row.createdAt)),
    colKey: 'createdAt',
    minWidth: 180,
    title: '创建时间',
  },
]

const statusFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '正常', value: 'ACTIVE' },
  { label: '已禁用', value: 'DISABLED' },
]

const errorDescription = computed(() => userList.error.value
  ? normalizeFeedbackError(userList.error.value).message
  : '请检查网络连接后重试')

// ---------- 行操作 ----------

function getActions(row: TableRowData): AppTableAction[] {
  const user = row as UserTableRow
  const deleted = Boolean(user.deletedAt)
  const actions: AppTableAction[] = []

  if (canList.value) {
    actions.push({ handler: () => void openDetail(user), key: 'detail', label: '详情' })
  }
  if (canEdit.value && !deleted) {
    actions.push(
      {
        handler: () => void openUserEdit(user),
        key: 'edit',
        label: '编辑',
      },
      {
        handler: () => void statusAction.run({
          status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
          user,
        }),
        key: 'status',
        label: user.status === 'ACTIVE' ? '禁用' : '启用',
        loading: statusAction.running.value,
        theme: user.status === 'ACTIVE' ? 'warning' : 'success',
      },
    )
  }
  if (canAssignRole.value && !deleted) {
    actions.push({ handler: () => void openRoleAssign(user), key: 'role', label: '分配角色' })
  }
  if (canResetPassword.value && !deleted) {
    actions.push({ handler: () => openResetPassword(user), key: 'reset-password', label: '重置密码' })
  }
  if (canRemove.value && !deleted) {
    actions.push({
      handler: () => void deleteAction.run(user),
      key: 'remove',
      label: '删除',
      loading: deleteAction.running.value,
      theme: 'danger',
    })
  }
  if (canEdit.value && deleted) {
    actions.push({
      handler: () => void restoreAction.run(user),
      key: 'restore',
      label: '恢复',
      loading: restoreAction.running.value,
      theme: 'success',
    })
  }
  return actions
}

// ---------- 分区表单 ----------

const isCreate = computed(() => userDrawer.mode.value === 'create')
const formRole = computed(() => userDrawer.formData.role)

const rules = computed<FormRules<UserForm>>(() => ({
  ...(isCreate.value
    ? {
        identifier: [
          { message: '请输入登录账号或手机号', required: true },
          { message: '登录账号或手机号至少 3 个字符', min: 3 },
          { message: '登录账号或手机号不能超过 255 个字符', max: 255 },
        ],
        password: [
          { message: '请输入初始密码', required: true },
          { message: '密码至少需要 12 个字符', min: 12 },
          { message: '密码不能超过 128 个字符', max: 128 },
        ],
      }
    : {
        phone: [{ message: '手机号格式不正确', pattern: /^\+?[0-9]{6,20}$/ }],
      }),
  channelType: [{
    message: '渠道用户必须选择渠道类型',
    validator: (value) => !isChannelUserRole(formRole.value) || Boolean(value),
  }],
  displayName: [
    { message: '请输入用户姓名', required: true },
    { message: '用户姓名不能超过 120 个字符', max: 120 },
  ],
  email: [
    { message: '邮箱格式不正确', email: true },
    { message: '邮箱不能超过 255 个字符', max: 255 },
  ],
  remark: [{ message: '备注不能超过 1000 个字符', max: 1000 }],
}))

// ---------- 重置密码弹窗 ----------

const resetPasswordForm = reactive({ confirm: '', password: '' })
const resetPasswordFormRef = ref<FormInstanceFunctions | null>(null)

const resetPasswordRules: FormRules = {
  confirm: [{
    message: '两次输入的密码不一致',
    validator: (value) => value === resetPasswordForm.password,
  }],
  password: [
    { message: '请输入新密码', required: true },
    { message: '密码至少需要 5 个字符', min: 5 },
    { message: '密码不能超过 128 个字符', max: 128 },
  ],
}

async function submitResetPasswordForm(): Promise<void> {
  const result = await resetPasswordFormRef.value?.validate()
  if (result !== true) {
    return
  }
  const ok = await submitResetPassword(resetPasswordForm.password)
  if (ok) {
    resetPasswordForm.password = ''
    resetPasswordForm.confirm = ''
    resetPasswordFormRef.value?.clearValidate()
  }
}

// ---------- 导入弹窗 ----------

const importErrorColumns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'row', title: '行号', width: 90 },
  { colKey: 'message', title: '失败原因', minWidth: 260 },
]

// ---------- 详情抽屉 ----------

function departmentLabelMap(): Map<string, string> {
  const map = new Map<string, string>()
  const visit = (options: readonly DepartmentTreeOption[]): void => {
    for (const option of options) {
      map.set(option.value, option.label)
      if (option.children) {
        visit(option.children)
      }
    }
  }
  visit(departmentOptions.value)
  return map
}

function primaryDepartmentName(detail: SystemUserDetail): string {
  const primary = detail.departments.find(item => item.isPrimary)
  if (!primary) {
    return '—'
  }
  return departmentLabelMap().get(primary.id) ?? '—'
}

function allDepartmentNames(detail: SystemUserDetail): string {
  const names = detail.departments.map(item => departmentLabelMap().get(item.id) ?? item.id)
  return names.length > 0 ? names.join('、') : '—'
}

onMounted(() => {
  void loadReferenceOptions()
})
</script>

<template>
  <AppPage>
    <template #search>
      <AppSearchPanel
        v-model:expanded="searchExpanded"
        collapsible
        :loading="userList.isLoading.value"
        @reset="userList.reset"
        @search="userList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="userList.query.keyword"
            clearable
            placeholder="用户姓名"
          />
        </t-form-item>
        <t-form-item label="角色">
          <t-select
            v-model="userList.query.roleId"
            clearable
            :options="roleOptions"
            placeholder="请选择动态角色"
          />
        </t-form-item>
        <template #advanced>
          <t-form-item label="状态">
            <t-select v-model="userList.query.status" :options="statusFilterOptions" />
          </t-form-item>
          <!-- <t-form-item label="已删除">
            <t-checkbox v-model="userList.query.includeDeleted">包含已删除账号</t-checkbox>
          </t-form-item> -->
        </template>
      </AppSearchPanel>
    </template>

    <!-- 内容区：左侧部门树 + 右侧用户列表 -->
    <div class="vicp-user-layout">
      <!-- 左侧：部门筛选树（移动端折叠为卡片） -->
      <aside class="vicp-user-dept-panel" aria-label="部门筛选">
        <div class="vicp-user-dept-panel__head" @click="toggleDeptPanel">
          <span class="vicp-user-dept-panel__title">部门</span>
          <div class="vicp-user-dept-panel__head-actions">
            <t-button
              theme="default"
              variant="text"
              size="small"
              :disabled="isAllDepartments()"
              @click.stop="selectAllDepartments"
            >
              清空
            </t-button>
            <ChevronDownIcon
              v-if="isMobile"
              class="vicp-user-dept-panel__arrow"
              :class="{ 'is-collapsed': deptCollapsed }"
            />
          </div>
        </div>
        <div v-show="!isMobile || !deptCollapsed" class="vicp-user-dept-panel__body">
          <t-input
            v-model="departmentKeyword"
            clearable
            placeholder="搜索部门"
          >
            <template #prefixIcon>
              <SearchIcon />
            </template>
          </t-input>
          <t-tree
            v-model:actived="activedDepartmentIds"
            :data="departmentOptions"
            expand-on-click-node
            :filter="departmentTreeFilter"
            hover
            :loading="referenceLoading"
            @click="onDepartmentClick"
          />
        </div>
      </aside>

      <div class="vicp-user-layout__main">
        <!-- 桌面端：表格 + 工具栏 -->
        <AppDataTable
          v-if="!isMobile"
      :columns="columns"
      :current="userList.current.value"
      :data="userList.data.value"
      empty-description="可新增第一个用户"
      empty-title="暂无用户"
      :error-description="errorDescription"
      :operations-width="260"
      :page-size="userList.pageSize.value"
      row-key="id"
      :status="userList.tableStatus.value"
      :total="userList.total.value"
      @page-change="userList.changePage"
      @refresh="userList.refresh"
      @retry="userList.retry"
    >
      <template #toolbar>
        <t-button v-if="canAdd" theme="primary" @click="userDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增用户
        </t-button>
        <t-button
          v-if="canImport"
          :disabled="referenceLoading"
          theme="default"
          variant="outline"
          @click="openImport"
        >
          <template #icon>
            <UploadIcon />
          </template>
          导入
        </t-button>
        <t-button
          v-if="canExport"
          :loading="exportAction.status.value === 'submitting'"
          theme="default"
          variant="outline"
          @click="exportAction.run"
        >
          <template #icon>
            <DownloadIcon />
          </template>
          导出
        </t-button>
      </template>
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <!-- 移动端：卡片列表 -->
    <section v-else class="vicp-user-cards">
      <div class="vicp-user-cards__toolbar">
        <t-button v-if="canAdd" size="small" theme="primary" @click="userDrawer.openCreate">
          <template #icon>
            <AddIcon />
          </template>
          新增用户
        </t-button>
        <t-button
          v-if="canImport"
          :disabled="referenceLoading"
          size="small"
          theme="default"
          variant="outline"
          @click="openImport"
        >
          导入
        </t-button>
        <t-button
          v-if="canExport"
          :loading="exportAction.status.value === 'submitting'"
          size="small"
          theme="default"
          variant="outline"
          @click="exportAction.run"
        >
          导出
        </t-button>
      </div>

      <AppErrorState
        v-if="userList.tableStatus.value === 'error'"
        :description="errorDescription"
        title="数据加载失败"
        @action="userList.retry"
      />

      <template v-else>
        <div v-if="userList.data.value.length === 0" class="vicp-user-cards__empty">
          <AppEmptyState :description="userList.isLoading.value ? '' : '可新增第一个用户'" title="暂无用户" />
        </div>
        <article v-for="user in userList.data.value" :key="user.id" class="vicp-user-card">
          <div class="vicp-user-card__head">
            <span class="vicp-user-card__name">{{ user.displayName }}</span>
            <AppStatusTag
              :label="user.deletedAt ? '已删除' : userStatusLabels[user.status as SystemUserStatus]"
              :status="user.deletedAt ? 'error' : user.status === 'ACTIVE' ? 'success' : 'warning'"
            />
          </div>
          <dl class="vicp-user-card__meta">
            <div>
              <dt>登录账号 / 手机号</dt>
              <dd>{{ user.phone ?? user.email ?? '—' }}</dd>
            </div>
            <div>
              <dt>账号类型 / 渠道</dt>
              <dd>
                {{ userRoleLabels[user.role as SystemUserRole] }}
                <template v-if="user.channelType"> / {{ channelTypeLabels[user.channelType as keyof typeof channelTypeLabels] }}</template>
              </dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ formatDate(new Date(user.createdAt)) }}</dd>
            </div>
          </dl>
          <div class="vicp-user-card__actions">
            <AppTableActions :actions="getActions(user)" :max-visible="1" />
          </div>
        </article>
      </template>

      <t-pagination
        v-if="userList.total.value > 0"
        :current="userList.current.value"
        :page-size="userList.pageSize.value"
        :page-size-options="[10, 20, 50, 100]"
        :show-jumper="true"
        :show-page-size="true"
        :total="userList.total.value"
        :total-content="false"
        @change="userList.changePage"
      />
    </section>
      </div>
    </div>

    <!-- 分区表单弹窗 -->
    <AppCrudFormDialog
      :form-data="userDrawer.formData"
      :mode="userDrawer.mode.value"
      :rules="rules"
      :submitting="userDrawer.isSubmitting.value"
      :title="isCreate ? '新增用户' : '编辑用户'"
      :visible="userDrawer.visible.value"
      :width="dialogWidth"
      :columns="2"
      @cancel="userDrawer.close"
      @submit="userDrawer.submit"
      @update:visible="userDrawer.setVisible"
    >
      <p v-if="!isCreate" class="vicp-user-form__hint vicp-user-form__wide">
        登录账号创建后不可修改；手机号可在下方调整。
      </p>
      <t-form-item v-if="isCreate" label="登录账号 / 手机号" name="identifier">
        <t-input
          v-model="userDrawer.formData.identifier"
          maxlength="255"
          placeholder="用户名或手机号，手机号格式自动识别"
        />
      </t-form-item>
      <t-form-item v-if="!isCreate" label="手机号" name="phone">
        <t-input
          v-model="userDrawer.formData.phone"
          maxlength="32"
          placeholder="手机号用于登录或联系"
        />
      </t-form-item>
      <t-form-item v-if="isCreate" label="初始密码" name="password">
        <t-input
          v-model="userDrawer.formData.password"
          autocomplete="new-password"
          placeholder="至少 12 位字符"
          type="password"
        />
      </t-form-item>
      <t-form-item label="用户姓名" name="displayName">
        <t-input
          v-model="userDrawer.formData.displayName"
          maxlength="120"
          placeholder="请输入用户姓名"
        />
      </t-form-item>
      <t-form-item label="性别" name="gender">
        <t-radio-group v-model="userDrawer.formData.gender" :options="userGenderOptions" />
      </t-form-item>
      <t-form-item label="邮箱" name="email">
        <t-input
          v-model="userDrawer.formData.email"
          maxlength="255"
          placeholder="选填"
        />
      </t-form-item>
      <t-form-item label="账号类型" name="role">
        <t-select
          v-model="userDrawer.formData.role"
          :options="userRoleOptions"
          placeholder="请选择账号类型"
        />
      </t-form-item>
      <t-form-item v-if="isChannelUserRole(formRole)" label="渠道类型" name="channelType">
        <t-select
          v-model="userDrawer.formData.channelType"
          :options="channelTypeOptions"
          placeholder="请选择渠道类型"
        />
      </t-form-item>
      <t-form-item label="所属部门" name="departmentIds">
        <t-tree-select
          v-model="userDrawer.formData.departmentIds"
          :data="departmentOptions"
          :loading="referenceLoading"
          multiple
          placeholder="可多选，首个部门为主部门"
        />
      </t-form-item>
      <t-form-item label="岗位" name="postIds">
        <t-select
          v-model="userDrawer.formData.postIds"
          :loading="referenceLoading"
          :options="postOptions"
          multiple
          placeholder="可多选"
        />
      </t-form-item>
      <t-form-item label="动态角色" name="roleIds">
        <t-select
          v-model="userDrawer.formData.roleIds"
          :loading="referenceLoading"
          :options="roleOptions"
          multiple
          placeholder="可多选，角色权限决定数据访问范围"
        />
      </t-form-item>
      <t-form-item label="账号状态" name="status">
        <t-radio-group
          v-model="userDrawer.formData.status"
          :options="[
            { label: '正常', value: 'ACTIVE' },
            { label: '已禁用', value: 'DISABLED' },
          ]"
        />
      </t-form-item>
      <t-form-item class="vicp-user-form__wide" label="备注" name="remark">
        <t-textarea
          v-model="userDrawer.formData.remark"
          :autosize="{ minRows: 2, maxRows: 4 }"
          maxlength="1000"
          placeholder="选填"
        />
      </t-form-item>
    </AppCrudFormDialog>

    <!-- 重置密码弹窗：独立确认，不展示明文密码 -->
    <t-dialog
      :cancel-btn="{ content: '取消', disabled: resetPassword.submitting }"
      :close-on-esc-keydown="!resetPassword.submitting"
      :close-on-overlay-click="false"
      :confirm-btn="{
        content: '确认重置',
        disabled: resetPassword.submitting,
        loading: resetPassword.submitting,
        theme: 'primary',
      }"
      destroy-on-close
      :header="`重置密码 · ${resetPassword.displayName}`"
      :visible="resetPassword.visible"
      @close="setResetPasswordVisible(false)"
      @confirm="submitResetPasswordForm"
    >
      <t-form
        ref="resetPasswordFormRef"
        :data="resetPasswordForm"
        label-align="top"
        layout="vertical"
        prevent-submit-default
        :rules="resetPasswordRules"
        @submit="submitResetPasswordForm"
      >
        <t-form-item label="新密码" name="password">
          <t-input
            v-model="resetPasswordForm.password"
            autocomplete="new-password"
            placeholder="至少 5 位字符"
            type="password"
          />
        </t-form-item>
        <t-form-item label="确认新密码" name="confirm">
          <t-input
            v-model="resetPasswordForm.confirm"
            autocomplete="new-password"
            placeholder="再次输入新密码"
            type="password"
          />
        </t-form-item>
      </t-form>
      <p class="vicp-user-reset-tip">
        重置后该用户将使用新密码登录，旧密码立即失效；密码不会明文展示或写入日志。
      </p>
    </t-dialog>

    <!-- 分配角色弹窗：独立入口，仅管理动态角色关联 -->
    <t-dialog
      :cancel-btn="{ content: '取消', disabled: roleAssign.submitting }"
      :close-on-esc-keydown="!roleAssign.submitting"
      :close-on-overlay-click="false"
      :confirm-btn="{
        content: '保存',
        disabled: roleAssign.submitting,
        loading: roleAssign.submitting,
        theme: 'primary',
      }"
      destroy-on-close
      :header="`分配角色 · ${roleAssign.displayName}`"
      :visible="roleAssign.visible"
      :width="'min(480px, 92vw)'"
      @close="setRoleAssignVisible(false)"
      @confirm="submitRoleAssign"
    >
      <t-form-item label="动态角色">
        <t-select
          v-model="roleAssign.roleIds"
          :loading="referenceLoading"
          :options="roleOptions"
          multiple
          placeholder="可多选，角色权限决定数据访问范围"
        />
      </t-form-item>
      <p class="vicp-user-form__hint">
        保存后立即生效；角色与账号类型（超级管理员 / 渠道用户 / 普通用户）相互独立。
      </p>
    </t-dialog>

    <!-- 导入弹窗：模板下载 + 上传 + 成功/失败明细 -->
    <t-dialog
      :footer="false"
      header="导入用户"
      :visible="importState.visible"
      @close="closeImport"
    >
      <div class="vicp-user-import">
        <div class="vicp-user-import__toolbar">
          <t-button theme="default" variant="outline" @click="downloadImportTemplate">
            下载导入模板
          </t-button>
        </div>
        <AppImportUpload
          ref="importUploadRef"
          accept=".csv"
          :handler="handleImportFile"
          :max="1"
          placeholder="选择 CSV 文件"
          :tips="USER_IMPORT_TIPS"
        />
        <template v-if="importState.result">
          <t-alert
            class="vicp-user-import__result"
            theme="success"
            :message="`导入完成：成功 ${importState.result.imported} 条${importState.result.errors.length > 0 ? `，失败 ${importState.result.errors.length} 条` : ''}`"
          />
          <div v-if="importState.result.errors.length > 0" class="vicp-user-import__errors">
            <t-table
              :columns="importErrorColumns"
              :data="importState.result.errors"
              :max-height="240"
              row-key="row"
              size="small"
            />
          </div>
        </template>
      </div>
    </t-dialog>

    <!-- 详情抽屉：角色 / 部门 / 岗位等关联由详情接口返回 -->
    <t-drawer
      :cancel-btn="{ content: '关闭' }"
      :header="`用户详情 · ${detailState.data?.user.displayName ?? ''}`"
      placement="right"
      :size="detailDrawerSize"
      :visible="detailState.visible"
      @close="closeDetail"
    >
      <t-loading :loading="detailState.loading">
        <dl v-if="detailState.data" class="vicp-user-detail">
          <div>
            <dt>用户姓名</dt>
            <dd>{{ detailState.data.user.displayName }}</dd>
          </div>
          <div>
            <dt>登录账号 / 手机号</dt>
            <dd>{{ detailState.data.user.phone ?? detailState.data.user.email ?? '—' }}</dd>
          </div>
          <div>
            <dt>账号类型</dt>
            <dd>{{ userRoleLabels[detailState.data.user.role as SystemUserRole] }}</dd>
          </div>
          <div>
            <dt>渠道类型</dt>
            <dd>
              {{ detailState.data.user.channelType
                ? channelTypeLabels[detailState.data.user.channelType as keyof typeof channelTypeLabels]
                : '—' }}
            </dd>
          </div>
          <div>
            <dt>状态</dt>
            <dd>{{ userStatusLabels[detailState.data.user.status as SystemUserStatus] }}</dd>
          </div>
          <div>
            <dt>主部门</dt>
            <dd>{{ primaryDepartmentName(detailState.data) }}</dd>
          </div>
          <div>
            <dt>所属部门</dt>
            <dd>{{ allDepartmentNames(detailState.data) }}</dd>
          </div>
          <div>
            <dt>岗位</dt>
            <dd>{{ detailState.data.posts.map(item => item.name).join('、') || '—' }}</dd>
          </div>
          <div>
            <dt>动态角色</dt>
            <dd>{{ detailState.data.roles.map(item => item.name).join('、') || '—' }}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{{ formatDate(new Date(detailState.data.user.createdAt)) }}</dd>
          </div>
        </dl>
      </t-loading>
    </t-drawer>
  </AppPage>
</template>

<style scoped>
/* 左右布局：左侧部门树 + 右侧列表 */
.vicp-user-layout {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: var(--td-size-4);
}

.vicp-user-layout__main {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.vicp-user-dept-panel {
  display: flex;
  min-width: 0;
  flex: 0 0 260px;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-size-6);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.vicp-user-dept-panel__head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
}

.vicp-user-dept-panel__head-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-1);
}

.vicp-user-dept-panel__arrow {
  color: var(--td-text-color-secondary);
  transition: transform var(--td-anim-duration-base) ease;
}

.vicp-user-dept-panel__arrow.is-collapsed {
  transform: rotate(-90deg);
}

.vicp-user-dept-panel__title {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-large);
  font-weight: var(--td-font-weight-medium);
}

.vicp-user-dept-panel__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.vicp-user-dept-panel :deep(.t-tree) {
  min-width: 0;
}

@media (max-width: 720px) {
  .vicp-user-layout {
    flex-direction: column;
  }

  .vicp-user-dept-panel {
    flex: none;
    width: 100%;
  }
}

.vicp-user-cards {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.vicp-user-cards__toolbar {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
}

.vicp-user-cards__empty {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  padding: var(--td-size-10) 0;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.vicp-user-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
  padding: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.vicp-user-card__head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.vicp-user-card__name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-large);
  font-weight: var(--td-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vicp-user-card__meta {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
  margin: 0;
}

.vicp-user-card__meta div {
  display: flex;
  min-width: 0;
  gap: var(--td-size-3);
  font-size: var(--td-font-size-body-small);
}

.vicp-user-card__meta dt {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
}

.vicp-user-card__meta dd {
  overflow: hidden;
  min-width: 0;
  margin: 0;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vicp-user-card__actions {
  display: flex;
  min-width: 0;
  justify-content: flex-end;
}

.vicp-user-form__hint {
  margin: 0 0 var(--td-size-4);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

/* 两列表单中占满整行的字段 */
.vicp-user-form__wide {
  grid-column: 1 / -1;
}

.vicp-user-reset-tip {
  margin: var(--td-size-4) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: var(--td-line-height-body-small);
}

.vicp-user-import {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
}

.vicp-user-import__toolbar {
  display: flex;
  min-width: 0;
}

.vicp-user-import__errors {
  min-width: 0;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
}

.vicp-user-detail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
  margin: 0;
}

.vicp-user-detail div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.vicp-user-detail dt {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-user-detail dd {
  margin: 0;
  color: var(--td-text-color-primary);
  word-break: break-all;
}
</style>