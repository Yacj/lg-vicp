<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppTableActions from '@/components/business/AppTableActions.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { deleteKnowledgeDocument, fetchKnowledgeDocuments } from '@/api/modules/knowledge'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeDocument, KnowledgeDocType, KnowledgeUserStatus } from '@/types/knowledge'
import { knowledgeDocTypes, knowledgeUserStatuses } from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeDocTypeLabel, knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'

const { canAccess } = usePermissionAccess()
const router = useRouter()
const canAdd = computed(() => canAccess({ permissions: ['system:knowledge:doc:add'] }))
const canRemove = computed(() => canAccess({ permissions: ['system:knowledge:doc:remove'] }))
const canViewDetail = computed(() => canAccess({ permissions: ['system:knowledge:doc:list'] }))
const keyword = ref('')
const docType = ref<KnowledgeDocType | undefined>()
const userStatus = ref<KnowledgeUserStatus | undefined>()
const moreExpanded = ref(false)
const sourceOrg = ref('')
const query = reactive({ page: 1, pageSize: 20 })
const documents = ref<KnowledgeDocument[]>([])
const total = ref(0)
const isLoading = ref(false)
const error = ref<unknown>(null)
const createVisible = ref(false)
const viewMode = ref<'card' | 'list'>('card')

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const searchKeyword = keyword.value.trim() || sourceOrg.value.trim()
    const result = await fetchKnowledgeDocuments({
      page: query.page, pageSize: query.pageSize,
      ...(searchKeyword ? { keyword: searchKeyword } : {}),
      ...(docType.value ? { docType: docType.value } : {}),
      ...(userStatus.value ? { userStatus: userStatus.value } : {}),
    })
    documents.value = result.items
    total.value = result.total
  }
  catch (cause) { error.value = cause }
  finally { isLoading.value = false }
}

