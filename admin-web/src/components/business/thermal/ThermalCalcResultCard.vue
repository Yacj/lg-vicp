<script setup lang="ts">
import type { ThermalCalcMode } from '@/types/thermal'
import type { ThermalCalcEvidence, ThermalCalcResultSummary } from '@/utils/thermal-calc'
import { computed } from 'vue'
import AppMetricCard from '@/components/ui/AppMetricCard.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import {
  thermalCalcComplianceLabel,
  thermalCalcEvidenceLabel,
  thermalCalcModeLabel,
  thermalCalcSourceLabel,
} from '@/utils/thermal-calc'

/**
 * 热工计算结果主视图（双 R）。
 * 数值全部来自后端冻结快照，前端只做展示格式化；raw JSON 不进入本卡片。
 */
const props = defineProps<{
  mode: ThermalCalcMode
  summary: ThermalCalcResultSummary
  evidence: ThermalCalcEvidence
}>()

const sourceLabel = computed(() => thermalCalcSourceLabel(props.mode))
const sourceHint = computed(() => props.mode === 'REFERENCE_TABLE'
  ? '直接读取已发布的图集参考值，未插值、未重复计算。'
  : '基于当前构造参数与已发布热工规则计算。')

const complianceStatus = computed<'default' | 'success' | 'error'>(() => {
  if (props.summary.compliant === true) {
    return 'success'
  }
  if (props.summary.compliant === false) {
    return 'error'
  }
  return 'default'
})

const kStatus = computed<'default' | 'success' | 'error'>(() => complianceStatus.value)
const basisLabel = computed(() => thermalCalcEvidenceLabel(props.evidence))

function formatNumber(value: number | null): string {
  return value == null ? '—' : String(value)
}

function formatVersion(version: number | null): string {
  return version == null ? '—' : `v${version}`
}

const versionText = computed(() => {
  const parts: string[] = []
  if (props.evidence.ruleVersion != null) {
    parts.push(`规则 ${formatVersion(props.evidence.ruleVersion)}`)
  }
  if (props.evidence.limitVersion != null) {
    parts.push(`限值 ${formatVersion(props.evidence.limitVersion)}`)
  }
  return parts.length > 0 ? parts.join(' · ') : '—'
})
</script>

<template>
  <section class="thermal-result">
    <header class="thermal-result__head">
      <AppStatusTag :label="sourceLabel" :status="mode === 'REFERENCE_TABLE' ? 'info' : 'success'" />
      <span class="thermal-result__hint">{{ sourceHint }}</span>
      <AppStatusTag
        v-if="summary.candidateCount > 0"
        :label="`找到 ${summary.candidateCount} 个图集方案`"
        status="default"
      />
    </header>

    <div class="thermal-result__grid">
      <AppMetricCard label="保温层厚度" :secondary-text="summary.thicknessMm == null ? '' : 'mm'" :value="formatNumber(summary.thicknessMm)" />
      <AppMetricCard label="产品层热阻 R" :secondary-text="summary.productResistance == null ? '' : 'm²·K/W'" :value="formatNumber(summary.productResistance)" />
      <AppMetricCard label="总热阻 R₀" :secondary-text="summary.totalResistance == null ? '' : 'm²·K/W'" :value="formatNumber(summary.totalResistance)" />
      <AppMetricCard label="传热系数 K" :secondary-text="summary.kValue == null ? '' : 'W/(m²·K)'" :status="kStatus" :value="formatNumber(summary.kValue)" />
    </div>

    <t-descriptions bordered :column="3" class="thermal-result__desc" size="small">
      <t-descriptions-item v-if="summary.limitKValue != null" label="限值">
        {{ `K ≤ ${summary.limitKValue} W/(m²·K)` }}
      </t-descriptions-item>
      <t-descriptions-item v-if="summary.compliant != null" label="是否满足要求">
        <AppStatusTag :label="thermalCalcComplianceLabel(summary.compliant)" :status="complianceStatus" />
      </t-descriptions-item>
      <t-descriptions-item label="计算方式">
        {{ thermalCalcModeLabel(mode) }}
      </t-descriptions-item>
      <t-descriptions-item label="使用规则">
        {{ summary.ruleName || summary.ruleCode || '—' }}
      </t-descriptions-item>
      <t-descriptions-item :label="mode === 'REFERENCE_TABLE' ? '图集依据' : '计算依据'">
        {{ basisLabel || '—' }}
      </t-descriptions-item>
      <t-descriptions-item label="快照版本">
        {{ versionText }}
      </t-descriptions-item>
    </t-descriptions>
  </section>
</template>

<style scoped>
.thermal-result {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-3);
}

.thermal-result__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--td-size-3);
}

.thermal-result__hint {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-result__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--td-size-3);
}

.thermal-result__desc {
  margin-top: var(--td-size-1);
}

@media (max-width: 1366px) {
  .thermal-result__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
