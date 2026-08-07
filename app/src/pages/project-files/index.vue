<script setup lang="ts">
import type { ApiEnvelope, ApiPage, DownloadUrlResult, FileRecord } from '@/api/types'
import { fileApi } from '@/api/modules/files'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { UPLOAD_PHASE_LABELS, useFileUpload } from '@/composables/useFileUpload'
import { useGlobalDialog } from '@/composables/useGlobalDialog'
import { useGlobalToast } from '@/composables/useGlobalToast'
import { getPlatformInfo } from '@/services/platform'

definePage({
  name: 'project-files',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

const route = useRoute()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const toast = useGlobalToast()
const dialog = useGlobalDialog()

const projectId = computed(() => String(route.query.id || ''))
const projectName = computed(() => String(route.query.name || ''))

// ---- 文件列表：首屏 load 走四态，轮询用 silentRefresh 避免闪烁 ----

const files = ref<FileRecord[]>([])
const status = ref<'idle' | 'loading' | 'success' | 'error'>('idle')

async function fetchFiles() {
  const response = await fileApi.list({ projectId: projectId.value, page: 1, pageSize: 50 })
    .send() as ApiEnvelope<ApiPage<FileRecord>>
  return response.data?.items || []
}

async function load() {
  status.value = 'loading'
  try {
    files.value = await fetchFiles()
    status.value = 'success'
  }
  catch {
    status.value = 'error'
  }
}

async function silentRefresh() {
  try {
    files.value = await fetchFiles()
  }
  catch {
    // 轮询失败不打扰用户，等下一轮
  }
}

// ---- 解析状态轮询：存在未落定文件时每 3s 刷新一次 ----

const ACTIVE_STATUSES = new Set<FileRecord['status']>(['UPLOADING', 'UPLOADED', 'QUEUED', 'PARSING', 'INDEXING'])
const hasActiveFiles = computed(() => files.value.some(file => ACTIVE_STATUSES.has(file.status)))
let pollTimer: ReturnType<typeof setInterval> | undefined

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = undefined
  }
}

watch(hasActiveFiles, (active) => {
  stopPolling()
  if (active) {
    pollTimer = setInterval(() => void silentRefresh(), 3000)
  }
})

onHide(stopPolling)
onUnmounted(stopPolling)

onMounted(() => {
  if (!requireLogin({ showToast: false })) {
    return
  }
  void load()
})

// ---- 上传 ----

const { tasks, pickAndUpload, dismissTask } = useFileUpload({
  projectId,
  onUploaded: () => void silentRefresh(),
})

const sheetVisible = ref(false)
const sheetActions = [
  { name: '选择文档', subname: 'PDF / DOCX' },
  { name: '从相册选择', subname: 'PNG / JPG' },
  { name: '拍照上传' },
]
const sheetPickTypes = ['file', 'album', 'camera'] as const

function openUploadSheet() {
  if (!requireLogin()) {
    return
  }
  sheetVisible.value = true
}

function onSheetSelect({ index }: { index: number }) {
  const type = sheetPickTypes[index]
  if (type) {
    void pickAndUpload(type)
  }
}

// ---- 文件行展示与操作 ----

const FILE_STATUS_UI: Record<FileRecord['status'], { label: string, cls: string }> = {
  UPLOADING: { label: '待确认', cls: 'app-state-warning' },
  UPLOADED: { label: '等待入队', cls: 'app-state-warning' },
  QUEUED: { label: '排队解析', cls: 'app-state-warning' },
  PARSING: { label: '解析中', cls: 'app-state-warning' },
  OCR_REQUIRED: { label: '需文字识别', cls: 'app-state-warning' },
  INDEXING: { label: '建立索引', cls: 'app-state-warning' },
  READY: { label: '已解析', cls: 'app-state-success' },
  FAILED: { label: '解析失败', cls: 'app-state-danger' },
  DELETED: { label: '已删除', cls: 'app-state-draft' },
}

