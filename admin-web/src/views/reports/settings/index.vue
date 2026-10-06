<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppEmptyState from '@/components/ui/AppEmptyState.vue'
import AppErrorState from '@/components/ui/AppErrorState.vue'
import AppPage from '@/components/ui/AppPage.vue'
import { useReportSettings } from '@/composables/useReportSettings'
import { useReportTypes } from '@/composables/useReportTypes'
import {
  buildReportSettingsPreview,
  getReportTypeLabel,
  REPORT_SETTINGS_SECTION_HIDDEN_HINT,
} from '@/utils/report'

defineOptions({ name: 'ReportSettings' })

const router = useRouter()
const { form, load, logoUrl, save, saving, settings, status, errorDescription } = useReportSettings()
const { load: loadTypes, types } = useReportTypes()
const previewVisible = ref(false)

onMounted(() => {
  void load()
  void loadTypes()
})

const typeOptions = computed(() => types.value.map(item => ({
  label: item.name,
  value: item.code,
})))

const exportOptions = [
  { label: 'PDF', value: 'PDF' },
  { label: 'Word', value: 'DOCX' },
] as const

const preview = computed(() => buildReportSettingsPreview({
  coverTitle: form.coverTitle,
  defaultExportFormat: form.defaultExportFormat,
  disclaimerText: form.disclaimerText,
  footerText: form.footerText,
  headerText: form.headerText,
  logoUrl: logoUrl.value,
  reportTypeLabel: getReportTypeLabel(form.defaultReportType, types.value),
  showCalculationProcess: form.showCalculationProcess,
  showDisclaimer: form.showDisclaimer,
  showSourceReferences: form.showSourceReferences,
}))

function goEnterprise(): void {
  void router.push('/system/enterprise')
}

function openPreview(): void {
  previewVisible.value = true
}

function closePreview(): void {
  previewVisible.value = false
}
</script>

<template>
  <AppPage
    description="配置系统生成报告时使用的默认展示信息和输出选项。"
    title="报告设置"
  >
    <div v-if="status === 'loading'" class="report-settings__center">
      <t-loading size="large" text="正在加载报告设置" />
    </div>

    <AppErrorState
      v-else-if="status === 'error'"
      :description="errorDescription"
      title="报告设置加载失败"
      @action="load"
    />

    <template v-else-if="status === 'ready'">
      <t-form class="report-settings__form" label-align="left" :label-width="120">
        <t-card title="基础信息">
          <t-form-item label="默认报告类型">
            <t-select
              v-model="form.defaultReportType"
              clearable
              :options="typeOptions"
              placeholder="请选择默认报告类型"
            />
          </t-form-item>
          <t-form-item label="企业 Logo">
            <div class="report-settings__company">
              <div class="report-settings__logo">
                <img
                  v-if="logoUrl"
                  alt="企业 Logo"
                  class="report-settings__logo-img"
                  :src="logoUrl"
                >
                <span v-else class="report-settings__muted">
                  {{ settings?.companyLogoFileId ? 'Logo 暂无法预览' : '未配置，请在企业信息中维护' }}
                </span>
              </div>
              <p class="report-settings__source">
                企业信息来源：系统管理 → 企业信息
              </p>
              <t-button theme="default" variant="outline" @click="goEnterprise">
                前往企业信息
              </t-button>
            </div>
          </t-form-item>
          <t-form-item label="封面标题">
            <t-input v-model="form.coverTitle" maxlength="200" placeholder="VICP智能技术方案" />
          </t-form-item>
        </t-card>

        <t-card title="内容显示">
          <t-form-item label="显示计算过程">
            <t-switch v-model="form.showCalculationProcess" />
          </t-form-item>
          <t-form-item label="显示引用来源">
            <t-switch v-model="form.showSourceReferences" />
          </t-form-item>
          <t-form-item label="显示免责声明">
            <t-switch v-model="form.showDisclaimer" />
          </t-form-item>
        </t-card>

        <t-card title="页眉页脚">
          <t-form-item label="页眉">
            <t-input v-model="form.headerText" maxlength="200" placeholder="安徽蓝格利通..." />
          </t-form-item>
          <t-form-item label="页脚">
            <t-input v-model="form.footerText" maxlength="200" placeholder="页脚说明" />
          </t-form-item>
        </t-card>

        <t-card title="免责声明">
          <t-form-item label="免责声明">
            <t-textarea
              v-model="form.disclaimerText"
              :autosize="{ minRows: 4, maxRows: 8 }"
              maxlength="10000"
              placeholder="默认免责声明文本"
            />
          </t-form-item>
        </t-card>

        <t-card title="导出设置">
          <t-form-item label="默认导出格式">
            <t-radio-group v-model="form.defaultExportFormat">
              <t-radio
                v-for="option in exportOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </t-radio>
            </t-radio-group>
          </t-form-item>
        </t-card>
      </t-form>

      <div class="report-settings__actions">
        <t-button theme="default" variant="outline" @click="openPreview">
          预览
        </t-button>
        <t-button :loading="saving" theme="primary" @click="save">
          保存设置
        </t-button>
      </div>

      <t-dialog
        :cancel-btn="{ content: '关闭' }"
        :confirm-btn="null"
        header="版式示意"
        placement="center"
        :visible="previewVisible"
        width="720px"
        @cancel="closePreview"
        @close="closePreview"
        @update:visible="previewVisible = $event"
      >
        <t-alert class="report-settings__preview-alert" theme="info">
          {{ preview.notice }}
        </t-alert>
        <article class="report-settings__paper">
          <p v-if="preview.headerText" class="report-settings__paper-header">
            {{ preview.headerText }}
          </p>
          <div class="report-settings__paper-cover">
            <img
              v-if="preview.logoUrl"
              alt="企业 Logo"
              class="report-settings__paper-logo"
              :src="preview.logoUrl"
            >
            <h2 class="report-settings__paper-title">
              {{ preview.coverTitle }}
            </h2>
            <p v-if="preview.reportTypeLabel" class="report-settings__paper-type">
              {{ preview.reportTypeLabel }}
            </p>
          </div>
          <section
            v-for="section in preview.sections"
            :key="section.key"
            class="report-settings__paper-section"
          >
            <h3>{{ section.title }}</h3>
            <p v-if="section.visible">
              {{ section.placeholder }}
            </p>
            <p v-else class="report-settings__paper-muted">
              {{ REPORT_SETTINGS_SECTION_HIDDEN_HINT }}
            </p>
          </section>
          <section v-if="preview.disclaimerText" class="report-settings__paper-section">
            <h3>免责声明</h3>
            <p>{{ preview.disclaimerText }}</p>
          </section>
          <p v-if="preview.footerText" class="report-settings__paper-footer">
            {{ preview.footerText }}
          </p>
          <p class="report-settings__paper-format">
            默认导出格式：{{ preview.exportFormatLabel }}
          </p>
        </article>
      </t-dialog>
    </template>

    <AppEmptyState
      v-else
      description="点击重试以读取报告设置"
      title="暂无设置"
    />
  </AppPage>
