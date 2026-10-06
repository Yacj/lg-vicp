import { computed, reactive, readonly, ref, shallowRef } from 'vue'
import { fetchFileDownloadUrl } from '@/api/modules/files'
import { fetchReportSettings, updateReportSettings } from '@/api/modules/reports'
import type { ReportExportFormat, ReportSettings } from '@/types/report'
import { normalizeFeedbackError, useAppFeedback } from './useAppFeedback'

export type ReportSettingsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface ReportSettingsForm {
  defaultReportType: string
  coverTitle: string
  showCalculationProcess: boolean
  showSourceReferences: boolean
  showDisclaimer: boolean
  disclaimerText: string
  headerText: string
  footerText: string
  defaultExportFormat: ReportExportFormat
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function toForm(settings: ReportSettings): ReportSettingsForm {
  return {
    coverTitle: settings.coverTitle ?? '',
    defaultExportFormat: settings.defaultExportFormat,
    defaultReportType: settings.defaultReportType ?? '',
    disclaimerText: settings.disclaimerText ?? '',
    footerText: settings.footerText ?? '',
    headerText: settings.headerText ?? '',
    showCalculationProcess: settings.showCalculationProcess,
    showDisclaimer: settings.showDisclaimer,
    showSourceReferences: settings.showSourceReferences,
  }
}

/**
 * 全局报告设置：GET/PUT /api/v1/platform/reports/settings。
 * 企业 Logo 只读，来自系统管理 → 企业信息。
 */
export function useReportSettings() {
  const feedback = useAppFeedback()
  const settings = shallowRef<ReportSettings | null>(null)
  const status = ref<ReportSettingsStatus>('idle')
  const saving = ref(false)
  const error = shallowRef<unknown>(null)
  const logoUrl = ref('')
  const form = reactive<ReportSettingsForm>({
    coverTitle: '',
    defaultExportFormat: 'PDF',
    defaultReportType: '',
    disclaimerText: '',
    footerText: '',
    headerText: '',
    showCalculationProcess: true,
    showDisclaimer: true,
    showSourceReferences: true,
  })

  const errorDescription = computed(() => error.value
    ? normalizeFeedbackError(error.value).message
    : '请检查网络连接后重试')

  async function loadLogo(fileId: string | null): Promise<void> {
    logoUrl.value = ''
    if (!fileId) {
      return
    }
    try {
      const result = await fetchFileDownloadUrl(fileId)
      logoUrl.value = result.url
    }
    catch {
      logoUrl.value = ''
    }
  }

  async function load(signal?: AbortSignal): Promise<void> {
    status.value = 'loading'
    error.value = null
    try {
      const result = await fetchReportSettings(signal)
      settings.value = result
      Object.assign(form, toForm(result))
      status.value = 'ready'
      await loadLogo(result.companyLogoFileId)
    }
    catch (cause) {
      error.value = cause
      status.value = 'error'
    }
  }

  async function save(): Promise<boolean> {
    if (saving.value) {
      return false
    }
    saving.value = true
    try {
      const result = await updateReportSettings({
        coverTitle: emptyToNull(form.coverTitle),
        defaultExportFormat: form.defaultExportFormat,
        defaultReportType: emptyToNull(form.defaultReportType),
        disclaimerText: emptyToNull(form.disclaimerText),
        footerText: emptyToNull(form.footerText),
        headerText: emptyToNull(form.headerText),
        showCalculationProcess: form.showCalculationProcess,
        showDisclaimer: form.showDisclaimer,
        showSourceReferences: form.showSourceReferences,
      })
      settings.value = result
      Object.assign(form, toForm(result))
      await loadLogo(result.companyLogoFileId)
      feedback.message('success', '报告设置已保存')
      return true
    }
    catch (cause) {
      feedback.messageError(cause)
      return false
    }
    finally {
      saving.value = false
    }
  }

  return {
    error: readonly(error),
    errorDescription,
    form,
    load,
    logoUrl: readonly(logoUrl),
    save,
    saving: readonly(saving),
    settings: readonly(settings),
    status: readonly(status),
  }
}
