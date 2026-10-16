<script setup>
import { computed, ref } from 'vue'
import KnowledgeRecognitionReview from '@/components/business/knowledge/KnowledgeRecognitionReview.vue'
import KnowledgePageViewer from '@/components/business/knowledge/KnowledgePageViewer.vue'
import KnowledgeTestPanel from '@/components/business/knowledge/KnowledgeTestPanel.vue'
const session = await (await fetch('/test-session')).json()
const label = ref('89'), mode = ref('table'), data = ref(null), error = ref('')
async function load() {
  data.value = null
  const response = await (await fetch(`/api/v1/platform/knowledge/pages/${session.pages[label.value]}/recognition`)).json()
  data.value = response.success ? response.data : null
  error.value = response.error?.message || ''
}
await load()
async function select(p) { label.value = p; await load() }
</script>
<template><main><h1>本轮只读复核 · B端当前组件 / 历史隔离库</h1><p>历史人工基线；本轮只读GET，无新审核/发布/模型调用。对象存储不可用，记录真实错误UI。</p><nav><button v-for="p in ['89','90','75']" @click="select(p)">印刷页 {{p}}</button><button @click="mode='table'">已确认表格</button><button @click="mode='review'">识别审核（发布只读）</button><button @click="mode='qa'">知识库测试</button></nav><p v-if="error">{{error}}</p><KnowledgeRecognitionReview v-if="mode==='review'" :document-id="session.documentId" :version-id="session.versionId" :version-editable="false"/><KnowledgeTestPanel v-else-if="mode==='qa'" :version-id="session.versionId"/><KnowledgePageViewer v-else-if="data" :key="label" :page-id="session.pages[label]" :render-model="data.renderModel" :confirmed-structured-data="data.confirmedStructuredData" :page-label="label" :page-image-url="data.pageImageUrl" :highlights="[]"/></main></template>
<style>body{margin:0;background:#f4f6fa;font:14px Arial,'Microsoft YaHei',sans-serif;color:#253247}main{max-width:1400px;padding:20px;margin:auto}h1{font-size:20px}nav{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}nav button{padding:8px;cursor:pointer}</style>
