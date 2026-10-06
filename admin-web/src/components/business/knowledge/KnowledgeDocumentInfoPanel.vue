<script setup lang="ts">
import { computed } from 'vue'
import AppStatusTag from '@/components/ui/AppStatusTag.vue'
import type { KnowledgeDocument, KnowledgeUserStatus } from '@/types/knowledge'
import { formatDate } from '@/utils/day'
import { knowledgeDocTypeLabel, knowledgeUserStatusMetaFor } from '@/utils/knowledge-user'
import { evidenceLevelLabels } from '@/utils/professional-status'

/**
 * 知识资料「资料信息」分区：只展示业务字段
 * （名称、编号、类型、分类、来源机构、日期、可信度、状态、页数、时间），
 * 不展示 parser、chunk、embedding、versionId、objectKey 等技术字段。
 */
const props = defineProps<{
  document: KnowledgeDocument | null
  categoryName: string
  pageCount?: number | null
  userStatus?: KnowledgeUserStatus | string
}>()

function orDash(value: string | null | undefined): string {
  return value && value.trim() ? value : '—'
}

const statusMeta = computed(() => knowledgeUserStatusMetaFor(props.userStatus))
const pageCountLabel = computed(() => props.pageCount != null ? `${props.pageCount} 页` : '—')
const evidenceLabel = computed(() => props.document?.evidenceLevel ? evidenceLevelLabels[props.document.evidenceLevel] : '—')
</script>

<template>
  <section class="knowledge-info">
    <t-descriptions bordered :column="2">
      <t-descriptions-item label="资料名称">{{ document?.title || '—' }}</t-descriptions-item>
      <t-descriptions-item label="资料编号">{{ orDash(document?.docNumber) }}</t-descriptions-item>
      <t-descriptions-item label="类型">{{ knowledgeDocTypeLabel(document?.docType) }}</t-descriptions-item>
      <t-descriptions-item label="分类">{{ categoryName || '未分类' }}</t-descriptions-item>
      <t-descriptions-item label="来源机构">{{ orDash(document?.sourceOrg) }}</t-descriptions-item>
      <t-descriptions-item label="资料可信度">{{ evidenceLabel }}</t-descriptions-item>
      <t-descriptions-item label="发布日期">{{ orDash(document?.issueDate) }}</t-descriptions-item>
      <t-descriptions-item label="生效日期">{{ orDash(document?.effectiveDate) }}</t-descriptions-item>
      <t-descriptions-item label="状态"><AppStatusTag :label="statusMeta.label" :status="statusMeta.status" /></t-descriptions-item>
      <t-descriptions-item label="页数">{{ pageCountLabel }}</t-descriptions-item>
      <t-descriptions-item label="创建时间">{{ document?.createdAt ? formatDate(new Date(document.createdAt)) : '—' }}</t-descriptions-item>
      <t-descriptions-item label="更新时间">{{ document?.updatedAt ? formatDate(new Date(document.updatedAt)) : '—' }}</t-descriptions-item>
    </t-descriptions>
  </section>
</template>

<style scoped>
.knowledge-info { padding:20px; }
</style>
