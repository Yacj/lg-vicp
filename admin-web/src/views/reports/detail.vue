<script setup lang="ts">
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import ReportPreviewDialog from '@/components/business/ReportPreviewDialog.vue'
import ReportShareDialog from '@/components/business/ReportShareDialog.vue'
import { useReportDetail } from '@/composables/useReportDetail'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { useUserStore } from '@/stores/user'
import { fetchReportDownloadUrl } from '@/api/modules/reports'
import {
  canPublishReport,
  canRegenerateReport,
  formatCreatorName,
  formatFileSize,
  getReportTypeLabel,
  REPORT_ARTIFACT_LABELS,
  reportStateMeta,
  shareFullUrl,
  shareState,
  SHARE_STATE_META,
} from '@/utils/report'
import { formatDate } from '@/utils/day'

defineOptions({ name: 'ReportDetail' })

const route = useRoute()
const router = useRouter()
const feedback = useAppFeedback()
const userStore = useUserStore()

const reportId = String(route.params.id)
const {
  actions,
  assets,
  detail,
  errorDescription,
  load,
  polling,
  project,
  shareLinks,
  status,
} = useReportDetail(reportId)

const shareDialogVisible = ref(false)
const previewVisible = ref(false)
const previewTitle = ref('')
const previewUrl = ref('')

onMounted(() => {
  void load()
})

const errorAlert = computed(() => status.value === 'error' ? errorDescription.value : '请检查网络连接后重试')

const report = computed(() => detail.value?.report ?? null)

function goBack(): void {
  if (window.history.state?.back) {
    router.back()
  }
  else {
    void router.push('/reports')
  }
}

/** contentJson 顶层简单值（字符串/数字/布尔）列表。 */
const simpleContentEntries = computed(() => {
  const json = report.value?.contentJson
  if (!json) {
    return []
  }
  return Object.entries(json).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
})

/** contentJson 嵌套结构（对象/数组），原样展示。 */
const nestedContentEntries = computed(() => {
  const json = report.value?.contentJson
  if (!json) {
    return []
  }
  return Object.entries(json).filter(([, value]) => typeof value === 'object' && value !== null)
})

function copyText(text: string): void {
  void navigator.clipboard.writeText(text)
    .then(() => feedback.message('success', '已复制'))
    .catch(() => feedback.message('warning', '复制失败，请手动复制'))
}

function shareStateOf(share: (typeof shareLinks.value)[number]) {
  const state = shareState(share)
  return { label: SHARE_STATE_META[state].label, status: SHARE_STATE_META[state].status }
}

async function previewHtml(): Promise<void> {
  if (!report.value) {
    return
  }
  try {
    const { url } = await fetchReportDownloadUrl(report.value.id, 'HTML')
    previewTitle.value = `${getReportTypeLabel(report.value.reportType)}报告预览`
    previewUrl.value = url
    previewVisible.value = true
  }
  catch (cause) {
    // 预览地址获取失败时退化为下载 HTML 文件，保证文件仍可获取
    void actions.downloadArtifact(report.value.id, 'HTML')
    void cause
  }
}
</script>

