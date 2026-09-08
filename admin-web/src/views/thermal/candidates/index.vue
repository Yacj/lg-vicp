<script setup lang="ts">
import type { ThermalCandidate, ThermalCandidateQuery, ThermalCandidateQueryResult } from '@/types/thermal'
import { MessagePlugin } from 'tdesign-vue-next'
import { computed, ref } from 'vue'
import { queryThermalCandidates } from '@/api/modules/thermal'
import AppPage from '@/components/ui/AppPage.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { closestThermalCandidateIds } from '@/utils/thermal-presentation'

/**
 * 候选方案试算：后端返回全部满足条件的图集参考候选（可多个），
 * 其中 ranking.isClosestToTarget 由后端标记「最接近目标值」；前端不做任何 K 值计算。
 */

defineOptions({ name: 'ThermalCandidates' })

const thicknessMode = ref<'any' | 'exact' | 'range'>('any')
const form = ref({
  targetK: undefined as number | undefined,
  regionCode: '',
  substrateMaterial: '',
  thicknessExact: undefined as number | undefined,
  thicknessMin: undefined as number | undefined,
  thicknessMax: undefined as number | undefined,
  specClass: undefined as 'I' | 'II' | 'III' | undefined,
})

const searching = ref(false)
const error = ref<unknown>(null)
const result = ref<ThermalCandidateQueryResult | null>(null)

const closestIds = computed(() =>
  result.value ? closestThermalCandidateIds(result.value.candidates) : new Set<string>())

const targetText = computed(() => {
  if (result.value === null) {
    return ''
  }
  const limit = result.value.limit
  if (form.value.targetK != null) {
    return `目标 K ≤ ${form.value.targetK} W/(㎡·K)`
  }
  if (limit) {
    return `目标 K ≤ ${limit.limitKValue} W/(㎡·K)（${limit.basisName}${limit.clauseRef ? ` · ${limit.clauseRef}` : ''}）`
  }
  return ''
})

function buildQuery(): ThermalCandidateQuery {
  const query: ThermalCandidateQuery = {}
  if (form.value.targetK != null) {
    query.targetK = form.value.targetK
  }
  if (form.value.regionCode.trim()) {
    query.regionCode = form.value.regionCode.trim()
  }
  if (form.value.substrateMaterial.trim()) {
    query.substrateMaterial = form.value.substrateMaterial.trim()
  }
  if (form.value.specClass) {
    query.specClass = form.value.specClass
  }
  if (thicknessMode.value === 'exact' && form.value.thicknessExact != null) {
    query.thicknessMm = form.value.thicknessExact
  }
  if (thicknessMode.value === 'range') {
    if (form.value.thicknessMin != null) {
      query.thicknessMin = form.value.thicknessMin
    }
    if (form.value.thicknessMax != null) {
      query.thicknessMax = form.value.thicknessMax
    }
  }
  return query
}

async function search(): Promise<void> {
  if (thicknessMode.value === 'exact' && form.value.thicknessExact == null) {
    MessagePlugin.warning('请填写精确厚度档')
    return
  }
  if (searching.value) {
    return
  }
  searching.value = true
  error.value = null
  try {
    result.value = await queryThermalCandidates(buildQuery())
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    searching.value = false
  }
}

function matchTag(candidate: ThermalCandidate): { label: string, status: 'success' | 'warning' | 'error' | 'default' } {
  if (candidate.matchType === 'NEIGHBOR') {
    return { label: `相邻档位（差 ${candidate.neighborGap ?? 1} 档）`, status: 'warning' }
  }
  return { label: '精确匹配', status: 'success' }
}
</script>

