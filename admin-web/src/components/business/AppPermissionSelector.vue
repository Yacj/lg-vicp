<script setup lang="ts">
import type { TreeNodeModel, TreeNodeValue, TreeOptionData } from 'tdesign-vue-next'
import { computed, ref, watch } from 'vue'
import type { CrudKey, CrudPermissionOption } from '@/types/crud'

const props = withDefaults(defineProps<{
  modelValue: CrudKey[]
  options?: CrudPermissionOption[]
  checkStrictly?: boolean
  clearText?: string
  disabled?: boolean
  emptyText?: string
  loading?: boolean
  maxHeight?: string | number
  searchable?: boolean
  searchPlaceholder?: string
  selectAllText?: string
  showCount?: boolean
  showExpandToggle?: boolean
  allExpanded?: boolean
  expandAllText?: string
  collapseAllText?: string
}>(), {
  options: () => [],
  checkStrictly: false,
  clearText: '清空',
  disabled: false,
  emptyText: '暂无可选权限',
  loading: false,
  maxHeight: 360,
  searchable: true,
  searchPlaceholder: '搜索权限',
  selectAllText: '全选',
  showCount: true,
  showExpandToggle: true,
  allExpanded: true,
  expandAllText: '展开全部',
  collapseAllText: '全部收起',
})

const emit = defineEmits<{
  'update:modelValue': [value: CrudKey[]]
  'change': [value: CrudKey[]]
}>()

const keyword = ref('')
const expandedKeys = ref<CrudKey[]>([])
const treeData = computed<TreeOptionData<CrudKey>[]>(() => mapOptions(props.options))
const selectableKeys = computed(() => collectSelectableKeys(props.options))
const allKeys = computed(() => collectAllKeys(props.options))
const selectedCount = computed(() => {
  const selectable = new Set(selectableKeys.value)
  return new Set(props.modelValue.filter(value => selectable.has(value))).size
})

watch(
  () => props.allExpanded,
  (allExpanded) => {
    expandedKeys.value = allExpanded ? [...allKeys.value] : []
  },
  { immediate: true },
)

function mapOptions(options: CrudPermissionOption[]): TreeOptionData<CrudKey>[] {
  return options.map(option => ({
    children: option.children ? mapOptions(option.children) : undefined,
    description: option.description,
    disabled: option.disabled,
    label: option.label,
    value: option.value,
  }))
}

function collectSelectableKeys(options: CrudPermissionOption[]): CrudKey[] {
  return options.flatMap((option) => {
    const current = option.disabled ? [] : [option.value]
    return option.children
      ? [...current, ...collectSelectableKeys(option.children)]
      : current
  })
}

function collectAllKeys(options: CrudPermissionOption[]): CrudKey[] {
  return options.flatMap(option => [
    option.value,
    ...collectAllKeys(option.children ?? []),
  ])
}

function updateValue(value: CrudKey[]): void {
  const normalized = [...new Set(value)]
  emit('update:modelValue', normalized)
  emit('change', normalized)
}

function handleChange(value: TreeNodeValue[]): void {
  updateValue(value)
}

function handleExpand(value: TreeNodeValue[]): void {
  expandedKeys.value = value
}

function selectAll(): void {
  updateValue(selectableKeys.value)
}

function clear(): void {
  updateValue([])
}

function toggleExpandAll(): void {
  expandedKeys.value = expandedKeys.value.length > 0 ? [] : [...allKeys.value]
}

function filterNode(node: TreeNodeModel<TreeOptionData<CrudKey>>): boolean {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) {
    return true
  }
  const label = String(node.data.label ?? '').toLocaleLowerCase()
  const description = String(node.data.description ?? '').toLocaleLowerCase()
  return label.includes(query) || description.includes(query)
}
</script>

<template>
  <section class="app-permission-selector">
    <header class="app-permission-selector__toolbar">
      <t-input
        v-if="searchable"
        v-model="keyword"
        clearable
        :disabled="disabled || loading"
        :placeholder="searchPlaceholder"
      />
      <span v-if="showCount" class="app-permission-selector__count">
        已选择 {{ selectedCount }} 项
      </span>
      <t-button
        v-if="showExpandToggle"
        :disabled="disabled || loading || allKeys.length === 0"
        theme="default"
        variant="text"
        @click="toggleExpandAll"
      >
        {{ expandedKeys.length > 0 ? collapseAllText : expandAllText }}
      </t-button>
      <t-button
        :disabled="disabled || loading || selectableKeys.length === 0"
        theme="default"
        variant="text"
        @click="selectAll"
      >
        {{ selectAllText }}
      </t-button>
      <t-button
        :disabled="disabled || loading || modelValue.length === 0"
        theme="default"
        variant="text"
        @click="clear"
      >
        {{ clearText }}
      </t-button>
    </header>

    <div class="app-permission-selector__body">
      <t-loading :loading="loading" size="small">
        <t-tree
          :allow-fold-node-on-filter="true"
          :check-strictly="checkStrictly"
          checkable
          :data="treeData"
          :disabled="disabled"
          :empty="emptyText"
          :expanded="expandedKeys"
          :filter="filterNode"
          hover
          :max-height="maxHeight"
          :model-value="modelValue"
          value-mode="all"
          @change="handleChange"
          @expand="handleExpand"
        />
      </t-loading>
    </div>
  </section>
</template>

<style scoped>
.app-permission-selector {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-permission-selector__toolbar {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-2);
  padding: var(--td-size-3);
  border-bottom: 1px solid var(--td-component-stroke);
}

.app-permission-selector__toolbar :deep(.t-input__wrap) {
  min-width: 160px;
  flex: 1;
}

.app-permission-selector__count {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.app-permission-selector__body {
  min-height: 160px;
  padding: var(--td-size-3);
}

.app-permission-selector__body :deep(.t-loading) {
  width: 100%;
}

@media (max-width: 640px) {
  .app-permission-selector__toolbar {
    align-items: stretch;
    flex-wrap: wrap;
  }

  .app-permission-selector__toolbar :deep(.t-input__wrap) {
    width: 100%;
    flex-basis: 100%;
  }
}
</style>