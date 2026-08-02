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

export interface CrudListRequest<TQuery extends Record<string, unknown>> {
  query: Readonly<TQuery>
  page: number
  pageSize: number
  signal: AbortSignal
}

export type CrudListFetcher<
  TItem,
  TQuery extends Record<string, unknown>,
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