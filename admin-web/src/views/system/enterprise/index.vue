<script setup lang="ts">
import type { FormInstanceFunctions, FormRules, PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import { AddIcon } from 'tdesign-icons-vue-next'
import { computed, onMounted, ref } from 'vue'
import AppCrudFormDrawer from '@/components/business/AppCrudFormDrawer.vue'
import AppFilePreview from '@/components/business/AppFilePreview.vue'
import AppTableActions from '@/components/business/AppTableActions.vue'
import CompanyFileField from '@/components/business/CompanyFileField.vue'
import AppDataTable from '@/components/ui/AppDataTable.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { useCompanyProfile } from '@/composables/useCompanyProfile'
import type { AppTableAction } from '@/types/crud'
import type { CompanyQualification, CompanySelectedFile } from '@/types/company'
import { companyAttachmentLabel } from '@/utils/company'

defineOptions({ name: 'SystemEnterprise' })

const formRef = ref<FormInstanceFunctions | null>(null)
const {
  canAddQualification,
  canEdit,
  canRemoveQualification,
  errorDescription,
  form,
  load,
  logoPreviewUrl,
  qualificationDelete,
  qualificationDrawer,
  qualifications,
  save,
  saving,
  status,
} = useCompanyProfile()

const previewQualification = ref<CompanyQualification | null>(null)
const previewVisible = computed({
  get: () => previewQualification.value !== null,
  set: (visible: boolean) => {
    if (!visible) {
      previewQualification.value = null
    }
  },
})

onMounted(() => {
  void load()
})

const profileRules: FormRules = {
  name: [
    { message: '请输入企业名称', required: true },
    { message: '企业名称不能超过 160 个字符', max: 160 },
  ],
  shortName: [{ message: '企业简称不能超过 80 个字符', max: 80 }],
  logoFileId: [{ message: '请上传企业 Logo', required: true }],
  website: [{ message: '企业官网不能超过 200 个字符', max: 200 }],
  description: [{ message: '企业简介不能超过 10000 个字符', max: 10000 }],
}

const qualificationRules: FormRules = {
  name: [
    { message: '请输入资质名称', required: true },
    { message: '资质名称不能超过 160 个字符', max: 160 },
  ],
  fileId: [{ message: '请上传资质附件', required: true }],
  certificateNo: [{ message: '证书编号不能超过 120 个字符', max: 120 }],
}

const columns: PrimaryTableCol<TableRowData>[] = [
  { colKey: 'name', minWidth: 200, title: '资质名称' },
  {
    cell: (_, { row }) => companyAttachmentLabel((row as CompanyQualification).mimeType),
    colKey: 'fileId',
    minWidth: 140,
    title: '附件',
  },
]

function getQualificationActions(row: TableRowData): AppTableAction[] {
  const entity = row as CompanyQualification
  const actions: AppTableAction[] = []
  if (entity.fileId) {
    actions.push({
      handler: () => {
        previewQualification.value = entity
      },
      key: 'preview',
      label: '预览',
    })
  }
  if (canEdit.value) {
    actions.push({
      handler: () => qualificationDrawer.openEdit(entity),
      key: 'edit',
      label: '编辑',
    })
  }
  if (canRemoveQualification.value) {
    actions.push({
      handler: () => qualificationDelete.run(entity),
      key: 'remove',
      label: '删除',
      loading: qualificationDelete.running.value,
      theme: 'danger',
    })
  }
  return actions
}

function onLogoChange(file: CompanySelectedFile): void {
  form.logoFileId = file.fileId
  logoPreviewUrl.value = file.previewUrl
}

function onQualificationFileChange(file: CompanySelectedFile): void {
  qualificationDrawer.formData.fileId = file.fileId
  qualificationDrawer.formData.mimeType = file.mimeType
  qualificationDrawer.formData.fileName = file.name
  qualificationDrawer.formData.previewUrl = file.previewUrl
}

async function submitProfile(): Promise<void> {
  if (!canEdit.value) {
    return
  }
  const valid = await formRef.value?.validate()
  if (valid !== true) {
    return
  }
  await save()
}
</script>

<template>
  <AppPage
    description="企业名称、Logo、简介和资质将用于 APP「关于我们」及报告企业信息展示。"
    title="企业信息"
  >
    <div v-if="status === 'loading'" class="enterprise-page__center">
      <t-loading size="large" text="正在加载企业信息" />
    </div>

    <AppErrorState
      v-else-if="status === 'error'"
      :description="errorDescription"
      title="企业信息加载失败"
      @action="load"
    />

    <template v-else-if="status === 'ready'">
      <t-form
        ref="formRef"
        class="enterprise-page__form"
        :data="form"
        label-align="left"
        :label-width="108"
        :readonly="!canEdit"
        :rules="profileRules"
      >
        <t-card title="基本信息">
          <t-form-item label="企业名称" name="name">
            <t-input
              v-model="form.name"
              :disabled="!canEdit"
              maxlength="160"
              placeholder="请输入企业名称"
            />
          </t-form-item>
          <t-form-item label="企业简称" name="shortName">
            <t-input
              v-model="form.shortName"
              :disabled="!canEdit"
              maxlength="80"
              placeholder="选填"
            />
          </t-form-item>
          <t-form-item label="企业 Logo" name="logoFileId">
            <CompanyFileField
              :disabled="!canEdit"
              :file-id="form.logoFileId"
              kind="logo"
              :preview-url="logoPreviewUrl"
              :readonly="!canEdit"
              @change="onLogoChange"
            />
          </t-form-item>
          <t-form-item label="企业官网" name="website">
            <t-input
              v-model="form.website"
              :disabled="!canEdit"
              maxlength="200"
              placeholder="选填"
            />
          </t-form-item>
          <t-form-item label="企业简介" name="description">
            <t-textarea
              v-model="form.description"
              :autosize="{ minRows: 4, maxRows: 8 }"
              :disabled="!canEdit"
              maxlength="10000"
              placeholder="选填"
            />
          </t-form-item>
        </t-card>
      </t-form>

      <t-card title="企业资质">
        <AppDataTable
          :columns="columns"
          :data="qualifications"
          empty-description="可添加对外展示的资质证书"
          empty-title="暂无企业资质"
          :operations-width="200"
          row-key="id"
          :show-column-controller="false"
          :show-fullscreen="false"
          :show-pagination="false"
          :show-refresh="false"
        >
          <template v-if="canAddQualification" #toolbar>
            <t-button theme="primary" variant="outline" @click="qualificationDrawer.openCreate">
              <template #icon>
                <AddIcon />
              </template>
              添加资质
            </t-button>
          </template>
          <template #operations="{ row }">
            <AppTableActions :actions="getQualificationActions(row)" :max-visible="3" />
          </template>
        </AppDataTable>
      </t-card>

      <div v-if="canEdit" class="enterprise-page__actions">
        <t-button :loading="saving" theme="primary" @click="submitProfile">
          保存
        </t-button>
      </div>
    </template>

    <AppCrudFormDrawer
      :form-data="qualificationDrawer.formData"
      :mode="qualificationDrawer.mode.value"
      :rules="qualificationRules"
      :submitting="qualificationDrawer.isSubmitting.value"
      :title="qualificationDrawer.mode.value === 'create' ? '添加资质' : '编辑资质'"
      :visible="qualificationDrawer.visible.value"
      @cancel="qualificationDrawer.close"
      @submit="qualificationDrawer.submit"
      @update:visible="qualificationDrawer.setVisible"
    >
      <t-form-item label="资质名称" name="name">
        <t-input v-model="qualificationDrawer.formData.name" maxlength="160" placeholder="请输入资质名称" />
      </t-form-item>
      <t-form-item label="资质附件" name="fileId">
        <CompanyFileField
          :file-id="qualificationDrawer.formData.fileId"
          :file-name="qualificationDrawer.formData.fileName"
          kind="qualification"
          :mime-type="qualificationDrawer.formData.mimeType"
          :preview-url="qualificationDrawer.formData.previewUrl"
          @change="onQualificationFileChange"
        />
      </t-form-item>
      <t-form-item label="证书编号" name="certificateNo">
        <t-input v-model="qualificationDrawer.formData.certificateNo" maxlength="120" placeholder="选填" />
      </t-form-item>
      <t-form-item label="有效期" name="expireDate">
        <t-date-picker
          v-model="qualificationDrawer.formData.expireDate"
          clearable
          format="YYYY-MM-DD"
          placeholder="选填"
          value-type="YYYY-MM-DD"
        />
      </t-form-item>
    </AppCrudFormDrawer>

    <AppFilePreview
      :file="previewQualification && previewQualification.fileId
        ? {
          id: previewQualification.fileId,
          mimeType: previewQualification.mimeType ?? 'application/octet-stream',
          originalName: previewQualification.name,
        }
        : null"
      :visible="previewVisible"
      @close="previewVisible = false"
    />
  </AppPage>
</template>

<style scoped>
.enterprise-page__center {
  display: flex;
  min-height: var(--vicp-state-min-height);
  align-items: center;
  justify-content: center;
}

.enterprise-page__form {
  display: flex;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}

.enterprise-page__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