<template>
  <AppPage>
    <template #navigation>
      <t-button theme="default" variant="outline" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回报告中心
      </t-button>
    </template>

    <div v-if="status === 'loading'" class="report-detail__center">
      <t-loading text="正在加载报告详情..." />
    </div>

    <div v-else-if="status === 'error'" class="report-detail__center">
      <t-alert theme="error" :title="errorAlert" />
      <t-button class="report-detail__retry" theme="primary" @click="load">
        重新加载
      </t-button>
    </div>

    <template v-else-if="report">
      <!-- 概览 -->
      <div class="report-detail__header">
        <div class="report-detail__header-main">
          <h2 class="report-detail__title">
            {{ getReportTypeLabel(report.reportType) }}报告
          </h2>
          <div class="report-detail__header-tags">
            <AppStatusTag v-bind="reportStateMeta(report)" />
            <AppStatusTag
              v-if="report.publishedAt"
              label="已发布"
              status="success"
            />
            <t-tag v-if="polling" theme="primary" variant="light" size="small">
              生成中，自动刷新
            </t-tag>
          </div>
        </div>
        <div class="report-detail__header-actions">
          <t-button
            v-if="canPublishReport(report)"
            :loading="actions.publishAction.running.value"
            theme="success"
            @click="actions.publishAction.run(report)"
          >
            发布
          </t-button>
          <t-button
            v-if="canRegenerateReport(report.status)"
            :loading="actions.retryAction.running.value"
            variant="outline"
            @click="actions.retryAction.run(report)"
          >
            重试
          </t-button>
          <t-button
            v-if="assets && assets.artifacts.some(item => item.type === 'HTML')"
            variant="outline"
            @click="previewHtml"
          >
            预览
          </t-button>
          <t-button
            v-if="report.status === 'READY'"
            variant="outline"
            @click="shareDialogVisible = true"
          >
            分享
          </t-button>
          <t-button
            :loading="actions.deleteAction.running.value"
            theme="danger"
            variant="outline"
            @click="actions.deleteAction.run(report)"
          >
            删除
          </t-button>
        </div>
      </div>

      <t-alert
        v-if="report.status === 'FAILED' && report.errorMessage"
        class="report-detail__alert"
        theme="error"
        title="生成失败"
      >
        {{ report.errorMessage }}
      </t-alert>

      <!-- 项目信息 -->
      <t-card class="report-detail__card" title="项目信息" :bordered="false">
        <t-descriptions v-if="project" bordered :column="3" size="medium">
          <t-descriptions-item label="项目名称">
            {{ project.name }}
          </t-descriptions-item>
          <t-descriptions-item label="地区">
            {{ project.region ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="建筑类型">
            {{ project.buildingType ?? '-' }}
          </t-descriptions-item>
          <t-descriptions-item label="可见性">
            {{ project.visibility === 'PRIVATE' ? '私有' : '公开' }}
          </t-descriptions-item>
          <t-descriptions-item label="创建时间">
            {{ formatDate(new Date(project.createdAt)) }}
          </t-descriptions-item>
          <t-descriptions-item label="更新时间">
            {{ formatDate(new Date(project.updatedAt)) }}
          </t-descriptions-item>
          <t-descriptions-item label="描述" :span="3">
            {{ project.description || '-' }}
          </t-descriptions-item>
        </t-descriptions>
        <AppEmptyState v-else description="项目信息加载失败或已删除" title="暂无项目信息" />
      </t-card>

      <!-- 使用方案与计算结果 -->
      <t-card class="report-detail__card" title="使用方案与计算结果" :bordered="false">
        <template v-if="simpleContentEntries.length > 0 || nestedContentEntries.length > 0">
          <t-descriptions v-if="simpleContentEntries.length > 0" :column="2" size="medium">
            <t-descriptions-item
              v-for="[key, value] in simpleContentEntries"
              :key="key"
              :label="key"
            >
              {{ String(value) }}
            </t-descriptions-item>
          </t-descriptions>
          <t-collapse v-if="nestedContentEntries.length > 0" class="report-detail__collapse">
            <t-collapse-panel
              v-for="[key, value] in nestedContentEntries"
              :key="key"
              :header="key"
              :value="key"
            >
              <pre class="report-detail__json">{{ JSON.stringify(value, null, 2) }}</pre>
            </t-collapse-panel>
          </t-collapse>
        </template>
        <AppEmptyState v-else description="该报告没有结构化内容" title="暂无内容" />
      </t-card>

      <!-- 来源资料 -->
      <t-card class="report-detail__card" title="来源资料" :bordered="false">
        <template v-if="assets && assets.sources.length > 0">
          <div v-for="source in assets.sources" :key="source.id" class="report-detail__source">
            <div class="report-detail__source-head">
              <span class="report-detail__source-index">来源 {{ source.sortOrder }}</span>
              <span class="report-detail__muted">
                {{ formatDate(new Date(source.createdAt)) }}
              </span>
              <span v-if="source.snapshotMetadata" class="report-detail__muted">
                {{ String(source.snapshotMetadata.model ?? '') }}
              </span>
            </div>
            <pre class="report-detail__source-content">{{ source.snapshotContent }}</pre>
          </div>
        </template>
        <AppEmptyState v-else description="该报告未使用 AI 回答作为素材" title="暂无来源资料" />
      </t-card>

      <!-- 生成日志 -->
      <t-card class="report-detail__card" title="生成日志" :bordered="false">
        <div class="report-detail__log">
          <div class="report-detail__log-item">
            <span class="report-detail__log-time">
              {{ formatDate(new Date(report.createdAt)) }}
            </span>
            <span>报告创建，进入生成流程</span>
          </div>
          <div v-if="report.updatedAt !== report.createdAt" class="report-detail__log-item">
            <span class="report-detail__log-time">
              {{ formatDate(new Date(report.updatedAt)) }}
            </span>
            <span>状态更新为「{{ reportStateMeta(report).label }}」</span>
          </div>
          <div v-if="report.publishedAt" class="report-detail__log-item">
            <span class="report-detail__log-time">
              {{ formatDate(new Date(report.publishedAt)) }}
            </span>
            <span>报告发布</span>
          </div>
        </div>
        <p class="report-detail__muted">
          模板版本 v{{ report.templateVersion }}
          <template v-if="report.promptTemplateVersion !== null">
            · 提示词版本 v{{ report.promptTemplateVersion }}
          </template>
          · 创建人 {{ formatCreatorName(report.createdById, userStore.profile?.id ?? null) }}
          · 生成任务由后端异步执行，进度以状态标签为准
        </p>
      </t-card>

      <!-- 文件版本 -->
      <t-card class="report-detail__card" title="文件版本" :bordered="false">
        <template v-if="assets && assets.artifacts.length > 0">
          <div v-for="artifact in assets.artifacts" :key="artifact.id" class="report-detail__artifact">
            <div class="report-detail__artifact-main">
              <span class="report-detail__artifact-name">{{ artifact.file.originalName }}</span>
              <span class="report-detail__muted">
                {{ REPORT_ARTIFACT_LABELS[artifact.type] }} ·
                {{ formatFileSize(artifact.file.sizeBytes) }} ·
                {{ formatDate(new Date(artifact.createdAt)) }}
              </span>
            </div>
            <div class="report-detail__artifact-actions">
              <t-button
                v-if="artifact.type === 'HTML'"
                size="small"
                theme="primary"
                variant="text"
                @click="previewHtml"
              >
                预览
              </t-button>
              <t-button
                size="small"
                variant="text"
                @click="actions.downloadArtifact(report.id, artifact.type)"
              >
                下载
              </t-button>
            </div>
          </div>
        </template>
        <AppEmptyState
          v-else
          description="生成完成后将产出 HTML / Word / PDF 等格式文件"
          title="暂无文件"
        />
      </t-card>

      <!-- 分享记录 -->
      <t-card class="report-detail__card" title="分享记录" :bordered="false">
        <template v-if="shareLinks.length > 0">
          <div v-for="share in shareLinks" :key="share.id" class="report-detail__share">
            <div class="report-detail__share-main">
              <div class="report-detail__share-title-row">
                <span class="report-detail__share-title">{{ share.title }}</span>
                <AppStatusTag v-bind="shareStateOf(share)" />
              </div>
              <span class="report-detail__muted">
                访问 {{ share.viewCount }} 次
                <template v-if="share.maxViews !== null"> / 上限 {{ share.maxViews }}</template>
                <template v-if="share.expiresAt">
                  · 有效期至 {{ formatDate(new Date(share.expiresAt)) }}
                </template>
                · 创建于 {{ formatDate(new Date(share.createdAt)) }}
              </span>
              <span class="report-detail__muted">
                {{ shareFullUrl(`/api/v1/public/shares/${share.token}`) }}
              </span>
            </div>
            <div class="report-detail__share-actions">
              <t-button
                size="small"
                variant="text"
                @click="copyText(shareFullUrl(`/api/v1/public/shares/${share.token}`))"
              >
                复制链接
              </t-button>
              <t-button
                v-if="share.enabled"
                :loading="actions.disableShareAction.running.value"
                size="small"
                theme="danger"
                variant="text"
                @click="actions.disableShareAction.run({ shareId: share.id, title: share.title })"
              >
                禁用
              </t-button>
            </div>
          </div>
        </template>
        <AppEmptyState v-else description="可通过右上角「分享」按钮创建公开链接" title="暂无分享记录" />
      </t-card>
    </template>

    <ReportShareDialog
      v-if="report"
      v-model:visible="shareDialogVisible"
      :artifact-types="assets?.artifacts.map(item => item.type) ?? []"
      :report-id="report.id"
      @success="load"
    />

    <ReportPreviewDialog
      v-model:visible="previewVisible"
      :title="previewTitle"
      :url="previewUrl"
    />
  </AppPage>
</template>

<style scoped>
.report-detail__center {
  display: flex;
  min-height: 320px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--td-size-4);
}

.report-detail__retry {
  margin-top: var(--td-size-4);
}

.report-detail__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
}

