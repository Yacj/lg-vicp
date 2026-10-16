<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AiMessageList from '@/components/ai/AiMessageList.vue'
import ReferencePageImage from '@/components/ai/ReferencePageImage.vue'
import ThermalPageTable from '@/components/ai/ThermalPageTable.vue'
import { useReferencePageHighlight } from '@/composables/useReferencePageHighlight'
import { useReferencePageImage } from '@/composables/useReferencePageImage'
import { useReferencePageResource } from '@/composables/useReferencePageResource'
import { parseStreamEvent } from '@/utils/aiStream'
import { normalizeReferencePages, referencePersistenceSnapshot } from '@/utils/referencePage'

const pageNumber = ref(90)
const thickness = ref(20)
const busy = ref(false)
const screen = ref('chat')
const expired = ref(false)
const messages = ref<any[]>([])
const current = ref<any>()
const preferred = ref<any>()
const order = ref('text-first')
const page = computed(() => messages.value[1]?.referencePages?.[0])
let querySequence = 0
const selected = computed(() => current.value || page.value)
const highlight = useReferencePageHighlight(() => ({ pageId: selected.value?.page.pageId || '', model: selected.value?.renderModel, matches: selected.value?.matches || [], preferred: preferred.value, anchorPrefix: 'fixture-full' }), () => { })
const resource = useReferencePageResource(() => ({ locator: { pageId: selected.value?.page.pageId }, context: selected.value }), async () => (await fetch(`/fixture/detail?page=${selected.value?.page.pageLabel}&expired=${expired.value ? 1 : 0}`)).json())
const image = useReferencePageImage()
watch([resource.pageImageUrl, resource.imageRevision], async ([url]) => {
  if (await image.load(url) === 'error')
    void resource.recoverImage()
})
function consume(event: string, data: any) {
  const payload = parseStreamEvent(event, data)
  if (!payload)
    return
  const message = messages.value[1]
  if (payload.event === 'delta')
    message.content += payload.data.text
  if (payload.event === 'reference_pages' || payload.event === 'done') {
    message.referencePages = normalizeReferencePages([...(message.referencePages || []), ...(payload.data.referencePages || [])])
    if (current.value?.page.pageId === message.referencePages[0]?.page.pageId)
      current.value = message.referencePages[0]
  }
}
async function query() {
  const sequence = ++querySequence
  busy.value = true
  current.value = undefined
  messages.value = [{ id: 'fixture-user', role: 'USER', content: `查看第 ${pageNumber.value} 页 ${thickness.value}mm 的两组参数和原表。` }, { id: 'fixture-answer', conversationId: 'fixture-phase4', role: 'ASSISTANT', content: '', status: 'COMPLETED', referencePages: [] }]
  const response = await fetch(`/fixture/sse?page=${pageNumber.value}&thickness=${thickness.value}&order=${order.value}`)
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  while (true) {
    const { value, done } = await reader.read()
    if (sequence !== querySequence) {
      await reader.cancel()
      return
    }
    pending += decoder.decode(value, { stream: !done })
    const blocks = pending.split('\n\n')
    pending = blocks.pop() || ''
    for (const block of blocks) {
      const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7)
      const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (event && data)
        consume(event, JSON.parse(data))
    }
    if (done)
      break
  }
  busy.value = false
}
async function source(value: any, _message?: string, match?: any) {
  current.value = value
  preferred.value = match
  screen.value = 'image'
  await resource.load()
}
function full(value: any, _message: string, match: any, enabled: boolean) {
  current.value = value
  preferred.value = match
  screen.value = 'table'
  highlight.enabled.value = enabled
}
function duplicate() {
  consume('reference_pages', { referencePages: page.value ? [JSON.parse(JSON.stringify(page.value))] : [] })
}
function save() {
  uni.setStorageSync('atlas-phase4-history', referencePersistenceSnapshot({ messages: messages.value }))
}
function restore() {
  querySequence++
  busy.value = false
  messages.value = uni.getStorageSync('atlas-phase4-history')?.messages || []
  current.value = undefined
  pageNumber.value = Number(page.value?.page.pageLabel) || 90
  screen.value = 'chat'
}
function failImage() {
  image.failed()
  void resource.recoverImage()
}
function preview() {
  uni.previewImage({ urls: [image.source.value], current: image.source.value })
}
void query()
</script>

