import type { SelectOption, TableRowData } from 'tdesign-vue-next'
import { ref, reactive } from 'vue'
import {
  createUser,
  deleteUser,
  exportUsersCsv,
  fetchUserDetail,
  fetchUsers,
  importUsers,
  resetUserPassword,
  restoreUser,
  setUserDepartments,
  setUserPosts,
  setUserRoles,
  updateUser,
  updateUserStatus,
} from '@/api/modules/users'
import { fetchDepartmentTree, fetchPosts } from '@/api/modules/system-management'
import { fetchRoles } from '@/api/modules/roles'
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
import { toDepartmentTreeOptions, trimToNull, type DepartmentTreeOption } from '@/utils/system-management'
import { isChannelUserRole } from '@/utils/system-user'
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
  roleId: string
  status: 'all' | SystemUserStatus
  includeDeleted: boolean
}

/**
 * 用户分区表单：
 * - 基本信息（identifier/password/displayName/gender/email/remark）
 * - 业务身份（role 账号类型 + channelType 渠道类型）
 * - 组织信息（departmentIds/postIds，仅编辑模式后端支持分配接口）
 * - 权限角色（roleIds，动态角色独立于账号类型）
 * - 状态设置（status，创建时后端不接受该字段，默认启用）
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
  departmentIds: string[]
  postIds: string[]
  roleIds: string[]
  status: SystemUserStatus
  phone: string
}

function createUserForm(): UserForm {
  return {
    channelType: undefined,
    departmentIds: [],
    displayName: '',
    email: '',
    gender: 'UNKNOWN',
    identifier: '',
    password: '',
    phone: '',
    postIds: [],
    remark: '',
    role: 'NORMAL_USER',
    roleIds: [],
    status: 'ACTIVE',
  }
}

function editUserForm(user: SystemDepartmentMember, detail: SystemUserDetail | undefined): UserForm {
  const departments = detail?.departments ?? []
  return {
    channelType: user.channelType ?? undefined,
    departmentIds: [...departments]
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map(item => item.id),
    displayName: user.displayName,
    email: user.email ?? '',
    gender: user.gender,
    identifier: '',
    password: '',
    phone: user.phone ?? '',
    postIds: (detail?.posts ?? []).map(item => item.id),
    remark: user.remark ?? '',
    role: user.role,
    roleIds: (detail?.roles ?? []).map(item => item.id),
    status: user.status,
  }
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every(id => rightSet.has(id))
}

function toCreateInput(data: UserForm): CreateSystemUserInput {
  const common = {
    displayName: data.displayName.trim(),
    gender: data.gender,
    role: data.role,
    email: trimToNull(data.email) ?? undefined,
    remark: trimToNull(data.remark) ?? undefined,
  }
  return {
    ...common,
    identifier: data.identifier.trim(),
    password: data.password,
    channelType: isChannelUserRole(data.role) ? data.channelType : null,
  }
}

function toUpdateInput(data: UserForm): UpdateSystemUserInput {
  return {
    displayName: data.displayName.trim(),
    gender: data.gender,
    role: data.role,
    email: trimToNull(data.email),
    remark: trimToNull(data.remark),
    channelType: isChannelUserRole(data.role) ? data.channelType : null,
    phone: trimToNull(data.phone),
  }
}

function toUserQuery(query: UserSearchQuery, page: number, pageSize: number): SystemUserQuery {
  return {
    keyword: query.keyword.trim() || undefined,
    departmentId: query.departmentId || undefined,
    roleId: query.roleId || undefined,
    status: query.status === 'all' ? undefined : query.status,
    includeDeleted: query.includeDeleted || undefined,
    page,
    pageSize,
  }
}

/**
 * 用户管理：列表、分区表单（含组织/角色分配）、启停、删除、恢复、
 * 重置密码（独立确认弹窗）、导入（模板 + 结果明细）、导出。
 */
export function useUserManagement() {
  const feedback = useAppFeedback()

  const userList = useCrudList<UserTableRow, UserSearchQuery>({
    createQuery: () => ({
      departmentId: '',
      includeDeleted: false,
      keyword: '',
      roleId: '',
      status: 'all',
    }),
    fetcher: ({ query, page, pageSize, signal }) =>
      fetchUsers(toUserQuery(query, page, pageSize), signal),
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
    createForm: createUserForm,
    editForm: (user) => editUserForm(user, detailCache.get(user.id)),
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await userList.refresh()
    },
    submit: async ({ data, entity, mode }) => {
      const form = data as UserForm
      if (mode === 'create') {
        const created = await createUser(toCreateInput(form))
        await assignOrganization(created.user.id, form)
        // 创建接口不接受状态字段，禁用状态沿用后置分配模式
        if (form.status === 'DISABLED') {
          await updateUserStatus(created.user.id, 'DISABLED')
        }
        return created
      }

      const id = entity!.id
      const previous = detailCache.get(id)
      const profile = await updateUser(id, toUpdateInput(form))
      const assignments: Promise<MutationMessage>[] = []

      if (previous && previous.user.status !== form.status) {
        assignments.push(updateUserStatus(id, form.status))
      }
      if (!previous || !sameIds(previous.departments.map(item => item.id), form.departmentIds)) {
        assignments.push(setUserDepartments(id, [...form.departmentIds]))
      }
      if (!previous || !sameIds(previous.posts.map(item => item.id), form.postIds)) {
        assignments.push(setUserPosts(id, [...form.postIds]))
      }
      if (!previous || !sameIds(previous.roles.map(item => item.id), form.roleIds)) {
        assignments.push(setUserRoles(id, [...form.roleIds]))
      }
      await Promise.all(assignments)
      detailCache.delete(id)
      return profile
    },
  })

  /** 创建成功后同步分配组织与角色（后端创建接口不接受这些字段）。 */
  async function assignOrganization(userId: string, form: UserForm): Promise<void> {
    const assignments: Promise<MutationMessage>[] = []
    if (form.departmentIds.length > 0) {
      assignments.push(setUserDepartments(userId, [...form.departmentIds]))
    }
    if (form.postIds.length > 0) {
      assignments.push(setUserPosts(userId, [...form.postIds]))
    }
    if (form.roleIds.length > 0) {
      assignments.push(setUserRoles(userId, [...form.roleIds]))
    }
    await Promise.all(assignments)
  }

  async function openUserEdit(user: UserTableRow): Promise<void> {
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
    { user: UserTableRow; status: SystemUserStatus },
    UserMutationResult
  >({
    action: ({ user, status }) => updateUserStatus(user.id, status),
    confirm: ({ user, status }) => ({
      content: status === 'ACTIVE'
        ? `确认恢复账号“${user.displayName}”的正常状态吗？`
        : `确认禁用账号“${user.displayName}”吗？禁用后该用户将无法登录。`,
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
      content: `确认删除账号“${user.displayName}”吗？删除后该用户将无法登录，可稍后从“已删除”视图中恢复。`,
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
      const [departmentResult, roleResult] = await Promise.all([fetchDepartmentTree(), fetchRoles()])
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