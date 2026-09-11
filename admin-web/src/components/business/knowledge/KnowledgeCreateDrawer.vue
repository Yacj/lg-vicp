<script setup lang="ts">
import type { FormInstanceFunctions, FormRules, UploadFile } from 'tdesign-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { MessagePlugin } from 'tdesign-vue-next'
import { createKnowledgeWithFile, fetchKnowledgeCategories, updateKnowledgeDocument } from '@/api/modules/knowledge'
import AppFilePicker from '@/components/business/AppFilePicker.vue'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppFileUploader from '@/components/business/AppFileUploader.vue'
import KnowledgeFileCard from '@/components/business/knowledge/KnowledgeFileCard.vue'
import { normalizeFeedbackError } from '@/composables/useAppFeedback'
import type { FileCenterItem } from '@/types/file'
import type { CompleteUploadResult } from '@/types/file'
import type {
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgeDocType,
  KnowledgeSelectedFile,
} from '@/types/knowledge'
import { knowledgeDocTypes } from '@/types/knowledge'
import type { EvidenceLevel } from '@/types/professional'
import { knowledgeDocTypeLabels, knowledgeUserMessage } from '@/utils/knowledge-user'

const props = withDefaults(defineProps<{
  visible: boolean
  mode?: 'create' | 'edit'
  document?: KnowledgeDocument | null
}>(), {
  mode: 'create',
  document: null,
})

const emit = defineEmits<{
  'update:visible': [visible: boolean]
  'created': [documentId: string]
  'updated': []
}>()

const formRef = ref<FormInstanceFunctions | null>(null)
const submitting = ref(false)
const moreExpanded = ref<string[]>([])
const pickerVisible = ref(false)
const previewVisible = ref(false)
const uploaderFiles = ref<UploadFile[]>([])
const categories = ref<KnowledgeCategory[]>([])
const selectedFile = ref<KnowledgeSelectedFile | null>(null)

const form = reactive({
  title: '',
  docType: 'DETAIL_ATLAS' as KnowledgeDocType,
  categoryId: undefined as string | undefined,
  docNumber: '',
  sourceOrg: '',
  issueDate: '',
  effectiveDate: '',
  evidenceLevel: undefined as EvidenceLevel | undefined,
  allowedPurposes: ['检索'] as string[],
})

const rules = computed<FormRules>(() => ({
  title: [{ required: true, message: '请输入知识库名称' }],
  docType: [{ required: true, message: '请选择知识库类型' }],
}))

const header = computed(() => props.mode === 'edit' ? '编辑基本信息' : '新建知识库')
const confirmText = computed(() => props.mode === 'edit' ? '保存' : '创建并解析')
const typeOptions = knowledgeDocTypes.map(value => ({ label: knowledgeDocTypeLabels[value], value }))

function reset(): void {
  form.title = props.document?.title ?? ''
  form.docType = props.document?.docType ?? 'DETAIL_ATLAS'
  form.categoryId = props.document?.categoryId ?? undefined
  form.docNumber = props.document?.docNumber ?? ''
  form.sourceOrg = props.document?.sourceOrg ?? ''
  form.issueDate = props.document?.issueDate ?? ''
  form.effectiveDate = props.document?.effectiveDate ?? ''
  form.evidenceLevel = props.document?.evidenceLevel ?? undefined
  form.allowedPurposes = props.document?.allowedPurposes?.length ? [...props.document.allowedPurposes] : ['检索']
  selectedFile.value = null
  uploaderFiles.value = []
  moreExpanded.value = []
}

async function loadCategories(): Promise<void> {
  try {
    categories.value = (await fetchKnowledgeCategories()).items
  }
  catch {
    categories.value = []
  }
}

function onUploaded(file: File, result: CompleteUploadResult): void {
  selectedFile.value = {
    fileId: result.fileId,
    name: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    fromCenter: result.message.includes('已存在相同文件') || result.message.includes('不会重复上传'),
  }
}

function onPicked(file: FileCenterItem): void {
  selectedFile.value = {
    fileId: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    fromCenter: true,
  }
  pickerVisible.value = false
}

function close(): void {
  if (submitting.value) {
    return
  }
  emit('update:visible', false)
}

async function submit(): Promise<void> {
  const valid = await formRef.value?.validate()
  if (valid !== true) {
    return
  }
  if (props.mode === 'create' && !selectedFile.value) {
    MessagePlugin.warning('请先选择知识文件')
    return
  }
  submitting.value = true
  try {
    const extra = {
      ...(form.categoryId ? { categoryId: form.categoryId } : {}),
      ...(form.docNumber.trim() ? { docNumber: form.docNumber.trim() } : {}),
      ...(form.sourceOrg.trim() ? { sourceOrg: form.sourceOrg.trim() } : {}),
      ...(form.issueDate ? { issueDate: form.issueDate } : {}),
      ...(form.effectiveDate ? { effectiveDate: form.effectiveDate } : {}),
      ...(form.evidenceLevel ? { evidenceLevel: form.evidenceLevel } : {}),
      allowedPurposes: form.allowedPurposes,
    }
    if (props.mode === 'edit' && props.document) {
      await updateKnowledgeDocument(props.document.id, {
        title: form.title.trim(),
        docType: form.docType,
        ...extra,
      })
      emit('updated')
      emit('update:visible', false)
      return
    }
    const result = await createKnowledgeWithFile({
      title: form.title.trim(),
      docType: form.docType,
      originalFileId: selectedFile.value!.fileId,
      ...extra,
    })
    emit('created', result.document.id)
    emit('update:visible', false)
  }
  catch (cause) {
    MessagePlugin.error(knowledgeUserMessage(normalizeFeedbackError(cause).message))
  }
  finally {
    submitting.value = false
  }
}

