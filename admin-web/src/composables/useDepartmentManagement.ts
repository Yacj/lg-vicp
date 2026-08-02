import type { TableRowData } from 'tdesign-vue-next'
import { computed, shallowRef } from 'vue'
import {
  createDepartment,
  deleteDepartment,
  fetchDepartmentTree,
  updateDepartment,
  updateDepartmentStatus,
} from '@/api/modules/system-management'
import type {
  DepartmentMutationResult,
  SystemDepartment,
  SystemDepartmentTreeNode,
} from '@/types/system-management'
import {
  collectDepartmentSubtreeIds,
  filterDepartmentTree,
  toDepartmentTreeOptions,
  trimToNull,
} from '@/utils/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export interface DepartmentSearchQuery extends Record<string, unknown> {
  keyword: string
}

export interface DepartmentForm extends Record<string, unknown> {
  parentId: string | undefined
  code: string
  name: string
  leader: string
  phone: string
  email: string
  sortOrder: number
  enabled: boolean
}

function createDepartmentForm(): DepartmentForm {
  return {
    code: '',
    email: '',
    enabled: true,
    leader: '',
    name: '',
    parentId: undefined,
    phone: '',
    sortOrder: 0,
  }
}

function editDepartmentForm(department: SystemDepartment): DepartmentForm {
  return {
    code: department.code,
    email: department.email ?? '',
    enabled: department.enabled,
    leader: department.leader ?? '',
    name: department.name,
    parentId: department.parentId ?? undefined,
    phone: department.phone ?? '',
    sortOrder: department.sortOrder,
  }
}

export function useDepartmentManagement() {
  const feedback = useAppFeedback()
  const tree = shallowRef<SystemDepartmentTreeNode[]>([])
  const treeStatus = shallowRef<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const treeError = shallowRef<unknown>(null)
  const expandedTreeNodes = shallowRef<string[]>([])

  const departmentList = useCrudList<SystemDepartmentTreeNode & TableRowData, DepartmentSearchQuery>({
    createQuery: () => ({ keyword: '' }),
    fetcher: async ({ query, signal }) => {
      treeStatus.value = 'loading'
      treeError.value = null
      try {
        const result = await fetchDepartmentTree(signal)
        tree.value = result.items
        const filtered = filterDepartmentTree(result.items, query.keyword)
        expandedTreeNodes.value = []
        treeStatus.value = 'ready'
        return {
          items: filtered,
          page: 1,
          pageSize: Math.max(filtered.length, 1),
          total: filtered.length,
        }
      }
      catch (error) {
        treeStatus.value = 'error'
        treeError.value = error
        throw error
      }
    },
    immediate: true,
    pageSize: 100,
    rowKey: 'id',
  })

  const departmentDrawer = useCrudDrawer<DepartmentForm, SystemDepartment, DepartmentMutationResult>({
    createForm: createDepartmentForm,
    editForm: editDepartmentForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async result => {
      await feedback.message('success', result.message)
      await departmentList.refresh()
    },
    submit: ({ data, entity, mode }) => {
      const common = {
        enabled: data.enabled,
        name: data.name.trim(),
        parentId: data.parentId ?? null,
        sortOrder: Number(data.sortOrder),
      }
      return mode === 'create'
        ? createDepartment({ code: data.code.trim(), ...common })
        : updateDepartment(entity!.id, {
            code: data.code.trim(),
            email: trimToNull(data.email),
            leader: trimToNull(data.leader),
            phone: trimToNull(data.phone),
            ...common,
          })
    },
  })

  const departmentStatusAction = useConfirmedCrudAction<
    { department: SystemDepartment, enabled: boolean },
    DepartmentMutationResult
  >({
    action: ({ department, enabled }) => updateDepartmentStatus(department.id, enabled),
    confirm: ({ department, enabled }) => ({
      content: `确认${enabled ? '启用' : '停用'}部门“${department.name}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}部门`,
    }),
    onSuccess: async () => {
      await departmentList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const departmentDeleteAction = useCrudDelete<SystemDepartment, { message: string }>({
    action: department => deleteDepartment(department.id),
    confirm: department => ({
      content: `确认删除部门“${department.name}”吗？存在下级部门或用户时，后端会拒绝删除。`,
      confirmText: '删除',
      danger: true,
      title: '删除部门',
    }),
    onSuccess: async (_result, _department) => {
      await departmentList.refresh()
    },
    successMessage: (_department, result) => result.message,
  })

  const parentOptions = computed(() => toDepartmentTreeOptions(
    tree.value,
    departmentDrawer.entity.value ? collectDepartmentSubtreeIds(findDepartmentNode(tree.value, departmentDrawer.entity.value.id) ?? departmentDrawer.entity.value as SystemDepartmentTreeNode) : new Set(),
  ))
  const expandableTreeNodeIds = computed(() => flattenDepartmentTree(departmentList.data.value)
    .filter(node => node.children.length > 0)
    .map(node => node.id))
  const hasExpandableTreeNodes = computed(() => expandableTreeNodeIds.value.length > 0)
  const allTreeNodesExpanded = computed(() => {
    if (!hasExpandableTreeNodes.value) {
      return false
    }
    const expandedNodeIds = new Set(expandedTreeNodes.value)
    return expandableTreeNodeIds.value.every(id => expandedNodeIds.has(id))
  })

  function updateExpandedTreeNodes(nodes: readonly (string | number)[]): void {
    expandedTreeNodes.value = nodes.map(node => String(node))
  }

  function toggleAllTreeNodes(): void {
    expandedTreeNodes.value = allTreeNodesExpanded.value
      ? []
      : [...expandableTreeNodeIds.value]
  }

  return {
    allTreeNodesExpanded,
    departmentDeleteAction,
    departmentDrawer,
    departmentList,
    departmentStatusAction,
    expandedTreeNodes,
    hasExpandableTreeNodes,
    parentOptions,
    toggleAllTreeNodes,
    tree,
    treeError,
    treeStatus,
    updateExpandedTreeNodes,
  }
}

function findDepartmentNode(
  nodes: readonly SystemDepartmentTreeNode[],
  id: string,
): SystemDepartmentTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }
    const found = findDepartmentNode(node.children, id)
    if (found) {
      return found
    }
  }
  return null
}

export function flattenDepartmentTree(
  nodes: readonly SystemDepartmentTreeNode[],
): SystemDepartmentTreeNode[] {
  return nodes.flatMap(node => [node, ...flattenDepartmentTree(node.children)])
}