<template>
  <view class="fixture">
    <view class="fixture__banner">
      隔离 Fixture · 人工源图基线<br>真实 UniApp H5 组件 / HTTP / SSE<br>未连接正式 Backend、数据库、Redis、Vision 或 OSS
    </view>
    <view v-show="screen === 'chat'">
      <view class="fixture__controls">
        <button v-for="number in [89, 90, 75]" :key="number" @click="pageNumber = number; query()">
          第{{ number }}页
        </button><button @click="thickness = thickness === 20 ? 25 : 20; query()">
          切换 {{ thickness === 20 ? 25 : 20 }}mm
        </button><button @click="order = order === 'text-first' ? 'source-first' : 'text-first'; query()">
          {{ order === 'text-first' ? '来源先到' : '正文先到' }}
        </button><button @click="duplicate">
          重复来源事件
        </button><button @click="save">
          保存隔离历史
        </button><button @click="restore">
          恢复隔离历史
        </button>
      </view>
      <view class="fixture__state">
        {{ busy ? '流式接收中' : '接收完成' }} · {{ pageNumber }}页 · {{ thickness }}mm
      </view>
      <AiMessageList :messages="messages" :is-streaming="busy" :streaming-message-id="busy ? 'fixture-answer' : null" :progress-message="null" @open-reference="source" @open-table="full" />
    </view>
    <view v-if="screen !== 'chat'">
      <button @click="screen = 'chat'">
        返回对话（保留页内位置）
      </button>
      <view>印刷页码 {{ selected?.page.pageLabel }} · {{ screen === 'table' ? '完整表格' : '原始 PNG' }}</view>
      <template v-if="screen === 'table'">
        <view>{{ highlight.active.value?.constructionId === selected?.renderModel.constructions[0].constructionId ? selected?.renderModel.constructions[0].rawConstructionLabel : selected?.renderModel.constructions[1].rawConstructionLabel }}</view>
        <button @click="highlight.navigate(1)">
          下一处命中
        </button><button @click="highlight.toggle">
          {{ highlight.enabled.value ? '取消高亮' : '恢复高亮' }}
        </button><button @click="duplicate">
          重复来源事件
        </button>
        <ThermalPageTable :constructions="selected.renderModel.constructions" :matches="highlight.matches.value" :active="highlight.active.value" :highlight-enabled="highlight.enabled.value" :viewport-height="500" anchor-prefix="fixture-full" />
        <button @click="source(selected)">
          查看原始页面
        </button>
      </template>
      <template v-else>
        <button @click="expired = true; resource.load()">
          模拟签名过期
        </button><button @click="expired = false; resource.recoverImage(true)">
          恢复授权图片
        </button>
        <ReferencePageImage :title="selected?.renderModel.pageTitle || '原始页面'" :source="image.source.value" :status="image.status.value" :refreshing="resource.refreshingImage.value" :revision="resource.imageRevision.value" @preview="preview" @retry="resource.recoverImage(true)" @image-error="failImage" @image-load="resource.imageLoaded">
          <template #fallback>
            <a :href="`/fixture/original/${selected?.page.pageLabel}.png`" target="_blank">打开原文件</a>
          </template>
        </ReferencePageImage>
        <view v-for="note in selected?.renderModel.notes" :key="note">
          {{ note }}
        </view>
      </template>
    </view>
  </view>
</template>

<style>
.fixture { padding: 12px; box-sizing: border-box; width: 100%; font-size: 14px; color: #1f1f1f; }
.fixture__banner { padding: 10px; background: #fff5df; border: 1px solid #dfb568; font-size: 12px; line-height: 1.7; }
.fixture__controls { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }
.fixture button { margin: 4px 0; padding: 0 7px; font-size: 12px; line-height: 30px; }
.fixture__state { padding:8px 0; color: #555; }
</style>
