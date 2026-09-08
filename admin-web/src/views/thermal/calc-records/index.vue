<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { ThermalCalcMode, ThermalCalcRecord, ThermalCalcRecordQuery } from '@/types/thermal'
import { computed, ref } from 'vue'
import { fetchThermalCalcRecord, fetchThermalCalcRecords } from '@/api/modules/thermal'
import AppTableActions from '@/components/business/AppTableActions.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { formatDate } from '@/utils/day'
import { buildThermalCalcPresentation } from '@/utils/thermal-presentation'

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:thermal:list'] }))

const modeOptions = [
  { label: '图集查表', value: 'REFERENCE_TABLE' },
  { label: '等效热阻', value: 'EQUIVALENT' },
  { label: '分层计算', value: 'LAYERED' },
]

const modeLabels: Record<ThermalCalcMode, string> = {
  REFERENCE_TABLE: '图集查表',
  EQUIVALENT: '等效热阻',
  LAYERED: '分层计算',
}

const list = useCrudList<ThermalCalcRecord, ThermalCalcRecordQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', mode: '', projectId: '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchThermalCalcRecords({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status, mode: !query.mode || query.mode === 'all' ? undefined : query.mode } as ThermalCalcRecordQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<ThermalCalcRecord | null>(null)

const detailPresentation = computed(() =>
  detail.value ? buildThermalCalcPresentation(detail.value) : null)

async function openDetail(row: ThermalCalcRecord): Promise<void> {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    detail.value = await fetchThermalCalcRecord(row.id)
  }
  finally {
    detailLoading.value = false
  }
}

const errorDescription = computed(() => list.error.value
  ? normalizeFeedbackError(list.error.value).message
  : '请检查网络连接后重试')

function resultSummary(row: ThermalCalcRecord): string {
  const result = row.result as Record<string, unknown> | null
  if (!result) {
    return '—'
  }
  const parts: string[] = []
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      parts.push(`${key}: ${String(value)}`)
    }
  }
  return parts.slice(0, 3).join('；') || '—'
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => modeLabels[row.mode as ThermalCalcMode] ?? row.mode, colKey: 'mode', minWidth: 100, title: '计算方式' },
  { cell: (_, { row }) => resultSummary(row as ThermalCalcRecord), colKey: 'result', minWidth: 280, title: '结果摘要' },
  { cell: (_, { row }) => row.ruleVersion == null ? '—' : `v${row.ruleVersion}`, colKey: 'ruleVersion', minWidth: 90, title: '规则版本' },
  { cell: (_, { row }) => row.limitVersion == null ? '—' : `v${row.limitVersion}`, colKey: 'limitVersion', minWidth: 90, title: '限值版本' },
  { cell: (_, { row }) => formatDate(new Date(row.createdAt)), colKey: 'createdAt', minWidth: 160, title: '计算时间' },
]

function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as ThermalCalcRecord
  const actions: AppTableAction[] = []
  if (canList.value) {
    actions.push({ key: 'detail', label: '查看详情', handler: () => void openDetail(entity) })
  }
  return actions
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}
</script>

