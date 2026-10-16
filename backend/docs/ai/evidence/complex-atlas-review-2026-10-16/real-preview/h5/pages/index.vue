<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useAuthStore } from '@/store/auth'
import { useAssistantStore } from '@/store/assistant'
import { aiApi } from '@/api/modules/ai'
import AiMessageList from '@/components/ai/AiMessageList.vue'
import ReferencePageViewer from '@/components/ai/ReferencePageViewer.vue'
import { useReferencePageImage } from '@/composables/useReferencePageImage'
const image = useReferencePageImage()
const assistant = useAssistantStore(), auth = useAuthStore()
const session = ref<any>(), source = ref<any>(), input = ref('I型VICP坡屋面正置和倒置，20mm的传热系数分别多少？看下表。'), error = ref(''), screen = ref('chat')
const label = ref('89'), original = ref(false)
onMounted(async () => { session.value = await (await fetch('/test-session')).json(); auth.setSession({ accessToken: session.value.accessToken, clientType: 'C_APP' }) })
async function send() { try { error.value = ''; await assistant.sendMessage(input.value) } catch (e: any) { error.value = e.message } }
async function history() { if (assistant.conversation) await assistant.loadConversation(assistant.conversation.id, { force: true }) }
async function openPage(p: string) {
  source.value = undefined; label.value = p; error.value = ''; original.value = false
  try {
    const result: any = await aiApi.getSourceDetail({ pageId: session.value.pages[p] }).send(true)
    const d = result.data
    source.value = { type: 'REFERENCE_PAGE', page: { pageId: d.page.id, documentId: d.document.id, documentTitle: d.document.title, pageLabel: d.location.pageLabel, imageUrl: d.original.pageImageUrl || d.page.pageImageUrl }, renderModel: d.page.renderModel, matches: [] }
    const imageResult = await image.load(source.value.page.imageUrl, { pageId: d.page.id, confirmedRevision: d.page.renderModel?.confirmedRevision })
    if (imageResult === 'ready') source.value.page.imageUrl = image.source.value
    screen.value = 'source'
  } catch (e: any) { error.value = e.message }
}
</script>
<template><view class="p-3"><view class="font-bold">本轮只读复核 · 当前组件 / 历史隔离库</view><view class="text-3 mt-2">本轮只测真实GET来源；不发送消息、不确认或发布。存储服务不可用，原图状态单独记录。</view><view class="flex flex-wrap gap-2 my-3"><button size="mini" @click="screen='chat'">对话</button><button size="mini" @click="assistant.newConversation();screen='chat'">新会话</button><button size="mini" @click="history">重读历史</button><button v-for="p in ['89','90','75']" :key="p" size="mini" @click="openPage(p)">原页 {{p}}</button></view><view v-if="error || assistant.loadError" class="text-red">{{error || assistant.loadError}}</view><template v-if="screen==='chat'"><textarea v-model="input" aria-label="自然问题" class="w-full border p-2"/><view>本轮只读；自然问答未执行</view><view class="text-3">{{assistant.isStreaming?'流式回答中':'已就绪'}} · 会话 {{assistant.conversation?.id || '尚未创建'}}</view><AiMessageList :messages="assistant.messages" :is-streaming="assistant.isStreaming" :streaming-message-id="assistant.streamingMessageId" :progress-message="assistant.progressMessage"/></template><template v-else-if="source"><view class="font-bold">印刷页码 {{label}} · 正式来源详情只读全表</view><view>原图平台读取状态 {{image.status.value}}</view><button size="mini" @click="openPage(label)">重新获取授权原图</button><ReferencePageViewer :key="label" :page="source" :image-failed="image.status.value === 'error'" initial-view="页面内容"/></template></view></template>

