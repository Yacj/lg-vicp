<script setup lang="ts">
import { ArrowLeftIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import ReportPreviewDialog from '@/components/business/ReportPreviewDialog.vue'
import ReportShareDialog from '@/components/business/ReportShareDialog.vue'
import { useReportDetail } from '@/composables/useReportDetail'
import { useAppFeedback } from '@/composables/useAppFeedback'
import { useUserStore } from '@/stores/user'
import { fetchReportDownloadUrl } from '@/api/modules/reports'
import {
  canApproveOrRejectReport,
  canPublishReport,
  canRegenerateReport,
  canSubmitReportReview,
  formatCreatorName,
  formatFileSize,
  getReportTypeLabel,
  REPORT_ARTIFACT_LABELS,
  reportStateMeta,
  shareFullUrl,
  shareState,
  SHARE_STATE_META,
} from '@/utils/report'
import { PRODUCT_COMPARE_THERMAL_UNAVAILABLE } from '@/utils/product-compare'
import { projectReportComparison, remainingReportContentJson } from '@/utils/report-comparison'
import { formatDate } from '@/utils/day'
import { usePermissionAccess } from '@/composables/usePermissionAccess'

defineOptions({ name: 'ReportDetail' })

const route = useRoute()
const router = useRouter()
const feedback = useAppFeedback()
const userStore = useUserStore()
const { canAccess } = usePermissionAccess()

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
const rejectDialogVisible = ref(false)
const rejectReason = ref('')
const rejectSubmitting = ref(false)

const canReview = computed(() => canAccess({ permissions: ['system:report:review'] }))
const canGenerate = computed(() => canAccess({ permissions: ['system:report:generate'] }))
const canViewTechnical = computed(() => canAccess({ permissions: ['system:report:template:list'] }))

onMounted(() => {
  void load()
})

const errorAlert = computed(() => status.value === 'error' ? errorDescription.value : '请检查网络连接后重试')

const report = computed(() => detail.value?.report ?? null)

const reportTitle = computed(() => (report.value ? `${getReportTypeLabel(report.value.reportType)}报告` : '报告详情'))

function goBack(): void {
  if (window.history.state?.back) {
    router.back()
  }
  else {
    void router.push('/reports')
  }
}

/** contentJson 顶层简单值（字符串/数字/布尔）列表。 */
const comparisonView = computed(() => projectReportComparison(report.value?.contentJson ?? null))
const remainingContentJson = computed(() => remainingReportContentJson(report.value?.contentJson ?? null))

const simpleContentEntries = computed(() => {
  const json = remainingContentJson.value
  if (!json) {
    return []
  }
  return Object.entries(json).filter(([, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
})

/** contentJson 嵌套结构（对象/数组），原样展示。 */
const nestedContentEntries = computed(() => {
  const json = remainingContentJson.value
  if (!json) {
    return []
  }
  return Object.entries(json).filter(([, value]) => typeof value === 'object' && value !== null)
})

const comparisonColumns = computed(() => {
  if (!comparisonView.value || comparisonView.value.selectedProducts.length === 0) {
    return []
  }
  return [
    { colKey: 'dimension', ellipsis: true, title: '对比维度', width: 180 },
    ...comparisonView.value.selectedProducts.map((product, index) => ({
      colKey: `p${index}`,
      ellipsis: true,
      minWidth: 160,
      title: product.name,
    })),
  ]
})

const comparisonTableData = computed(() => {
  if (!comparisonView.value) {
    return []
  }
  return comparisonView.value.dimensions.map((dimension) => {
    const row: Record<string, string> = { dimension: dimension.label }
    dimension.cells.forEach((cell, index) => {
      row[`p${index}`] = cell.display
    })
    return row
  })
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

async function submitReject(): Promise<void> {
  if (!report.value || rejectSubmitting.value) {
    return
  }
  const reason = rejectReason.value.trim()
  if (!reason) {
    await feedback.message('warning', '请填写驳回原因')
    return
  }
  rejectSubmitting.value = true
  try {
    const ok = await actions.rejectReport(report.value.id, reason)
    if (ok) {
      rejectDialogVisible.value = false
      rejectReason.value = ''
    }
  }
  finally {
    rejectSubmitting.value = false
  }
}
</script>

<template>
  <AppPage :title="reportTitle">
    <template #navigation>
      <t-button variant="text" @click="goBack">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        返回报告中心
      </t-button>
    </template>

    <template #actions>
      <template v-if="report">
        <AppStatusTag v-bind="reportStateMeta(report)" />
        <AppStatusTag v-if="report.publishedAt" label="已发布" status="success" />
        <t-tag v-if="polling" theme="primary" variant="light" size="small">
          生成中，自动刷新
        </t-tag>
        <t-button
          v-if="canGenerate && canSubmitReportReview(report)"
          :loading="actions.submitReviewAction.running.value"
          variant="outline"
          @click="actions.submitReviewAction.run(report)"
        >
          提交审核
        </t-button>
        <t-button
          v-if="canReview && canApproveOrRejectReport(report.status)"
          :loading="actions.approveAction.running.value"
          theme="success"
          variant="outline"
          @click="actions.approveAction.run(report)"
        >
          审核通过
        </t-button>
        <t-button
          v-if="canReview && canApproveOrRejectReport(report.status)"
          theme="danger"
          variant="outline"
          @click="rejectDialogVisible = true"
        >
          驳回
        </t-button>
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
      </template>
    </template>

    <div v-if="status === 'loading'" class="report-detail__center">
      <t-loading size="large" text="正在加载报告详情" />
    </div>

    <AppErrorState
      v-else-if="status === 'error'"
      :description="errorAlert"
      title="报告加载失败"
      @action="load"
    />

    <template v-else-if="report">
      <t-alert
        v-if="report.status === 'FAILED' && report.errorMessage"
        class="report-detail__alert"
        theme="error"
        title="生成失败"
      >
        {{ report.errorMessage }}
      </t-alert>

      <t-alert
        v-if="report.status === 'REJECTED' && report.rejectReason"
        class="report-detail__alert"
        theme="warning"
        title="审核驳回"
      >
        {{ report.rejectReason }}
      </t-alert>

      <t-card title="报告信息">
        <t-descriptions :column="2" size="medium">
          <t-descriptions-item label="报告类型">
            {{ getReportTypeLabel(report.reportType) }}
          </t-descriptions-item>
          <t-descriptions-item v-if="project" label="项目">
            <t-button theme="primary" variant="text" @click="void router.push(`/projects/${encodeURIComponent(project.id)}`)">
              {{ project.name }}
            </t-button>
          </t-descriptions-item>
          <t-descriptions-item label="生成时间">
            {{ formatDate(new Date(report.createdAt)) }}
          </t-descriptions-item>
          <t-descriptions-item label="状态">
            <AppStatusTag v-bind="reportStateMeta(report)" />
          </t-descriptions-item>
        </t-descriptions>
      </t-card>

      <t-card v-if="comparisonView" title="产品对比">
        <section>
          <h3 class="report-detail__section-title">纳入报告的产品</h3>
          <div v-if="comparisonView.selectedProducts.length > 0" class="report-detail__product-tags">
            <t-tag v-for="product in comparisonView.selectedProducts" :key="product.id">
              {{ product.name }}
            </t-tag>
          </div>
          <p v-else class="report-detail__muted">未记录选中产品。</p>
        </section>

        <section v-if="comparisonView.dimensions.length > 0" class="report-detail__compare-block">
          <h3 class="report-detail__section-title">对比结果快照</h3>
          <t-table
            :columns="comparisonColumns"
            :data="comparisonTableData"
            row-key="dimension"
            size="small"
          />
        </section>

        <section class="report-detail__compare-block">
          <h3 class="report-detail__section-title">来源</h3>
          <ul v-if="comparisonView.sources.length > 0" class="report-detail__source-list">
            <li v-for="source in comparisonView.sources" :key="`${source.type}:${source.id}`">
              {{ source.label }}
              <span class="report-detail__muted">（{{ source.type }}）</span>
            </li>
          </ul>
          <p v-else class="report-detail__muted">暂无额外来源。</p>
        </section>

        <section class="report-detail__compare-block">
          <h3 class="report-detail__section-title">热工数据</h3>
          <pre v-if="comparisonView.showThermalResults" class="report-detail__json">{{ JSON.stringify(comparisonView.thermalResults, null, 2) }}</pre>
          <p v-else class="report-detail__muted">{{ PRODUCT_COMPARE_THERMAL_UNAVAILABLE }}</p>
        </section>
      </t-card>

      <!-- 使用方案与计算结果 -->
      <t-card title="使用方案与计算结果">
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
      <t-card title="来源资料">
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
      <t-card title="生成日志">
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
          创建人 {{ formatCreatorName(report.createdById, userStore.profile?.id ?? null) }}
          · 生成任务由后端异步执行，进度以状态标签为准
        </p>
      </t-card>

      <t-card v-if="canViewTechnical" title="技术信息">
        <t-descriptions :column="2" size="medium">
          <t-descriptions-item label="模板版本">
            v{{ report.templateVersion }}
          </t-descriptions-item>
          <t-descriptions-item v-if="report.promptTemplateVersion !== null" label="提示词版本">
            v{{ report.promptTemplateVersion }}
          </t-descriptions-item>
          <t-descriptions-item v-if="report.conversationId" label="会话 ID">
            {{ report.conversationId }}
          </t-descriptions-item>
          <t-descriptions-item label="报告类型编码">
            {{ report.reportType }}
          </t-descriptions-item>
        </t-descriptions>
      </t-card>

      <!-- 文件版本 -->
      <t-card title="文件版本">
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
      <t-card title="分享记录">
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

    <t-dialog
      header="驳回报告"
      :confirm-btn="{ content: '确认驳回', theme: 'danger', loading: rejectSubmitting }"
      :visible="rejectDialogVisible"
      width="min(480px, 92vw)"
      @cancel="rejectDialogVisible = false"
      @close="rejectDialogVisible = false"
      @confirm="submitReject"
    >
      <t-form-item label="驳回原因" required-mark>
        <t-textarea
          v-model="rejectReason"
          :autosize="{ minRows: 2, maxRows: 5 }"
          maxlength="500"
          placeholder="必填，将展示给报告创建人"
        />
      </t-form-item>
    </t-dialog>
  </AppPage>
</template>

<style scoped>
.report-detail__center {
  display: flex;
  min-height: var(--vicp-state-min-height);
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: var(--td-size-4);
}

.report-detail__section-title {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
}

.report-detail__compare-block {
  margin-top: var(--td-size-5);
}

.report-detail__product-tags,
.report-detail__source-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.report-detail__source-list {
  flex-direction: column;
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