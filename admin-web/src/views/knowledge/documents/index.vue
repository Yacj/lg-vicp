<script setup lang="ts">
import type { PageInfo, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import type { AppTableAction } from '@/types/crud'
import type { KnowledgeDocType, KnowledgeDocument, KnowledgeUserStatus } from '@/types/knowledge'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, h, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { deleteKnowledgeDocument, fetchKnowledgeDocuments } from '@/api/modules/knowledge'
import AppTableActions from '@/components/business/AppTableActions.vue'
import KnowledgeCreateDrawer from '@/components/business/knowledge/KnowledgeCreateDrawer.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppPage from '@/components/ui/AppPage.vue'
import AppSearchPanel from '@/components/ui/AppSearchPanel.vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import { useConfirmedCrudAction } from '@/composables/useCrudActions'
import { usePermissionAccess } from '@/composables/usePermissionAccess'
import { knowledgeDocTypes, knowledgeUserStatuses } from '@/types/knowledge'
import { businessUserError } from '@/utils/business-error'
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
const failedCoverIds = ref<Set<string>>(new Set())

async function load(): Promise<void> {
  isLoading.value = true
  error.value = null
  try {
    const searchKeyword = keyword.value.trim() || sourceOrg.value.trim()
    const result = await fetchKnowledgeDocuments({
      page: query.page,
      pageSize: query.pageSize,
      ...(searchKeyword ? { keyword: searchKeyword } : {}),
      ...(docType.value ? { docType: docType.value } : {}),
      ...(userStatus.value ? { userStatus: userStatus.value } : {}),
    })
    documents.value = result.items
    total.value = result.total
    failedCoverIds.value = new Set()
  }
  catch (cause) {
    error.value = cause
  }
  finally {
    isLoading.value = false
  }
}

onMounted(() => void load())
function search(): void { query.page = 1; void load() }
function reset(): void {
  keyword.value = ''
  docType.value = undefined
  userStatus.value = undefined
  sourceOrg.value = ''
  query.page = 1
  void load()
}
function onPageChange(info: PageInfo): void {
  query.page = info.current
  if (info.pageSize) {
    query.pageSize = info.pageSize
  }
  void load()
}
function openDetail(id: string): void {
  if (canViewDetail.value) {
    void router.push({ name: 'KnowledgeDocumentDetail', params: { id } })
  }
}
const deleteAction = useConfirmedCrudAction<KnowledgeDocument, unknown>({
  action: row => deleteKnowledgeDocument(row.id),
  confirm: row => ({ title: '删除知识库', content: `确定删除「${row.title}」？解析内容和历史版本将一并清理。`, danger: true }),
  successMessage: '已删除',
  onSuccess: () => load(),
})
const errorDescription = computed(() => businessUserError(error.value))
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
  if (canViewDetail.value) {
    actions.push({ key: 'view', label: '查看图库', handler: () => openDetail(entity.id) })
  }
  if (canRemove.value) {
    actions.push({ key: 'remove', label: '删除', loading: deleteAction.running.value, theme: 'danger', handler: () => deleteAction.run(entity) })
  }
  return actions
}
function statusMeta(document: KnowledgeDocument) { return knowledgeUserStatusMetaFor(document.userStatus) }
function pageCount(document: KnowledgeDocument): string { return document.currentVersion?.pageCount != null ? `${document.currentVersion.pageCount} 页` : '页数待整理' }
function coverKind(document: KnowledgeDocument): string {
  const title = document.title.toLowerCase()
  if (title.endsWith('.pdf')) {
    return 'PDF'
  }
  if (title.endsWith('.docx') || title.endsWith('.doc')) {
    return 'Word'
  }
  return knowledgeDocTypeLabel(document.docType)
}
function markCoverUnavailable(id: string): void {
  failedCoverIds.value = new Set([...failedCoverIds.value, id])
}
</script>

