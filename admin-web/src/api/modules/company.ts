import { api } from '@/api/http/client'
import type {
  CompanyMutationMessage,
  CompanyProfile,
  CompanyProfileUpdate,
  CompanyQualification,
  CompanyQualificationListResult,
  CompanyQualificationUpdate,
  CompanyQualificationWrite,
} from '@/types/company'

const COMPANY_PREFIX = '/api/v1/platform/company'

function qualificationPath(id: string): string {
  return `${COMPANY_PREFIX}/qualifications/${encodeURIComponent(id)}`
}

/** 读取企业信息（名称/简称/Logo/简介/官网/资质）。 */
export function fetchCompanyProfile(signal?: AbortSignal): Promise<CompanyProfile> {
  return api.get<CompanyProfile>(`${COMPANY_PREFIX}/profile`, { signal })
}

/** 保存企业基本信息；保存后即可用于 About 与报告，无需审核。 */
export function updateCompanyProfile(input: CompanyProfileUpdate): Promise<CompanyProfile> {
  return api.put<CompanyProfile>(`${COMPANY_PREFIX}/profile`, input)
}

/** 查询企业资质列表。 */
export function fetchCompanyQualifications(signal?: AbortSignal): Promise<CompanyQualificationListResult> {
  return api.get<CompanyQualificationListResult>(`${COMPANY_PREFIX}/qualifications`, { signal })
}

/** 新增企业资质。 */
export function createCompanyQualification(input: CompanyQualificationWrite): Promise<CompanyQualification> {
  return api.post<CompanyQualification>(`${COMPANY_PREFIX}/qualifications`, input)
}

/** 修改企业资质。 */
export function updateCompanyQualification(
  id: string,
  input: CompanyQualificationUpdate,
): Promise<CompanyQualification> {
  return api.put<CompanyQualification>(qualificationPath(id), input)
}

/** 删除企业资质。 */
export function deleteCompanyQualification(id: string): Promise<CompanyMutationMessage> {
  return api.delete<CompanyMutationMessage>(qualificationPath(id))
}