<template>
  <AppPage title="计算记录" description="热工计算历史（只读）；历史结果不随后台参数变化，可完整查看当时的输入与规则。">
    <template #search>
      <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
        <t-form-item label="计算方式">
          <t-select v-model="list.query.mode" :options="modeOptions" clearable placeholder="全部" />
        </t-form-item>
        <t-form-item label="项目 ID">
          <t-input v-model="list.query.projectId" clearable placeholder="选填" />
        </t-form-item>
      </AppSearchPanel>
    </template>

    <AppDataTable
      :columns="columns"
      :current="list.current.value"
      :data="list.data.value"
      empty-description="暂无计算记录"
      empty-title="暂无计算记录"
      :error-description="errorDescription"
      :operations-width="120"
      :page-size="list.pageSize.value"
      row-key="id"
      :status="list.tableStatus.value"
      :total="list.total.value"
      @page-change="list.changePage"
      @refresh="list.refresh"
      @retry="list.retry"
    >
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" />
      </template>
    </AppDataTable>

    <t-drawer
      :cancel-btn="{ content: '关闭' }"
      :footer="false"
      :header="`计算详情 · ${detail?.id ?? ''}`"
      placement="right"
      size="min(560px, 100vw)"
      :visible="detailVisible"
      @close="detailVisible = false"
    >
      <t-loading :loading="detailLoading">
        <div v-if="detail" class="vicp-record">
          <!-- 用户展示视图：结果 → 计算过程 → 构造分层 -->
          <section class="vicp-record__section">
            <h4>计算结果</h4>
            <div v-if="detailPresentation && (detailPresentation.resultK !== null || detailPresentation.totalResistance !== null)" class="vicp-record__result">
              <div v-if="detailPresentation.targetK !== null" class="vicp-record__result-item">
                <span>目标 K</span>
                <strong>≤ {{ detailPresentation.targetK }} W/(㎡·K)</strong>
              </div>
              <div v-if="detailPresentation.resultK !== null" class="vicp-record__result-item">
                <span>结果 K</span>
                <strong>{{ detailPresentation.resultK }} W/(㎡·K)</strong>
              </div>
              <div v-else-if="detailPresentation.totalResistance !== null" class="vicp-record__result-item">
                <span>总热阻</span>
                <strong>{{ detailPresentation.totalResistance }} (㎡·K)/W</strong>
              </div>
              <div v-if="detailPresentation.compliant !== null" class="vicp-record__result-item">
                <span>状态</span>
                <AppStatusTag
                  :label="detailPresentation.compliant ? '满足要求' : '不满足要求'"
                  :status="detailPresentation.compliant ? 'success' : 'error'"
                />
              </div>
            </div>
            <p v-if="detailPresentation?.standardLabel" class="vicp-record__basis">
              依据：{{ detailPresentation.standardLabel }}
            </p>
          </section>

          <t-collapse v-if="detailPresentation && detailPresentation.steps.length > 0" :default-value="['process']" class="vicp-record__collapse">
            <t-collapse-panel value="process" header="计算过程">
              <ol class="vicp-record__steps">
                <li v-for="step in detailPresentation.steps" :key="step.key" class="vicp-record__step">
                  <span class="vicp-record__step-label">{{ step.label }}</span>
                  <span v-if="step.formula" class="vicp-record__step-formula">{{ step.formula }}</span>
                  <span v-if="step.value !== null" class="vicp-record__step-value">
                    = {{ step.value }}<template v-if="step.unit"> {{ step.unit }}</template>
                  </span>
                </li>
              </ol>
            </t-collapse-panel>
          </t-collapse>

          <t-collapse v-if="detailPresentation && detailPresentation.layers.length > 0" class="vicp-record__collapse">
            <t-collapse-panel value="layers" header="构造分层">
              <ol class="vicp-record__layer-list">
                <li v-for="layer in detailPresentation.layers" :key="layer.order" class="vicp-record__layer">
                  <span class="vicp-record__layer-name">{{ layer.name }}</span>
                  <span v-if="layer.thicknessMm !== null">{{ layer.thicknessMm }}mm</span>
                  <span v-if="layer.lambda !== null">λ={{ layer.lambda }}</span>
                  <span v-if="layer.correctionFactor !== null">修正 a={{ layer.correctionFactor }}</span>
                </li>
              </ol>
            </t-collapse-panel>
          </t-collapse>

          <section class="vicp-record__section">
            <h4>基本信息</h4>
            <dl>
              <div><dt>请求 ID</dt><dd>{{ detail.requestId ?? '—' }}</dd></div>
              <div><dt>计算方式</dt><dd>{{ modeLabels[detail.mode as ThermalCalcMode] ?? detail.mode }}</dd></div>
              <div><dt>规则版本</dt><dd>{{ detail.ruleVersion == null ? '—' : `v${detail.ruleVersion}` }}</dd></div>
              <div><dt>限值版本</dt><dd>{{ detail.limitVersion == null ? '—' : `v${detail.limitVersion}` }}</dd></div>
              <div><dt>计算时间</dt><dd>{{ formatDate(new Date(detail.createdAt)) }}</dd></div>
            </dl>
          </section>

          <!-- 技术调试信息：原始快照 JSON，默认折叠，不面向业务人员 -->
          <t-collapse class="vicp-record__collapse">
            <t-collapse-panel value="debug" header="技术调试信息（原始快照）">
              <section v-if="detail.input" class="vicp-record__debug-block">
                <h5>输入</h5>
                <pre class="vicp-record__json">{{ formatJson(detail.input) }}</pre>
              </section>
              <section v-if="detail.steps && detail.steps.length > 0" class="vicp-record__debug-block">
                <h5>计算步骤快照</h5>
                <pre class="vicp-record__json">{{ formatJson(detail.steps) }}</pre>
              </section>
              <section v-if="detail.formulas" class="vicp-record__debug-block">
                <h5>公式</h5>
                <pre class="vicp-record__json">{{ formatJson(detail.formulas) }}</pre>
              </section>
              <section class="vicp-record__debug-block">
                <h5>结果</h5>
                <pre class="vicp-record__json">{{ formatJson(detail.result) }}</pre>
              </section>
            </t-collapse-panel>
          </t-collapse>
        </div>
      </t-loading>
    </t-drawer>
  </AppPage>
</template>

<style scoped>
.vicp-record {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-5);
}

.vicp-record__result {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-6);
}

.vicp-record__result-item {
  display: flex;
  min-width: 0;
  align-items: baseline;
  flex-direction: column;
  gap: var(--td-size-1);
}

.vicp-record__result-item span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-record__result-item strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-medium);
  font-weight: var(--td-font-weight-medium);
}

.vicp-record__basis {
  margin: var(--td-size-3) 0 0;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-record__collapse {
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
}

.vicp-record__steps,
.vicp-record__layer-list {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin: 0;
  padding-left: var(--td-size-5);
}

.vicp-record__step {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--td-size-3);
  font-size: var(--td-font-size-body-small);
}

.vicp-record__step-label {
  color: var(--td-text-color-primary);
}

.vicp-record__step-formula {
  color: var(--td-text-color-secondary);
  font-family: var(--td-font-family-mono);
}

.vicp-record__step-value {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
  font-family: var(--td-font-family-mono);
  white-space: nowrap;
}

.vicp-record__layer {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--td-size-3);
  font-size: var(--td-font-size-body-small);
}

.vicp-record__layer-name {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}

.vicp-record__debug-block + .vicp-record__debug-block {
  margin-top: var(--td-size-4);
}

.vicp-record__debug-block h5 {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: var(--td-font-weight-medium);
}

.vicp-record__section h4 {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  font-weight: var(--td-font-weight-medium);
}

.vicp-record__section dl {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-2);
  margin: 0;
}

.vicp-record__section dl div {
  display: flex;
  min-width: 0;
  gap: var(--td-size-3);
  font-size: var(--td-font-size-body-small);
}

.vicp-record__section dt {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
}

.vicp-record__section dd {
  overflow: hidden;
  min-width: 0;
  margin: 0;
  color: var(--td-text-color-primary);
  text-overflow: ellipsis;
  word-break: break-all;
  white-space: nowrap;
}

.vicp-record__json {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: var(--td-size-3);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-component);
  color: var(--td-text-color-primary);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
