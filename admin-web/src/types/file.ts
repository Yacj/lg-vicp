import type { PageResult } from './api'

/** 后端 supportedMimeTypes（backend/src/modules/files/file.schemas.ts）。 */
export const SUPPORTED_FILE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
] as const

export type SupportedFileMimeType = (typeof SUPPORTED_FILE_MIME_TYPES)[number]

/** 文件状态，与后端 fileStatusEnum 对齐。 */
export type FileStatus =
  | 'UPLOADING'
  | 'UPLOADED'
  | 'QUEUED'
  | 'PARSING'
  | 'OCR_REQUIRED'
  | 'INDEXING'
  | 'READY'
  | 'FAILED'
  | 'DELETED'

/** 异步任务状态，与后端 asyncTaskStatusEnum 对齐。 */
export type AsyncTaskStatus = 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'FAILED'

export type FileTaskBusinessType = 'file' | 'report' | null

/** 文件记录（后端 files 表投影）。 */
export interface FileRecord {
  id: string
  projectId: string | null
  ownerUserId: string
  storageProvider: string
  bucket: string
  objectKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string | null
  status: FileStatus
  errorMessage: string | null
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 异步任务记录（后端 async_tasks 表投影）。 */
export interface AsyncTaskRecord {
  id: string
  queueName: string
  jobType: string
  businessType: FileTaskBusinessType
  businessId: string | null
  bullJobId: string | null
  status: AsyncTaskStatus
  progress: number
  payload: Record<string, unknown> | null
  result: Record<string, unknown> | null
  attempts: number
  errorMessage: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 创建上传凭证请求体（createUploadIntentBodySchema）。 */
export interface CreateUploadIntentInput {
  projectId?: string
  fileName: string
  mimeType: SupportedFileMimeType
  sizeBytes: number
  sha256?: string
}

/** POST /files/upload-intents 响应。 */
export interface UploadIntent {
  message: string
  fileId: string
  uploadUrl: string
  headers: Record<string, string>
  expiresAt: string
}

/** POST /files/:id/complete 响应。 */
export interface CompleteUploadResult {
  message: string
  fileId: string
  taskId: string
}

/** GET /files/:id/status 响应。 */
export interface FileStatusResult {
  file: FileRecord
  task: AsyncTaskRecord | null
}

/** GET /files/:id/download-url 响应。 */
export interface DownloadUrlResult {
  url: string
  expiresIn: number
}

/** GET /files 查询参数。 */
export interface FilePageQuery {
  page?: number
  pageSize?: number
  projectId?: string
}

/** GET /files 响应。 */
export type FilePageResult = PageResult<FileRecord>

/** 上传进度回调。 */
export interface UploadProgress {
  /** 已传输字节数。 */
  loaded: number
  /** 总字节数（响应头未提供时可能为 undefined）。 */
  total: number | undefined
  /** 0-100 的百分比。 */
  percent: number
}

export interface UploadFileContext {
  signal: AbortSignal
  onProgress: (progress: UploadProgress) => void
}

export type FileUploadHandler = (file: File, context: UploadFileContext) => Promise<CompleteUploadResult>