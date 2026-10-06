<script setup lang="ts">
import type { FormInstanceFunctions, FormRules, PrimaryTableCol, TableRowData, TreeProps } from 'tdesign-vue-next'
import type { UserForm, UserTableRow } from '@/composables/useUserManagement'
import type { AppTableAction } from '@/types/crud'
import type { SystemUserStatus } from '@/types/system-management'
import { AddIcon, ChevronDownIcon, DownloadIcon, SearchIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppCrudFormDialog from '@/components/business/AppCrudFormDialog.vue'
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
import { useUserManagement } from '@/composables/useUserManagement'
import { formatDate } from '@/utils/day'
import {
  accessAppFilterOptions,
  accessDetailRowsForUser,
  accessTagsForUser,
  canEditManagedUserProfile,
  canResetManagedUserPassword,
  hasAdminAccess,
  projectLoginMethods,
  userGenderOptions,
  userStatusLabels,
} from '@/utils/system-user'

const {
  closeDetail,
  deleteAction,
  departmentOptions,
  detailState,
  exportAction,
  loadReferenceOptions,
  openDetail,
  openResetPassword,
  openUserEdit,
  postOptions,
  referenceLoading,
  resetPassword,
  restoreAction,
  setResetPasswordVisible,
  statusAction,
  submitResetPassword,
  userDrawer,
  userList,
} = useUserManagement()
const { canAccess } = usePermissionAccess()
const { isMobile } = useResponsiveShell()
const router = useRouter()

const canList = computed(() => canAccess({ permissions: ['system:user:list'] }))
const canAdd = computed(() => canAccess({ permissions: ['system:user:add'] }))
const canEdit = computed(() => canAccess({ permissions: ['system:user:edit'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:user:remove'] }))
const canResetPassword = computed(() => canAccess({ permissions: ['system:user:reset-password'] }))
const canExport = computed(() => canAccess({ permissions: ['system:user:export'] }))
const canViewDepartments = computed(() => canAccess({ permissions: ['system:dept:list'] }))

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

// ---------- 列表列 ----------

function renderUser(_h: unknown, { row }: { row: TableRowData }) {
  const user = row as UserTableRow
  return h('div', { class: 'vicp-user-cell' }, [
    h('strong', { class: 'vicp-user-cell__name' }, user.displayName),
  ])
}

function renderAccess(_h: unknown, { row }: { row: TableRowData }) {
  const tags = accessTagsForUser(row as UserTableRow)
  if (tags.length === 0) {
    return '—'
  }
  return h('div', { class: 'vicp-user-access' }, tags.map(tag => h(AppStatusTag, {
    key: tag.app,
    label: tag.label,
    status: tag.app === 'ADMIN' ? 'processing' : 'default',
  })))
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
  { cell: renderUser, colKey: 'displayName', minWidth: 160, title: '用户' },
  {
    cell: (_h, { row }) => (row as UserTableRow).phone ?? '—',
    colKey: 'phone',
    minWidth: 140,
    title: '手机号',
  },
  { cell: renderAccess, colKey: 'appAccess', minWidth: 180, title: '访问权限' },
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
  const adminAccess = hasAdminAccess(user)

  if (canList.value) {
    actions.push({ handler: () => void openDetail(user), key: 'detail', label: '查看' })
  }
  if (canEdit.value && !deleted && canEditManagedUserProfile(user)) {
    actions.push({
      handler: () => void openUserEdit(user),
      key: 'edit',
      label: '编辑',
    })
  }
  if (canEdit.value && !deleted) {
    actions.push({
      handler: () => void statusAction.run({
        status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE',
        user,
      }),
      key: 'status',
      label: user.status === 'ACTIVE' ? '禁用' : '启用',
      loading: statusAction.running.value,
      theme: user.status === 'ACTIVE' ? 'warning' : 'success',
    })
  }
  if (canResetPassword.value && !deleted && canResetManagedUserPassword(user)) {
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
  if (canEdit.value && deleted && adminAccess) {
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

function goDepartmentManagement(): void {
  void router.push('/system/dept')
}

function openCreateAdmin(): void {
  void loadReferenceOptions()
  userDrawer.openCreate()
}

const detailAccessRows = computed(() => {
  const detail = detailState.data
  return detail ? accessDetailRowsForUser(detail.user) : []
})

const detailLoginMethods = computed(() => {
  const detail = detailState.data
  if (!detail) {
    return []
  }
  return projectLoginMethods({
    identities: detail.identities ?? detail.user.identities,
    loginIdentifier: detail.user.loginIdentifier,
    phone: detail.user.phone,
    role: detail.user.role,
  })
})

// ---------- 分区表单 ----------

const isCreate = computed(() => userDrawer.mode.value === 'create')

const rules = computed<FormRules<UserForm>>(() => ({
  ...(isCreate.value
    ? {
        identifier: [{ message: '请输入登录账号', required: true }],
        password: [
          { message: '请输入初始密码', required: true },
          { message: '密码至少需要 5 个字符', min: 5 },
          { message: '密码不能超过 128 个字符', max: 128 },
        ],
        phone: [
          { message: '请输入手机号码', required: true },
          { message: '手机号格式不正确', pattern: /^\+?\d{6,20}$/ },
        ],
      }
    : {
        phone: [
          { message: '请输入手机号码', required: true },
          { message: '手机号格式不正确', pattern: /^\+?\d{6,20}$/ },
        ],
      }),
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
    validator: value => value === resetPasswordForm.password,
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

onMounted(() => {
  void loadReferenceOptions()
})
</script>

<template>
  <AppPage description="统一管理用户及其管理后台、客户端访问权限。新增仅创建超级管理员，客户端访问由用户首次进入 C 端自动开通。" title="用户管理">
    <template #search>
      <AppSearchPanel
        :loading="userList.isLoading.value"
        @reset="userList.reset"
        @search="userList.search"
      >
        <t-form-item label="关键词">
          <t-input
            v-model="userList.query.keyword"
            clearable
            placeholder="姓名或手机号"
          />
        </t-form-item>
        <t-form-item label="状态">
          <t-select v-model="userList.query.status" :options="statusFilterOptions" />
        </t-form-item>
        <t-form-item label="访问端">
          <t-select v-model="userList.query.accessApp" :options="accessAppFilterOptions" />
        </t-form-item>
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
          empty-description="当前筛选条件下暂无用户"
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
            <t-button
              v-if="canAdd"
              theme="primary"
              @click="openCreateAdmin"
            >
              <template #icon>
                <AddIcon />
              </template>
              新增超级管理员
            </t-button>
            <t-button
              v-if="canViewDepartments"
              theme="default"
              variant="outline"
              @click="goDepartmentManagement"
            >
              部门管理
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
            <t-button
              v-if="canAdd"
              size="small"
              theme="primary"
              @click="openCreateAdmin"
            >
              新增超级管理员
            </t-button>
            <t-button
              v-if="canViewDepartments"
              size="small"
              theme="default"
              variant="outline"
              @click="goDepartmentManagement"
            >
              部门管理
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
              <AppEmptyState :description="userList.isLoading.value ? '' : '当前筛选条件下暂无用户'" title="暂无用户" />
            </div>
            <article v-for="user in userList.data.value" :key="user.id" class="vicp-user-card">
              <div class="vicp-user-card__head">
                <span class="vicp-user-card__name">{{ user.displayName }}</span>
                <AppStatusTag
                  :label="user.deletedAt ? '已删除' : userStatusLabels[user.status as SystemUserStatus]"
                  :status="user.deletedAt ? 'error' : user.status === 'ACTIVE' ? 'success' : 'warning'"
                />
              </div>
              <div class="vicp-user-access">
                <AppStatusTag
                  v-for="tag in accessTagsForUser(user)"
                  :key="tag.app"
                  :label="tag.label"
                  :status="tag.app === 'ADMIN' ? 'processing' : 'default'"
                />
              </div>
              <dl class="vicp-user-card__meta">
                <div>
                  <dt>手机号</dt>
                  <dd>{{ user.phone ?? '—' }}</dd>
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

    <!-- 分区表单弹窗：仅超级管理员可创建/编辑 -->
    <AppCrudFormDialog
      :form-data="userDrawer.formData"
      :mode="userDrawer.mode.value"
      :rules="rules"
      :submitting="userDrawer.isSubmitting.value"
      :title="isCreate ? '新增超级管理员' : '编辑超级管理员'"
      :visible="userDrawer.visible.value"
      :width="dialogWidth"
      :columns="2"
      @cancel="userDrawer.close"
      @submit="userDrawer.submit"
      @update:visible="userDrawer.setVisible"
    >
      <p class="vicp-user-form__hint vicp-user-form__wide">
        {{ isCreate
          ? '仅可创建超级管理员，默认开通管理后台，不会开通客户端。部门和岗位选填。客户端访问由用户首次进入 C 端自动开通。'
          : '登录账号创建后不可修改。部门归属请到部门管理维护，不在此分配访问端。' }}
      </p>
      <t-form-item v-if="isCreate" label="登录账号" name="identifier">
        <t-input
          v-model="userDrawer.formData.identifier"
          placeholder="请输入登录账号"
        />
      </t-form-item>
      <t-form-item v-if="!isCreate" label="登录账号" name="identifier">
        <t-input
          v-model="userDrawer.formData.identifier"
          disabled
          placeholder="登录账号创建后不可修改"
        />
      </t-form-item>
      <t-form-item label="手机号码" name="phone">
        <t-input
          v-model="userDrawer.formData.phone"
          maxlength="32"
          placeholder="请输入手机号码"
        />
      </t-form-item>
      <t-form-item v-if="isCreate" label="初始密码" name="password">
        <t-input
          v-model="userDrawer.formData.password"
          autocomplete="new-password"
          placeholder="至少 5 位字符"
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
      <t-form-item v-if="isCreate" class="vicp-user-form__wide" label="部门" name="departmentIds">
        <t-tree-select
          v-model="userDrawer.formData.departmentIds"
          clearable
          :data="departmentOptions"
          filterable
          :loading="referenceLoading"
          multiple
          placeholder="选填，可多选"
          :tree-props="{ checkStrictly: true }"
        />
      </t-form-item>
      <t-form-item v-if="isCreate" class="vicp-user-form__wide" label="岗位" name="postIds">
        <t-select
          v-model="userDrawer.formData.postIds"
          clearable
          filterable
          :loading="referenceLoading"
          multiple
          :options="postOptions"
          placeholder="选填，可多选"
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

    <!-- 详情抽屉：只读 -->
    <t-drawer
      :cancel-btn="{ content: '关闭' }"
      :header="`用户详情 · ${detailState.data?.user.displayName ?? ''}`"
      placement="right"
      :size="detailDrawerSize"
      :visible="detailState.visible"
      @close="closeDetail"
    >
      <t-loading :loading="detailState.loading">
        <div v-if="detailState.data" class="vicp-user-detail">
          <section class="vicp-user-detail__section">
            <h3>基本信息</h3>
            <dl>
              <div>
                <dt>姓名</dt>
                <dd>{{ detailState.data.user.displayName }}</dd>
              </div>
              <div>
                <dt>手机号</dt>
                <dd>{{ detailState.data.user.phone ?? '—' }}</dd>
              </div>
              <div>
                <dt>状态</dt>
                <dd>{{ userStatusLabels[detailState.data.user.status as SystemUserStatus] }}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{{ formatDate(new Date(detailState.data.user.createdAt)) }}</dd>
              </div>
            </dl>
          </section>
          <section class="vicp-user-detail__section">
            <h3>访问权限</h3>
            <dl>
              <div v-for="row in detailAccessRows" :key="row.app">
                <dt>{{ row.label }}</dt>
                <dd>{{ row.roleLabel }} / {{ row.statusLabel }}</dd>
              </div>
            </dl>
          </section>
          <section class="vicp-user-detail__section">
            <h3>登录方式</h3>
            <dl>
              <div v-for="method in detailLoginMethods" :key="method.key">
                <dt>{{ method.label }}</dt>
                <dd>{{ method.value }}</dd>
              </div>
            </dl>
          </section>
        </div>
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

.vicp-user-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.vicp-user-cell__name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vicp-user-access {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-2);
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

.vicp-user-detail {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-7);
}

.vicp-user-detail__section {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-3);
}

.vicp-user-detail__section h3 {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-large);
  font-weight: var(--td-font-weight-medium);
}

.vicp-user-detail dl {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-4);
  margin: 0;
}

.vicp-user-detail dl div {
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