watch(
  () => [props.visible, props.document?.id, props.mode] as const,
  ([visible]) => {
    if (!visible) {
      return
    }
    reset()
    void loadCategories()
  },
)
</script>

<template>
  <t-drawer
    :cancel-btn="{ content: '取消', disabled: submitting }"
    :close-on-overlay-click="!submitting"
    :confirm-btn="{ content: confirmText, loading: submitting, disabled: submitting, theme: 'primary' }"
    :header="header"
    :visible="visible"
    size="800px"
    @cancel="close"
    @close="close"
    @confirm="submit"
    @update:visible="(value: boolean) => emit('update:visible', value)"
  >
    <t-form
      ref="formRef"
      :data="form"
      label-align="top"
      :rules="rules"
    >
      <section class="knowledge-create__section">
        <h3>基本信息</h3>
        <t-form-item label="知识库名称" name="title" required-mark>
          <t-input v-model="form.title" maxlength="200" placeholder="如：VICP 建筑构造图集" />
        </t-form-item>
        <t-form-item label="知识库类型" name="docType" required-mark>
          <t-select v-model="form.docType" :options="typeOptions" />
        </t-form-item>
        <t-form-item label="资料分类" name="categoryId">
          <t-select
            v-model="form.categoryId"
            clearable
            :options="categories.map((item) => ({ label: item.name, value: item.id }))"
            placeholder="请选择"
          />
        </t-form-item>
      </section>

      <section v-if="mode === 'create'" class="knowledge-create__section">
        <h3>知识文件</h3>
        <t-form-item name="file" required-mark>
          <KnowledgeFileCard
            v-if="selectedFile"
            :file="selectedFile"
            @preview="previewVisible = true"
            @replace="selectedFile = null"
          />
          <div v-else class="knowledge-create__upload">
            <p>上传 PDF / Word 等知识资料</p>
            <div class="knowledge-create__upload-actions">
              <AppFileUploader
                accept=".pdf,.docx"
                :draggable="false"
                :max="1"
                :max-size-m-b="80"
                :multiple="false"
                placeholder="上传新文件"
                tips=""
                v-model="uploaderFiles"
                @success="onUploaded"
              />
              <t-button theme="default" variant="outline" @click="pickerVisible = true">
                从文件中心选择
              </t-button>
            </div>
          </div>
        </t-form-item>
      </section>

      <t-collapse v-model="moreExpanded">
        <t-collapse-panel header="更多信息" value="more">
          <t-form-item label="文档编号" name="docNumber">
            <t-input v-model="form.docNumber" maxlength="80" placeholder="如：JGJ 144" />
          </t-form-item>
          <t-form-item label="来源机构" name="sourceOrg">
            <t-input v-model="form.sourceOrg" maxlength="120" placeholder="如：住建部" />
          </t-form-item>
          <t-form-item label="发布日期" name="issueDate">
            <t-date-picker v-model="form.issueDate" clearable style="width: 100%" />
          </t-form-item>
          <t-form-item label="实施日期" name="effectiveDate">
            <t-date-picker v-model="form.effectiveDate" clearable style="width: 100%" />
          </t-form-item>
          <t-form-item label="资料可靠程度" name="evidenceLevel">
            <t-select
              v-model="form.evidenceLevel"
              clearable
              :options="[
                { label: '标准规范', value: 'A' },
                { label: '检测认证', value: 'B' },
                { label: '厂商资料', value: 'C' },
              ]"
              placeholder="未标注"
            />
          </t-form-item>
          <t-form-item label="用在哪些地方" name="allowedPurposes">
            <t-select
              v-model="form.allowedPurposes"
              :options="[{ label: '提问查找', value: '检索' }, { label: '对比', value: '对比' }, { label: '写进报告', value: '报告引用' }]"
              multiple
              placeholder="选择这份知识库可以用在哪些地方"
            />
          </t-form-item>
        </t-collapse-panel>
      </t-collapse>
    </t-form>
  </t-drawer>

  <AppFilePicker v-model:visible="pickerVisible" @confirm="onPicked" />
  <AppFilePreview
    :file="selectedFile ? { id: selectedFile.fileId, originalName: selectedFile.name, mimeType: selectedFile.mimeType } : null"
    :visible="previewVisible"
    @close="previewVisible = false"
  />
</template>

<style scoped>
.knowledge-create__section {
  margin-bottom: var(--td-size-6);
}

.knowledge-create__section h3 {
  margin: 0 0 var(--td-size-4);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.knowledge-create__upload {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: var(--td-size-4);
  padding: var(--td-size-8) var(--td-size-5);
  border: 1px dashed var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
  text-align: center;
}

.knowledge-create__upload p {
  margin: 0;
  color: var(--td-text-color-secondary);
}

.knowledge-create__upload-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: var(--td-size-3);
}
</style>
