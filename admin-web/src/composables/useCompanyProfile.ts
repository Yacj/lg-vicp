import { computed, reactive, readonly, ref, shallowRef } from 'vue'
import {
  createCompanyQualification,
  deleteCompanyQualification,
  fetchCompanyProfile,
  fetchCompanyQualifications,
  updateCompanyProfile,
  updateCompanyQualification,
} from '@/api/modules/company'
import { COMPANY_PERMISSIONS } from '@/types/company'
import type {
  CompanyProfile,
  CompanyProfileForm,
  CompanyQualification,
  CompanyQualificationForm,
} from '@/types/company'
import {
  createEmptyCompanyProfileForm,
  createEmptyQualificationForm,
  toCompanyProfileForm,
  toCompanyProfileUpdate,
  toCompanyQualificationWrite,
  toQualificationForm,
} from '@/utils/company'
import { normalizeFeedbackError, useAppFeedback } from './useAppFeedback'
import { useConfirmedCrudAction } from './useCrudActions'
import { useCrudDrawer } from './useCrudDrawer'
import { usePermissionAccess } from './usePermissionAccess'

export type CompanyProfileStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * 企业信息普通页：基本信息统一保存，资质独立增删改。
 */
export function useCompanyProfile() {
  const feedback = useAppFeedback()
  const { canAccess } = usePermissionAccess()
  const profile = shallowRef<CompanyProfile | null>(null)
  const status = ref<CompanyProfileStatus>('idle')
  const saving = ref(false)
  const error = shallowRef<unknown>(null)
  const form = reactive<CompanyProfileForm>(createEmptyCompanyProfileForm())
  const logoPreviewUrl = ref('')

  const canView = computed(() => canAccess({ permissions: [COMPANY_PERMISSIONS.view] }))
  const canEdit = computed(() => canAccess({ permissions: [COMPANY_PERMISSIONS.edit] }))
  const canAddQualification = computed(() => canAccess({ permissions: [COMPANY_PERMISSIONS.addQualification] }))
  const canRemoveQualification = computed(() => canAccess({ permissions: [COMPANY_PERMISSIONS.removeQualification] }))
  const qualifications = computed(() => profile.value?.qualifications ?? [])
  const errorDescription = computed(() => error.value
    ? normalizeFeedbackError(error.value).message
    : '请检查网络连接后重试')

  function applyProfile(next: CompanyProfile): void {
    profile.value = next
    Object.assign(form, toCompanyProfileForm(next))
    logoPreviewUrl.value = next.logoPreviewUrl ?? ''
  }

  function applyQualifications(items: CompanyQualification[]): void {
    if (!profile.value) {
      return
    }
    profile.value = {
      ...profile.value,
      qualifications: items,
    }
  }

  async function refreshQualifications(): Promise<void> {
    try {
      const result = await fetchCompanyQualifications()
      applyQualifications(result.items)
    }
    catch (cause) {
      feedback.messageError(cause)
    }
  }

  async function load(signal?: AbortSignal): Promise<void> {
    status.value = 'loading'
    error.value = null
    try {
      const result = await fetchCompanyProfile(signal)
      applyProfile(result)
      status.value = 'ready'
    }
    catch (cause) {
      error.value = cause
      status.value = 'error'
    }
  }

  async function save(): Promise<boolean> {
    if (saving.value || !canEdit.value) {
      return false
    }
    saving.value = true
    try {
      const result = await updateCompanyProfile(toCompanyProfileUpdate(form))
      applyProfile(result)
      feedback.message('success', '企业信息已保存')
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

  const qualificationDrawer = useCrudDrawer<CompanyQualificationForm, CompanyQualification, CompanyQualification>({
    createForm: createEmptyQualificationForm,
    editForm: toQualificationForm,
    onError: cause => feedback.messageError(cause),
    onSuccess: () => refreshQualifications(),
    submit: async ({ mode, data, entity }) => {
      const input = toCompanyQualificationWrite(data)
      return mode === 'create'
        ? createCompanyQualification(input)
        : updateCompanyQualification(entity!.id, input)
    },
  })

  const qualificationDelete = useConfirmedCrudAction<CompanyQualification, unknown>({
    action: row => deleteCompanyQualification(row.id),
    confirm: row => ({
      content: `确定删除「${row.name}」？删除后 APP 关于我们与报告将不再展示该资质。`,
      danger: true,
      title: '删除资质',
    }),
    onSuccess: () => refreshQualifications(),
    successMessage: '已删除资质',
  })

  return {
    canAddQualification,
    canEdit,
    canRemoveQualification,
    canView,
    error: readonly(error),
    errorDescription,
    form,
    load,
    logoPreviewUrl,
    profile: readonly(profile),
    qualificationDelete,
    qualificationDrawer,
    qualifications,
    save,
    saving: readonly(saving),
    status: readonly(status),
  }
}
