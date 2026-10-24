<script setup lang="ts">
import type { ApiEnvelope, ApiPage, DownloadUrlResult, ProjectRecord, ReportDetail, ReportTaskResult } from '@/api/types'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { projectApi } from '@/api/modules/projects'
import { reportApi } from '@/api/modules/reports'
import ReportPdfReader from '@/components/report/ReportPdfReader.vue'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { useReportDetail } from '@/composables/useReportDetail'
import { formatReportDate, reportTypeLabel } from '@/constants/reports'
import { openOriginalFile } from '@/services/files/openOriginalFile'
import { getPlatformInfo } from '@/services/platform'
import { useAuthStore } from '@/store/auth'
import { useReportTypeStore } from '@/store/reportTypes'
import { reportDetailPresentation, reportErrorMessage } from '@/utils/aiReportTask'

definePage({
  name: 'report-detail',
  layout: 'default',
  style: {
    navigationStyle: 'custom',
  },
})

interface ReportSection {
  heading?: string
  content?: string
}

const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { error: showError, success: showSuccess } = useGlobalToast()

// ID绑定本页面的实际加载参数；全局路由在同路径切换query时可能仍保留上一份报告。
const reportId = ref('')
onLoad((options) => {
  reportId.value = typeof options?.id === 'string' ? options.id : ''
})
const auth = useAuthStore()
const resource = useReportDetail(() => ({ id: reportId.value, userId: auth.user?.id ?? null }), {
  get: async id => (await reportApi.getDetail(id).send(true) as ApiEnvelope<ReportDetail>).data,
  retry: async id => (await reportApi.retry(id).send() as ApiEnvelope<ReportTaskResult>).data,
})
const { detail, status, errorMessage, refreshing, retrying } = resource
const presentation = computed(() => detail.value ? reportDetailPresentation(detail.value) : null)
const fileAction = ref<'preview' | 'download' | null>(null)
const fileError = ref('')
const pdfPreviewVisible = ref(false)
const platform = getPlatformInfo().platform
// #ifdef H5
// 浏览器同页只切换query时，uni-app可能复用页面而不再触发onLoad。
// 仅同步当前报告详情的真实地址；资源层会清空旧数据、作废旧请求并重新授权。
function syncReportLocation() {
  const [path, query = ''] = window.location.hash.slice(1).split('?')
  if (path === '/pages/report-detail/index')
    reportId.value = new URLSearchParams(query).get('id') ?? ''
}
onMounted(() => {
  if (platform === 'h5')
    window.addEventListener('hashchange', syncReportLocation)
})
onBeforeUnmount(() => window.removeEventListener('hashchange', syncReportLocation))
// #endif
const downloadLabel = platform === 'h5' ? '下载 PDF' : '保存并打开 PDF'
let visible = false
let fileRevision = 0
let projectRevision = 0
const moreVisible = ref(false)
const projectPickerVisible = ref(false)
const linking = ref(false)
const projects = ref<ProjectRecord[]>([])

const report = computed(() => detail.value?.report)
const project = computed(() => detail.value?.project ?? null)
const content = computed(() => (report.value?.contentJson || {}) as Record<string, unknown>)
const title = computed(() => typeof content.value.title === 'string' && content.value.title.trim()
  ? content.value.title
  : reportTypeLabel(report.value?.reportType || '', Boolean(project.value)))
const summary = computed(() => typeof content.value.summary === 'string' ? content.value.summary : '')
const sections = computed(() => Array.isArray(content.value.sections) ? content.value.sections as ReportSection[] : [])
const risks = computed(() => Array.isArray(content.value.risks) ? content.value.risks.filter((item): item is string => typeof item === 'string') : [])
const disclaimer = computed(() => typeof content.value.disclaimer === 'string' ? content.value.disclaimer : '')
const canLinkProject = computed(() => Boolean(report.value && !project.value))
const moreActions = computed(() => canLinkProject.value ? [{ name: '关联项目' }] : [])

onShow(() => {
  visible = true
  if (requireLogin({ showToast: false })) {
    void useReportTypeStore().ensureLoaded()
    void resource.start()
  }
  else {
    resource.reset()
    status.value = 'error'
    errorMessage.value = '请登录后查看报告'
  }
})

function stopPage() {
  visible = false
  pdfPreviewVisible.value = false
  fileRevision++
  fileAction.value = null
  projectRevision++
  linking.value = false
  moreVisible.value = false
  projectPickerVisible.value = false
  projects.value = []
  resource.stop()
}
onHide(stopPage)
onUnload(stopPage)
onBeforeUnmount(stopPage)

watch([reportId, () => auth.user?.id], () => {
  pdfPreviewVisible.value = false
  fileRevision++
  fileAction.value = null
  fileError.value = ''
  projectRevision++
  linking.value = false
  projectPickerVisible.value = false
  projects.value = []
  resource.reset()
  if (visible)
    void resource.start()
})

async function loadDetail() {
  if (requireLogin({ showToast: false }))
    await resource.refresh()
}

