import type { PageResult } from './api'

export type CrudKey = string | number
export type CrudListStatus = 'idle' | 'loading' | 'ready' | 'error'
export type CrudMutationStatus = 'idle' | 'submitting' | 'success' | 'error'
export type CrudDrawerMode = 'create' | 'edit' | 'view'
export type AppTableActionTheme = 'default' | 'primary' | 'danger' | 'warning' | 'success'

export interface AppTableAction {
  key: string
  label: string
  handler: () => unknown | Promise<unknown>
  theme?: AppTableActionTheme
  disabled?: boolean
  loading?: boolean
}

export interface CrudListRequest<TQuery> {
  query: Readonly<TQuery>
  page: number
  pageSize: number
  signal: AbortSignal
}

export type CrudListFetcher<
  TItem,
  TQuery,
> = (request: CrudListRequest<TQuery>) => Promise<PageResult<TItem>>

export interface CrudDrawerSubmitContext<TForm, TEntity> {
  mode: Exclude<CrudDrawerMode, 'view'>
  data: TForm
  entity: TEntity | null
}

export interface CrudPermissionOption {
  value: CrudKey
  label: string
  children?: CrudPermissionOption[]
  description?: string
  disabled?: boolean
  /**
   * 仅 menu: 分组节点使用：该目录/菜单自身携带的页面访问权限码。
   * 提交角色权限时用于祖先补全（子页面被勾选时必须一并授予父目录访问码，
   * 否则后端按行过滤会把整个父目录隐藏）。
   */
  pageAccessCode?: string
}

export interface CrudUploadContext {
  signal: AbortSignal
  onProgress: (percent: number) => void
}

export type CrudUploadHandler<TResult = unknown>
  = (file: File, context: CrudUploadContext) => Promise<TResult>

export interface CrudExportContext {
  signal: AbortSignal
  onProgress: (percent: number) => void
}

export type CrudExportHandler<TResult = unknown>
  = (context: CrudExportContext) => Promise<TResult>