onMounted(() => void load())
function search(): void { query.page = 1; void load() }
function reset(): void {
  keyword.value = ''; docType.value = undefined; userStatus.value = undefined; sourceOrg.value = ''; query.page = 1; void load()
}
function onPageChange(info: PageInfo): void {
  query.page = info.current
  if (info.pageSize) query.pageSize = info.pageSize
  void load()
}
function openDetail(id: string): void { void router.push({ name: 'KnowledgeDocumentDetail', params: { id } }) }
const deleteAction = useConfirmedCrudAction<KnowledgeDocument, unknown>({
  action: row => deleteKnowledgeDocument(row.id),
  confirm: row => ({ title: '删除知识库', content: `确定删除「${row.title}」？解析内容和历史版本将一并清理。`, danger: true }),
  successMessage: '已删除', onSuccess: () => load(),
})
const errorDescription = computed(() => error.value ? normalizeFeedbackError(error.value).message : '请检查网络连接后重试')
const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'title', minWidth: 280, title: '知识库', cell: (_, { row }) => h('div', { class: 'vicp-doc-title' }, (row as KnowledgeDocument).title) },
  { colKey: 'docType', minWidth: 120, title: '类型', cell: (_, { row }) => knowledgeDocTypeLabel((row as KnowledgeDocument).docType) },
  { colKey: 'userStatus', minWidth: 160, title: '解析状态', cell: (_, { row }) => { const meta = knowledgeUserStatusMetaFor((row as KnowledgeDocument).userStatus); return h(AppStatusTag, { label: meta.label, status: meta.status }) } },
  { colKey: 'pageCount', minWidth: 90, title: '页数', cell: (_, { row }) => (row as KnowledgeDocument).currentVersion?.pageCount != null ? `${(row as KnowledgeDocument).currentVersion?.pageCount} 页` : '—' },
  { colKey: 'updatedAt', minWidth: 130, title: '更新时间', cell: (_, { row }) => formatDate(new Date((row as KnowledgeDocument).updatedAt), 'YYYY-MM-DD') },
]
function getActions(row: TableRowData): AppTableAction[] {
  const entity = row as KnowledgeDocument
  const actions: AppTableAction[] = []
  if (canViewDetail.value) actions.push({ key: 'view', label: '查看图库', handler: () => openDetail(entity.id) })
  if (canRemove.value) actions.push({ key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger', handler: () => deleteAction.run(entity) })
  return actions
}
function statusMeta(document: KnowledgeDocument) { return knowledgeUserStatusMetaFor(document.userStatus) }
function pageCount(document: KnowledgeDocument): string { return document.currentVersion?.pageCount != null ? `${document.currentVersion.pageCount} 页` : '页数待整理' }
function coverKind(document: KnowledgeDocument): string {
  const title = document.title.toLowerCase()
  if (title.endsWith('.pdf')) return 'PDF'
  if (title.endsWith('.docx') || title.endsWith('.doc')) return 'Word'
  return knowledgeDocTypeLabel(document.docType)
}
</script>

<template>
  <AppPage description="管理图集、标准、产品资料等知识内容。解析完成后，提问时就能用到。" title="知识库">
    <template #search>
      <AppSearchPanel :collapsible="true" :expanded="moreExpanded" :loading="isLoading" @reset="reset" @search="search" @update:expanded="(value: boolean) => moreExpanded = value">
        <t-form-item label="关键词"><t-input v-model="keyword" clearable placeholder="知识库名称 / 编号" /></t-form-item>
        <t-form-item label="类型"><t-select v-model="docType" :options="knowledgeDocTypes.map(value => ({ label: knowledgeDocTypeLabel(value), value }))" clearable placeholder="全部" /></t-form-item>
        <t-form-item label="解析状态"><t-select v-model="userStatus" :options="knowledgeUserStatuses.map(value => ({ label: knowledgeUserStatusMetaFor(value).label, value }))" clearable placeholder="全部" /></t-form-item>
        <template #advanced><t-form-item label="来源机构"><t-input v-model="sourceOrg" clearable placeholder="来源机构" /></t-form-item></template>
      </AppSearchPanel>
    </template>
    <div class="knowledge-list-toolbar">
      <span class="knowledge-list-toolbar__count">共 {{ total }} 份资料</span>
      <div class="knowledge-list-toolbar__actions">
        <t-radio-group v-model="viewMode" variant="default-filled" size="small">
          <t-radio-button value="card">卡片</t-radio-button><t-radio-button value="list">列表</t-radio-button>
        </t-radio-group>
        <t-button v-if="canAdd" theme="primary" @click="createVisible = true"><template #icon><AddIcon /></template>新建知识库</t-button>
      </div>
    </div>
    <div v-if="viewMode === 'card'" class="knowledge-card-grid" :class="{ 'is-loading': isLoading }">
      <div v-for="document in documents" :key="document.id" class="knowledge-card" role="button" tabindex="0" @click="openDetail(document.id)" @keydown.enter="openDetail(document.id)">
        <div class="knowledge-card__cover">
          <img v-if="document.coverImageUrl" :alt="`${document.title}封面`" :src="document.coverImageUrl">
          <div v-else class="knowledge-card__placeholder">
            <span class="knowledge-card__placeholder-kind">{{ coverKind(document) }}</span>
          </div>
        </div>
        <div class="knowledge-card__body">
          <div class="knowledge-card__title" :title="document.title">{{ document.title }}</div>
          <div class="knowledge-card__meta"><span>{{ knowledgeDocTypeLabel(document.docType) }}</span><span>{{ pageCount(document) }}</span></div>
          <div class="knowledge-card__footer"><AppStatusTag :label="statusMeta(document).label" :status="statusMeta(document).status" /><span>{{ formatDate(new Date(document.updatedAt), 'YYYY-MM-DD') }}</span></div>
        </div>
      </div>
      <div v-if="!isLoading && documents.length === 0" class="knowledge-card-grid__empty">{{ errorDescription }}</div>
    </div>
    <AppDataTable v-else :columns="columns" :current="query.page" :data="documents" empty-description="上传图集、标准、产品资料后，系统会自动整理章节和内容。" empty-title="还没有知识库" :error-description="errorDescription" :operations-width="140" :page-size="query.pageSize" row-key="id" :status="isLoading ? 'loading' : error ? 'error' : 'ready'" :total="total" @page-change="onPageChange" @refresh="load" @retry="load">
      <template #operations="{ row }"><AppTableActions :actions="getActions(row)" :max-visible="2" /></template>
    </AppDataTable>
    <div v-if="viewMode === 'card' && total > 0" class="knowledge-card-pagination"><t-pagination v-model="query.page" :page-size="query.pageSize" :total="total" @change="(pageInfo: PageInfo) => onPageChange(pageInfo)" /></div>
    <KnowledgeCreateDrawer v-model:visible="createVisible" @created="(id: string) => openDetail(id)" />
  </AppPage>
</template>

<style scoped>
.knowledge-list-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
.knowledge-list-toolbar__count { color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
.knowledge-list-toolbar__actions { display:flex; align-items:center; gap:12px; }
.knowledge-card-grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:16px; min-height:220px; }
.knowledge-card { display:flex; min-width:0; flex-direction:column; padding:0; border:1px solid var(--td-component-stroke); border-radius:var(--td-radius-medium); background:var(--td-bg-color-container); color:var(--td-text-color-primary); text-align:left; cursor:pointer; overflow:hidden; transition:border-color .2s, transform .2s; }
.knowledge-card:hover { border-color:var(--td-brand-color); transform:translateY(-2px); }
.knowledge-card__cover { aspect-ratio:1.55; display:grid; place-items:center; overflow:hidden; background:var(--td-bg-color-secondarycontainer); }
.knowledge-card__cover img { width:100%; height:100%; object-fit:cover; }
.knowledge-card__placeholder { color:var(--td-brand-color); font-size:42px; opacity:.5; display:grid; place-items:center; width:100%; height:100%; }
.knowledge-card__placeholder-kind { display:inline-flex; min-width:64px; justify-content:center; padding:8px 12px; border-radius:var(--td-radius-small); background:var(--td-brand-color-light); color:var(--td-brand-color); font-size:14px; font-weight:600; opacity:1; }
.knowledge-card__body { display:flex; flex-direction:column; gap:10px; padding:14px; }
.knowledge-card__title { overflow:hidden; font-weight:var(--td-font-weight-medium); text-overflow:ellipsis; white-space:nowrap; }
.knowledge-card__meta, .knowledge-card__footer { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
.knowledge-card__footer :deep(.t-tag) { flex:none; }
.knowledge-card-grid__empty { grid-column:1/-1; display:grid; place-items:center; min-height:220px; color:var(--td-text-color-secondary); }
.knowledge-card-pagination { display:flex; justify-content:flex-end; margin-top:16px; }
.vicp-doc-title { color:var(--td-text-color-primary); font-weight:var(--td-font-weight-medium); }
@media (min-width:1500px) { .knowledge-card-grid { grid-template-columns:repeat(5, minmax(0, 1fr)); } }
@media (max-width:1100px) { .knowledge-card-grid { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
@media (max-width:720px) { .knowledge-card-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; } .knowledge-list-toolbar { align-items:flex-start; flex-direction:column; } }
</style>
