import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadErrorMessage,
  downloadFromUrl,
  normalizeDownloadError,
  resolveDownloadFilename,
  triggerBlobDownload,
} from './download'
import { BusinessError, HttpRequestError } from '@/types/error'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveDownloadFilename', () => {
  it('prefers filename* UTF-8 encoded header', () => {
    expect(resolveDownloadFilename(
      "attachment; filename*=UTF-8''%E6%8A%A5%E5%91%8A.pdf",
      'https://storage.example/x',
    )).toBe('报告.pdf')
  })

  it('falls back to plain filename header', () => {
    expect(resolveDownloadFilename(
      'attachment; filename="report.pdf"',
      'https://storage.example/x',
    )).toBe('report.pdf')
  })

  it('falls back to url path segment when header is missing', () => {
    expect(resolveDownloadFilename(null, 'https://storage.example/files/design-2026.pdf')).toBe('design-2026.pdf')
  })

  it('falls back to url path segment for relative-looking input', () => {
    expect(resolveDownloadFilename(null, 'not-a-url')).toBe('not-a-url')
  })

  it('falls back to default name when url has no path segment', () => {
    expect(resolveDownloadFilename(null, 'https://storage.example/')).toBe('download')
    expect(resolveDownloadFilename(null, '')).toBe('download')
  })

  it('ignores invalid percent-encoded header and keeps fallback chain', () => {
    expect(resolveDownloadFilename("attachment; filename*=UTF-8''%E4%B", 'https://storage.example/a.pdf')).toBe('a.pdf')
  })
})

describe('triggerBlobDownload', () => {
  it('creates a link with download attribute and returns filename', () => {
    const click = vi.fn()
    const link = { click, remove: vi.fn() }
    vi.spyOn(document, 'createElement').mockReturnValue(link as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => undefined as never)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => undefined as never)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const result = triggerBlobDownload(new Blob(['data']), { filename: 'a.pdf' })

    expect(result.filename).toBe('a.pdf')
    expect(result.sizeBytes).toBe(4)
    expect(click).toHaveBeenCalled()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('applies mime type override when provided', () => {
    vi.spyOn(document, 'createElement').mockReturnValue({ click: vi.fn() } as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => undefined as never)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => undefined as never)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const blob = new Blob(['x'])
    triggerBlobDownload(blob, { filename: 'a.csv', mimeType: 'text/csv;charset=utf-8' })

    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.objectContaining({ type: 'text/csv;charset=utf-8' }))
  })
})

describe('normalizeDownloadError', () => {
  it('passes BusinessError with requestId through', () => {
    const error = new BusinessError({ code: 413, message: '文件不能超过 50 MB' }, 'req-1')
    expect(normalizeDownloadError(error)).toEqual({
      message: '文件不能超过 50 MB',
      requestId: 'req-1',
      status: undefined,
    })
  })

  it('passes HttpRequestError through', () => {
    const error = new HttpRequestError('对象存储上传失败', { requestId: 'req-2', status: 403 })
    expect(normalizeDownloadError(error)).toEqual({
      message: '对象存储上传失败',
      requestId: 'req-2',
      status: 403,
    })
  })

  it('extracts unified protocol error payload from axios response', () => {
    const axiosError = {
      isAxiosError: true,
      message: 'Request failed with status code 404',
      response: {
        status: 404,
        data: { success: false, error: { code: 404, message: '文件不存在或无权下载' }, requestId: 'req-3' },
      },
    }
    expect(normalizeDownloadError(axiosError)).toEqual({
      message: '文件不存在或无权下载',
      requestId: 'req-3',
      status: 404,
    })
  })

  it('uses http status message when body has no protocol payload', () => {
    const axiosError = {
      isAxiosError: true,
      response: { status: 500, data: new Blob(['internal error']) },
    }
    expect(normalizeDownloadError(axiosError)).toEqual({
      message: '下载失败（HTTP 500）',
      status: 500,
    })
  })

  it('reports no-server-response for network failure', () => {
    const axiosError = { isAxiosError: true, message: 'Network Error' }
    expect(normalizeDownloadError(axiosError)).toEqual({
      message: '下载失败：无服务器响应',
    })
  })

  it('falls back for unknown errors', () => {
    expect(normalizeDownloadError(new Error('boom'))).toEqual({ message: 'boom' })
    expect(normalizeDownloadError('oops')).toEqual({ message: '下载失败，请稍后重试' })
  })
})

describe('downloadFromUrl', () => {
  it('downloads and resolves filename from content-disposition', async () => {
    const blob = new Blob(['pdf'])
    const fetchBlob = vi.fn().mockResolvedValue({
      blob,
      contentDisposition: 'attachment; filename="report.pdf"',
      contentType: 'application/pdf',
    })
    const trigger = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(document, 'createElement').mockReturnValue({ click: vi.fn() } as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => undefined as never)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => undefined as never)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const result = await downloadFromUrl('https://storage.example/object-key', {
      fetchBlob,
      onProgress: vi.fn(),
      signal: new AbortController().signal,
    })

    expect(result.filename).toBe('report.pdf')
    expect(trigger).toHaveBeenCalled()
  })

  it('gives explicit filename highest priority', async () => {
    const fetchBlob = vi.fn().mockResolvedValue({
      blob: new Blob(['x']),
      contentDisposition: 'attachment; filename="from-header.pdf"',
      contentType: 'application/octet-stream',
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock')
    vi.spyOn(document, 'createElement').mockReturnValue({ click: vi.fn() } as unknown as HTMLElement)
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => undefined as never)
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => undefined as never)
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)

    const result = await downloadFromUrl('https://storage.example/object-key', {
      fetchBlob,
      filename: 'explicit.pdf',
    })

    expect(result.filename).toBe('explicit.pdf')
  })

  it('propagates fetch failure as error message', async () => {
    const fetchBlob = vi.fn().mockRejectedValue(new HttpRequestError('文件下载失败（HTTP 403）', { status: 403 }))

    await expect(downloadFromUrl('https://storage.example/x', { fetchBlob })).rejects.toBeInstanceOf(HttpRequestError)
    expect(downloadErrorMessage(new HttpRequestError('文件下载失败（HTTP 403）', { status: 403 }))).toBe('文件下载失败（HTTP 403）')
  })
})