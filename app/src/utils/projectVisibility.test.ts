import {
  autoSelectDepartmentId,
  buildProjectVisibilityPayload,
  canSelectDepartmentVisibility,
  formatDepartmentVisibilityDetails,
  isLegacyPublicVisibility,
  isWriteVisibility,
  NO_DEPARTMENT_HINT,
  PROJECT_WRITE_VISIBILITIES,
  projectListApiName,
  projectVisibilityLabel,
  resolveDepartmentName,
  resolveProjectListKind,
} from './projectVisibility.ts'

let failed = 0
let passed = 0

function assert(condition: unknown, name: string) {
  if (condition) {
    passed += 1
    console.log(`ok  ${name}`)
    return
  }
  failed += 1
  console.error(`FAIL  ${name}`)
}

assert(PROJECT_WRITE_VISIBILITIES.join(',') === 'PRIVATE,DEPARTMENT', '新建可见范围不含 PUBLIC')
assert(isWriteVisibility('PRIVATE') && isWriteVisibility('DEPARTMENT'), '可写可见范围为 PRIVATE/DEPARTMENT')
assert(!isWriteVisibility('PUBLIC'), 'PUBLIC 不能作为新建值')
assert(isLegacyPublicVisibility('PUBLIC'), '历史 PUBLIC 仅展示兼容')
assert(projectVisibilityLabel('PUBLIC') === '公开（历史）', '历史 PUBLIC 展示文案')
assert(projectVisibilityLabel('DEPARTMENT') === '部门可见', '部门可见文案')
assert(projectVisibilityLabel('PRIVATE') === '私有', '私有文案')

const none = buildProjectVisibilityPayload({ visibility: 'PRIVATE', visibleDepartmentId: 'dept-1', includeChildDepartments: true })
assert(none.ok && !('visibleDepartmentId' in none.data) && !('includeChildDepartments' in none.data), 'PRIVATE 不提交部门字段')

const missingDept = buildProjectVisibilityPayload({ visibility: 'DEPARTMENT' })
assert(!missingDept.ok && missingDept.error.includes('可见部门'), 'DEPARTMENT 必须选择部门')

const noDeptAccount = buildProjectVisibilityPayload({
  visibility: 'DEPARTMENT',
  visibleDepartmentId: 'dept-1',
  departments: [],
})
assert(!noDeptAccount.ok && noDeptAccount.error === NO_DEPARTMENT_HINT, '0 个部门不能提交 DEPARTMENT')

const departmentPayload = buildProjectVisibilityPayload({
  visibility: 'DEPARTMENT',
  visibleDepartmentId: 'dept-tech',
  includeChildDepartments: true,
  departments: [{ id: 'dept-tech' }],
})
assert(
  departmentPayload.ok
  && departmentPayload.data.visibility === 'DEPARTMENT'
  && departmentPayload.data.visibleDepartmentId === 'dept-tech'
  && departmentPayload.data.includeChildDepartments === true,
  'DEPARTMENT 提交部门与包含下级',
)

const withoutChildren = buildProjectVisibilityPayload({
  visibility: 'DEPARTMENT',
  visibleDepartmentId: 'dept-tech',
  includeChildDepartments: false,
  departments: [{ id: 'dept-tech' }],
})
assert(withoutChildren.ok && withoutChildren.data.includeChildDepartments === false, '可不包含下级部门')

assert(!canSelectDepartmentVisibility([]), '无部门时禁用部门可见')
assert(canSelectDepartmentVisibility([{ id: 'a' }]), '有部门时允许部门可见')
assert(autoSelectDepartmentId([{ id: 'only' }]) === 'only', '仅一个部门时自动选择')
assert(autoSelectDepartmentId([{ id: 'a' }, { id: 'b' }]) === '', '多个部门不自动选择')
assert(autoSelectDepartmentId([{ id: 'a' }, { id: 'b' }], 'b') === 'b', '已选部门保持不变')

assert(resolveDepartmentName('dept-1', [{ id: 'dept-1', name: '技术部' }]) === '技术部', '用可选部门名展示')
assert(resolveDepartmentName('secret-id', [], '技术部') === '技术部', '优先使用 Backend 附带部门名')
assert(resolveDepartmentName('secret-id', []) === '', '没有部门名时不暴露 departmentId')

assert(
  formatDepartmentVisibilityDetails({
    visibility: 'DEPARTMENT',
    departmentName: '技术部',
    includeChildDepartments: true,
  }).join(' / ') === '技术部 / 包含下级部门',
  '部门可见可展示部门名与下级',
)

assert(resolveProjectListKind('public') === 'public', '公开案例入口解析为 public')
assert(resolveProjectListKind('mine') === 'mine', '我的项目不走 public')
assert(projectListApiName('mine') === 'getMy', '我的项目调用 getMy')
assert(projectListApiName('public') === 'getPublic', '公开项目调用 getPublic')
assert(projectListApiName(resolveProjectListKind('public')) !== 'getMy', 'scope=public 不得落到 getMy')

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) {
  throw new Error(`projectVisibility tests failed: ${failed}`)
}
