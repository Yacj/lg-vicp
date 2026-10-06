<script setup lang="ts">
import type { ApiEnvelope, ApiPage, ProjectRecord, ReportDetail } from '@/api/types'
import { projectApi } from '@/api/modules/projects'
import { reportApi } from '@/api/modules/reports'
import { useAuthGate } from '@/composables/useAuthGate'
import { useBackNavigation } from '@/composables/useBackNavigation'
import { formatReportDate, reportTypeLabel } from '@/constants/reports'
import { useReportTypeStore } from '@/store/reportTypes'

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

const route = useRoute()
const router = useRouter()
const { goBack } = useBackNavigation()
const { requireLogin } = useAuthGate()
const { error: showError, success: showSuccess } = useGlobalToast()

const reportId = computed(() => String(route.query.id || route.params.id || ''))
const detail = ref<ReportDetail>()
const status = ref<'idle' | 'loading' | 'success' | 'error'>('loading')
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

onMounted(() => {
  if (requireLogin({ showToast: false })) {
    void useReportTypeStore().ensureLoaded()
    void loadDetail()
  }
})

async function loadDetail() {
  if (!reportId.value) {
    status.value = 'error'
    return
  }
  status.value = 'loading'
  try {
    const response = await reportApi.getDetail(reportId.value).send() as ApiEnvelope<ReportDetail>
    detail.value = response.data
    status.value = 'success'
  }
  catch {
    status.value = 'error'
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
  try {
    const response = await projectApi.getMy({ page: 1, pageSize: 50 }).send() as ApiEnvelope<ApiPage<ProjectRecord>>
    projects.value = response.data?.items || []
    if (!projects.value.length) {
      showError('暂无可关联的项目')
      return
    }
    projectPickerVisible.value = true
  }
  catch (error) {
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
  if (!report.value || linking.value) {
    return
  }
  linking.value = true
  try {
    const response = await reportApi.linkProject(report.value.id, { projectId: item.id }).send() as ApiEnvelope<{ report: ReportDetail['report'], project: { id: string, name: string } }>
    if (detail.value) {
      detail.value.report = response.data.report
      detail.value.project = response.data.project
    }
    projectPickerVisible.value = false
    showSuccess('报告已关联项目')
  }
  catch (error) {
    showError(error instanceof Error ? error.message : '关联项目失败')
  }
  finally {
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
          请检查网络后重试
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
    </view>

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
