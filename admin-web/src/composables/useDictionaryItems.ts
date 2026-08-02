import type { TableRowData } from 'tdesign-vue-next'
import {
  createDictionaryItem,
  deleteDictionaryItem,
  fetchDictionaryItems,
  updateDictionaryItem,
} from '@/api/modules/system-management'
import type {
  DictionaryItemMutationResult,
  SystemDictionaryItem,
} from '@/types/system-management'
import {
  formatMetadataText,
  matchesEnabledFilter,
  matchesKeyword,
  parseMetadataText,
  projectClientPage,
} from '@/utils/system-management'
import type { EnabledFilter } from '@/utils/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export interface DictionaryItemSearchQuery extends Record<string, unknown> {
  keyword: string
  enabled: EnabledFilter
}

export interface DictionaryItemForm extends Record<string, unknown> {
  value: string
  label: string
  sortOrder: number
  enabled: boolean
  metadata: string
}

function createDictionaryItemForm(): DictionaryItemForm {
  return {
    enabled: true,
    label: '',
    metadata: '',
    sortOrder: 0,
    value: '',
  }
}

function editDictionaryItemForm(item: SystemDictionaryItem): DictionaryItemForm {
  return {
    enabled: item.enabled,
    label: item.label,
    metadata: formatMetadataText(item.metadata),
    sortOrder: item.sortOrder,
    value: item.value,
  }
}

export function useDictionaryItems(dictionaryId: string) {
  const feedback = useAppFeedback()

  const itemList = useCrudList<SystemDictionaryItem & TableRowData, DictionaryItemSearchQuery>({
    createQuery: () => ({ enabled: 'all', keyword: '' }),
    fetcher: async ({ page, pageSize, query, signal }) => {
      const { items } = await fetchDictionaryItems(dictionaryId, signal)
      return projectClientPage(items, {
        page,
        pageSize,
        predicate: item => matchesEnabledFilter(item.enabled, query.enabled)
          && matchesKeyword(query.keyword, [item.label, item.value]),
      })
    },
    immediate: true,
    rowKey: 'id',
  })

  const itemDrawer = useCrudDrawer<DictionaryItemForm, SystemDictionaryItem, DictionaryItemMutationResult>({
    createForm: createDictionaryItemForm,
    editForm: editDictionaryItemForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await itemList.refresh()
    },
    submit: ({ data, entity, mode }) => {
      const metadata = parseMetadataText(data.metadata)
      const input = {
        enabled: data.enabled,
        label: data.label.trim(),
        ...(metadata || mode === 'edit' ? { metadata: metadata ?? {} } : {}),
        sortOrder: Number(data.sortOrder),
        value: data.value.trim(),
      }
      return mode === 'create'
        ? createDictionaryItem(dictionaryId, input)
        : updateDictionaryItem(dictionaryId, entity!.id, input)
    },
  })

  const itemStatusAction = useConfirmedCrudAction<{
    item: SystemDictionaryItem
    enabled: boolean
  }, DictionaryItemMutationResult>({
    action: ({ item, enabled }) => updateDictionaryItem(dictionaryId, item.id, { enabled }),
    confirm: ({ item, enabled }) => ({
      content: `确认${enabled ? '启用' : '停用'}字典项“${item.label}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}字典项`,
    }),
    onSuccess: () => itemList.refresh(),
    successMessage: (_payload, result) => result.message,
  })

  const itemDeleteAction = useCrudDelete<SystemDictionaryItem, { message: string }>({
    action: item => deleteDictionaryItem(dictionaryId, item.id),
    confirm: item => ({
      content: `确认删除字典项“${item.label}”吗？删除后无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除字典项',
    }),
    onSuccess: () => itemList.refresh(),
    successMessage: (_item, result) => result.message,
  })

  return {
    itemDeleteAction,
    itemDrawer,
    itemList,
    itemStatusAction,
  }
}