<template>
  <AppPage description="管理图集、标准和产品资料，核对内容后可发布用于问答。" title="知识库">
    <template #search>
      <AppSearchPanel :collapsible="true" :expanded="moreExpanded" :loading="isLoading" @reset="reset" @search="search" @update:expanded="(value: boolean) => moreExpanded = value">
        <t-form-item label="关键词">
          <t-input v-model="keyword" clearable placeholder="知识库名称 / 编号" />
        </t-form-item>
        <t-form-item label="类型">
          <t-select v-model="docType" :options="knowledgeDocTypes.map(value => ({ label: knowledgeDocTypeLabel(value), value }))" clearable placeholder="全部" />
        </t-form-item>
        <t-form-item label="解析状态">
          <t-select v-model="userStatus" :options="knowledgeUserStatuses.map(value => ({ label: knowledgeUserStatusMetaFor(value).label, value }))" clearable placeholder="全部" />
        </t-form-item>
        <template #advanced>
          <t-form-item label="来源机构">
            <t-input v-model="sourceOrg" clearable placeholder="来源机构" />
          </t-form-item>
        </template>
      </AppSearchPanel>
    </template>
    <div class="knowledge-list-toolbar">
      <t-button v-if="canAdd" theme="primary" @click="createVisible = true">
        <template #icon>
          <AddIcon />
        </template>新建知识库
      </t-button>
      <div class="knowledge-list-toolbar__actions" aria-label="切换知识库显示方式">
        <t-radio-group v-model="viewMode" variant="default-filled" size="small">
          <t-radio-button value="card">
            卡片
          </t-radio-button><t-radio-button value="list">
            列表
          </t-radio-button>
        </t-radio-group>
      </div>
    </div>
    <div v-if="viewMode === 'card' && error" class="knowledge-card-grid__empty">
      <span>{{ errorDescription }}</span><t-button variant="text" @click="load">重新加载</t-button>
    </div>
    <t-loading v-else-if="viewMode === 'card' && isLoading" loading text="正在加载知识库" />
    <div v-else-if="viewMode === 'card'" class="knowledge-card-grid">
      <article v-for="document in documents" :key="document.id" class="knowledge-card">
        <div class="knowledge-card__content" :role="canViewDetail ? 'button' : undefined" :tabindex="canViewDetail ? 0 : undefined" @click="openDetail(document.id)" @keydown.enter.self="openDetail(document.id)" @keydown.space.self.prevent="openDetail(document.id)">
        <div class="knowledge-card__cover">
          <img v-if="document.coverImageUrl && !failedCoverIds.has(document.id)" :alt="`${document.title}封面`" :src="document.coverImageUrl" @error="markCoverUnavailable(document.id)">
          <div v-else class="knowledge-card__placeholder">
            <span class="knowledge-card__placeholder-kind">{{ coverKind(document) }}</span>
          </div>
        </div>
        <div class="knowledge-card__body">
          <div class="knowledge-card__title" :title="document.title">
            {{ document.title }}
          </div>
          <div class="knowledge-card__meta">
            <span>{{ knowledgeDocTypeLabel(document.docType) }}</span><span>{{ pageCount(document) }}</span>
          </div>
          <div class="knowledge-card__footer">
            <AppStatusTag :label="statusMeta(document).label" :status="statusMeta(document).status" /><span>{{ formatDate(new Date(document.updatedAt), 'YYYY-MM-DD') }}</span>
          </div>
        </div>
        </div>
        <div v-if="canViewDetail || canRemove" class="knowledge-card__actions">
          <AppTableActions :actions="getActions(document)" :max-visible="2" />
        </div>
      </article>
      <div v-if="!isLoading && documents.length === 0" class="knowledge-card-grid__empty">
        {{ canAdd ? '还没有知识库。点击“新建知识库”添加第一份资料。' : '还没有知识库，请联系有权限的管理员添加资料。' }}
      </div>
    </div>
    <AppDataTable v-else :columns="columns" :current="query.page" :data="documents" :empty-description="canAdd ? '点击“新建知识库”添加图集、标准或产品资料。' : '请联系有权限的管理员添加资料。'" empty-title="还没有知识库" :error-description="errorDescription" :operations-width="140" :page-size="query.pageSize" row-key="id" :show-pagination="total > query.pageSize" :status="isLoading ? 'loading' : error ? 'error' : 'ready'" :total="total" @page-change="onPageChange" @refresh="load" @retry="load">
      <template #operations="{ row }">
        <AppTableActions :actions="getActions(row)" :max-visible="2" />
      </template>
    </AppDataTable>
    <div v-if="viewMode === 'card' && total > query.pageSize" class="knowledge-card-pagination">
      <t-pagination v-model="query.page" :page-size="query.pageSize" :total="total" @change="(pageInfo: PageInfo) => onPageChange(pageInfo)" />
    </div>
    <KnowledgeCreateDrawer v-model:visible="createVisible" @created="(id: string) => openDetail(id)" />
  </AppPage>
</template>

<style scoped>
.knowledge-list-toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:16px; }
.knowledge-list-toolbar__actions { display:flex; align-items:center; gap:12px; }
.knowledge-card-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap:var(--td-size-5); }
.knowledge-card { display:flex; min-width:0; flex-direction:column; padding:0; border:1px solid var(--td-component-stroke); border-radius:var(--td-radius-medium); background:var(--td-bg-color-container); color:var(--td-text-color-primary); text-align:left; cursor:pointer; overflow:hidden; transition:border-color .2s, transform .2s; }
.knowledge-card:hover { border-color:var(--td-brand-color); transform:translateY(-2px); }
.knowledge-card__content { flex:1; min-width:0; }
.knowledge-card__content:focus-visible { outline:2px solid var(--td-brand-color); outline-offset:-2px; }
.knowledge-card__actions { display:flex; justify-content:flex-end; padding:var(--td-size-3) var(--td-size-5); border-top:1px solid var(--td-component-stroke); cursor:default; }
.knowledge-card__cover { height:96px; display:grid; place-items:center; overflow:hidden; background:var(--td-bg-color-secondarycontainer); }
.knowledge-card__cover img { width:100%; height:100%; object-fit:cover; }
.knowledge-card__placeholder { color:var(--td-brand-color); display:grid; place-items:center; width:100%; height:100%; }
.knowledge-card__placeholder-kind { display:inline-flex; min-width:64px; justify-content:center; padding:8px 12px; border-radius:var(--td-radius-small); background:var(--td-brand-color-light); color:var(--td-brand-color); font-size:14px; font-weight:600; opacity:1; }
.knowledge-card__body { display:flex; flex-direction:column; gap:var(--td-size-3); padding:var(--td-size-5); }
.knowledge-card__title { overflow:hidden; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; font-weight:var(--td-font-weight-medium); overflow-wrap:anywhere; }
.knowledge-card__meta, .knowledge-card__footer { display:flex; align-items:center; justify-content:space-between; gap:8px; color:var(--td-text-color-secondary); font-size:var(--td-font-size-body-small); }
.knowledge-card__footer :deep(.t-tag) { flex:none; }
.knowledge-card-grid__empty { grid-column:1/-1; display:flex; align-items:center; justify-content:center; gap:var(--td-size-2); min-height:120px; color:var(--td-text-color-secondary); }
.knowledge-card-pagination { display:flex; justify-content:flex-end; margin-top:16px; }
.vicp-doc-title { color:var(--td-text-color-primary); font-weight:var(--td-font-weight-medium); }
@media (max-width:720px) { .knowledge-card-grid { gap:10px; } .knowledge-list-toolbar { align-items:flex-start; flex-direction:column; } }
</style>
