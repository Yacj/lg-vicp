import { describe, expect, it, vi } from 'vitest'
import {
  createObjectPreviewUrl,
  readTextBlob,
  resolvePreviewKind,
} from './file-preview'

describe('resolvePreviewKind', () => {
  it('recognizes pdf by mime', () => {
    expect(resolvePreviewKind('application/pdf', 'design.pdf')).toEqual({ kind: 'pdf' })
  })

  it('recognizes common images by mime', () => {
    expect(resolvePreviewKind('image/png', 'a.png').kind).toBe('image')
    expect(resolvePreviewKind('image/jpeg', 'a.jpg').kind).toBe('image')
    expect(resolvePreviewKind('image/webp', 'a.webp').kind).toBe('image')
  })

  it('recognizes text by mime', () => {
    expect(resolvePreviewKind('text/plain', 'notes.txt').kind).toBe('text')
    expect(resolvePreviewKind('application/json', 'data.json').kind).toBe('text')
  })

  it('recognizes text by extension when mime is generic', () => {
    expect(resolvePreviewKind('application/octet-stream', 'notes.md').kind).toBe('text')
    expect(resolvePreviewKind('', 'log.csv').kind).toBe('text')
  })

  it('reports unsupported with download hint', () => {
    const descriptor = resolvePreviewKind(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'contract.docx',
    )
    expect(descriptor.kind).toBe('unsupported')
    expect(descriptor.reason).toContain('下载')
  })

  it('is case-insensitive for mime and extension', () => {
    expect(resolvePreviewKind('IMAGE/PNG', 'A.PNG').kind).toBe('image')
    expect(resolvePreviewKind('text/plain', 'A.TXT').kind).toBe('text')
  })

  it('treats unknown image mime as image', () => {
    expect(resolvePreviewKind('image/tiff', 'scan.tiff').kind).toBe('image')
  })
})

describe('createObjectPreviewUrl', () => {
  it('creates object url for preview', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview')
    expect(createObjectPreviewUrl(new Blob(['x']))).toBe('blob:preview')
    create.mockRestore()
  })
})

describe('readTextBlob', () => {
  it('reads small text blob', async () => {
    const blob = new Blob(['hello 世界'])
    await expect(readTextBlob(blob)).resolves.toBe('hello 世界')
  })

  it('rejects oversized text blob', async () => {
    const large = new Blob(['x'.repeat(5 * 1024 * 1024 + 1)])
    await expect(readTextBlob(large)).rejects.toThrow('文本文件过大')
  })
})