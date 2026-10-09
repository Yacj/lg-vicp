import type { PageResult } from './api'

/** 后端 supportedMimeTypes（backend/src/modules/files/file.schemas.ts）。 */
export const SUPPORTED_FILE_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
  'image/svg+xml',
] as const

export type SupportedFileMimeType = (typeof SUPPORTED_FILE_MIME_TYPES)[number]

/** 文件状态，与后端 fileStatusEnum 对齐。 */
export type FileStatus
  = | 'UPLOADING'
    | 'UPLOADED'
    | 'QUEUED'
    | 'PARSING'
    | 'OCR_REQUIRED'
    | 'INDEXING'
    | 'READY'
    | 'FAILED'
    | 'DELETED'
    | 'RECYCLED'

export const fileCenterSources = [
  'USER_UPLOAD',
  'BATCH_IMPORT',
  'CRAWLER',
  'INTERNAL_API',
  'THERMAL_IMPORT',
] as const
export type FileCenterSource = (typeof fileCenterSources)[number]

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

/**
 * 文件用途（后端 filePurposeSchema）。
 * - GENERAL：缺省值，complete 后进入文档解析队列（status=QUEUED），READY 需等解析完成
 * - CHAT_IMAGE：聊天图片，complete 后直接 READY
 * - KNOWLEDGE_SOURCE：知识库来源文件，complete 后直接 READY（不触发自动解析）
 * 注意：页图 / 需要「上传后立即 READY」的场景必须显式传 KNOWLEDGE_SOURCE，否则默认 GENERAL 会先入解析队列，
 * 导致后续依赖 READY 的接口（如 pages/batch-upload）报「文件尚未上传完成」。
 */
export type FilePurpose = 'GENERAL' | 'CHAT_IMAGE' | 'KNOWLEDGE_SOURCE'

/** 创建上传凭证请求体（createUploadIntentBodySchema）。 */
export interface CreateUploadIntentInput {
  projectId?: string
  purpose?: FilePurpose
  fileName: string
  mimeType: SupportedFileMimeType
  sizeBytes: number
  sha256?: string
}

/** POST /files/upload-intents 响应。SHA-256 命中已有 READY 文件时为 REUSE，无需再 PUT。 */
export interface UploadIntent {
  message: string
  fileId: string
  mode?: 'UPLOAD' | 'REUSE'
  uploadUrl?: string | null
  headers?: Record<string, string>
  expiresAt?: string | null
  file?: {
    id: string
    originalName: string
    mimeType: string
    sizeBytes: number
    sha256: string | null
  }
}

/** POST /files/:id/complete 响应。 */
export interface CompleteUploadResult {
  message: string
  fileId: string
  taskId: string
  /** 上传完成后按内容去重时，指向最终可用的 READY 文件；fileId 同样是这个最终 ID。 */
  duplicateOfFileId?: string
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

/** GET /files 查询参数（B 端文件中心 / FilePicker 口径）。 */
export interface FilePageQuery {
  page?: number
  pageSize?: number
  projectId?: string
  keyword?: string
  mimeType?: string
  extension?: string
  source?: FileCenterSource
  status?: FileStatus
  sort?: 'createdAt' | 'sizeBytes' | 'originalName'
  includeRecycled?: '1'
}

/** 文件中心列表项（不含 objectKey / bucket / 永久 URL）。 */
export interface FileCenterItem {
  id: string
  originalName: string
  mimeType: string
  extension: string | null
  sizeBytes: number
  status: FileStatus
  source?: FileCenterSource | string | null
  projectId: string | null
  ownerUserId: string
  uploaderName?: string | null
  sha256: string | null
  errorMessage: string | null
  referenceCount?: number
  recycledAt?: string | null
  createdAt: string
  updatedAt: string
}

/** GET /files 响应（B 端为文件中心投影）。 */
export type FilePageResult = PageResult<FileCenterItem>

/** GET /files/recent 响应。 */
export interface FileRecentResult {
  items: FileCenterItem[]
}

/** GET /files/:id/preview 响应。 */
export interface FilePreviewResult {
  fileId: string
  mode: 'INLINE' | 'DOWNLOAD'
  mimeType?: string
  url?: string | null
  expiresIn?: number
  reason?: string
}

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
