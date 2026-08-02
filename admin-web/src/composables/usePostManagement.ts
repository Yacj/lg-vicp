import type { TableRowData } from 'tdesign-vue-next'
import {
  createPost,
  deletePost,
  fetchPosts,
  updatePost,
  updatePostStatus,
} from '@/api/modules/system-management'
import type {
  PostMutationResult,
  SystemPost,
  SystemPostPageQuery,
} from '@/types/system-management'
import { trimToNull } from '@/utils/system-management'
import { useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction, useCrudDelete } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { useCrudList } from './useCrudList'

/**
 * 岗位列表契约：后端仅支持 page/pageSize 服务端分页，
 * 无关键词、状态等筛选参数，因此查询状态保持空对象。
 */
export interface PostSearchQuery extends Record<string, unknown> {}

export interface PostForm extends Record<string, unknown> {
  name: string
  code: string
  sortOrder: number
  enabled: boolean
  remark: string
}

function createPostForm(): PostForm {
  return {
    code: '',
    enabled: true,
    name: '',
    remark: '',
    sortOrder: 0,
  }
}

function editPostForm(post: SystemPost): PostForm {
  return {
    code: post.code,
    enabled: post.enabled,
    name: post.name,
    remark: post.remark ?? '',
    sortOrder: post.sortOrder,
  }
}

function toPostQuery(page: number, pageSize: number): SystemPostPageQuery {
  return { page, pageSize }
}

export function usePostManagement() {
  const feedback = useAppFeedback()

  const postList = useCrudList<SystemPost & TableRowData, PostSearchQuery>({
    createQuery: () => ({}),
    fetcher: ({ page, pageSize, signal }) =>
      fetchPosts(toPostQuery(page, pageSize), signal),
    immediate: true,
    rowKey: 'id',
  })

  const postDrawer = useCrudDrawer<PostForm, SystemPost, PostMutationResult>({
    createForm: createPostForm,
    editForm: editPostForm,
    onError: error => void feedback.messageError(error),
    onSuccess: async result => {
      await feedback.message('success', result.message)
      await postList.refresh()
    },
    submit: ({ data, entity, mode }) => {
      const common = {
        enabled: data.enabled,
        name: data.name.trim(),
        remark: trimToNull(data.remark),
        sortOrder: Number(data.sortOrder),
      }
      return mode === 'create'
        ? createPost({ code: data.code.trim(), ...common })
        : updatePost(entity!.id, { code: data.code.trim(), ...common })
    },
  })

  const postStatusAction = useConfirmedCrudAction<
    { enabled: boolean, post: SystemPost },
    PostMutationResult
  >({
    action: ({ enabled, post }) => updatePostStatus(post.id, enabled),
    confirm: ({ enabled, post }) => ({
      content: `确认${enabled ? '启用' : '停用'}岗位“${post.name}”吗？`,
      confirmText: enabled ? '启用' : '停用',
      danger: !enabled,
      title: `${enabled ? '启用' : '停用'}岗位`,
    }),
    onSuccess: async () => {
      await postList.refresh()
    },
    successMessage: (_payload, result) => result.message,
  })

  const postDeleteAction = useCrudDelete<SystemPost, { message: string }>({
    action: post => deletePost(post.id),
    confirm: post => ({
      content: `确认删除岗位“${post.name}”吗？删除后无法恢复。`,
      confirmText: '删除',
      danger: true,
      title: '删除岗位',
    }),
    onSuccess: async () => {
      await postList.refresh()
    },
    successMessage: (_post, result) => result.message,
  })

  return {
    postDeleteAction,
    postDrawer,
    postList,
    postStatusAction,
  }
}