<template>
  <AppPage
    title="候选方案试算"
    description="按图集参考表查询满足条件的保温构造候选方案；后端会标记最接近目标 K 值的方案，全部候选平等展示，可核对每条方案的图集依据。"
  >
    <div class="vicp-candidate">
      <section class="vicp-candidate__form">
        <t-form label-align="top" layout="inline">
          <t-form-item label="目标 K 值（W/(㎡·K)）">
            <t-input-number v-model="form.targetK" :min="0" :max="10" :step="0.01" placeholder="如 0.25" theme="normal" />
          </t-form-item>
          <t-form-item label="地区编码">
            <t-input v-model="form.regionCode" clearable placeholder="如 华北，选填" />
          </t-form-item>
          <t-form-item label="基层材料">
            <t-input v-model="form.substrateMaterial" clearable placeholder="如 钢筋混凝土，选填" />
          </t-form-item>
          <t-form-item label="产品规格类别">
            <t-select v-model="form.specClass" clearable placeholder="全部" style="width: 120px">
              <t-option value="I" label="Ⅰ 型" />
              <t-option value="II" label="Ⅱ 型" />
              <t-option value="III" label="Ⅲ 型" />
            </t-select>
          </t-form-item>
        </t-form>
        <div class="vicp-candidate__thickness">
          <t-radio-group v-model="thicknessMode" variant="default-filled" size="small">
            <t-radio-button value="any">
              不限厚度
            </t-radio-button>
            <t-radio-button value="exact">
              精确厚度档
            </t-radio-button>
            <t-radio-button value="range">
              厚度区间
            </t-radio-button>
          </t-radio-group>
          <t-input-number v-if="thicknessMode === 'exact'" v-model="form.thicknessExact" :min="0" :max="1000" placeholder="mm" theme="normal" />
          <template v-if="thicknessMode === 'range'">
            <t-input-number v-model="form.thicknessMin" :min="0" :max="1000" placeholder="下限 mm" theme="normal" />
            <span class="vicp-candidate__separator">—</span>
            <t-input-number v-model="form.thicknessMax" :min="0" :max="1000" placeholder="上限 mm" theme="normal" />
          </template>
          <t-button theme="primary" :loading="searching" @click="search">
            查询候选
          </t-button>
        </div>
      </section>

      <t-alert v-if="error" theme="error" :message="normalizeFeedbackError(error).message" />

      <template v-if="result">
        <t-alert
          v-for="(note, index) in result.notes"
          :key="index"
          theme="info"
          :message="note"
        />

        <section class="vicp-candidate__summary">
          <div class="vicp-candidate__target">
            <strong>查询条件</strong>
            <span>{{ targetText || '未指定目标 K 值' }}</span>
          </div>
          <div v-if="result.missingConditions.length > 0" class="vicp-candidate__missing">
            <span>未提供的条件：</span>
            <t-tag v-for="item in result.missingConditions" :key="item" size="small" theme="warning" variant="light">
              {{ item }}
            </t-tag>
          </div>
          <p class="vicp-candidate__count">
            共 {{ result.candidates.length }} 个候选方案
          </p>
        </section>

        <div v-if="result.candidates.length > 0" class="vicp-candidate__list">
          <article
            v-for="candidate in result.candidates"
            :key="candidate.candidateId"
            class="vicp-candidate__card"
          >
            <header class="vicp-candidate__card-head">
              <strong class="vicp-candidate__card-title">
                {{ candidate.scheme.code }}
                <span v-if="candidate.system.name" class="vicp-candidate__card-system">{{ candidate.system.name }}</span>
              </strong>
              <t-tag v-if="closestIds.has(candidate.candidateId)" theme="primary" variant="light">
                最接近目标值
              </t-tag>
              <AppStatusTag :label="matchTag(candidate).label" :status="matchTag(candidate).status" />
              <AppStatusTag
                v-if="candidate.compliant !== null"
                :label="candidate.compliant ? '满足标准限值' : '未满足标准限值'"
                :status="candidate.compliant ? 'success' : 'error'"
              />
            </header>

            <div class="vicp-candidate__card-metrics">
              <div class="vicp-candidate__metric">
                <span>厚度</span>
                <strong>{{ candidate.result.thicknessMm }}mm</strong>
              </div>
              <div class="vicp-candidate__metric">
                <span>总热阻</span>
                <strong>{{ candidate.result.totalThermalResistance }} (㎡·K)/W</strong>
              </div>
              <div class="vicp-candidate__metric">
                <span>K 值</span>
                <strong>{{ candidate.result.kValue }} W/(㎡·K)</strong>
              </div>
              <div v-if="candidate.ranking" class="vicp-candidate__metric">
                <span>与目标差距</span>
                <strong>{{ candidate.ranking.kGap }}</strong>
              </div>
            </div>

            <div class="vicp-candidate__card-conditions">
              <t-tag v-for="item in candidate.matchedConditions" :key="item" size="small" theme="success" variant="light">
                {{ item }}
              </t-tag>
              <t-tag v-for="item in candidate.unmatchedConditions" :key="item" size="small" theme="danger" variant="light">
                {{ item }}
              </t-tag>
              <t-tag v-for="item in candidate.missingConditions" :key="item" size="small" theme="warning" variant="light">
                缺失：{{ item }}
              </t-tag>
            </div>

            <footer class="vicp-candidate__card-evidence">
              图集依据：{{ candidate.evidence.source }} {{ candidate.evidence.ref }}
              <template v-if="candidate.scheme.atlasPage">
                · 参考页 {{ candidate.scheme.atlasPage }}
              </template>
              <template v-if="candidate.set.buildingTypes.length > 0">
                · 适用建筑：{{ candidate.set.buildingTypes.join('、') }}
              </template>
            </footer>
          </article>
        </div>
        <t-empty v-else description="没有满足条件的候选方案；可放宽厚度区间或调整目标 K 值" />
      </template>

      <t-empty v-else-if="!error && !searching" description="填写查询条件后开始试算，结果与 APP 端展示口径一致" />
    </div>
  </AppPage>
</template>

<style scoped>
.vicp-candidate {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.vicp-candidate__form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.vicp-candidate__thickness {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.vicp-candidate__separator {
  color: var(--td-text-color-secondary);
}

.vicp-candidate__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
}

.vicp-candidate__target {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.vicp-candidate__target strong {
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.vicp-candidate__target span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__missing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.vicp-candidate__count {
  margin: 0 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px;
}

.vicp-candidate__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border: 1px solid var(--td-component-border);
  border-radius: var(--td-radius-medium);
  background: var(--td-bg-color-container);
}

.vicp-candidate__card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.vicp-candidate__card-title {
  min-width: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
}

.vicp-candidate__card-system {
  margin-left: 6px;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  font-weight: normal;
}

.vicp-candidate__card-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.vicp-candidate__metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.vicp-candidate__metric span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.vicp-candidate__metric strong {
  color: var(--td-text-color-primary);
  font-weight: var(--td-font-weight-medium);
}

.vicp-candidate__card-conditions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.vicp-candidate__card-evidence {
  padding-top: 8px;
  border-top: 1px dashed var(--td-component-stroke);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
  line-height: 1.6;
}
</style>