function extensionBadge(file: FileRecord) {
  const ext = /\.([a-z0-9]+)$/i.exec(file.originalName)?.[1]
  return (ext || 'file').toUpperCase().slice(0, 4)
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function openFile(file: FileRecord) {
  if (file.status === 'UPLOADING') {
    toast.info('文件尚未上传完成')
    return
  }

  try {
    const response = await fileApi.getDownloadUrl(file.id).send() as ApiEnvelope<DownloadUrlResult>
    const url = response.data?.url
    if (!url) {
      throw new Error('empty url')
    }

    if (getPlatformInfo().platform === 'h5') {
      window.open(url, '_blank')
      return
    }

    if (file.mimeType.startsWith('image/')) {
      uni.previewImage({ urls: [url] })
      return
    }

    uni.downloadFile({
      url,
      success: result => uni.openDocument({ filePath: result.tempFilePath, showMenu: true }),
      fail: () => toast.error('文件下载失败'),
    })
  }
  catch {
    toast.error('获取下载地址失败')
  }
}

function confirmRemove(file: FileRecord) {
  dialog.confirm({
    title: '删除文件',
    msg: `确定删除「${file.originalName}」吗？对应知识切片将不再参与 AI 回答。`,
    success: (result) => {
      if (result.action === 'confirm') {
        void removeFile(file)
      }
    },
  })
}

async function removeFile(file: FileRecord) {
  try {
    await fileApi.remove(file.id).send()
    files.value = files.value.filter(item => item.id !== file.id)
    toast.success('文件已删除')
  }
  catch {
    toast.error('删除失败，请稍后重试')
  }
}
</script>

<template>
  <view class="project-files-page app-page app-page--immersive box-border pb-6">
    <wd-navbar
      custom-class="app-navbar"
      safe-area-inset-top
      left-arrow
      title="项目资料"
      @click-left="goBack"
    />

    <view class="app-enter box-border px-4 py-4 pb-6">
      <view class="app-panel mb-5 p-4">
        <view class="flex items-start justify-between gap-3">
          <view class="min-w-0 flex-1">
            <view class="app-section-title">
              上传项目资料
            </view>
            <view class="app-muted mt-1 text-3 leading-5">
              {{ projectName ? `归属项目：${projectName}` : '支持 PDF、DOCX、PNG、JPG' }}，上传后自动解析为可追溯的知识切片，供筑小格回答引用。
            </view>
          </view>
        </view>
        <wd-button type="primary" block custom-class="mt-4!" @click="openUploadSheet">
          上传资料
        </wd-button>
      </view>

      <view v-if="tasks.length" class="mb-5">
        <view class="app-section-title mb-3">
          上传队列
        </view>
        <view class="app-panel-flat overflow-hidden">
          <view
            v-for="task in tasks"
            :key="task.key"
            class="flex items-center gap-3 border-b border-b-solid px-4 py-3 last:border-b-0"
            style="border-color: var(--app-border-default)"
          >
            <wd-loading v-if="task.phase !== 'failed'" size="28rpx" color="var(--app-action-primary)" />
            <wd-icon v-else name="warn-bold" size="28rpx" custom-class="app-danger-text" />
            <view class="min-w-0 flex-1">
              <view class="truncate text-3 font-medium">
                {{ task.name }}
              </view>
              <view class="mt-0.5 text-2.5" :class="task.phase === 'failed' ? 'app-danger-text' : 'app-tertiary'">
                {{ task.error || UPLOAD_PHASE_LABELS[task.phase] }}
              </view>
            </view>
            <wd-icon
              v-if="task.phase === 'failed'"
              name="close"
              size="28rpx"
              custom-class="app-tertiary"
              @click="dismissTask(task.key)"
            />
          </view>
        </view>
      </view>

      <view class="mb-3 flex items-center justify-between">
        <view class="app-section-title">
          资料列表
        </view>
        <view v-if="hasActiveFiles" class="app-tertiary text-2.5">
          解析中，自动刷新
        </view>
      </view>

      <view v-if="status === 'loading'" class="app-panel-flat flex items-center justify-center gap-2 py-16">
        <wd-loading size="32rpx" color="var(--app-action-primary)" />
        <view class="app-tertiary text-3">
          加载中
        </view>
      </view>

      <view v-else-if="status === 'error'" class="app-panel-flat flex items-center justify-center gap-2 py-16" @click="load">
        <wd-icon name="refresh" size="32rpx" color="var(--app-text-tertiary)" />
        <view class="app-tertiary text-3">
          资料加载失败，点击重试
        </view>
      </view>

      <view v-else-if="!files.length" class="app-panel-flat overflow-hidden px-4 py-8">
        <wd-empty image="content" description="暂无项目资料，上传后自动解析" />
      </view>

      <view v-else class="app-panel-flat overflow-hidden">
        <view
          v-for="file in files"
          :key="file.id"
          class="app-pressable flex items-center gap-3 border-b border-b-solid px-4 py-3 last:border-b-0"
          style="border-color: var(--app-border-default)"
          @click="openFile(file)"
        >
          <view
            class="app-primary-text h-10 w-10 flex shrink-0 items-center justify-center rounded-2 text-2.5 font-bold"
            style="background: var(--app-action-primary-soft)"
          >
            {{ extensionBadge(file) }}
          </view>
          <view class="min-w-0 flex-1">
            <view class="truncate text-3 font-medium">
              {{ file.originalName }}
            </view>
            <view class="app-tertiary mt-0.5 flex items-center gap-2 text-2.5">
              <text>{{ formatSize(file.sizeBytes) }}</text>
              <text>{{ formatDate(file.createdAt) }}</text>
              <text v-if="file.status === 'FAILED' && file.errorMessage" class="app-danger-text truncate">
                {{ file.errorMessage }}
              </text>
            </view>
          </view>
          <view class="shrink-0 rounded-full px-2 py-0.5 text-2.5" :class="FILE_STATUS_UI[file.status].cls">
            {{ FILE_STATUS_UI[file.status].label }}
          </view>
          <wd-icon
            name="delete"
            size="32rpx"
            custom-class="app-tertiary shrink-0"
            @click.stop="confirmRemove(file)"
          />
        </view>
      </view>
    </view>

    <wd-action-sheet
      v-model="sheetVisible"
      :actions="sheetActions"
      cancel-text="取消"
      @select="onSheetSelect"
    />
  </view>
</template>

<style lang="scss" scoped>
.project-files-page {
  min-height: 100vh;
}
</style>
