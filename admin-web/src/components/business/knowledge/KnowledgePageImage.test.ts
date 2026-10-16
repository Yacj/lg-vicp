import TDesign from 'tdesign-vue-next'
import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { fetchKnowledgePageRecognition, fetchKnowledgePageImage } from '@/api/modules/knowledge'
import KnowledgePageImage from './KnowledgePageImage.vue'

vi.mock('@/api/modules/knowledge', () => ({ fetchKnowledgePageRecognition: vi.fn(), fetchKnowledgePageImage: vi.fn() }))
let app: ReturnType<typeof createApp> | undefined
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

it('原图失败后重新授权取链接，保留原文件入口；失败反馈可再次重试', async () => {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:authorized-original'), revokeObjectURL: vi.fn() })
  vi.mocked(fetchKnowledgePageImage).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Blob(['original'], { type: 'image/png' }))
  const el = document.createElement('div')
  document.body.append(el)
  app = createApp({ render: () => h(KnowledgePageImage, { pageId: 'fixture', imageUrl: '/expired.png' }) })
  app.use(TDesign).mount(el)
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await Promise.resolve()
      await nextTick()
    }
  }
  el.querySelector('img')!.dispatchEvent(new Event('error'))
  await settle()
  expect(el.querySelector('[role="status"]')!.textContent).toContain('重新获取授权链接')
  vi.mocked(fetchKnowledgePageRecognition).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ pageImageUrl: '/renewed.png' } as any)
  const retry = () => [...el.querySelectorAll('button')].find(button => button.textContent?.trim() === '重新获取原图')!.click()
  retry()
  await settle()
  expect(el.querySelector('[role="alert"]')!.textContent).toContain('重新获取原图失败')
  retry()
  await settle()
  expect(fetchKnowledgePageRecognition).toHaveBeenCalledWith('fixture')
  expect(fetchKnowledgePageImage).toHaveBeenCalledWith('fixture')
  expect(el.querySelector('img')?.getAttribute('src')).toBe('blob:authorized-original')
  expect(el.querySelector('a')?.getAttribute('href')).toBe('blob:authorized-original')
})
