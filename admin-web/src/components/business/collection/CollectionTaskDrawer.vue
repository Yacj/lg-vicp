<script setup lang="ts">
import { computed, ref } from 'vue'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import type { CollectionTask } from '@/types/collection'
import { COLLECTION_PERMISSIONS } from '@/types/collection'
import {
  collectionMetaNumber,
  collectionModeLabel,
  collectionResultFileName,
  collectionResultMimeType,
  collectionRunDurationMs,
  collectionUiStatusMeta,
  isCollectionConfirmable,
  isCollectionImported,
} from '@/utils/collection'
import { formatDate } from '@/utils/day'

const props = withDefaults(defineProps<{
  task: CollectionTask | null
  visible: boolean
  importing?: boolean
}>(), {
  importing: false,
})

const emit = defineEmits<{
  close: []
  import: [task: CollectionTask]
  openKnowledge: [documentId: string]
}>()

const { canAccess } = usePermissionAccess()
const canImport = computed(() => canAccess({ permissions: [COLLECTION_PERMISSIONS.TASK_IMPORT] }))
const canViewKnowledge = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))

const previewVisible = ref(false)

const resultFileName = computed(() => props.task ? collectionResultFileName(props.task) : null)
const resultFile = computed(() => {
  if (!props.task?.resultFileId || !resultFileName.value) {
    return null
  }
  return {
    id: props.task.resultFileId,
    mimeType: collectionResultMimeType(props.task),
    originalName: resultFileName.value,
  }
})
const confirmable = computed(() => props.task ? isCollectionConfirmable(props.task) : false)
const imported = computed(() => props.task ? isCollectionImported(props.task) : false)
const knowledgeDocumentId = computed(() => props.task?.importedKnowledgeDocumentId ?? null)
const runDuration = computed(() => props.task ? collectionRunDurationMs(props.task) : null)
const visitedCount = computed(() => collectionMetaNumber(props.task?.resultMeta, 'visitedCount'))
const storedCount = computed(() => collectionMetaNumber(props.task?.resultMeta, 'storedCount'))

function close(): void {
  if (props.importing) {
    return
  }
  emit('close')
}
</script>

<template>
  <t-drawer
    :close-btn="true"
    :close-on-esc-keydown="!importing"
    :close-on-overlay-click="!importing"
    :footer="Boolean(task)"
    header="采集详情"
    size="min(480px, 92vw)"
    :visible="visible"
    @close="close"
    @update:visible="(value: boolean) => { if (!value) close() }"
  >
    <dl v-if="task" class="collection-task-drawer">
      <div class="collection-task-drawer__row">
        <dt>采集名称</dt>
        <dd>{{ task.name }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>来源地址</dt>
        <dd>
          <a
            class="collection-task-drawer__link"
            :href="task.sourceUrl"
            rel="noopener noreferrer"
            target="_blank"
          >{{ task.sourceUrl }}</a>
        </dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>采集方式</dt>
        <dd>{{ collectionModeLabel(task.mode) }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>状态</dt>
        <dd>
          <AppStatusTag v-bind="collectionUiStatusMeta(task.status)" />
        </dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>运行耗时</dt>
        <dd>{{ runDuration == null ? '—' : `${Math.round(runDuration / 1000)} 秒` }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>访问页面数</dt>
        <dd>{{ visitedCount ?? '—' }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>新增记录数</dt>
        <dd>{{ storedCount ?? '—' }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>创建时间</dt>
        <dd>{{ formatDate(new Date(task.createdAt), 'YYYY-MM-DD HH:mm') }}</dd>
      </div>
      <div class="collection-task-drawer__row">
        <dt>结果文件/内容</dt>
        <dd>
          <t-button
            v-if="resultFile"
            theme="primary"
            variant="text"
            @click="previewVisible = true"
          >
            {{ resultFileName }}
          </t-button>
          <span v-else>—</span>
        </dd>
      </div>
      <div v-if="task.status === 'FAILED'" class="collection-task-drawer__row">
        <dt>错误信息</dt>
        <dd class="collection-task-drawer__error">
          {{ task.errorMessage || '采集失败' }}
        </dd>
      </div>
    </dl>

    <template #footer>
      <div class="collection-task-drawer__footer">
        <t-button theme="default" variant="outline" @click="close">
          关闭
        </t-button>
        <t-button
          v-if="confirmable && canImport && task"
          :loading="importing"
          theme="primary"
          @click="emit('import', task)"
        >
          确认入库
        </t-button>
        <t-button
          v-else-if="imported && canViewKnowledge && knowledgeDocumentId"
          theme="primary"
          @click="emit('openKnowledge', knowledgeDocumentId)"
        >
          查看知识
        </t-button>
      </div>
    </template>
  </t-drawer>

  <AppFilePreview
    :file="resultFile"
    :visible="previewVisible"
    @close="previewVisible = false"
  />
</template>

<style scoped>
.collection-task-drawer {
  display: flex;
  margin: 0;
  flex-direction: column;
  gap: var(--td-size-5);
}

.collection-task-drawer__row {
  display: grid;
  min-width: 0;
  gap: var(--td-size-1);
}

.collection-task-drawer__row dt {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.collection-task-drawer__row dd {
  margin: 0;
  min-width: 0;
  color: var(--td-text-color-primary);
  word-break: break-all;
}

.collection-task-drawer__link {
  color: var(--td-brand-color);
}

.collection-task-drawer__error {
  color: var(--td-error-color);
}

.collection-task-drawer__footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-size-3);
}
</style>