</template>

<style scoped>
.report-settings__center {
  display: flex;
  min-height: var(--vicp-state-min-height);
  align-items: center;
  justify-content: center;
}

.report-settings__form {
  display: flex;
  flex-direction: column;
  gap: var(--vicp-page-gap);
}

.report-settings__logo {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: var(--td-size-3);
}

.report-settings__company {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--td-size-2);
}

.report-settings__logo-img {
  width: 72px;
  height: 72px;
  object-fit: contain;
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.report-settings__muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-settings__source {
  margin: var(--td-size-2) 0 var(--td-size-3);
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-settings__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--td-size-3);
}

.report-settings__preview-alert {
  margin-bottom: var(--td-size-4);
}

.report-settings__paper {
  display: flex;
  flex-direction: column;
  gap: var(--td-size-4);
  padding: var(--vicp-panel-padding);
  border: 1px solid var(--td-component-stroke);
  border-radius: var(--vicp-radius);
  background: var(--td-bg-color-container);
}

.report-settings__paper-header,
.report-settings__paper-footer,
.report-settings__paper-type,
.report-settings__paper-format,
.report-settings__paper-muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-settings__paper-cover {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--td-size-3);
  padding: var(--td-size-5) 0;
  border-bottom: 1px solid var(--td-component-stroke);
}

.report-settings__paper-logo {
  width: 72px;
  height: 72px;
  object-fit: contain;
}

.report-settings__paper-title {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-medium);
  font-weight: 600;
  text-align: center;
}

.report-settings__paper-section h3 {
  margin: 0 0 var(--td-size-2);
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-title-small);
  font-weight: 600;
}

.report-settings__paper-section p {
  margin: 0;
  color: var(--td-text-color-primary);
  font-size: var(--td-font-size-body-medium);
  line-height: 1.6;
  white-space: pre-wrap;
}

.report-settings__paper-section p.report-settings__paper-muted {
  color: var(--td-text-color-secondary);
  font-size: var(--td-font-size-body-small);
}

.report-settings__paper-footer {
  padding-top: var(--td-size-3);
  border-top: 1px solid var(--td-component-stroke);
}

.report-settings__paper-format {
  align-self: flex-end;
}
</style>