async function openPdf(mode: 'preview' | 'download') {
  if (!requireLogin() || fileAction.value || !presentation.value?.canPreviewPdf)
    return
  if (mode === 'preview' && platform === 'h5') {
    pdfPreviewVisible.value = true
    return
  }
  const id = reportId.value
  const userId = auth.user?.id
  const revision = ++fileRevision
  const current = () => visible && fileRevision === revision && reportId.value === id && auth.user?.id === userId
  fileAction.value = mode
  fileError.value = ''
  try {
    await openOriginalFile({
      mimeType: 'application/pdf',
      mode,
      isCurrent: current,
      getUrl: async () => {
        const method = mode === 'preview' ? reportApi.getArtifactPreviewUrl(id, 'PDF') : reportApi.getArtifactDownloadUrl(id, 'PDF')
        return (await method.send(true) as ApiEnvelope<DownloadUrlResult>).data
      },
    })
    if (current() && mode === 'download' && platform !== 'h5')
      showSuccess('PDF 已保存到应用并打开，可通过阅读器导出')
  }
  catch (error) {
    if (current()) {
      fileError.value = reportErrorMessage(error, '文件操作失败，请重试')
      void resource.refresh()
    }
  }
  finally {
    if (current())
      fileAction.value = null
  }
}

function openProject() {
  if (!project.value) {
    return
  }
  router.push({ name: 'project-detail', params: { id: project.value.id } })
}

function handleMoreSelect() {
  void openProjectPicker()
}

