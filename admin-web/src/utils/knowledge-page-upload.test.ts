import { beforeEach, describe, expect, it, vi } from 'vitest'
import { completeFileUpload, createUploadIntent, uploadFileToPresignedUrl } from '@/api/modules/files'
import { uploadKnowledgePageImage } from './knowledge-page-upload'

vi.mock('@/api/modules/files', () => ({
  completeFileUpload: vi.fn(),
  createUploadIntent: vi.fn(),
  uploadFileToPresignedUrl: vi.fn(),
}))

const intent = vi.mocked(createUploadIntent)
const complete = vi.mocked(completeFileUpload)
const put = vi.mocked(uploadFileToPresignedUrl)
const file = new File(['image bytes'], 'page-2.png', { type: 'image/png' })
const options = { signal: new AbortController().signal, onProgress: vi.fn() }

beforeEach(() => vi.resetAllMocks())

describe('页面图片上传的最终文件 ID', () => {
  it('申请上传时命中已有文件，直接使用 READY 文件 ID', async () => {
    intent.mockResolvedValue({ mode: 'REUSE', fileId: 'ready-1', message: '已直接使用' })

    await expect(uploadKnowledgePageImage(file, options)).resolves.toEqual({ fileId: 'ready-1', reused: true })
    expect(put).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
  })

  it('上传完成后才发现重复，使用 complete 返回的 ID 而非临时 ID', async () => {
    intent.mockResolvedValue({ mode: 'UPLOAD', fileId: 'temporary-1', uploadUrl: 'https://storage.test/page.png', message: '上传凭证创建成功' })
    put.mockResolvedValue('')
    complete.mockResolvedValue({ message: '已存在相同文件，本次上传已合并', fileId: 'ready-1', duplicateOfFileId: 'ready-1', taskId: '' })

    await expect(uploadKnowledgePageImage(file, options)).resolves.toEqual({ fileId: 'ready-1', reused: true })
    expect(complete).toHaveBeenCalledWith('temporary-1')
  })

  it('新文件上传完成后沿用已就绪的文件 ID', async () => {
    intent.mockResolvedValue({ mode: 'UPLOAD', fileId: 'new-1', uploadUrl: 'https://storage.test/page.png', message: '上传凭证创建成功' })
    put.mockResolvedValue('')
    complete.mockResolvedValue({ message: '上传完成', fileId: 'new-1', taskId: '' })

    await expect(uploadKnowledgePageImage(file, options)).resolves.toEqual({ fileId: 'new-1', reused: false })
  })
})
