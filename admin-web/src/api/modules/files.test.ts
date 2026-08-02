import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, httpClient } from '@/api/http/client'
import { presignedClient } from '@/api/http/presigned'
import {
  completeFileUpload,
  createUploadIntent,
  deleteFile,
  downloadUrlToBlob,
  fetchFileDownloadUrl,
  fetchFileStatus,
  fetchFiles,
  requestBlob,
  uploadFileToPresignedUrl,
} from './files'

vi.mock('@/api/http/presigned', () => ({
  presignedClient: {
    get: vi.fn(),
    put: vi.fn(),
  },
}))

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
  httpClient: {
    request: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)
const mockedHttpClient = vi.mocked(httpClient)
const mockedPresignedClient = vi.mocked(presignedClient)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('file api contracts', () => {
  it('creates upload intent with real backend body fields', async () => {
    await createUploadIntent({
      fileName: '图纸.pdf',
      mimeType: 'application/pdf',
      projectId: 'project-1',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
    })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/files/upload-intents', {
      fileName: '图纸.pdf',
      mimeType: 'application/pdf',
      projectId: 'project-1',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
    })
  })

  it('completes upload with the file id path', async () => {
    await completeFileUpload('file-1')

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/files/file-1/complete')
  })

  it('fetches file status and passes abort signal for polling', async () => {
    const signal = new AbortController().signal
    await fetchFileStatus('file-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/files/file-1/status', { signal })
  })

  it('fetches presigned download url', async () => {
    await fetchFileDownloadUrl('file-1')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/files/file-1/download-url')
  })

  it('queries file list with backend pagination parameters', async () => {
    const signal = new AbortController().signal
    await fetchFiles({ page: 2, pageSize: 20, projectId: 'project-1' }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/files', {
      params: { page: 2, pageSize: 20, projectId: 'project-1' },
      signal,
    })
  })

  it('deletes file by id', async () => {
    await deleteFile('file-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/files/file-1')
  })
})

describe('uploadFileToPresignedUrl', () => {
  it('performs presigned PUT with the raw file and reports progress', async () => {
    const file = new File(['content'], '图纸.pdf', { type: 'application/pdf' })
    const progress = vi.fn()
    mockedPresignedClient.put.mockImplementation(async (_url, _data, config) => {
      config?.onUploadProgress?.({ loaded: 50, total: 100, bytes: 50, lengthComputable: true })
      return { status: 200, data: '' }
    })

    await uploadFileToPresignedUrl('https://storage.example/upload', file, {
      onProgress: progress,
      signal: new AbortController().signal,
    })

    expect(mockedPresignedClient.put).toHaveBeenCalledWith(
      'https://storage.example/upload',
      file,
      expect.objectContaining({
        headers: { 'Content-Type': 'application/pdf' },
      }),
    )
    expect(progress).toHaveBeenCalledWith({ loaded: 50, percent: 50, total: 100 })
  })

  it('normalizes HTTP error from storage into HttpRequestError', async () => {
    const file = new File(['content'], 'a.pdf', { type: 'application/pdf' })
    mockedPresignedClient.put.mockResolvedValue({ status: 403, data: '<Error>denied</Error>' })

    await expect(uploadFileToPresignedUrl('https://storage.example/upload', file, {
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      message: '对象存储上传失败（HTTP 403）：denied',
      status: 403,
    })
  })

  it('normalizes network failure into HttpRequestError', async () => {
    const file = new File(['content'], 'a.pdf', { type: 'application/pdf' })
    mockedPresignedClient.put.mockRejectedValue({ isAxiosError: true, message: 'Network Error' })

    await expect(uploadFileToPresignedUrl('https://storage.example/upload', file, {
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      message: '对象存储上传失败：Network Error',
    })
  })

  it('rethrows abort errors as-is', async () => {
    const file = new File(['content'], 'a.pdf', { type: 'application/pdf' })
    mockedPresignedClient.put.mockRejectedValue(new DOMException('aborted', 'AbortError'))

    await expect(uploadFileToPresignedUrl('https://storage.example/upload', file, {
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(DOMException)
  })
})

describe('downloadUrlToBlob', () => {
  it('returns blob with content headers for filename resolution', async () => {
    const blob = new Blob(['pdf-data'], { type: 'application/pdf' })
    mockedPresignedClient.get.mockResolvedValue({
      status: 200,
      data: blob,
      headers: {
        'content-disposition': 'attachment; filename="report.pdf"',
        'content-type': 'application/pdf',
      },
    })

    const result = await downloadUrlToBlob('https://storage.example/file.pdf', {
      signal: new AbortController().signal,
    })

    expect(result.blob).toBe(blob)
    expect(result.contentDisposition).toBe('attachment; filename="report.pdf"')
    expect(result.contentType).toBe('application/pdf')
  })

  it('throws HttpRequestError on storage error response', async () => {
    mockedPresignedClient.get.mockResolvedValue({ status: 404, data: new Blob(['not found']) })

    await expect(downloadUrlToBlob('https://storage.example/missing.pdf', {
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      message: '文件下载失败（HTTP 404）',
      status: 404,
    })
  })
})

describe('requestBlob', () => {
  it('fetches blob through the business http client', async () => {
    const blob = new Blob(['csv'], { type: 'text/csv' })
    mockedHttpClient.request.mockResolvedValue({ data: blob })

    const result = await requestBlob({
      url: '/api/v1/platform/users/export',
    })

    expect(result).toBe(blob)
    expect(mockedHttpClient.request).toHaveBeenCalledWith(expect.objectContaining({
      method: 'GET',
      responseType: 'blob',
      url: '/api/v1/platform/users/export',
    }))
  })
})