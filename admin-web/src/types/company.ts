/** 企业信息普通业务 DTO，对齐 /api/v1/platform/company。 */

export const COMPANY_PERMISSIONS = {
  view: 'system:md:enterprise:list',
  edit: 'system:md:enterprise:edit',
  addQualification: 'system:md:enterprise:add',
  removeQualification: 'system:md:enterprise:remove',
} as const

export interface CompanyQualification {
  id: string
  name: string
  fileId: string | null
  certificateNo: string | null
  expireDate: string | null
  sortOrder: number
  previewUrl: string | null
  mimeType: string | null
}

export interface CompanyProfile {
  id: string | null
  name: string
  shortName: string | null
  logoFileId: string | null
  description: string | null
  website: string | null
  logoPreviewUrl: string | null
  qualifications: CompanyQualification[]
  updatedAt: string | null
}

export interface CompanyProfileUpdate {
  name: string
  shortName?: string | null
  logoFileId?: string | null
  description?: string | null
  website?: string | null
}

export interface CompanyQualificationWrite {
  name: string
  fileId: string
  certificateNo?: string | null
  expireDate?: string | null
  sortOrder?: number
}

export interface CompanyQualificationUpdate {
  name?: string
  fileId?: string
  certificateNo?: string | null
  expireDate?: string | null
  sortOrder?: number
}

export interface CompanyQualificationListResult {
  items: CompanyQualification[]
}

export interface CompanyMutationMessage {
  message: string
}

export interface CompanyProfileForm {
  name: string
  shortName: string
  logoFileId: string
  website: string
  description: string
}

export interface CompanyQualificationForm extends Record<string, unknown> {
  name: string
  fileId: string
  certificateNo: string
  expireDate: string
  mimeType: string
  previewUrl: string
  fileName: string
}

export interface CompanySelectedFile {
  fileId: string
  mimeType: string
  name: string
  previewUrl: string
}
