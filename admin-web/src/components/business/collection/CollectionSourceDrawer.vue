<script setup lang="ts">
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { computed, h } from 'vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { CollectionSource, CollectionTask } from '@/types/collection'
import {
  collectionResultFileName,
  collectionUiStatusMeta,
} from '@/utils/collection'
import { formatDate } from '@/utils/day'

const props = withDefaults(defineProps<{
  source: CollectionSource | null
  visible: boolean
  history: readonly CollectionTask[]
  historyStatus?: 'ready' | 'loading' | 'error'
  historyError?: string
}>(), {
  historyStatus: 'ready',
  historyError: '请检查网络连接后重试',
})

const emit = defineEmits<{
  close: []
  retry: []
  openTask: [task: CollectionTask]
}>()

const columns: PrimaryTableCol<TableRowData>[] = [
  {
    colKey: 'createdAt',
    minWidth: 160,
    title: '时间',
    cell: (_, { row }) => formatDate(new Date((row as CollectionTask).createdAt), 'YYYY-MM-DD HH:mm'),
  },
  {
    colKey: 'status',
    minWidth: 100,
    title: '状态',
    cell: (_, { row }) => h(AppStatusTag, collectionUiStatusMeta((row as CollectionTask).status)),
  },
  {
    colKey: 'result',
    ellipsis: true,
    minWidth: 180,
    title: '结果',
    cell: (_, { row }) => {
      const entity = row as CollectionTask
      if (entity.status === 'FAILED') {
        return entity.errorMessage || '采集失败'
      }
      return collectionResultFileName(entity) ?? '—'
    },
  },
]

const enabledLabel = computed(() => props.source?.enabled ? '启用' : '停用')
</script>

<template>
  <t-drawer
    :close-btn="true"
    :footer="false"
    header="采集来源"
    size="min(640px, 92vw)"
    :visible="visible"
    @close="emit('close')"
    @update:visible="(value: boolean) => { if (!value) emit('close') }"
  >
    <section v-if="source" class="collection-source-drawer">
      <dl class="collection-source-drawer__meta">
        <div class="collection-source-drawer__row">
          <dt>来源名称</dt>
          <dd>{{ source.name }}</dd>
        </div>
        <div class="collection-source-drawer__row">
          <dt>来源地址</dt>
          <dd>
            <a
              class="collection-source-drawer__link"
              :href="source.sourceUrl"
              rel="noopener noreferrer"
              target="_blank"
            >{{ source.sourceUrl }}</a>
          </dd>
        </div>
        <div class="collection-source-drawer__row">
          <dt>状态</dt>
          <dd>{{ enabledLabel }}</dd>
        </div>
        <div class="collection-source-drawer__row">
          <dt>最近采集</dt>
          <dd>
            {{ source.lastCollectedAt
              ? formatDate(new Date(source.lastCollectedAt), 'YYYY-MM-DD HH:mm')
              : '尚未采集' }}
          </dd>
        </div>
      </dl>

      <h3 class="collection-source-drawer__history-title">
        采集历史
      </h3>
      <AppDataTable
        :columns="columns"
        :data="history"
        empty-description="启用后来源会按固定周期采集，新资料仍需确认入库"
        empty-title="暂无采集历史"
        :error-description="historyError"
        :operations-width="80"
        :show-pagination="false"
        :show-toolbar="false"
        row-key="id"
        :status="historyStatus"
        :total="history.length"
        @retry="emit('retry')"
      >
        <template #operations="{ row }">
          <t-button
            size="small"
            theme="primary"
            variant="text"
            @click="emit('openTask', row as CollectionTask)"
          >
            查看
          </t-button>
        </template>
      </AppDataTable>
    </section>
  </t-drawer>
</template>

<style scoped>
.collection-source-drawer {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--td-size-6);
}

.collection-source-drawer__meta {
  display: grid;
  margin: 0;
  gap: var(--td-size-4);
}

.collection-source-drawer__row {
  display: grid;
  min-width: 0;
  gap: var(--td-size-1);
}

.collection-source-drawer__row dt {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.collection-source-drawer__row dd {
  margin: 0;
  min-width: 0;
  color: var(--td-text-color-primary);
  word-break: break-all;
}

.collection-source-drawer__link {
  color: var(--td-brand-color);
}

.collection-source-drawer__history-title {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: var(--td-font-weight-medium);
}
</style>
