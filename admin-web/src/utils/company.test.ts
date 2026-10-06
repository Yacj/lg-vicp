import { describe, expect, it } from 'vitest'
import type { CompanyProfile } from '@/types/company'
import {
  companyAttachmentLabel,
  createEmptyCompanyProfileForm,
  isCompanyLogoMime,
  isCompanyQualificationMime,
  toCompanyProfileForm,
  toCompanyProfileUpdate,
  toCompanyQualificationWrite,
  toQualificationForm,
} from './company'

describe('company form projection', () => {
  it('maps profile fields used by ordinary admins and omits hidden CRM fields', () => {
    const profile: CompanyProfile = {
      description: '简介',
      id: '11111111-1111-4111-8111-111111111111',
      logoFileId: '22222222-2222-4222-8222-222222222222',
      logoPreviewUrl: 'https://example.com/logo.png',
      name: '蓝格节能科技有限公司',
      qualifications: [],
      shortName: '蓝格',
      updatedAt: '2026-09-15T00:00:00.000Z',
      website: 'https://example.com',
    }

    expect(toCompanyProfileForm(profile)).toEqual({
      description: '简介',
      logoFileId: '22222222-2222-4222-8222-222222222222',
      name: '蓝格节能科技有限公司',
      shortName: '蓝格',
      website: 'https://example.com',
    })
    expect(toCompanyProfileUpdate(toCompanyProfileForm(profile))).toEqual({
      description: '简介',
      logoFileId: '22222222-2222-4222-8222-222222222222',
      name: '蓝格节能科技有限公司',
      shortName: '蓝格',
      website: 'https://example.com',
    })
    expect(createEmptyCompanyProfileForm()).toEqual({
      description: '',
      logoFileId: '',
      name: '',
      shortName: '',
      website: '',
    })
  })

  it('normalizes optional profile strings to null and keeps required name', () => {
    expect(toCompanyProfileUpdate({
      description: '  ',
      logoFileId: '',
      name: ' 蓝格 ',
      shortName: '',
      website: '  ',
    })).toEqual({
      description: null,
      logoFileId: null,
      name: '蓝格',
      shortName: null,
      website: null,
    })
  })

  it('writes qualification fields without approval or region metadata', () => {
    const form = toQualificationForm({
      certificateNo: 'CERT-001',
      expireDate: '2027-12-31',
      fileId: '33333333-3333-4333-8333-333333333333',
      id: '44444444-4444-4444-8444-444444444444',
      mimeType: 'application/pdf',
      name: 'VICP相关认证',
      previewUrl: null,
      sortOrder: 1,
    })

    expect(form.fileName).toBe('PDF 附件')
    expect(toCompanyQualificationWrite(form)).toEqual({
      certificateNo: 'CERT-001',
      expireDate: '2027-12-31',
      fileId: '33333333-3333-4333-8333-333333333333',
      name: 'VICP相关认证',
    })
    expect(toCompanyQualificationWrite({
      ...form,
      certificateNo: '  ',
      expireDate: '',
    })).toEqual({
      certificateNo: null,
      expireDate: null,
      fileId: '33333333-3333-4333-8333-333333333333',
      name: 'VICP相关认证',
    })
  })

  it('accepts logo and qualification mime types used by file center', () => {
    expect(isCompanyLogoMime('image/png')).toBe(true)
    expect(isCompanyLogoMime('application/pdf')).toBe(false)
    expect(isCompanyQualificationMime('application/pdf')).toBe(true)
    expect(isCompanyQualificationMime('application/msword')).toBe(false)
    expect(companyAttachmentLabel('image/jpeg')).toBe('图片附件')
    expect(companyAttachmentLabel(null)).toBe('未上传')
  })
})
