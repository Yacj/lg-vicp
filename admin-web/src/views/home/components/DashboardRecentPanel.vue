<script setup lang="ts">
import type { KnowledgeParsingJob } from '@/types/knowledge'
import type { ReportCenterRow } from '@/types/report'
import { TimeIcon } from 'tdesign-icons-vue-next'
import { ref } from 'vue'
import { AppEmptyState, AppStatusTag } from '@/components/ui'
import AppWorkspaceTabs from '@/components/ui/AppWorkspaceTabs.vue'
import { formatDate } from '@/utils/day'
import { knowledgeUserMessage } from '@/utils/knowledge-user'
import { getReportTypeLabel, reportStateMeta } from '@/utils/report'

const props = defineProps<{
  recentReports: ReportCenterRow[] | null
  canAggregateReports: boolean
  parsingFailures: KnowledgeParsingJob[] | null
  parsingFailureTotal: number
  parsingJobsReachable: boolean
  parsingJobsPath: string
}>()

const emit = defineEmits<{
  openReport: [report: ReportCenterRow]
  openPath: [path: string]
}>()

const activeTab = ref('reports')

const JOB_TYPE_LABELS: Record<KnowledgeParsingJob['jobType'], string> = {
  CHUNK_REBUILD: '重新整理内容',
  OCR: '补充文字',
  PARSE: '解析文件',
  REPARSE: '重新解析',
}

const tabs = [
  { key: 'reports', label: '最近报告' },
  { key: 'anomalies', label: '资料异常' },
]
</script>

<template>
  <div class="dashboard-recent">
    <AppWorkspaceTabs v-model="activeTab" :tabs="tabs">
      <template #reports>
        <t-loading :loading="props.recentReports === null" size="small" text="正在加载最近报告">
          <template v-if="props.recentReports && props.recentReports.length > 0">
            <ul class="dashboard-line-list">
              <li v-for="report in props.recentReports" :key="report.id" class="dashboard-line-item">
                <t-button
                  class="dashboard-line-item__main"
                  theme="default"
                  variant="text"
                  @click="emit('openReport', report)"
                >
                  <strong>{{ getReportTypeLabel(report.reportType) }}</strong>
                  <span class="dashboard-line-item__meta">
                    {{ report.projectName }} · {{ report.conversationTitle || '未关联会话' }}
                  </span>
                </t-button>
                <span class="dashboard-line-item__side">
                  <AppStatusTag
                    :label="reportStateMeta(report).label"
                    :status="reportStateMeta(report).status"
                  />
                  <span class="dashboard-line-item__time">
                    <TimeIcon />
                    {{ formatDate(new Date(report.updatedAt)) }}
                  </span>
                </span>
              </li>
            </ul>
          </template>
          <AppEmptyState
            v-else-if="props.recentReports && !props.canAggregateReports"
            description="报告按项目聚合展示，可进入报告管理按项目查看"
            size="small"
            title="暂无报告概览"
          />
          <AppEmptyState
            v-else-if="props.recentReports"
            description="在 AI 会话中生成报告后，最近成果会显示在这里"
            size="small"
            title="暂无最近报告"
          />
        </t-loading>
      </template>

      <template #anomalies>
        <div class="dashboard-recent__anomalies">
          <header v-if="props.parsingJobsReachable" class="dashboard-recent__anomalies-head">
            <span v-if="props.parsingFailureTotal > 0" class="dashboard-recent__anomalies-total">
              共 {{ props.parsingFailureTotal }} 条解析失败
            </span>
            <t-button
              size="small"
              theme="default"
              variant="text"
              @click="emit('openPath', props.parsingJobsPath)"
            >
              解析任务
            </t-button>
          </header>

          <t-loading :loading="props.parsingFailures === null" size="small" text="正在加载资料异常">
            <template v-if="props.parsingFailures && props.parsingFailures.length > 0">
              <ul class="dashboard-line-list">
                <li v-for="job in props.parsingFailures" :key="job.id" class="dashboard-line-item">
                  <span class="dashboard-line-item__main is-static">
                    <strong>{{ job.document?.title || '未命名知识库' }}</strong>
                    <span class="dashboard-line-item__meta">
                      {{ JOB_TYPE_LABELS[job.jobType] }} · {{ knowledgeUserMessage(job.errorMessage || '解析失败') }}
                    </span>
                  </span>
                  <span class="dashboard-line-item__time">
                    <TimeIcon />
                    {{ formatDate(new Date(job.finishedAt ?? job.createdAt)) }}
                  </span>
                </li>
              </ul>
            </template>
            <AppEmptyState
              v-else-if="props.parsingFailures"
              description="知识库解析失败任务会显示在这里"
              size="small"
              title="暂无解析异常"
            />
          </t-loading>
        </div>
      </template>
    </AppWorkspaceTabs>
  </div>
</template>

<style scoped>
.dashboard-recent {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.dashboard-recent__anomalies {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-2);
}

.dashboard-recent__anomalies-head {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-3);
}

.dashboard-recent__anomalies-total {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.dashboard-line-list {
  display: flex;
  min-width: 0;
  margin: 0;
  padding: 0;
  flex-direction: column;
  list-style: none;
}

.dashboard-line-item {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-size-3) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.dashboard-line-item:last-child {
  border-bottom: 0;
}

.dashboard-line-item__main {
  display: flex;
  height: auto;
  min-width: 0;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: var(--td-size-1);
  padding: 0;
  text-align: left;
  white-space: normal;
}

.dashboard-line-item__main.is-static {
  cursor: default;
}

.dashboard-line-item__main strong {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__main:not(.is-static):hover strong {
  color: var(--td-brand-color);
}

.dashboard-line-item__meta {
  overflow: hidden;
  max-width: 100%;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-line-item__side {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: flex-end;
  flex-direction: column;
  gap: var(--td-size-1);
}

.dashboard-line-item__time {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-1);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  white-space: nowrap;
}

@media (max-width: 640px) {
  .dashboard-line-item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--td-size-2);
  }

  .dashboard-line-item__side {
    align-items: center;
    flex-direction: row;
  }
}
</style>
