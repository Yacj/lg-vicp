<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { ThermalCalcMode, ThermalCalcRecord, ThermalCalcRecordQuery } from '@/types/thermal'
import { computed, ref, watch } from 'vue'
import { fetchThermalCalcRecord, fetchThermalCalcRecords } from '@/api/modules/thermal'
import AppTableActions from '@/components/business/AppTableActions.vue'
import ThermalCalcResultCard from '@/components/business/thermal/ThermalCalcResultCard.vue'
import ThermalDebugPanel from '@/components/business/thermal/ThermalDebugPanel.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import { useCrudList } from '@/composables/useCrudList'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { businessUserError } from '@/utils/business-error'
import { formatDate } from '@/utils/day'
import {
  THERMAL_CALC_MODE_OPTIONS,
  thermalCalcEvidence,
  thermalCalcModeLabel,
  thermalCalcResultSummary,
} from '@/utils/thermal-calc'
import { buildThermalCalcPresentation } from '@/utils/thermal-presentation'

/**
 * 热工计算记录面板（只读）。
 * 传入 lockedProjectId 时锁定项目上下文（项目详情 / 智能计算 / 历史记录）。
 */
const props = defineProps<{
  lockedProjectId?: string
}>()

const { canAccess } = usePermissionAccess()
const canList = computed(() => canAccess({ permissions: ['system:thermal:list'] }))
/** 高级调试：后端 system:thermal:* 无专用 debug 码，沿用知识库 debug 码门控（超管自动放行）。 */
const canDebug = computed(() => canAccess({ permissions: ['system:knowledge:debug'] }))

const modeOptions = THERMAL_CALC_MODE_OPTIONS

const list = useCrudList<ThermalCalcRecord, ThermalCalcRecordQuery>({
  createQuery: () => ({ page: 1, pageSize: 20, keyword: '', status: '', mode: '', projectId: props.lockedProjectId ?? '' }),
  fetcher: ({ query, page, pageSize, signal }) =>
    fetchThermalCalcRecords({ ...query, page, pageSize, status: !query.status || query.status === 'all' ? undefined : query.status, mode: !query.mode || query.mode === 'all' ? undefined : query.mode } as ThermalCalcRecordQuery, signal),
  immediate: true,
  rowKey: 'id',
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<ThermalCalcRecord | null>(null)

// keepAlive 复用组件时跟随外部项目上下文变化（项目详情切换项目后再次进入）
watch(() => props.lockedProjectId, (value) => {
  if (!value) {
    return
  }
  if (list.query.projectId !== value) {
    list.query.projectId = value
    void list.search()
  }
})

const detailPresentation = computed(() =>
  detail.value ? buildThermalCalcPresentation(detail.value) : null)
const detailSummary = computed(() => (detail.value ? thermalCalcResultSummary(detail.value) : null))
const detailEvidence = computed(() => (detail.value ? thermalCalcEvidence(detail.value) : null))

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

const errorDescription = computed(() => businessUserError(list.error.value))

/** 列表结果摘要：双 R + K + 判定（来自冻结快照，不展示原始 JSON 键值）。 */
function resultSummary(row: ThermalCalcRecord): string {
  const summary = thermalCalcResultSummary(row)
  const parts: string[] = []
  if (summary.productResistance != null) {
    parts.push(`R=${summary.productResistance}`)
  }
  if (summary.totalResistance != null) {
    parts.push(`R₀=${summary.totalResistance}`)
  }
  if (summary.kValue != null) {
    parts.push(`K=${summary.kValue}`)
  }
  if (summary.compliant === true) {
    parts.push('满足限值')
  }
  if (summary.compliant === false) {
    parts.push('不满足限值')
  }
  return parts.length > 0 ? parts.join(' · ') : '—'
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { cell: (_, { row }) => thermalCalcModeLabel(row.mode as ThermalCalcMode), colKey: 'mode', minWidth: 100, title: '计算方式' },
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
</script>

<template>
  <div class="vicp-record-panel">
    <AppSearchPanel :loading="list.isLoading.value" @reset="list.reset" @search="list.search">
      <t-form-item label="计算方式">
        <t-select v-model="list.query.mode" :options="modeOptions" clearable placeholder="全部" />
      </t-form-item>
      <t-form-item v-if="!lockedProjectId" label="项目 ID">
        <t-input v-model="list.query.projectId" clearable placeholder="选填" />
      </t-form-item>
    </AppSearchPanel>

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
          <!-- 用户展示视图：结果（双 R）→ 计算过程 → 构造分层 → 基本信息 → 高级调试 -->
          <ThermalCalcResultCard
            v-if="detailSummary && detailEvidence"
            :evidence="detailEvidence"
            :mode="detail.mode as ThermalCalcMode"
            :summary="detailSummary"
          />

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
              <div><dt>计算方式</dt><dd>{{ thermalCalcModeLabel(detail.mode as ThermalCalcMode) }}</dd></div>
              <div><dt>规则版本</dt><dd>{{ detail.ruleVersion == null ? '—' : `v${detail.ruleVersion}` }}</dd></div>
              <div><dt>限值版本</dt><dd>{{ detail.limitVersion == null ? '—' : `v${detail.limitVersion}` }}</dd></div>
              <div><dt>计算时间</dt><dd>{{ formatDate(new Date(detail.createdAt)) }}</dd></div>
            </dl>
          </section>

          <!-- 技术调试信息：原始快照 JSON，仅 debug 权限可见，不面向业务人员 -->
          <ThermalDebugPanel :can-debug="canDebug" :record="detail" />
        </div>
      </t-loading>
    </t-drawer>
  </div>
</template>

<style scoped>
.vicp-record-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--vicp-page-gap);
  min-height: 0;
}

.vicp-record {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-5);
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
</style>
