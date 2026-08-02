<script setup lang="ts">
import type { CheckboxGroupValue, PageInfo, PrimaryTableCellParams, PrimaryTableCol, SelectOptions, TableRowData, TableTreeConfig, TableTreeNodeExpandOptions } from 'tdesign-vue-next'
import { EnhancedTable } from 'tdesign-vue-next'
import { useFullscreen } from '@vueuse/core'
import {
  FullscreenExitIcon,
  FullscreenIcon,
  RefreshIcon,
  SettingIcon,
} from 'tdesign-icons-vue-next'
import { computed, h, ref, useSlots, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import AppEmptyState from './AppEmptyState.vue'
import AppErrorState from './AppErrorState.vue'
import AppPageToolbar from './AppPageToolbar.vue'

export type AppDataTableStatus = 'ready' | 'loading' | 'error'

const props = withDefaults(defineProps<{
  rowKey: string
  columns: PrimaryTableCol<TableRowData>[]
  data?: readonly TableRowData[]
  status?: AppDataTableStatus
  title?: string
  description?: string
  errorTitle?: string
  errorDescription?: string
  emptyTitle?: string
  emptyDescription?: string
  current?: number
  pageSize?: number
  pageSizeOptions?: number[]
  total?: number
  maxHeight?: string | number
  tableContentWidth?: string
  displayColumns?: Array<string | number>
  selectedRowKeys?: Array<string | number>
  rowSelectionType?: 'single' | 'multiple'
  selectionWidth?: string | number
  selectionDisabled?: (row: TableRowData) => boolean
  reserveSelectedRowOnPaginate?: boolean
  selectOnRowClick?: boolean
  operationsTitle?: string
  operationsWidth?: string | number
  showToolbar?: boolean
  showRefresh?: boolean
  showColumnController?: boolean
  showFullscreen?: boolean
  showPagination?: boolean
  bordered?: boolean
  stripe?: boolean
  tree?: TableTreeConfig
  expandedTreeNodes?: Array<string | number>
}>(), {
  data: () => [],
  status: 'ready',
  title: '',
  description: '',
  errorTitle: '数据加载失败',
  errorDescription: '请检查网络连接后重试',
  emptyTitle: '暂无数据',
  emptyDescription: '',
  current: 1,
  pageSize: 20,
  pageSizeOptions: () => [10, 20, 50, 100],
  total: 0,
  maxHeight: undefined,
  tableContentWidth: '100%',
  displayColumns: undefined,
  selectedRowKeys: () => [],
  rowSelectionType: undefined,
  selectionWidth: 48,
  reserveSelectedRowOnPaginate: false,
  selectOnRowClick: false,
  operationsTitle: '操作',
  operationsWidth: 210,
  showToolbar: true,
  showRefresh: true,
  showColumnController: true,
  showFullscreen: true,
  showPagination: true,
  bordered: false,
  stripe: true,
  tree: undefined,
  expandedTreeNodes: undefined,
})

const emit = defineEmits<{
  'refresh': []
  'retry': []
  'page-change': [pageInfo: PageInfo]
  'selection-change': [selectedRowKeys: Array<string | number>, options: SelectOptions<TableRowData>]
  'expanded-tree-nodes-change': [expandedTreeNodes: Array<string | number>, options: TableTreeNodeExpandOptions<TableRowData>]
  'display-columns-change': [columns: Array<string | number>]
}>()

const slots = useSlots()
const settingsStore = useSettingsStore()
const containerRef = ref<HTMLElement | null>(null)
const columnControllerVisible = ref(false)
const internalDisplayColumns = ref<Array<string | number>>(props.displayColumns ? [...props.displayColumns] : [])
const { isFullscreen, isSupported: fullscreenSupported, toggle: toggleFullscreen } = useFullscreen(containerRef)

watch(
  () => props.displayColumns,
  value => {
    internalDisplayColumns.value = value ? [...value] : []
  },
)

const size = computed(() => settingsStore.settings.density === 'compact' ? 'small' : 'medium')
const resolvedData = computed<TableRowData[]>(() => [...props.data])
const hasOperations = computed(() => Boolean(slots.operations))
const resolvedColumns = computed<PrimaryTableCol<TableRowData>[]>(() => [
  ...(props.rowSelectionType
    ? [{
        colKey: '__selection',
        fixed: 'left' as const,
        type: props.rowSelectionType,
        width: props.selectionWidth,
        ...(props.selectionDisabled
          ? { disabled: ({ row }: { row: TableRowData }) => props.selectionDisabled!(row) }
          : {}),
      }]
    : []),
  ...props.columns,
  ...(hasOperations.value
    ? [{
        cell: (_h: unknown, context: PrimaryTableCellParams<TableRowData>) => h('div', {
          class: 'app-data-table__operations-cell',
          onClick: (event: MouseEvent) => event.stopPropagation(),
        }, slots.operations?.(context)),
        colKey: '__operations',
        fixed: 'right' as const,
        title: props.operationsTitle,
        width: props.operationsWidth,
      }]
    : []),
])
const controlledTableProps = computed(() => ({
  ...(internalDisplayColumns.value.length > 0
    ? { displayColumns: internalDisplayColumns.value }
    : {}),
  ...(props.tree ? {
      expandedTreeNodes: props.expandedTreeNodes,
      tree: props.tree,
    } : {}),
  ...(props.rowSelectionType
    ? {
        reserveSelectedRowOnPaginate: props.reserveSelectedRowOnPaginate,
        rowSelectionType: props.rowSelectionType,
        selectOnRowClick: props.selectOnRowClick,
        selectedRowKeys: props.selectedRowKeys,
      }
    : {}),
}))
const resolvedMaxHeight = computed(() => props.maxHeight)
const hasToolbar = computed(() => props.showToolbar && (
  props.title
  || props.description
  || Boolean(slots.toolbar)
  || props.showRefresh
  || props.showColumnController
  || props.showFullscreen
))

function handlePageChange(pageInfo: PageInfo): void {
  emit('page-change', pageInfo)
}

function handleSelectionChange(
  selectedRowKeys: Array<string | number>,
  options: SelectOptions<TableRowData>,
): void {
  emit('selection-change', selectedRowKeys, options)
}

function handleExpandedTreeNodesChange(
  expandedTreeNodes: Array<string | number>,
  options: TableTreeNodeExpandOptions<TableRowData>,
): void {
  emit('expanded-tree-nodes-change', expandedTreeNodes, options)
}

function handleDisplayColumnsChange(value: CheckboxGroupValue): void {
  const columns = value.filter((column): column is string | number => typeof column !== 'boolean')
  internalDisplayColumns.value = [...columns]
  emit('display-columns-change', [...columns])
}

function handleColumnControllerVisibleChange(visible: boolean): void {
  columnControllerVisible.value = visible
}
</script>

<template>
  <section ref="containerRef" class="app-data-table" :class="{ 'is-fullscreen': isFullscreen }">
    <AppPageToolbar v-if="hasToolbar" :description="description" :title="title" divided>
      <slot name="toolbar" />
      <template #actions>
        <t-tooltip v-if="showRefresh" content="刷新" placement="top">
          <t-button aria-label="刷新表格" :loading="status === 'loading'" shape="square" theme="default" variant="text" @click="emit('refresh')">
            <RefreshIcon />
          </t-button>
        </t-tooltip>
        <t-tooltip v-if="showColumnController" content="列设置" placement="top">
          <t-button aria-label="设置显示列" shape="square" theme="default" variant="text" @click="columnControllerVisible = true">
            <SettingIcon />
          </t-button>
        </t-tooltip>
        <t-tooltip v-if="showFullscreen" :content="isFullscreen ? '退出全屏' : '全屏'" placement="top">
          <t-button
            :aria-label="isFullscreen ? '退出全屏表格' : '全屏表格'"
            :disabled="!fullscreenSupported"
            shape="square"
            theme="default"
            variant="text"
            @click="toggleFullscreen"
          >
            <FullscreenExitIcon v-if="isFullscreen" />
            <FullscreenIcon v-else />
          </t-button>
        </t-tooltip>
      </template>
    </AppPageToolbar>

    <AppErrorState
      v-if="status === 'error'"
      :description="errorDescription"
      :title="errorTitle"
      @action="emit('retry')"
    />

    <template v-else>
      <EnhancedTable
        :bordered="bordered"
        :column-controller="{ hideTriggerButton: true }"
        :column-controller-visible="columnControllerVisible"
        :columns="resolvedColumns"
        :data="resolvedData"
        v-bind="controlledTableProps"
        hover
        :loading="status === 'loading'"
        :max-height="resolvedMaxHeight"
        :row-key="rowKey"
        :size="size"
        :stripe="stripe"
        :table-content-width="tableContentWidth"
        @column-controller-visible-change="handleColumnControllerVisibleChange"
        @display-columns-change="handleDisplayColumnsChange"
        @expanded-tree-nodes-change="handleExpandedTreeNodesChange"
        @select-change="handleSelectionChange"
      >
        <template #empty>
          <AppEmptyState :description="emptyDescription" :title="emptyTitle" />
        </template>
      </EnhancedTable>

      <footer v-if="showPagination" class="app-data-table__pagination">
        <span class="app-data-table__total">共 {{ total }} 条</span>
        <t-pagination
          :current="current"
          :page-size="pageSize"
          :page-size-options="pageSizeOptions"
          :show-jumper="true"
          :show-page-size="true"
          :size="size"
          :total="total"
          :total-content="false"
          @change="handlePageChange"
        />
      </footer>
    </template>
  </section>
</template>

<style scoped>
.app-data-table {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-data-table.is-fullscreen {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  border: 0;
  border-radius: 0;
}

.app-data-table :deep(.app-page-toolbar) {
  margin-bottom: var(--td-size-4);
}

.app-data-table :deep(.t-table) {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.app-data-table :deep(.t-table__content) {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
}

.app-data-table__operations-cell {
  display: inline-flex;
  min-width: 0;
  align-items: center;
}

.app-data-table__pagination {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding-top: var(--td-size-4);
}

.app-data-table__total {
  flex: 0 0 auto;
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

@media (max-width: 720px) {
  .app-data-table__pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>