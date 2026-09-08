<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { EditIcon, AddIcon, DeleteIcon, CheckIcon } from 'tdesign-icons-vue-next'
import { MessagePlugin } from 'tdesign-vue-next'
import type { KnowledgeTocItem, KnowledgeTocStatus } from '@/types/knowledge'

const props = withDefaults(defineProps<{
  items: KnowledgeTocItem[]
  selectedId?: string | null
  editable?: boolean
  saving?: boolean
}>(), { selectedId: null, editable: false, saving: false })

const emit = defineEmits<{
  select: [item: KnowledgeTocItem]
  save: [items: KnowledgeTocItem[], confirm: boolean]
  edit: [item: KnowledgeTocItem]
  delete: [item: KnowledgeTocItem]
  add: []
}>()

const dialogVisible = ref(false)
const editing = ref<KnowledgeTocItem | null>(null)
const form = reactive({ title: '', pageLabel: '', physicalPageNumber: undefined as number | undefined, level: 1, status: 'PENDING_REVIEW' as KnowledgeTocStatus })
const localItems = computed(() => [...props.items].sort((a, b) => a.sortOrder - b.sortOrder))
const confirmedCount = computed(() => props.items.filter(item => item.status === 'CONFIRMED').length)

function openEdit(item: KnowledgeTocItem): void {
  editing.value = item
  form.title = item.title
  form.pageLabel = item.pageLabel ?? ''
  form.physicalPageNumber = item.physicalPageNumber ?? undefined
  form.level = item.level
  form.status = item.status ?? 'PENDING_REVIEW'
  dialogVisible.value = true
}

function submitEdit(): void {
  const item = editing.value
  if (!item || !form.title.trim()) {
    MessagePlugin.warning('目录标题不能为空')
    return
  }
  const next = localItems.value.map(row => row.id === item.id ? {
    ...row,
    title: form.title.trim(),
    pageLabel: form.pageLabel.trim() || null,
    physicalPageNumber: form.physicalPageNumber ?? null,
    level: form.level,
    status: form.status,
  } : row)
  dialogVisible.value = false
  emit('save', next, false)
}

function moveItem(index: number, offset: -1 | 1): void {
  const target = index + offset
  if (target < 0 || target >= localItems.value.length) return
  const next = [...localItems.value]
  const [item] = next.splice(index, 1)
  if (!item) return
  next.splice(target, 0, item)
  emit('save', next.map((row, sortOrder) => ({ ...row, sortOrder })), false)
}

function confirmAll(): void {
  emit('save', localItems.value.map((item, sortOrder) => ({ ...item, sortOrder, status: 'CONFIRMED' })), true)
}
</script>

<template>
  <div class="knowledge-toc-editor">
    <div class="knowledge-toc-editor__toolbar">
      <span>真实 PDF 目录 · 已确认 {{ confirmedCount }}/{{ items.length }} 项</span>
      <t-space v-if="editable">
        <t-button size="small" variant="outline" @click="emit('add')"><template #icon><AddIcon /></template>新增目录项</t-button>
        <t-button size="small" theme="primary" :loading="saving" @click="confirmAll"><template #icon><CheckIcon /></template>保存并确认</t-button>
      </t-space>
    </div>
    <div v-if="localItems.length === 0" class="knowledge-toc-editor__empty">暂无原文目录，请先完成文件解析。</div>
    <div v-for="(item, index) in localItems" :key="item.id" class="knowledge-toc-editor__row" :class="{ 'is-selected': selectedId === item.id }" :style="{ paddingLeft: `${12 + Math.max(0, item.level - 1) * 18}px` }" @click="emit('select', item)">
      <div class="knowledge-toc-editor__main">
        <span class="knowledge-toc-editor__title">{{ item.title }}</span>
        <span class="knowledge-toc-editor__page">{{ item.pageLabel || '未标页码' }}<template v-if="item.physicalPageNumber != null"> · 物理页 {{ item.physicalPageNumber }}</template></span>
      </div>
      <t-tag size="small" variant="outline" :theme="item.status === 'CONFIRMED' ? 'success' : 'warning'">{{ item.status === 'CONFIRMED' ? '已确认' : '待校对' }}</t-tag>
      <t-tag size="small" variant="light">{{ item.source }}</t-tag>
      <t-space v-if="editable" size="small" @click.stop>
        <t-button size="small" variant="text" :disabled="index === 0" @click="moveItem(index, -1)">上移</t-button>
        <t-button size="small" variant="text" :disabled="index === localItems.length - 1" @click="moveItem(index, 1)">下移</t-button>
        <t-button size="small" variant="text" @click="openEdit(item)"><template #icon><EditIcon /></template>编辑</t-button>
        <t-button size="small" variant="text" theme="danger" @click="emit('delete', item)"><template #icon><DeleteIcon /></template>删除</t-button>
      </t-space>
    </div>

    <t-dialog v-model:visible="dialogVisible" header="校正目录项" :confirm-btn="{ content: '保存', theme: 'primary' }" @confirm="submitEdit">
      <t-form label-align="top">
        <t-form-item label="标题" required-mark><t-input v-model="form.title" /></t-form-item>
        <t-form-item label="图集页码标签"><t-input v-model="form.pageLabel" placeholder="如 A1、A5、21" /></t-form-item>
        <t-form-item label="PDF 物理页"><t-input-number v-model="form.physicalPageNumber" :min="1" clearable /></t-form-item>
        <t-form-item label="层级"><t-input-number v-model="form.level" :min="1" :max="6" /></t-form-item>
        <t-form-item label="状态"><t-select v-model="form.status" :options="[{ label: '待校对', value: 'PENDING_REVIEW' }, { label: '已确认', value: 'CONFIRMED' }, { label: '草稿', value: 'DRAFT' }]" /></t-form-item>
      </t-form>
    </t-dialog>
  </div>
</template>

<style scoped>
.knowledge-toc-editor { display: flex; flex-direction: column; gap: 8px; }
.knowledge-toc-editor__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.knowledge-toc-editor__row { display: flex; align-items: center; gap: 8px; min-height: 44px; padding-top: 6px; padding-right: 10px; padding-bottom: 6px; border: 1px solid transparent; border-bottom-color: var(--td-component-border); cursor: pointer; }
.knowledge-toc-editor__row:hover, .knowledge-toc-editor__row.is-selected { background: var(--td-bg-color-container-hover); border-color: var(--td-brand-color-3); }
.knowledge-toc-editor__main { display: flex; min-width: 220px; flex: 1; flex-direction: column; gap: 2px; }
.knowledge-toc-editor__title { color: var(--td-text-color-primary); font-size: var(--td-font-size-body-medium); }
.knowledge-toc-editor__page { color: var(--td-text-color-secondary); font-size: var(--td-font-size-body-small); }
.knowledge-toc-editor__empty { padding: 48px 0; color: var(--td-text-color-placeholder); text-align: center; }
</style>
