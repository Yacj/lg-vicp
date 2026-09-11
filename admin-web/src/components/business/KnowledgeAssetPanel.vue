<script setup lang="ts">
import type { KnowledgeDocumentAsset, KnowledgeParseStatus, KnowledgeUsageMode } from '@/types/knowledge'
import { computed } from 'vue'

const props = defineProps<{ assets: KnowledgeDocumentAsset[], parseStatus: KnowledgeParseStatus, usageMode: KnowledgeUsageMode, editable?: boolean, loading?: boolean }>()
const emit = defineEmits<{ preview: [asset: KnowledgeDocumentAsset], replace: [role: 'ORIGINAL' | 'SEARCH_SOURCE'], usageModeChange: [mode: KnowledgeUsageMode] }>()
const original = computed(() => props.assets.find(item => item.role === 'ORIGINAL') ?? null)
const searchSource = computed(() => props.assets.find(item => item.role === 'SEARCH_SOURCE') ?? original.value)
const noTextLayer = computed(() => props.parseStatus === 'NO_TEXT_LAYER' || props.parseStatus === 'SEARCH_SOURCE_REQUIRED')
</script>

<template>
  <div class="knowledge-assets">
    <t-alert v-if="noTextLayer" theme="warning" title="当前文件读不出文字">
      这个 PDF 可以查看，但系统读不出其中的文字。请补充一份可搜索文字版本，或改为只查看原文件。
    </t-alert>
    <div class="knowledge-assets__grid">
      <article v-for="item in [{ role: 'ORIGINAL' as const, label: '知识文件', purpose: '查看原文件', asset: original }, { role: 'SEARCH_SOURCE' as const, label: '可搜索文字版本', purpose: '给提问使用', asset: searchSource }]" :key="item.role" class="knowledge-assets__card">
        <div class="knowledge-assets__head"><strong>{{ item.label }}</strong><t-tag size="small" variant="outline" :theme="item.asset ? 'success' : 'warning'">{{ item.asset ? '已准备好' : '还没有' }}</t-tag></div>
        <div class="knowledge-assets__name">{{ item.asset?.fileName ?? '还没有文件' }}</div>
        <div class="knowledge-assets__purpose">用途：{{ item.purpose }}<template v-if="item.role === 'SEARCH_SOURCE' && searchSource === original && original">（当前和知识文件是同一份）</template></div>
        <t-space v-if="item.asset" size="small"><t-button size="small" variant="text" theme="primary" @click="emit('preview', item.asset!)">预览</t-button><t-button v-if="editable" size="small" variant="text" @click="emit('replace', item.role)">替换</t-button></t-space>
        <t-button v-else-if="editable" size="small" variant="outline" @click="emit('replace', item.role)">绑定文件</t-button>
      </article>
    </div>
    <div class="knowledge-assets__mode">
      <span>这份知识库怎么用</span>
      <t-select
        :value="usageMode"
        :disabled="!editable"
        :options="[{ label: '可以提问', value: 'AI_ENABLED' }, { label: '只查看原文件', value: 'BROWSE_ONLY' }]"
        style="width: 160px"
        @change="(value: unknown) => emit('usageModeChange', value as KnowledgeUsageMode)"
      />
    </div>
    <t-alert v-if="usageMode === 'BROWSE_ONLY'" theme="info" message="当前只用来查看原文件，提问时不会用到这份知识库。" />
  </div>
</template>

<style scoped>
.knowledge-assets__mode { display: flex; align-items: center; gap: 8px; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.knowledge-assets { display: flex; flex-direction: column; gap: 12px; }
.knowledge-assets__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.knowledge-assets__card { display: flex; min-width: 0; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--td-component-border); background: var(--td-bg-color-container); }
.knowledge-assets__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.knowledge-assets__name { overflow: hidden; color: var(--td-text-color-primary); text-overflow: ellipsis; white-space: nowrap; }
.knowledge-assets__purpose { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
@media (max-width: 760px) { .knowledge-assets__grid { grid-template-columns: 1fr; } }
</style>
