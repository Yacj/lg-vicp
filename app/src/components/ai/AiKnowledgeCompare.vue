<script setup lang="ts">
import type { AiReferencePage } from '@/api/reference-page'
import { computed, ref } from 'vue'
import MpHtml from '@/uni_modules/mp-html/components/mp-html/mp-html.vue'
import { markdownTagStyle, renderMarkdown } from '@/utils/markdown'

/**
 * 只读比较：只消费已确认、已发布、当前有权访问的页面档位。
 * 结果显式标注 comparisonOnly/confirmable=false，不产生候选、不写方案状态。
 */
const props = defineProps<{ pages: AiReferencePage[] }>()

interface Choice {
  key: string
  pageId: string
  constructionCode: string | null
  constructionLabel: string
  thicknessMm: number | null
  label: string
}

const visible = ref(false)
const loading = ref(false)
const error = ref('')
const selected = ref<string[]>([])
const result = ref<{ answer?: string, failures?: Array<{ message: string }>, comparisonOnly?: boolean, confirmable?: boolean } | null>(null)

const choices = computed<Choice[]>(() => props.pages.flatMap(page => (page.renderModel?.constructions ?? []).flatMap((construction) => {
  const code = construction.constructionCode ?? null
  const label = construction.rawConstructionLabel || construction.systemName || code || '未命名构造'
  return (construction.options ?? []).map(option => {
    const thickness = typeof option.thicknessMm === 'number' ? option.thicknessMm : Number(option.thicknessMm ?? NaN)
    const value = Number.isFinite(thickness) ? thickness : null
    return {
      key: `${page.page.pageId}|${code ?? label}|${value ?? 'x'}`,
      pageId: page.page.pageId,
      constructionCode: code,
      constructionLabel: label,
      thicknessMm: value,
      label: `${label}${value == null ? '' : ` ${value}mm`}${option.kValue == null ? '' : ` · K ${option.kValue}`}`,
    }
  })
})))

function toggle(key: string) {
  if (selected.value.includes(key)) {
    selected.value = selected.value.filter(item => item !== key)
    return
  }
  if (selected.value.length >= 6) {
    error.value = '一次最多比较六个档位。'
    return
  }
  error.value = ''
  selected.value = [...selected.value, key]
}

async function compare() {
  if (selected.value.length < 2) {
    error.value = '请至少选择两个档位。'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const { aiApi } = await import('@/api/modules/ai')
    const picked = choices.value.filter(item => selected.value.includes(item.key))
    const response = await aiApi.compareKnowledgeOptions({
      selections: picked.map(item => ({ pageId: item.pageId, constructionCode: item.constructionCode ?? undefined, thicknessMm: item.thicknessMm })),
    }) as { data?: typeof result.value }
    result.value = response?.data ?? (response as unknown as typeof result.value)
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '比较失败，请稍后重试。'
  }
  finally {
    loading.value = false
  }
}

function open() {
  visible.value = true
  result.value = null
  error.value = ''
}
</script>

<template>
  <view v-if="choices.length >= 2">
    <wd-button size="small" variant="text" @click="open">
      只读比较（不产生候选）
    </wd-button>
    <wd-popup v-model="visible" position="bottom" :z-index="2100" :close-on-click-modal="true" custom-class="ai-knowledge-compare">
      <view class="px-4 pb-6 pt-4">
        <view class="mb-2 flex items-center justify-between">
          <text class="text-3 font-600">
            只读比较
          </text>
          <wd-icon name="close" size="32rpx" color="var(--app-text-tertiary)" @click="visible = false" />
        </view>
        <text class="app-muted text-2.5">
          仅比较已确认、已发布、你有权访问的图集档位；不会生成正式候选，不能据此确认方案或出报告。
        </text>

        <view v-if="!result" class="mt-3 max-h-60 overflow-auto">
          <view
            v-for="item in choices" :key="item.key"
            class="mb-2 flex items-center rounded-2 px-3 py-2"
            :class="selected.includes(item.key) ? 'bg-[var(--app-primary-soft)]' : 'bg-[var(--app-surface-2)]'"
            @click="toggle(item.key)"
          >
            <wd-icon :name="selected.includes(item.key) ? 'check-circle-filled' : 'circle'" size="32rpx" :color="selected.includes(item.key) ? 'var(--app-primary)' : 'var(--app-text-tertiary)'" />
            <text class="ml-2 text-2.5">
              {{ item.label }}
            </text>
          </view>
        </view>

        <view v-if="result" class="mt-3 max-h-80 overflow-auto">
          <mp-html v-if="result.answer" :content="renderMarkdown(result.answer)" :tag-style="markdownTagStyle" scroll-table container-style="font-size: 26rpx; line-height: 1.7;" />
          <view v-for="(failure, index) in result.failures ?? []" :key="index" class="mt-2 text-2.5 text-[var(--app-warning)]">
            · {{ failure.message }}
          </view>
        </view>

        <view v-if="error" class="mt-2 text-2.5 text-[var(--app-danger)]">
          {{ error }}
        </view>

        <view class="mt-3 flex gap-2">
          <wd-button size="small" plain :loading="loading" @click="result = null">
            {{ result ? '重新选择' : '取消' }}
          </wd-button>
          <wd-button v-if="!result" size="small" :loading="loading" @click="compare">
            比较所选档位
          </wd-button>
        </view>
      </view>
    </wd-popup>
  </view>
</template>
