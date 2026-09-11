<script setup lang="ts">
import type { DropdownOption } from 'tdesign-vue-next'
import { ArrowLeftIcon, ChevronDownIcon } from 'tdesign-icons-vue-next'
import { computed } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { KnowledgeUserStatus } from '@/types/knowledge'
import { knowledgeDocTypeLabel, knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'

export interface KnowledgeHeaderAction {
  key: string
  label: string
  disabled?: boolean
  theme?: 'default' | 'error'
}

const props = withDefaults(defineProps<{
  title: string
  docType?: string | null
  categoryName?: string | null
  userStatus?: KnowledgeUserStatus | string | null
  pageCount?: number | null
  chapterCount?: number | null
  canPreview?: boolean
  canTest?: boolean
  moreActions?: KnowledgeHeaderAction[]
}>(), {
  docType: '',
  categoryName: '',
  userStatus: null,
  pageCount: null,
  chapterCount: null,
  canPreview: false,
  canTest: false,
  moreActions: () => [],
})

const emit = defineEmits<{
  back: []
  preview: []
  test: []
  more: [key: string]
}>()

const statusMeta = computed(() => knowledgeUserStatusMetaFor(props.userStatus))
const subtitle = computed(() => [knowledgeDocTypeLabel(props.docType), props.categoryName].filter(Boolean).join(' · '))
const summary = computed(() => {
  const parts: string[] = []
  if (props.pageCount != null && props.pageCount > 0) {
    parts.push(`${props.pageCount} 页`)
  }
  if (props.chapterCount != null && props.chapterCount > 0) {
    parts.push(`${props.chapterCount} 个章节`)
  }
  return parts.join(' · ')
})
const dropdownOptions = computed<DropdownOption[]>(() => props.moreActions.map(action => ({
  content: action.label,
  disabled: action.disabled,
  theme: action.theme === 'error' ? 'error' : 'default',
  value: action.key,
})))

function onMore(option: DropdownOption['value']): void {
  if (typeof option !== 'object' || option === null) {
    return
  }
  const key = String(option.value ?? '')
  if (key) {
    emit('more', key)
  }
}
</script>

<template>
  <header class="knowledge-workspace-header">
    <div class="knowledge-workspace-header__leading">
      <t-button theme="default" variant="text" @click="emit('back')">
        <template #icon>
          <ArrowLeftIcon />
        </template>
        知识库
      </t-button>
      <div class="knowledge-workspace-header__titles">
        <h1>{{ title }}</h1>
        <p v-if="subtitle">
          {{ subtitle }}
        </p>
      </div>
    </div>

    <div class="knowledge-workspace-header__status">
      <AppStatusTag :label="statusMeta.label" :status="statusMeta.status" />
      <span v-if="summary">{{ summary }}</span>
    </div>

    <div class="knowledge-workspace-header__actions">
      <t-button v-if="canPreview" theme="default" variant="outline" @click="emit('preview')">
        查看原文件
      </t-button>
      <t-button v-if="canTest" theme="primary" @click="emit('test')">
        测试知识库
      </t-button>
      <t-dropdown
        v-if="moreActions.length > 0"
        :options="dropdownOptions"
        placement="bottom-right"
        trigger="click"
        @click="onMore"
      >
        <t-button theme="default" variant="outline">
          更多
          <template #suffix>
            <ChevronDownIcon />
          </template>
        </t-button>
      </t-dropdown>
    </div>
  </header>
</template>

<style scoped>
.knowledge-workspace-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--td-size-4);
  padding: var(--td-comp-paddingTB-m) var(--td-size-6);
  background: var(--vicp-bg-surface);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
}

.knowledge-workspace-header__leading {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: var(--td-size-4);
}

.knowledge-workspace-header__titles {
  min-width: 0;
}

.knowledge-workspace-header__titles h1,
.knowledge-workspace-header__titles p {
  margin: 0;
}

.knowledge-workspace-header__titles h1 {
  overflow: hidden;
  color: var(--td-text-color-primary);
  font-size: var(--vicp-page-title-size);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-workspace-header__titles p,
.knowledge-workspace-header__status span {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.knowledge-workspace-header__status,
.knowledge-workspace-header__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: var(--td-size-3);
}

@media (max-width: 1280px) {
  .knowledge-workspace-header {
    flex-wrap: wrap;
  }

  .knowledge-workspace-header__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
