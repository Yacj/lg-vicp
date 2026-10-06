import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createCompanyQualification,
  deleteCompanyQualification,
  fetchCompanyProfile,
  fetchCompanyQualifications,
  updateCompanyProfile,
  updateCompanyQualification,
} from './company'

vi.mock('@/api/http/client', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}))

const mockedApi = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('company api contracts', () => {
  it('reads and updates the slim company profile', async () => {
    const signal = new AbortController().signal
    await fetchCompanyProfile(signal)
    await updateCompanyProfile({
      description: '建筑节能系统服务商',
      logoFileId: '11111111-1111-4111-8111-111111111111',
      name: '蓝格节能科技有限公司',
      shortName: '蓝格',
      website: 'https://example.com',
    })

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/company/profile', { signal })
    expect(mockedApi.put).toHaveBeenCalledWith('/api/v1/platform/company/profile', {
      description: '建筑节能系统服务商',
      logoFileId: '11111111-1111-4111-8111-111111111111',
      name: '蓝格节能科技有限公司',
      shortName: '蓝格',
      website: 'https://example.com',
    })
    expect(mockedApi.put.mock.calls[0]?.[1]).not.toHaveProperty('address')
    expect(mockedApi.put.mock.calls[0]?.[1]).not.toHaveProperty('contactPhone')
    expect(mockedApi.put.mock.calls[0]?.[1]).not.toHaveProperty('creditCode')
  })

  it('lists and mutates qualifications independently of profile save', async () => {
    const signal = new AbortController().signal
    await fetchCompanyQualifications(signal)
    await createCompanyQualification({
      fileId: '22222222-2222-4222-8222-222222222222',
      name: 'VICP相关认证',
      certificateNo: 'CERT-001',
      expireDate: '2027-12-31',
    })
    await updateCompanyQualification('33333333-3333-4333-8333-333333333333', {
      name: '产品检测证书',
      fileId: '44444444-4444-4444-8444-444444444444',
    })
    await deleteCompanyQualification('33333333-3333-4333-8333-333333333333')

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/company/qualifications', { signal })
    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/platform/company/qualifications', {
      fileId: '22222222-2222-4222-8222-222222222222',
      name: 'VICP相关认证',
      certificateNo: 'CERT-001',
      expireDate: '2027-12-31',
    })
    expect(mockedApi.put).toHaveBeenCalledWith(
      '/api/v1/platform/company/qualifications/33333333-3333-4333-8333-333333333333',
      {
        name: '产品检测证书',
        fileId: '44444444-4444-4444-8444-444444444444',
      },
    )
    expect(mockedApi.delete).toHaveBeenCalledWith(
      '/api/v1/platform/company/qualifications/33333333-3333-4333-8333-333333333333',
    )
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('issuer')
    expect(mockedApi.post.mock.calls[0]?.[1]).not.toHaveProperty('status')
  })
})
