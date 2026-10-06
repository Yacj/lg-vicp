import type {
  CompanyProfile,
  CompanyProfileForm,
  CompanyProfileUpdate,
  CompanyQualification,
  CompanyQualificationForm,
  CompanyQualificationWrite,
} from '@/types/company'

/** 与后端 company-files.ts 对齐：Logo 仅 PNG / JPEG / SVG。 */
export const COMPANY_LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml'] as const

/** 与后端 company-files.ts 对齐：资质附件为图片或 PDF。 */
export const COMPANY_QUALIFICATION_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'application/pdf',
] as const

export const COMPANY_LOGO_ACCEPT = '.png,.jpg,.jpeg,.svg'
export const COMPANY_QUALIFICATION_ACCEPT = '.png,.jpg,.jpeg,.svg,.pdf'

export function isCompanyLogoMime(mimeType: string): boolean {
  return (COMPANY_LOGO_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function isCompanyQualificationMime(mimeType: string): boolean {
  return (COMPANY_QUALIFICATION_MIME_TYPES as readonly string[]).includes(mimeType)
}

export function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function createEmptyCompanyProfileForm(): CompanyProfileForm {
  return {
    description: '',
    logoFileId: '',
    name: '',
    shortName: '',
    website: '',
  }
}

export function toCompanyProfileForm(profile: CompanyProfile): CompanyProfileForm {
  return {
    description: profile.description ?? '',
    logoFileId: profile.logoFileId ?? '',
    name: profile.name ?? '',
    shortName: profile.shortName ?? '',
    website: profile.website ?? '',
  }
}

export function toCompanyProfileUpdate(form: CompanyProfileForm): CompanyProfileUpdate {
  return {
    description: emptyToNull(form.description),
    logoFileId: form.logoFileId.trim() || null,
    name: form.name.trim(),
    shortName: emptyToNull(form.shortName),
    website: emptyToNull(form.website),
  }
}

export function createEmptyQualificationForm(): CompanyQualificationForm {
  return {
    certificateNo: '',
    expireDate: '',
    fileId: '',
    fileName: '',
    mimeType: '',
    name: '',
    previewUrl: '',
  }
}

export function toQualificationForm(entity: CompanyQualification): CompanyQualificationForm {
  return {
    certificateNo: entity.certificateNo ?? '',
    expireDate: entity.expireDate ?? '',
    fileId: entity.fileId ?? '',
    fileName: companyAttachmentLabel(entity.mimeType),
    mimeType: entity.mimeType ?? '',
    name: entity.name,
    previewUrl: entity.previewUrl ?? '',
  }
}

export function toCompanyQualificationWrite(form: CompanyQualificationForm): CompanyQualificationWrite {
  return {
    certificateNo: emptyToNull(form.certificateNo),
    expireDate: emptyToNull(form.expireDate),
    fileId: form.fileId.trim(),
    name: form.name.trim(),
  }
}

export function companyAttachmentLabel(mimeType: string | null | undefined): string {
  if (!mimeType) {
    return '未上传'
  }
  if (mimeType === 'application/pdf') {
    return 'PDF 附件'
  }
  if (mimeType.startsWith('image/')) {
    return '图片附件'
  }
  return '附件'
}

export function isImageMime(mimeType: string | null | undefined): boolean {
  return Boolean(mimeType?.startsWith('image/'))
}
