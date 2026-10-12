import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRouter } from '@wot-ui/router'
import { knowledgeSourceLocation } from './aiSource'

test('参考页命名跳转保留来源、原文件和命中参数，使用实际安装的路由序列化', async () => {
  const previousUni = Reflect.get(globalThis, 'uni')
  let navigatedUrl = ''
  Reflect.set(globalThis, 'uni', {
    navigateTo(options: { url: string, success: () => void }) {
      navigatedUrl = options.url
      options.success()
    },
  })
  try {
    const router = createRouter({ routes: [{ name: 'knowledge-source', path: '/pages/knowledge-source/index' }] })
    const inputs = [
      { documentId: 'document', pageId: 'page', referenceMessageId: 'message', view: 'image', constructionId: 'A1-3', optionId: 'A1-3-18', title: '外墙图集 · 参考页', pageLabel: '22' },
      { blockId: 'block', originalFileId: 'file', physicalPageNumber: 24, title: '知识原文', pageLabel: 'A1' },
      { documentId: 'document', pageId: 'page', optionId: 'A1-3-18', view: 'content', pageLabel: '22' },
    ]
    for (const input of inputs) {
      await router.push(knowledgeSourceLocation(input))
      const url = new URL(navigatedUrl, 'https://example.test')
      assert.equal(url.pathname, '/pages/knowledge-source/index')
      for (const [key, value] of Object.entries(input)) {
        assert.equal(url.searchParams.get(key), String(value), key)
      }
      assert.ok(['documentId', 'pageId', 'blockId'].some(key => url.searchParams.get(key)))
    }
  }
  finally {
    if (previousUni === undefined)
      Reflect.deleteProperty(globalThis, 'uni')
    else
      Reflect.set(globalThis, 'uni', previousUni)
  }
})
