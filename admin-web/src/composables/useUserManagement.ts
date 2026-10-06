import type { SelectOption, TableRowData } from 'tdesign-vue-next'
import type {
  CreateSystemUserInput,
  MutationMessage,
  SystemChannelType,
  SystemDepartmentMember,
  SystemPost,
  SystemUserDetail,
  SystemUserGender,
  SystemUserQuery,
  SystemUserRole,
  SystemUserStatus,
  UpdateSystemUserInput,
  UserImportResult,
  UserMutationResult,
} from '@/types/system-management'
import type { DepartmentTreeOption } from '@/utils/system-management'
import type { UserAccessAppFilter } from '@/utils/system-user'
import { reactive, ref } from 'vue'
import { fetchRoles } from '@/api/modules/roles'
import { fetchDepartmentTree, fetchPosts } from '@/api/modules/system-management'
import {
  createUser,
  deleteUser,
  exportUsersCsv,
  fetchUserDetail,
  fetchUsers,
  importUsers,
  resetUserPassword,
  restoreUser,
  setUserRoles,
  updateUser,
  updateUserStatus,
} from '@/api/modules/users'
import { toDepartmentTreeOptions, trimToNull } from '@/utils/system-management'
import {
  USER_DISABLE_BOTH_ENDS_HINT,
  accessAppToRoleFilter,
  hasAdminAccess,
} from '@/utils/system-user'
import { buildUserExportFilename, buildUserImportTemplate, triggerBlobDownload, triggerTextDownload } from '@/utils/user-csv'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudExport } from './useCrudExport'
import { useCrudList } from './useCrudList'

export type UserTableRow = SystemDepartmentMember & TableRowData

export interface UserSearchQuery extends Record<string, unknown> {
  keyword: string
  departmentId: string
  status: 'all' | SystemUserStatus
  accessApp: UserAccessAppFilter
  includeDeleted: boolean
}

/**
 * 用户分区表单仅维护超级管理员资料。
 * 不在此分配部门、CLIENT 访问或登录方式。
 */
export interface UserForm extends Record<string, unknown> {
  identifier: string
  password: string
  displayName: string
  gender: SystemUserGender
  email: string
  remark: string
  role: SystemUserRole
  channelType: SystemChannelType | undefined
  /** 是否允许登录 B 端管理后台；仅普通用户可选，其余账号类型恒为 true。 */
  adminLoginEnabled: boolean
  departmentIds: string[]
  postIds: string[]
  roleIds: string[]
  status: SystemUserStatus
  phone: string
}

function createUserForm(): UserForm {
  return {
    adminLoginEnabled: true,
    channelType: undefined,
    departmentIds: [],
    displayName: '',
    email: '',
    gender: 'UNKNOWN',
    identifier: '',
    password: '123456',
    phone: '',
    postIds: [],
    remark: '',
    role: 'SUPER_ADMIN',
    roleIds: [],
    status: 'ACTIVE',
  }
}

function editUserForm(user: SystemDepartmentMember, detail: SystemUserDetail | undefined): UserForm {
  const departments = detail?.departments ?? []
  return {
    adminLoginEnabled: user.adminLoginEnabled,
    channelType: user.channelType ?? undefined,
    departmentIds: [...departments]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map(item => item.id),
    displayName: user.displayName,
    email: user.email ?? '',
    gender: user.gender,
    identifier: user.loginIdentifier ?? '',
    password: '',
    phone: user.phone ?? '',
    postIds: (detail?.posts ?? []).map(item => item.id),
    remark: user.remark ?? '',
    role: user.role,
    roleIds: (detail?.roles ?? []).map(item => item.id),
    status: user.status,
  }
}

function optionalIds(ids: readonly string[]): string[] | undefined {
  return ids.length > 0 ? [...ids] : undefined
}

function toCreateInput(data: UserForm): CreateSystemUserInput {
  const departmentIds = optionalIds(data.departmentIds)
  const postIds = optionalIds(data.postIds)
  return {
    displayName: data.displayName.trim(),
    gender: data.gender,
    role: 'SUPER_ADMIN',
    email: trimToNull(data.email) ?? undefined,
    remark: trimToNull(data.remark) ?? undefined,
    identifier: data.identifier.trim(),
    password: data.password,
    phone: trimToNull(data.phone) ?? undefined,
    status: data.status,
    ...(departmentIds ? { departmentIds } : {}),
    ...(postIds ? { postIds } : {}),
  }
}

function toUpdateInput(data: UserForm): UpdateSystemUserInput {
  return {
    displayName: data.displayName.trim(),
    gender: data.gender,
    email: trimToNull(data.email),
    remark: trimToNull(data.remark),
    phone: trimToNull(data.phone),
  }
}

