<script setup lang="ts">
import { ref } from 'vue'
import { useKnowledgePageImage } from '@/composables/useKnowledgePageImage'
const props = defineProps<{ imageUrl?: string | null, title?: string, fullscreenMode?: boolean }>()
const { scale, dragging, failed, imageStyle, reset, zoom, start, move, stop } = useKnowledgePageImage(() => props.imageUrl)
const fullscreen = ref(false)
</script>

<template>
  <div class="page-image" :class="{ 'page-image--fullscreen': fullscreenMode }">
    <div class="page-image__toolbar">
      <span>{{ Math.round(scale * 100) }}%</span>
      <t-space size="small">
        <t-button size="small" variant="outline" :disabled="!imageUrl || failed" @click="zoom(-0.1)">缩小</t-button>
        <t-button size="small" variant="outline" :disabled="!imageUrl || failed" @click="zoom(0.1)">放大</t-button>
        <t-button size="small" variant="outline" @click="reset">复位</t-button>
        <t-button v-if="!fullscreenMode" size="small" variant="outline" :disabled="!imageUrl || failed" @click="fullscreen = true">全屏</t-button>
      </t-space>
    </div>
    <div class="page-image__stage" :class="{ 'is-dragging': dragging }" @wheel.prevent="zoom($event.deltaY > 0 ? -0.1 : 0.1)" @pointerdown="start" @pointermove="move" @pointerup="stop" @pointercancel="stop" @lostpointercapture="stop">
      <img v-if="imageUrl && !failed" :src="imageUrl" :alt="`${title || '页面'}原图`" :style="imageStyle" draggable="false" @error="failed = true">
      <p v-else>原始页面图片暂不可用，请检查页面图片来源。</p>
    </div>
    <t-dialog v-model:visible="fullscreen" :header="title || '页面原图'" mode="full-screen" :footer="false" destroy-on-close>
      <KnowledgePageImage v-if="fullscreen" :image-url="imageUrl" :title="title" fullscreen-mode />
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
