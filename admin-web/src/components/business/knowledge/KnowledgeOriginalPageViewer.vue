<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { fetchKnowledgePageRecognition, fetchVersionPageWindow } from '@/api/modules/knowledge'
import { businessUserError } from '@/utils/business-error'

const props = withDefaults(defineProps<{
  visible: boolean
  imageUrl?: string | null
  pageId?: string | null
  versionId?: string | null
  physicalPageNumber?: number | null
  pageLabel?: string | null
  title?: string
}>(), { imageUrl: null, pageId: null, versionId: null, physicalPageNumber: null, pageLabel: null, title: '原始页面' })
const emit = defineEmits<{ 'update:visible': [value: boolean] }>()
const loadedUrl = ref<string | null>(null)
const loading = ref(false)
const error = ref<unknown>(null)
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const dragging = ref(false)
let origin = { x: 0, y: 0, ox: 0, oy: 0 }
let requestSequence = 0
const source = computed(() => props.imageUrl || loadedUrl.value)

function reset(): void {
  scale.value = 1
  offset.value = { x: 0, y: 0 }
}

async function load(): Promise<void> {
  const request = ++requestSequence
  loadedUrl.value = null
  error.value = null
  reset()
  if (!props.visible || props.imageUrl) return
  if ((!props.versionId || props.physicalPageNumber == null) && !props.pageId) return
  loading.value = true
  try {
    const url = props.versionId && props.physicalPageNumber != null
      ? (await fetchVersionPageWindow(props.versionId, props.physicalPageNumber, 0, 0)).page.pageImageUrl
      : (await fetchKnowledgePageRecognition(props.pageId!)).pageImageUrl
    if (request === requestSequence) loadedUrl.value = url
  }
  catch (cause) {
    if (request === requestSequence) error.value = cause
  }
  finally {
    if (request === requestSequence) loading.value = false
  }
}

function zoom(delta: number): void {
  scale.value = Math.min(4, Math.max(0.5, Number((scale.value + delta).toFixed(2))))
}

function onWheel(event: WheelEvent): void {
  event.preventDefault()
  zoom(event.deltaY > 0 ? -0.1 : 0.1)
}

function startDrag(event: MouseEvent): void {
  if (scale.value <= 1) return
  dragging.value = true
  origin = { x: event.clientX, y: event.clientY, ox: offset.value.x, oy: offset.value.y }
}

function moveDrag(event: MouseEvent): void {
  if (dragging.value) offset.value = { x: origin.ox + event.clientX - origin.x, y: origin.oy + event.clientY - origin.y }
}

watch(() => [props.visible, props.imageUrl, props.pageId, props.versionId, props.physicalPageNumber], () => { void load() })
</script>

<template>
  <t-dialog
    :visible="visible"
    :footer="false"
    :header="title"
    width="min(1180px, 96vw)"
    destroy-on-close
    @update:visible="emit('update:visible', $event)"
  >
    <div class="original-page__toolbar">
      <span>文件第 {{ physicalPageNumber ?? '—' }} 页 · 印刷页码 {{ pageLabel || '—' }}</span>
      <t-space>
        <t-button size="small" @click="zoom(-0.1)">缩小</t-button>
        <t-button size="small" @click="zoom(0.1)">放大</t-button>
        <t-button size="small" variant="outline" @click="reset">复位</t-button>
      </t-space>
    </div>
    <t-loading v-if="loading" loading text="正在加载原始页面" />
    <t-alert v-else-if="error" theme="error" :message="businessUserError(error)">
      <t-button size="small" variant="text" @click="load">重试</t-button>
    </t-alert>
    <div
      v-else
      class="original-page__stage"
      @wheel="onWheel"
      @mousedown="startDrag"
      @mousemove="moveDrag"
      @mouseup="dragging = false"
      @mouseleave="dragging = false"
    >
      <img
        v-if="source"
        :src="source"
        :alt="`${title}原图`"
        :style="{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, cursor: scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default' }"
        draggable="false"
      >
      <span v-else>原始页面图片暂不可用，请到“资料页面”检查原图。</span>
    </div>
  </t-dialog>
</template>

<style scoped>
.original-page__toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--td-size-3); margin-bottom: var(--td-size-3); color: var(--td-text-color-secondary); }
.original-page__stage { display: grid; min-height: 360px; max-height: 72vh; place-items: center; overflow: hidden; background: var(--td-bg-color-secondarycontainer); user-select: none; }
.original-page__stage img { max-width: 100%; max-height: 72vh; object-fit: contain; transform-origin: center; }
</style>
