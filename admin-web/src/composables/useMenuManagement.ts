import type { TableRowData } from 'tdesign-vue-next'
import { computed, ref, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import {
  createMenu,
  deleteMenu,
  fetchMenus,
  updateMenu,
  updateMenuStatus,
} from '@/api/modules/system-management'
import { dynamicComponentOptions } from '@/router/component-map'
import { useRouteStore } from '@/stores/route'
import type {
  MenuMutationResult,
  MutationMessage,
  SystemMenu,
  SystemMenuTreeNode,
} from '@/types/system-management'
import type {
  MenuTreeOption,
  SystemMenuForm,
} from '@/utils/system-menu'
import {
  buildMenuTree,
  collectMenuSubtreeIdsFromFlat,
  createMenuForm,
  filterMenuTree,
  menuToForm,
  normalizeMenuForm,
  toMenuTreeOptions,
  validateMenuForm,
} from '@/utils/system-menu'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export interface MenuSearchQuery extends Record<string, unknown> {
  keyword: string
}

export type MenuTableRow = SystemMenuTreeNode & TableRowData

function validationMessage(issues: readonly { message: string }[]): string {
  if (issues.length === 0) {
    return ''
  }
  return issues.map(item => item.message).join('；')
}

export function useMenuManagement() {
  const feedback = useAppFeedback()
  const router = useRouter()
  const routeStore = useRouteStore()

  const flatMenus = shallowRef<SystemMenu[]>([])
  const runtimeRefreshing = ref(false)
  const runtimeRefreshError = shallowRef<unknown>(null)

  const fullMenuTree = computed(() => buildMenuTree(flatMenus.value))

  const menuList = useCrudList<MenuTableRow, MenuSearchQuery>({
    createQuery: () => ({ keyword: '' }),
    fetcher: async ({ query, signal }) => {
      const result = await fetchMenus(signal)
      flatMenus.value = result.items
      const filteredTree = filterMenuTree(buildMenuTree(result.items), query.keyword)
      return {
        items: filteredTree as MenuTableRow[],
        page: 1,
        pageSize: Math.max(result.items.length, 1),
        total: filteredTree.reduce((count, node) => count + countTreeNodes(node), 0),
      }
    },
    immediate: true,
    pageSize: 100,
    rowKey: 'id',
  })

  async function refreshRuntimeMenus(): Promise<void> {
    runtimeRefreshing.value = true
    runtimeRefreshError.value = null
    try {
       await routeStore.refresh(router)
      // if (result.issues.length > 0) {
      //   await feedback.message('warning', `运行时菜单已更新，但有 ${result.issues.length} 个节点未通过投影校验`)
      // }
      // else {
      //   await feedback.message('success', '已重新获取运行时菜单')
      // }
    }
    catch (error) {
      runtimeRefreshError.value = error
      // await feedback.notifyError(error, '运行时菜单刷新失败')
    }
    finally {
      runtimeRefreshing.value = false
    }
  }

  async function afterMutation(message: string): Promise<void> {
    await feedback.message('success', message)
    await menuList.refresh()
    await refreshRuntimeMenus()
  }

  const menuDrawer = useCrudDrawer<SystemMenuForm, SystemMenu, MenuMutationResult>({
    createForm: createMenuForm,
    editForm: menuToForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async result => {
      await afterMutation(result.message)
    },
    submit: ({ data, entity, mode }) => {
      const issues = validateMenuForm(
        data,
        flatMenus.value,
        mode === 'edit' ? entity?.id ?? null : null,
      )
      const message = validationMessage(issues)
      if (message) {
        throw new Error(message)
      }
      const input = normalizeMenuForm(data)
      return mode === 'create'
        ? createMenu(input)
        : updateMenu(entity!.id, input)
    },
  })

  const menuStatusAction = useConfirmedCrudAction<
    { menu: SystemMenu, enabled: boolean },
    MenuMutationResult
  >({
    action: ({ menu, enabled }) => updateMenuStatus(menu.id, enabled),
    confirm: ({ menu, enabled }) => ({
      content: `确认${enabled ? '启用' : '停用'}菜单“${menu.name}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}菜单`,
    }),
    onSuccess: async result => {
      await afterMutation(result.message)
    },
    successMessage: false,
  })

  const menuDeleteAction = useCrudDelete<SystemMenu, MutationMessage>({
    action: menu => deleteMenu(menu.id),
    confirm: menu => ({
      content: `确认删除菜单“${menu.name}”吗？请先处理所有下级菜单。`,
      confirmText: '删除',
      danger: true,
      title: '删除菜单',
    }),
    onSuccess: async result => {
      await afterMutation(result.message)
    },
    successMessage: false,
  })

  const expandedTreeNodes = ref<string[]>([])
  const expandableTreeNodeIds = computed(() => flattenTree(fullMenuTree.value)
    .filter(node => node.children.length > 0)
    .map(node => node.id))
  const hasExpandableTreeNodes = computed(() => expandableTreeNodeIds.value.length > 0)
  const allTreeNodesExpanded = computed(() => {
    if (!hasExpandableTreeNodes.value) {
      return false
    }
    const expanded = new Set(expandedTreeNodes.value)
    return expandableTreeNodeIds.value.every(id => expanded.has(id))
  })

  const parentOptions = computed<MenuTreeOption[]>(() => {
    const excluded = menuDrawer.entity.value
      ? collectMenuSubtreeIdsFromFlat(flatMenus.value, menuDrawer.entity.value.id)
      : new Set<string>()
    return toMenuTreeOptions(fullMenuTree.value, excluded)
  })

  function openCreate(parentId: string | null = null): void {
    menuDrawer.openCreate()
    menuDrawer.formData.parentId = parentId ?? undefined
  }

  function openEdit(menu: SystemMenu): void {
    menuDrawer.openEdit(menu)
  }

  function openCreateSibling(menu: SystemMenu): void {
    openCreate(menu.parentId)
  }

  function openCreateChild(menu: SystemMenu): void {
    if (menu.menuType !== 'BUTTON') {
      openCreate(menu.id)
    }
  }

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
    dynamicComponentOptions,
    expandedTreeNodes,
    flatMenus,
    fullMenuTree,
    hasExpandableTreeNodes,
    menuDeleteAction,
    menuDrawer,
    menuList,
    menuStatusAction,
    openCreate,
    openCreateChild,
    openCreateSibling,
    openEdit,
    parentOptions,
    runtimeRefreshError,
    runtimeRefreshing,
    toggleAllTreeNodes,
    updateExpandedTreeNodes,
  }
}

function countTreeNodes(node: SystemMenuTreeNode): number {
  return 1 + node.children.reduce((count, child) => count + countTreeNodes(child), 0)
}

function flattenTree(nodes: readonly SystemMenuTreeNode[]): SystemMenuTreeNode[] {
  return nodes.flatMap(node => [node, ...flattenTree(node.children)])
}