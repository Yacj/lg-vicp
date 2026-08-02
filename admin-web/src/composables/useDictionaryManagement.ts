import type { TableRowData } from 'tdesign-vue-next'
import {
  createDictionary,
  deleteDictionary,
  fetchDictionaries,
  updateDictionary,
} from '@/api/modules/system-management'
import type {
  DictionaryMutationResult,
  SystemDictionary,
} from '@/types/system-management'
import {
  matchesEnabledFilter,
  matchesKeyword,
  projectClientPage,
  trimToNull,
  trimToUndefined,
} from '@/utils/system-management'
import type { EnabledFilter } from '@/utils/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

export interface DictionarySearchQuery extends Record<string, unknown> {
  keyword: string
  enabled: EnabledFilter
}

export interface DictionaryForm extends Record<string, unknown> {
  code: string
  name: string
  description: string
  enabled: boolean
}

function createDictionaryForm(): DictionaryForm {
  return {
    code: '',
    description: '',
    enabled: true,
    name: '',
  }
}

function editDictionaryForm(dictionary: SystemDictionary): DictionaryForm {
  return {
    code: dictionary.code,
    description: dictionary.description ?? '',
    enabled: dictionary.enabled,
    name: dictionary.name,
  }
}

export function useDictionaryManagement() {
  const feedback = useAppFeedback()
  const dictionaryList = useCrudList<SystemDictionary & TableRowData, DictionarySearchQuery>({
    createQuery: () => ({ enabled: 'all', keyword: '' }),
    fetcher: async ({ page, pageSize, query, signal }) => {
      const { items } = await fetchDictionaries(signal)
      return projectClientPage(items, {
        page,
        pageSize,
        predicate: item => matchesEnabledFilter(item.enabled, query.enabled)
          && matchesKeyword(query.keyword, [item.name, item.code, item.description]),
      })
    },
    immediate: true,
    rowKey: 'id',
  })

  const dictionaryDrawer = useCrudDrawer<DictionaryForm, SystemDictionary, DictionaryMutationResult>({
    createForm: createDictionaryForm,
    editForm: editDictionaryForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async (result) => {
      await feedback.message('success', result.message)
      await dictionaryList.refresh()
    },
    submit: ({ data, entity, mode }) => mode === 'create'
      ? createDictionary({
          code: data.code.trim(),
          description: trimToUndefined(data.description),
          enabled: data.enabled,
          name: data.name.trim(),
        })
      : updateDictionary(entity!.id, {
          description: trimToNull(data.description),
          enabled: data.enabled,
          name: data.name.trim(),
        }),
  })

  const dictionaryStatusAction = useConfirmedCrudAction<{
    dictionary: SystemDictionary
    enabled: boolean
  }, DictionaryMutationResult>({
    action: ({ dictionary, enabled }) => updateDictionary(dictionary.id, { enabled }),
    confirm: ({ dictionary, enabled }) => ({
      content: `确认${enabled ? '启用' : '停用'}字典“${dictionary.name}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}字典`,
    }),
    onSuccess: async () => {
      await dictionaryList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const dictionaryDeleteAction = useCrudDelete<SystemDictionary, { message: string }>({
    action: dictionary => deleteDictionary(dictionary.id),
    confirm: dictionary => ({
      content: `删除字典“${dictionary.name}”会同时删除其字典项，且无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除字典',
    }),
    onSuccess: async (_result, _dictionary) => {
      await dictionaryList.refresh()
    },
    successMessage: (_dictionary, result) => result.message,
  })

  return {
    dictionaryDeleteAction,
    dictionaryDrawer,
    dictionaryList,
    dictionaryStatusAction,
  }
}