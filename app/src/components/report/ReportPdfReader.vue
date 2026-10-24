<script setup lang="ts">
import type { ApiEnvelope } from '@/api/types'
import type { ReportPdfPage } from '@/composables/useReportPdfPages'
import { reportApi } from '@/api/modules/reports'
import { useReportPdfPages } from '@/composables/useReportPdfPages'

const props = defineProps<{ modelValue: boolean, reportId: string, userId: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { page, loading, error, zoom, requestedPage, loadPage } = useReportPdfPages(
  () => ({ visible: props.modelValue, reportId: props.reportId, userId: props.userId }),
  async (id, number) => (await reportApi.getPdfPage(id, number).send(true) as ApiEnvelope<ReportPdfPage>).data,
)
</script>

<template>
  <wd-popup :model-value="modelValue" position="bottom" safe-area-inset-bottom custom-style="height: 94vh; border-radius: 16px 16px 0 0;" @update:model-value="emit('update:modelValue', $event)">
    <view class="report-pdf-reader">
      <view class="report-pdf-toolbar">
        <text class="font-semibold">PDF 预览</text>
        <wd-button size="small" variant="plain" @click="emit('update:modelValue', false)">关闭预览</wd-button>
      </view>
      <view class="report-pdf-toolbar">
        <wd-button size="small" variant="plain" :disabled="loading || !page || page.pageNumber <= 1" @click="loadPage(page!.pageNumber - 1)">上一页</wd-button>
        <text>{{ page ? `第 ${page.pageNumber} / ${page.pageCount} 页` : '正在打开' }}</text>
        <wd-button size="small" variant="plain" :disabled="loading || !page || page.pageNumber >= page.pageCount" @click="loadPage(page!.pageNumber + 1)">下一页</wd-button>
        <wd-button size="small" variant="plain" :disabled="zoom <= 100" @click="zoom -= 50">缩小</wd-button>
        <wd-button size="small" variant="plain" :disabled="zoom >= 250" @click="zoom += 50">放大</wd-button>
      </view>
      <view v-if="loading" class="p-3 text-center"><wd-loading /> 正在加载页面…</view>
      <view v-if="error" class="p-3 text-center">
        <text>{{ error }}</text>
        <wd-button size="small" variant="plain" :disabled="loading" @click="loadPage(requestedPage)">重试</wd-button>
      </view>
      <scroll-view class="report-pdf-scroll" scroll-x scroll-y>
        <image v-if="page && !error" class="report-pdf-page" :src="page.imageDataUrl" mode="widthFix" :style="{ width: `${zoom}%` }" @error="error = '页面图片加载失败，请重试或下载 PDF 查看'" />
      </scroll-view>
    </view>
  </wd-popup>
</template>

<style scoped>
.report-pdf-reader { height: 100%; display: flex; flex-direction: column; }
.report-pdf-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 10px 16px; }
.report-pdf-scroll { flex: 1; min-height: 0; background: #e8ebef; }
.report-pdf-page { display: block; margin: 0 auto; }
</style>
