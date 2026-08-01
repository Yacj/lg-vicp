<script setup lang="ts">
import type { CheckboxGroupValue, PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { useFullscreen } from '@vueuse/core'
import {
  FullscreenExitIcon,
  FullscreenIcon,
  RefreshIcon,
  SettingIcon,
} from 'tdesign-icons-vue-next'
import { computed, ref, useSlots, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import AppEmptyState from './AppEmptyState.vue'
import AppErrorState from './AppErrorState.vue'
import AppPageToolbar from './AppPageToolbar.vue'

export type AppDataTableStatus = 'ready' | 'loading' | 'error'

const props = withDefaults(defineProps<{
  rowKey: string
  columns: PrimaryTableCol<TableRowData>[]
  data?: TableRowData[]
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
  operationsTitle?: string
  operationsWidth?: string | number
  showToolbar?: boolean
  showRefresh?: boolean
  showColumnController?: boolean
  showFullscreen?: boolean
  showPagination?: boolean
  bordered?: boolean
  stripe?: boolean
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
  maxHeight: 560,
  tableContentWidth: '100%',
  displayColumns: undefined,
  operationsTitle: '操作',
  operationsWidth: 160,
  showToolbar: true,
  showRefresh: true,
  showColumnController: true,
  showFullscreen: true,
  showPagination: true,
  bordered: false,
  stripe: true,
})

const emit = defineEmits<{
  'refresh': []
  'retry': []
  'page-change': [pageInfo: PageInfo]
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
const hasOperations = computed(() => Boolean(slots.operations))
const resolvedColumns = computed<PrimaryTableCol<TableRowData>[]>(() => {
  if (!hasOperations.value) {
    return props.columns
  }
  return [
    ...props.columns,
    {
      colKey: '__operations',
      title: props.operationsTitle,
      fixed: 'right',
      width: props.operationsWidth,
      cell: (_h, context) => slots.operations?.(context),
    },
  ]
})
const displayColumnProps = computed(() => internalDisplayColumns.value.length > 0
  ? { displayColumns: internalDisplayColumns.value }
  : {})
const resolvedMaxHeight = computed(() => isFullscreen.value ? 'calc(100vh - 176px)' : props.maxHeight)
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
      <t-primary-table
        :bordered="bordered"
        :column-controller="{ hideTriggerButton: true }"
        :column-controller-visible="columnControllerVisible"
        :columns="resolvedColumns"
        :data="data"
        v-bind="displayColumnProps"
        hover
        :loading="status === 'loading'"
        :max-height="resolvedMaxHeight"
        :row-key="rowKey"
        :size="size"
        :stripe="stripe"
        :table-content-width="tableContentWidth"
        @column-controller-visible-change="handleColumnControllerVisibleChange"
        @display-columns-change="handleDisplayColumnsChange"
      >
        <template #empty>
          <AppEmptyState :description="emptyDescription" :title="emptyTitle" />
        </template>
      </t-primary-table>

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
  min-width: 0;
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.app-data-table.is-fullscreen {
  width: 100vw;
  height: 100vh;
  overflow: auto;
  border: 0;
  border-radius: 0;
}

.app-data-table :deep(.app-page-toolbar) {
  margin-bottom: var(--td-size-4);
}

.app-data-table :deep(.t-table__content) {
  overflow-x: auto;
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