function toUserQuery(query: UserSearchQuery, page: number, pageSize: number): SystemUserQuery {
  return {
    role: accessAppToRoleFilter(query.accessApp),
    keyword: query.keyword.trim() || undefined,
    departmentId: query.departmentId || undefined,
    status: query.status === 'all' ? undefined : query.status,
    includeDeleted: query.includeDeleted || undefined,
    page,
    pageSize,
  }
}

/**
 * 统一用户管理：一个 User + 多端访问权限。
 * 新增只创建 ADMIN / SUPER_ADMIN，默认不开通 CLIENT。
 * 部门归属走部门管理 → 部门成员。
 */
export function useUserManagement() {
  const feedback = useAppFeedback()

  const userList = useCrudList<UserTableRow, UserSearchQuery>({
    createQuery: () => ({
      accessApp: 'all',
      departmentId: '',
      includeDeleted: false,
      keyword: '',
      status: 'all',
    }),
    fetcher: ({ query, page, pageSize, signal }) => fetchUsers(toUserQuery(query, page, pageSize), signal),
    immediate: true,
    rowKey: 'id',
  })

  const detailCache = new Map<string, SystemUserDetail>()
  const editingDetailLoading = ref(false)

  /**
   * 列表接口不返回动态角色/部门/岗位关联，详情抽屉通过 /users/:id 单独拉取。
   * 最后登录时间后端无查询接口，详情中不展示。
   */
  const detailState = reactive({
    data: null as SystemUserDetail | null,
    loading: false,
    visible: false,
  })

  async function openDetail(user: UserTableRow): Promise<void> {
    detailState.visible = true
    detailState.loading = true
    detailState.data = null
    try {
      detailState.data = await fetchUserDetail(user.id)
    }
    catch (error) {
      await feedback.messageError(error)
      detailState.visible = false
    }
    finally {
      detailState.loading = false
    }
  }

  function closeDetail(): void {
    if (detailState.loading) {
      return
    }
    detailState.visible = false
  }

  const userDrawer = useCrudDrawer<UserForm, UserTableRow, UserMutationResult>({
    createForm: () => {
      const form = createUserForm()
      form.role = 'SUPER_ADMIN'
      form.adminLoginEnabled = true
      form.channelType = undefined
      return form
    },
    editForm: user => editUserForm(user, detailCache.get(user.id)),
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await userList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const form = data as UserForm
      if (mode === 'create') {
        return createUser(toCreateInput(form))
      }

      const id = entity!.id
      const previous = detailCache.get(id)
      const input: UpdateSystemUserInput = toUpdateInput(form)
      if (!previous || previous.user.status !== form.status) {
        input.status = form.status
      }
      const profile = await updateUser(id, input)
      detailCache.delete(id)
      return profile
    },
  })

  async function openUserEdit(user: UserTableRow): Promise<void> {
    if (!hasAdminAccess(user)) {
      return
    }
    editingDetailLoading.value = true
    try {
      const detail = await fetchUserDetail(user.id)
      detailCache.set(user.id, detail)
      userDrawer.openEdit(user)
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      editingDetailLoading.value = false
    }
  }

  const statusAction = useConfirmedCrudAction<
    { user: UserTableRow, status: SystemUserStatus },
    UserMutationResult
  >({
    action: ({ user, status }) => updateUserStatus(user.id, status),
    confirm: ({ user, status }) => ({
      content: status === 'ACTIVE'
        ? `确认启用账号“${user.displayName}”吗？启用后该用户可按已开通的访问权限登录。`
        : `确认禁用账号“${user.displayName}”吗？${USER_DISABLE_BOTH_ENDS_HINT}`,
      confirmText: status === 'ACTIVE' ? '启用' : '禁用',
      danger: status === 'DISABLED',
      title: status === 'ACTIVE' ? '启用账号' : '禁用账号',
    }),
    onSuccess: async () => {
      await userList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const deleteAction = useCrudDelete<UserTableRow, MutationMessage>({
    action: user => deleteUser(user.id),
    confirm: user => ({
      content: `确认删除账号“${user.displayName}”吗？删除后该用户将无法登录管理后台和客户端。`,
      confirmText: '删除',
      danger: true,
      title: '删除账号',
    }),
    onSuccess: async () => {
      await userList.refresh()
    },
    successMessage: (_user, result) => result.message,
  })

  const restoreAction = useConfirmedCrudAction<UserTableRow, UserMutationResult>({
    action: user => restoreUser(user.id),
    confirm: user => ({
      content: `确认恢复账号“${user.displayName}”吗？恢复后账号状态将回到正常。`,
      confirmText: '恢复',
      title: '恢复账号',
    }),
    onSuccess: async () => {
      await userList.refresh()
    },
    successMessage: (_user, result) => result.message,
  })

  const resetPassword = reactive({
    displayName: '',
    submitting: false,
    userId: '',
    visible: false,
  })

  function openResetPassword(user: UserTableRow): void {
    resetPassword.displayName = user.displayName
    resetPassword.userId = user.id
    resetPassword.submitting = false
    resetPassword.visible = true
  }

  function closeResetPassword(): void {
    if (resetPassword.submitting) {
      return
    }
    resetPassword.visible = false
  }

  function setResetPasswordVisible(visible: boolean): void {
    if (!visible) {
      closeResetPassword()
    }
  }

  /** 重置密码仅提交新密码；密码不写入任何本地日志，后端也只落哈希。 */
  async function submitResetPassword(password: string): Promise<boolean> {
    if (resetPassword.submitting || !resetPassword.userId) {
      return false
    }
    resetPassword.submitting = true
    try {
      const result = await resetUserPassword(resetPassword.userId, password)
      await feedback.message('success', result.message)
      resetPassword.visible = false
      return true
    }
    catch (error) {
      await feedback.messageError(error)
      return false
    }
    finally {
      resetPassword.submitting = false
    }
  }

  const importState = reactive({
    result: null as UserImportResult | null,
    visible: false,
  })

  async function handleImportFile(file: File): Promise<UserImportResult> {
    const result = await importUsers({ csv: await file.text() })
    importState.result = result
    return result
  }

  function openImport(): void {
    importState.result = null
    importState.visible = true
  }

  function closeImport(): void {
    importState.visible = false
  }

  function setImportVisible(visible: boolean): void {
    if (!visible) {
      closeImport()
    }
  }

  function downloadImportTemplate(): void {
    triggerTextDownload(buildUserImportTemplate(), 'user-import-template.csv')
  }

  // ---------- 分配角色（独立 Dialog，行操作快捷入口） ----------

  const roleAssign = reactive({
    displayName: '',
    roleIds: [] as string[],
    submitting: false,
    userId: '',
    visible: false,
  })

  async function openRoleAssign(user: UserTableRow): Promise<void> {
    try {
      let detail = detailCache.get(user.id)
      if (!detail) {
        detail = await fetchUserDetail(user.id)
        detailCache.set(user.id, detail)
      }
      roleAssign.displayName = user.displayName
      roleAssign.roleIds = detail.roles.map(item => item.id)
      roleAssign.userId = user.id
      roleAssign.submitting = false
      roleAssign.visible = true
    }
    catch (error) {
      await feedback.messageError(error)
    }
  }

  function closeRoleAssign(): void {
    if (roleAssign.submitting) {
      return
    }
    roleAssign.visible = false
  }

  function setRoleAssignVisible(visible: boolean): void {
    if (!visible) {
      closeRoleAssign()
    }
  }

  async function submitRoleAssign(): Promise<void> {
    if (roleAssign.submitting || !roleAssign.userId) {
      return
    }
    roleAssign.submitting = true
    try {
      const result = await setUserRoles(roleAssign.userId, [...roleAssign.roleIds])
      await feedback.message('success', result.message)
      detailCache.delete(roleAssign.userId)
      roleAssign.visible = false
      await userList.refresh()
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      roleAssign.submitting = false
    }
  }

  const exportAction = useCrudExport<Blob>({
    handler: async ({ signal }) => {
      const blob = await exportUsersCsv(signal)
      triggerBlobDownload(blob, buildUserExportFilename())
      return blob
    },
    successMessage: '用户数据导出完成',
  })

  // 参考数据：部门树、岗位全量、动态角色全量（导入/表单/筛选共用）。
  const departmentOptions = ref<DepartmentTreeOption[]>([])
  const postOptions = ref<SelectOption[]>([])
  const roleOptions = ref<SelectOption[]>([])
  const referenceLoading = ref(false)
  let referencesLoaded = false

  async function loadReferenceOptions(force = false): Promise<void> {
    if (referencesLoaded && !force) {
      return
    }
    referenceLoading.value = true
    try {
      const [departmentResult, roleResult] = await Promise.all([
        fetchDepartmentTree(),
        fetchRoles(),
      ])
      departmentOptions.value = toDepartmentTreeOptions(departmentResult.items)
      roleOptions.value = roleResult.items.map(role => ({ label: role.name, value: role.id }))

      const posts: SystemPost[] = []
      for (let page = 1; page <= 100; page += 1) {
        const result = await fetchPosts({ page, pageSize: 100 })
        posts.push(...result.items)
        if (result.items.length < 100 || page * result.pageSize >= result.total) {
          break
        }
      }
      postOptions.value = posts.map(post => ({ label: post.name, value: post.id }))
      referencesLoaded = true
    }
    catch (error) {
      await feedback.messageError(error)
    }
    finally {
      referenceLoading.value = false
    }
  }

  return {
    closeDetail,
    closeImport,
    deleteAction,
    departmentOptions,
    detailState,
    downloadImportTemplate,
    editingDetailLoading,
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
    setImportVisible,
    setResetPasswordVisible,
    setRoleAssignVisible,
    statusAction,
    submitResetPassword,
    submitRoleAssign,
    userDrawer,
    userList,
  }
}