async function openProjectPicker() {
  if (!visible || !requireLogin())
    return
  const id = reportId.value
  const userId = auth.user?.id
  const revision = ++projectRevision
  const current = () => visible && revision === projectRevision && reportId.value === id && auth.user?.id === userId
  try {
    const response = await projectApi.getMy({ page: 1, pageSize: 50 }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
    if (!current())
      return
    projects.value = response.data?.items || []
    if (!projects.value.length) {
      showError('暂无可关联的项目')
      return
    }
    projectPickerVisible.value = true
  }
  catch (error) {
    if (current())
      showError(error instanceof Error ? error.message : '项目列表加载失败')
  }
}

function handleProjectSelect(event: { item: { value?: string } }) {
  const target = projects.value.find(item => item.id === event.item.value)
  if (target) {
    void linkProject(target)
  }
}

async function linkProject(item: ProjectRecord) {
  if (!visible || !report.value || linking.value || !requireLogin()) {
    return
  }
  linking.value = true
  const id = report.value.id
  const userId = auth.user?.id
  const revision = ++projectRevision
  const current = () => visible && revision === projectRevision && reportId.value === id && auth.user?.id === userId
  try {
    const response = await reportApi.linkProject(id, { projectId: item.id }).send() as ApiEnvelope<{ report: ReportDetail['report'], project: { id: string, name: string } }>
    if (!current())
      return
    if (detail.value) {
      detail.value.report = response.data.report
      detail.value.project = response.data.project
    }
    projectPickerVisible.value = false
    showSuccess('报告已关联项目')
  }
  catch (error) {
    if (current())
      showError(error instanceof Error ? error.message : '关联项目失败')
  }
  finally {
    if (current())
      linking.value = false
  }
}
</script>

<template>
  <view class="app-page app-page--immersive min-h-screen">
    <wd-navbar

      safe-area-inset-top left-arrow placeholder fixed
      title="报告详情"
      @click-left="goBack"
    >
      <template v-if="canLinkProject" #right>
        <view class="flex items-center justify-center px-2" aria-label="更多" @click="moreVisible = true">
          <wd-icon name="more" size="36rpx" color="var(--app-text-primary)" />
        </view>
      </template>
    </wd-navbar>

    <view class="app-enter report-detail box-border px-4 py-4 pb-8">
      <view v-if="status === 'loading'" class="flex flex-col items-center justify-center py-16">
        <wd-loading size="48rpx" color="var(--app-action-primary)" />
        <view class="app-muted mt-3 text-3">
          正在加载报告
        </view>
      </view>

      <view v-else-if="status === 'error' || !report" class="app-panel-flat flex flex-col items-center justify-center px-6 py-16 text-center">
        <wd-icon name="warning" size="56rpx" color="var(--app-danger)" />
        <text class="mt-3 text-3.5 font-medium">
          报告加载失败
        </text>
        <text class="app-muted mt-1 text-2.5">
          {{ errorMessage || '请检查网络后重试' }}
        </text>
        <wd-button size="small" custom-class="mt-4!" @click="loadDetail">
          重新加载
        </wd-button>
      </view>

      <template v-else>
        <view class="app-panel-flat p-4">
          <view class="text-5 font-bold leading-7">
            {{ title }}
          </view>
          <view class="app-muted mt-2 text-2.5">
            {{ reportTypeLabel(report.reportType, Boolean(project)) }} · {{ formatReportDate(report.createdAt) }}
          </view>
          <view
            v-if="project"
            class="app-primary-text app-pressable mt-3 flex items-center justify-between rounded-3 bg-[var(--app-action-primary-soft)] px-3 py-2.5"
            @click="openProject"
          >
            <text class="min-w-0 truncate text-3">
              {{ project.name }}
            </text>
            <wd-icon name="arrow-right" size="28rpx" color="var(--app-action-primary)" />
          </view>
        </view>

        <view v-if="presentation" class="app-panel-flat mt-3 p-4">
          <view class="text-3.5 font-semibold">
            {{ presentation.title }}
          </view>
          <view class="app-muted mt-2 text-3">
            {{ [presentation.reviewLabel, presentation.publicationLabel].filter(Boolean).join(' · ') }}
          </view>
          <view v-if="presentation.taskLabel" class="app-muted mt-2 text-3">
            {{ presentation.taskLabel }}{{ presentation.progress != null ? ` · ${presentation.progress}%` : '' }}
          </view>
          <view v-if="presentation.errorMessage" class="app-danger-text mt-2 text-3">
            {{ presentation.errorMessage }}
          </view>
          <view v-if="errorMessage" class="app-danger-text mt-2 text-3">
            {{ errorMessage }}
          </view>
          <view class="mt-3 flex flex-wrap gap-2">
            <wd-button size="small" variant="plain" :loading="refreshing" :disabled="refreshing || retrying" @click="loadDetail">
              刷新状态
            </wd-button>
            <wd-button v-if="presentation.canRetry" size="small" :loading="retrying" :disabled="retrying || refreshing" @click="resource.retry()">
              重新生成
            </wd-button>
          </view>
        </view>

        <view v-if="presentation && (presentation.formal || presentation.canPreviewPdf)" class="app-panel-flat mt-3 p-4">
          <view class="text-3.5 font-semibold">
            {{ presentation.pdfLabel }}
          </view>
          <view v-if="detail?.solutionSnapshotId" class="app-muted mt-2 break-all text-2.5">
            确认方案编号：{{ detail.solutionSnapshotId }}
          </view>
          <view v-if="presentation.formal" class="app-muted mt-2 text-3 leading-5.5">
            方案参数和原页来源以已确认快照及 PDF 为准。
          </view>
          <view v-if="presentation.canPreviewPdf" class="mt-3 flex flex-wrap gap-2">
            <wd-button size="small" :loading="fileAction === 'preview'" :disabled="Boolean(fileAction)" @click="openPdf('preview')">
              预览 PDF
            </wd-button>
            <wd-button size="small" variant="plain" :loading="fileAction === 'download'" :disabled="Boolean(fileAction)" @click="openPdf('download')">
              {{ downloadLabel }}
            </wd-button>
          </view>
          <view v-if="presentation.canPreviewPdf && platform !== 'h5'" class="app-muted mt-2 text-2.5">
            {{ platform === 'app' ? '使用设备文档阅读器打开；保存后可在阅读器中导出。' : '使用小程序文档阅读器打开，可通过右上角菜单导出。' }}
          </view>
          <view v-if="fileError" class="app-danger-text mt-2 text-3">
            {{ fileError }}
          </view>
        </view>

        <template v-if="!presentation?.formal || (report.contentJson && !detail?.solutionSnapshotId)">
          <view v-if="summary" class="app-panel-flat mt-3 p-4">
            <view class="text-3.5 font-semibold">
              摘要
            </view>
            <view class="app-muted mt-2 text-3 leading-5.5">
              {{ summary }}
            </view>
          </view>

          <view
            v-for="(section, index) in sections"
            :key="`${section.heading || 'section'}-${index}`"
            class="app-panel-flat mt-3 p-4"
          >
            <view class="text-3.5 font-semibold">
              {{ section.heading || `章节 ${index + 1}` }}
            </view>
            <view class="app-muted mt-2 whitespace-pre-wrap text-3 leading-5.5">
              {{ section.content }}
            </view>
          </view>

          <view v-if="risks.length" class="app-panel-flat mt-3 p-4">
            <view class="text-3.5 font-semibold">
              风险提示
            </view>
            <view v-for="(risk, index) in risks" :key="index" class="app-muted mt-2 text-3 leading-5.5">
              {{ risk }}
            </view>
          </view>

          <view v-if="disclaimer" class="app-tertiary mt-4 px-1 text-2.5 leading-4.5">
            {{ disclaimer }}
          </view>
        </template>
      </template>
    </view>

    <ReportPdfReader v-if="platform === 'h5'" v-model="pdfPreviewVisible" :report-id="reportId" :user-id="auth.user?.id ?? null" />

    <wd-action-sheet
      v-model="moreVisible"
      title="更多"
      cancel-text="取消"
      :actions="moreActions"
      @select="handleMoreSelect"
    />

    <wd-action-sheet
      v-model="projectPickerVisible"
      title="关联项目"
      cancel-text="取消"
      :actions="projects.map(item => ({ name: item.name, value: item.id }))"
      @select="handleProjectSelect"
    />
  </view>
</template>

<style lang="scss" scoped>
.report-detail {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
}
</style>
