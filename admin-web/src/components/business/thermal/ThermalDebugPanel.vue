<script setup lang="ts">
import type { ThermalCalcRecord } from '@/types/thermal'
import { computed } from 'vue'

/**
 * 热工计算原始快照调试面板。
 * 后端 system:thermal:* 无专用 debug 权限码，调用方以 system:knowledge:debug 门控（超管自动放行）；
 * canDebug 为 false 时整块不渲染，普通业务用户看不到内部 ID 与原始 JSON。
 */
const props = withDefaults(defineProps<{
  record: ThermalCalcRecord
  canDebug?: boolean
}>(), {
  canDebug: false,
})

interface DebugSection {
  key: string
  title: string
  value: unknown
}

function isEmptyValue(value: unknown): boolean {
  if (value == null) {
    return true
  }
  if (Array.isArray(value)) {
    return value.length === 0
  }
  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length === 0
  }
  return false
}

const sections = computed<DebugSection[]>(() => {
  const record = props.record
  const candidates: DebugSection[] = [
    { key: 'input', title: '输入参数', value: record.input },
    { key: 'layers', title: '构造层快照', value: record.layers },
    { key: 'parameters', title: '材料 / 当量参数快照', value: record.parameters },
    { key: 'rule', title: '计算规则快照', value: record.rule },
    { key: 'standard', title: '标准限值快照', value: record.standard },
    { key: 'formulas', title: '公式', value: record.formulas },
    { key: 'steps', title: '计算步骤快照', value: record.steps },
    { key: 'result', title: '结果', value: record.result },
  ]
  return candidates.filter(item => !isEmptyValue(item.value))
})

const meta = computed(() => {
  const record = props.record
  return [
    { label: '记录 ID', value: record.id },
    { label: '请求 ID', value: record.requestId ?? '—' },
    { label: '规则版本', value: record.ruleVersion == null ? '—' : `v${record.ruleVersion}` },
    { label: '限值版本', value: record.limitVersion == null ? '—' : `v${record.limitVersion}` },
  ]
})

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
  <t-collapse v-if="canDebug" class="thermal-debug">
    <t-collapse-panel value="debug" header="高级调试（原始快照 JSON）">
      <p class="thermal-debug__notice">
        以下内容为后端落库的冻结快照，仅供排查问题使用，不作为业务结论。
      </p>
      <dl class="thermal-debug__meta">
        <div v-for="item in meta" :key="item.label">
          <dt>{{ item.label }}</dt>
          <dd>{{ item.value }}</dd>
        </div>
      </dl>
      <section v-for="section in sections" :key="section.key" class="thermal-debug__block">
        <h5>{{ section.title }}</h5>
        <pre class="thermal-debug__json">{{ formatJson(section.value) }}</pre>
      </section>
    </t-collapse-panel>
  </t-collapse>
</template>

<style scoped>
.thermal-debug {
  margin-top: var(--td-size-4);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--td-radius-medium);
}

.thermal-debug__notice {
  margin: 0 0 var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.thermal-debug__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--td-size-2) var(--td-size-5);
  margin: 0 0 var(--td-size-4);
}

.thermal-debug__meta div {
  display: flex;
  gap: var(--td-size-2);
  font-size: var(--td-font-size-body-small);
}

.thermal-debug__meta dt {
  color: var(--td-text-color-secondary);
}

.thermal-debug__meta dd {
  margin: 0;
  color: var(--td-text-color-primary);
  font-family: var(--td-font-family-mono);
  word-break: break-all;
}

.thermal-debug__block + .thermal-debug__block {
  margin-top: var(--td-size-4);
}

.thermal-debug__block h5 {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: var(--td-font-weight-medium);
}

.thermal-debug__json {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: var(--td-size-3);
  border-radius: var(--td-radius-small);
  background: var(--td-bg-color-secondarycontainer);
  color: var(--td-text-color-primary);
  font-family: var(--td-font-family-mono);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
