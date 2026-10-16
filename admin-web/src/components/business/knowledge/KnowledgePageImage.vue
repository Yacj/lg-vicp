<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { fetchKnowledgePageRecognition, fetchKnowledgePageImage } from '@/api/modules/knowledge'
import { useKnowledgePageImage } from '@/composables/useKnowledgePageImage'
const props = defineProps<{ imageUrl?: string | null, pageId?: string | null, title?: string, fullscreenMode?: boolean }>()
const source = ref(props.imageUrl)
const retryKey = ref(0)
const refreshing = ref(false)
const error = ref('')
let sequence = 0
let objectUrl = ''
let automaticRecoveryUsed = false
function releaseObjectUrl() { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = '' }
watch(() => [props.imageUrl, props.pageId], () => {
  sequence++
  releaseObjectUrl()
  automaticRecoveryUsed = false
  source.value = props.imageUrl
  error.value = ''
  refreshing.value = false
})
const { scale, dragging, failed, imageStyle, reset, zoom, start, move, stop } = useKnowledgePageImage(() => source.value)
const fullscreen = ref(false)
async function loadAuthorizedImage(current: number) {
  if (!props.pageId) return false
  const blob = await fetchKnowledgePageImage(props.pageId)
  if (current !== sequence) return false
  if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('原图响应格式无效')
  releaseObjectUrl()
  objectUrl = URL.createObjectURL(blob)
  source.value = objectUrl
  retryKey.value++
  failed.value = false
  return true
}
async function handleImageError() {
  failed.value = true
  if (!props.pageId || automaticRecoveryUsed) return
  automaticRecoveryUsed = true
  const current = ++sequence
  refreshing.value = true
  try { await loadAuthorizedImage(current) }
  catch { if (current === sequence) error.value = '原图读取失败，请检查权限或网络后重试。' }
  finally { if (current === sequence) refreshing.value = false }
}
onBeforeUnmount(() => { sequence++; releaseObjectUrl() })
async function retry(): Promise<void> {
  const current = ++sequence
  refreshing.value = true
  error.value = ''
  try {
    const url = props.pageId ? (await fetchKnowledgePageRecognition(props.pageId)).pageImageUrl : source.value
    if (current !== sequence) {
      return
    }
    if (props.pageId && await loadAuthorizedImage(current)) return
    if (!url) {
      error.value = '当前页面未提供可用原图，请联系有审核权限的管理员。'
      return
    }
    source.value = url
    retryKey.value++
    failed.value = false
  }
  catch {
    if (current === sequence) {
      error.value = '重新获取原图失败，请检查权限或网络后重试。'
    }
  }
  finally {
    if (current === sequence) {
      refreshing.value = false
    }
  }
}
</script>

<template>
  <div class="page-image" :class="{ 'page-image--fullscreen': fullscreenMode }">
    <div class="page-image__toolbar">
      <span>{{ Math.round(scale * 100) }}%</span>
      <t-space size="small">
        <t-button size="small" variant="outline" :disabled="!source || failed" @click="zoom(-0.1)">缩小</t-button>
        <t-button size="small" variant="outline" :disabled="!source || failed" @click="zoom(0.1)">放大</t-button>
        <t-button size="small" variant="outline" @click="reset">复位</t-button>
        <t-button v-if="!fullscreenMode" size="small" variant="outline" :disabled="!source || failed" @click="fullscreen = true">全屏</t-button>
        <t-button size="small" variant="outline" :loading="refreshing" :disabled="refreshing || (!pageId && !source)" @click="retry">重新获取原图</t-button>
        <a v-if="source" :href="source" target="_blank" rel="noopener noreferrer">打开原图文件</a>
      </t-space>
    </div>
    <div class="page-image__stage" :class="{ 'is-dragging': dragging }" @wheel.prevent="zoom($event.deltaY > 0 ? -0.1 : 0.1)" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop">
      <img v-if="source && !failed" :key="retryKey" :src="source" :alt="`${title || '页面'}原图`" :style="imageStyle" draggable="false" @error="handleImageError">
      <p v-else role="status">原始页面图片暂不可用，可重新获取授权链接后重试。</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    <t-dialog v-model:visible="fullscreen" :header="title || '页面原图'" mode="full-screen" :footer="false" destroy-on-close>
      <KnowledgePageImage v-if="fullscreen" :image-url="source" :page-id="pageId" :title="title" fullscreen-mode />
    </t-dialog>
  </div>
</template>

<style scoped>
.page-image__toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--td-size-3); margin-bottom: var(--td-size-3); }
.page-image__stage { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: 62vh; min-height: 280px; place-items: center; overflow: hidden; background: var(--td-bg-color-secondarycontainer); touch-action: none; user-select: none; cursor: grab; }
.page-image__stage img { display: block; width: 100%; height: 100%; min-width: 0; min-height: 0; object-fit: contain; transform-origin: center; }
.page-image--fullscreen .page-image__stage { height: calc(100dvh - 160px); }
.page-image__stage.is-dragging { cursor: grabbing; }
.page-image__stage p { padding: var(--td-size-4); color: var(--td-text-color-secondary); }
</style>
