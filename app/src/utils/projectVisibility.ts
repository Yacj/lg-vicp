import type {
  ClientSelectableDepartment,
  ProjectVisibility,
  UpdateProjectVisibilityBody,
} from '@/api/types'

export type ProjectListKind = 'mine' | 'public'

export type ProjectVisibilityTone = 'private' | 'department' | 'legacy-public'

export const PROJECT_WRITE_VISIBILITIES: ProjectVisibility[] = ['PRIVATE', 'DEPARTMENT']

export const NO_DEPARTMENT_HINT = '当前账号尚未加入部门，暂时只能创建私有项目。'

export function isWriteVisibility(value: string | undefined | null): value is ProjectVisibility {
  return value === 'PRIVATE' || value === 'DEPARTMENT'
}

export function isLegacyPublicVisibility(value: string | undefined | null) {
  return value === 'PUBLIC'
}

export function projectVisibilityLabel(visibility: string | undefined | null) {
  if (visibility === 'DEPARTMENT') {
    return '部门可见'
  }
  if (visibility === 'PUBLIC') {
    return '公开（历史）'
  }
  return '私有'
}

export function projectVisibilityTone(visibility: string | undefined | null): ProjectVisibilityTone {
  if (visibility === 'DEPARTMENT') {
    return 'department'
  }
  if (visibility === 'PUBLIC') {
    return 'legacy-public'
  }
  return 'private'
}

export function canSelectDepartmentVisibility(departments: Array<{ id: string }>) {
  return departments.length > 0
}

export function autoSelectDepartmentId(departments: Array<{ id: string }>, currentId?: string | null) {
  if (currentId && departments.some(item => item.id === currentId)) {
    return currentId
  }
  return departments.length === 1 ? departments[0].id : ''
}

export function resolveDepartmentName(
  departmentId: string | null | undefined,
  departments: Array<Pick<ClientSelectableDepartment, 'id' | 'name'>>,
  fallbackName?: string | null,
) {
  const attached = fallbackName?.trim()
  if (attached) {
    return attached
  }
  if (!departmentId) {
    return ''
  }
  return departments.find(item => item.id === departmentId)?.name || ''
}

export function formatDepartmentVisibilityDetails(options: {
  visibility: string | undefined | null
  departmentName?: string | null
  includeChildDepartments?: boolean | null
}) {
  if (options.visibility !== 'DEPARTMENT') {
    return []
  }

  const details: string[] = []
  const departmentName = options.departmentName?.trim()
  if (departmentName) {
    details.push(departmentName)
  }
  if (options.includeChildDepartments !== false) {
    details.push('包含下级部门')
  }
  return details
}

export function buildProjectVisibilityPayload(input: {
  visibility: string | undefined | null
  visibleDepartmentId?: string | null
  includeChildDepartments?: boolean | null
  departments?: Array<{ id: string }>
}): { ok: true, data: UpdateProjectVisibilityBody } | { ok: false, error: string } {
  if (input.visibility === 'PUBLIC' || !isWriteVisibility(input.visibility)) {
    return { ok: false, error: '请选择仅自己或部门可见' }
  }

  if (input.visibility === 'PRIVATE') {
    return { ok: true, data: { visibility: 'PRIVATE' } }
  }

  if (input.departments && !canSelectDepartmentVisibility(input.departments)) {
    return { ok: false, error: NO_DEPARTMENT_HINT }
  }

  const visibleDepartmentId = input.visibleDepartmentId?.trim()
  if (!visibleDepartmentId) {
    return { ok: false, error: '部门可见项目必须选择可见部门' }
  }

  if (input.departments && !input.departments.some(item => item.id === visibleDepartmentId)) {
    return { ok: false, error: '请选择当前账号有权使用的部门' }
  }

  return {
    ok: true,
    data: {
      visibility: 'DEPARTMENT',
      visibleDepartmentId,
      includeChildDepartments: input.includeChildDepartments !== false,
    },
  }
}

/** 首页「公开案例」走 public；我的项目 Tab 走 mine。禁止 scope=public 仍调 getMy。 */
export function resolveProjectListKind(scope?: string | null): ProjectListKind {
  return scope === 'public' ? 'public' : 'mine'
}

export function projectListApiName(kind: ProjectListKind): 'getMy' | 'getPublic' {
  return kind === 'public' ? 'getPublic' : 'getMy'
}
