import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'
import type { PageResult } from '@/types/api'
import type {
  EnterpriseCertificate,
  EnterpriseCertificateInput,
  EnterpriseCertificateQuery,
  EnterpriseProfile,
  EnterpriseProfileInput,
  EnterpriseProfileQuery,
  Material,
  MaterialInput,
  MaterialParameterVersion,
  MaterialParameterVersionInput,
  MaterialParameterVersionQuery,
  MaterialQuery,
  MutationMessageResponse,
  ProductAttachment,
  ProductAttachmentInput,
  ProductAttachmentQuery,
  ProductParameter,
  ProductParameterInput,
  ProductParameterQuery,
  ProductSeries,
  ProductSeriesInput,
  ProductSeriesQuery,
  ProductSpec,
  ProductSpecInput,
  ProductSpecQuery,
  WorkflowItemResponse,
} from '@/types/masterdata'
import type { WorkflowActionInput } from '@/types/professional'

const MASTERDATA_PREFIX = '/api/v1/platform/masterdata'

function resourcePath(resource: string, id: string): string {
  return `${MASTERDATA_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

/** 版本化实体通用工作流端点（submit/approve/reject/publish/disable/new-version） */
function versionedWorkflow<T>(resource: string, id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<T>> {
  return postWorkflow<WorkflowItemResponse<T>>(`${MASTERDATA_PREFIX}/${resource}`, id, action)
}

/** 非版本化实体工作流端点（无 new-version） */
function simpleWorkflow<T>(resource: string, id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<T>> {
  return postWorkflow<WorkflowItemResponse<T>>(`${MASTERDATA_PREFIX}/${resource}`, id, action)
}

// ===== 企业内容 =====

export function fetchEnterpriseProfiles(
  query: EnterpriseProfileQuery,
  signal?: AbortSignal,
): Promise<PageResult<EnterpriseProfile>> {
  return api.get<PageResult<EnterpriseProfile>>(`${MASTERDATA_PREFIX}/enterprise-profiles`, { params: query, signal })
}

export function createEnterpriseProfile(input: EnterpriseProfileInput): Promise<WorkflowItemResponse<EnterpriseProfile>> {
  return api.post<WorkflowItemResponse<EnterpriseProfile>>(`${MASTERDATA_PREFIX}/enterprise-profiles`, input)
}

export function updateEnterpriseProfile(
  id: string,
  input: Partial<EnterpriseProfileInput>,
): Promise<WorkflowItemResponse<EnterpriseProfile>> {
  return api.patch<WorkflowItemResponse<EnterpriseProfile>>(resourcePath('enterprise-profiles', id), input)
}

export function deleteEnterpriseProfile(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('enterprise-profiles', id))
}

export function runEnterpriseProfileWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<EnterpriseProfile>> {
  return versionedWorkflow<EnterpriseProfile>('enterprise-profiles', id, action)
}

export function fetchPublishedEnterpriseProfiles(signal?: AbortSignal): Promise<PageResult<EnterpriseProfile>> {
  return api.get<PageResult<EnterpriseProfile>>(`${MASTERDATA_PREFIX}/published/enterprise-profiles`, { signal })
}

export function fetchEnterpriseCertificates(
  query: EnterpriseCertificateQuery,
  signal?: AbortSignal,
): Promise<PageResult<EnterpriseCertificate>> {
  return api.get<PageResult<EnterpriseCertificate>>(`${MASTERDATA_PREFIX}/enterprise-certificates`, { params: query, signal })
}

export function createEnterpriseCertificate(input: EnterpriseCertificateInput): Promise<WorkflowItemResponse<EnterpriseCertificate>> {
  return api.post<WorkflowItemResponse<EnterpriseCertificate>>(`${MASTERDATA_PREFIX}/enterprise-certificates`, input)
}

export function updateEnterpriseCertificate(
  id: string,
  input: Partial<EnterpriseCertificateInput>,
): Promise<WorkflowItemResponse<EnterpriseCertificate>> {
  return api.patch<WorkflowItemResponse<EnterpriseCertificate>>(resourcePath('enterprise-certificates', id), input)
}

export function deleteEnterpriseCertificate(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('enterprise-certificates', id))
}

export function runEnterpriseCertificateWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<EnterpriseCertificate>> {
  return simpleWorkflow<EnterpriseCertificate>('enterprise-certificates', id, action)
}

// ===== 产品中心 =====

export function fetchProductSeries(
  query: ProductSeriesQuery,
  signal?: AbortSignal,
): Promise<PageResult<ProductSeries>> {
  return api.get<PageResult<ProductSeries>>(`${MASTERDATA_PREFIX}/product-series`, { params: query, signal })
}

export function createProductSeries(input: ProductSeriesInput): Promise<WorkflowItemResponse<ProductSeries>> {
  return api.post<WorkflowItemResponse<ProductSeries>>(`${MASTERDATA_PREFIX}/product-series`, input)
}

export function updateProductSeries(
  id: string,
  input: Partial<ProductSeriesInput>,
): Promise<WorkflowItemResponse<ProductSeries>> {
  return api.patch<WorkflowItemResponse<ProductSeries>>(resourcePath('product-series', id), input)
}

export function deleteProductSeries(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('product-series', id))
}

export function runProductSeriesWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<ProductSeries>> {
  return versionedWorkflow<ProductSeries>('product-series', id, action)
}

export function fetchProductSpecs(
  query: ProductSpecQuery,
  signal?: AbortSignal,
): Promise<PageResult<ProductSpec>> {
  return api.get<PageResult<ProductSpec>>(`${MASTERDATA_PREFIX}/product-specs`, { params: query, signal })
}

export function createProductSpec(input: ProductSpecInput): Promise<WorkflowItemResponse<ProductSpec>> {
  return api.post<WorkflowItemResponse<ProductSpec>>(`${MASTERDATA_PREFIX}/product-specs`, input)
}

export function updateProductSpec(
  id: string,
  input: Partial<ProductSpecInput>,
): Promise<WorkflowItemResponse<ProductSpec>> {
  return api.patch<WorkflowItemResponse<ProductSpec>>(resourcePath('product-specs', id), input)
}

export function deleteProductSpec(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('product-specs', id))
}

export function runProductSpecWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<ProductSpec>> {
  return versionedWorkflow<ProductSpec>('product-specs', id, action)
}

export function fetchPublishedProductSpecs(query: { seriesId?: string; specClass?: string; keyword?: string }, signal?: AbortSignal): Promise<PageResult<ProductSpec>> {
  return api.get<PageResult<ProductSpec>>(`${MASTERDATA_PREFIX}/published/product-specs`, { params: query, signal })
}

export function fetchProductParameters(
  query: ProductParameterQuery,
  signal?: AbortSignal,
): Promise<PageResult<ProductParameter>> {
  return api.get<PageResult<ProductParameter>>(`${MASTERDATA_PREFIX}/product-parameters`, { params: query, signal })
}

export function createProductParameter(input: ProductParameterInput): Promise<WorkflowItemResponse<ProductParameter>> {
  return api.post<WorkflowItemResponse<ProductParameter>>(`${MASTERDATA_PREFIX}/product-parameters`, input)
}

export function updateProductParameter(
  id: string,
  input: Partial<ProductParameterInput>,
): Promise<WorkflowItemResponse<ProductParameter>> {
  return api.patch<WorkflowItemResponse<ProductParameter>>(resourcePath('product-parameters', id), input)
}

export function deleteProductParameter(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('product-parameters', id))
}

export function runProductParameterWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<ProductParameter>> {
  return versionedWorkflow<ProductParameter>('product-parameters', id, action)
}

export function fetchProductAttachments(
  query: ProductAttachmentQuery,
  signal?: AbortSignal,
): Promise<PageResult<ProductAttachment>> {
  return api.get<PageResult<ProductAttachment>>(`${MASTERDATA_PREFIX}/product-attachments`, { params: query, signal })
}

export function createProductAttachment(input: ProductAttachmentInput): Promise<WorkflowItemResponse<ProductAttachment>> {
  return api.post<WorkflowItemResponse<ProductAttachment>>(`${MASTERDATA_PREFIX}/product-attachments`, input)
}

export function updateProductAttachment(
  id: string,
  input: Partial<ProductAttachmentInput>,
): Promise<WorkflowItemResponse<ProductAttachment>> {
  return api.patch<WorkflowItemResponse<ProductAttachment>>(resourcePath('product-attachments', id), input)
}

export function deleteProductAttachment(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('product-attachments', id))
}

export function runProductAttachmentWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<ProductAttachment>> {
  return simpleWorkflow<ProductAttachment>('product-attachments', id, action)
}

// ===== 基础数据 =====

export function fetchMaterials(
  query: MaterialQuery,
  signal?: AbortSignal,
): Promise<PageResult<Material>> {
  return api.get<PageResult<Material>>(`${MASTERDATA_PREFIX}/materials`, { params: query, signal })
}

export function createMaterial(input: MaterialInput): Promise<WorkflowItemResponse<Material>> {
  return api.post<WorkflowItemResponse<Material>>(`${MASTERDATA_PREFIX}/materials`, input)
}

export function updateMaterial(
  id: string,
  input: Partial<MaterialInput>,
): Promise<WorkflowItemResponse<Material>> {
  return api.patch<WorkflowItemResponse<Material>>(resourcePath('materials', id), input)
}

export function deleteMaterial(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('materials', id))
}

export function runMaterialWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<Material>> {
  return versionedWorkflow<Material>('materials', id, action)
}

export function fetchMaterialParameterVersions(
  query: MaterialParameterVersionQuery,
  signal?: AbortSignal,
): Promise<PageResult<MaterialParameterVersion>> {
  return api.get<PageResult<MaterialParameterVersion>>(`${MASTERDATA_PREFIX}/material-parameter-versions`, { params: query, signal })
}

export function createMaterialParameterVersion(input: MaterialParameterVersionInput): Promise<WorkflowItemResponse<MaterialParameterVersion>> {
  return api.post<WorkflowItemResponse<MaterialParameterVersion>>(`${MASTERDATA_PREFIX}/material-parameter-versions`, input)
}

export function updateMaterialParameterVersion(
  id: string,
  input: Partial<MaterialParameterVersionInput>,
): Promise<WorkflowItemResponse<MaterialParameterVersion>> {
  return api.patch<WorkflowItemResponse<MaterialParameterVersion>>(resourcePath('material-parameter-versions', id), input)
}

export function deleteMaterialParameterVersion(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('material-parameter-versions', id))
}

export function runMaterialParameterVersionWorkflow(id: string, action: WorkflowActionInput): Promise<WorkflowItemResponse<MaterialParameterVersion>> {
  return versionedWorkflow<MaterialParameterVersion>('material-parameter-versions', id, action)
}