.report-detail__header-main {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.report-detail__title {
  margin: 0;
  font-size: var(--td-font-size-title-large);
  font-weight: 600;
}

.report-detail__header-tags {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.report-detail__header-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-2);
}

.report-detail__alert {
  margin-bottom: var(--td-size-4);
}

.report-detail__card {
  margin-top: var(--td-size-4);
  border: 1px solid var(--td-component-border);
}

.report-detail__collapse {
  margin-top: var(--td-size-3);
}

.report-detail__json {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: var(--td-size-3);
  color: var(--td-text-color-primary);
  background: var(--td-bg-color-container-hover);
  border-radius: var(--td-radius-small);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.report-detail__source {
  padding: var(--td-size-3) 0;
  border-bottom: 1px dashed var(--td-component-stroke);
}

.report-detail__source:last-child {
  border-bottom: 0;
}

.report-detail__source-head {
  display: flex;
  align-items: center;
  gap: var(--td-size-3);
}

.report-detail__source-index {
  color: var(--td-brand-color);
  font-weight: 600;
}

.report-detail__source-content {
  max-height: 200px;
  overflow: auto;
  margin: var(--td-size-2) 0 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

.report-detail__log {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
}

.report-detail__log-item {
  display: flex;
  align-items: baseline;
  gap: var(--td-size-3);
  color: var(--td-text-color-primary);
}

.report-detail__log-time {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-detail__artifact {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--td-size-3) 0;
  border-bottom: 1px dashed var(--td-component-stroke);
}

.report-detail__artifact:last-child {
  border-bottom: 0;
}

.report-detail__artifact-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.report-detail__artifact-name {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.report-detail__share {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
  padding: var(--td-size-3) 0;
  border-bottom: 1px dashed var(--td-component-stroke);
}

.report-detail__share:last-child {
  border-bottom: 0;
}

.report-detail__share-main {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-1);
}

.report-detail__share-title-row {
  display: flex;
  align-items: center;
  gap: var(--td-size-2);
}

.report-detail__share-title {
  color: var(--td-text-color-primary);
  font-weight: 500;
}

.report-detail__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}
</style>