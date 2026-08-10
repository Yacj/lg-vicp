import { api } from '@/api/http/client'
import { postWorkflow } from '@/api/modules/workflow'
import type { PageResult } from '@/types/api'
import type {
  MutationMessageResponse,
  NodeDrawing,
  NodeDrawingInput,
  NodeDrawingQuery,
  NodeSchemeLink,
  NodeSchemeLinkQuery,
  ValidationResult,
} from '@/types/nodes'
import type { WorkflowActionInput } from '@/types/professional'

const NODES_PREFIX = '/api/v1/platform/nodes'

function resourcePath(resource: string, id: string): string {
  return `${NODES_PREFIX}/${resource}/${encodeURIComponent(id)}`
}

// ===== 节点图 =====

export function fetchNodeDrawings(
  query: NodeDrawingQuery,
  signal?: AbortSignal,
): Promise<PageResult<NodeDrawing>> {
  return api.get<PageResult<NodeDrawing>>(`${NODES_PREFIX}/`, { params: query, signal })
}

export function createNodeDrawing(input: NodeDrawingInput): Promise<NodeDrawing> {
  return api.post<NodeDrawing>(`${NODES_PREFIX}/`, input)
}

export function updateNodeDrawing(
  id: string,
  input: Partial<NodeDrawingInput>,
): Promise<NodeDrawing> {
  return api.patch<NodeDrawing>(`${NODES_PREFIX}/${encodeURIComponent(id)}`, input)
}

export function deleteNodeDrawing(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(`${NODES_PREFIX}/${encodeURIComponent(id)}`)
}

export function runNodeDrawingWorkflow(id: string, action: WorkflowActionInput): Promise<{ item: NodeDrawing }> {
  return postWorkflow<{ item: NodeDrawing }>(`${NODES_PREFIX}`, id, action)
}

export function validateNodeDrawing(id: string): Promise<ValidationResult> {
  return api.post<ValidationResult>(`${NODES_PREFIX}/${encodeURIComponent(id)}/validate`)
}

// ===== 节点-方案关联 =====

export function fetchNodeSchemeLinks(
  nodeId: string,
  query: NodeSchemeLinkQuery,
  signal?: AbortSignal,
): Promise<PageResult<NodeSchemeLink>> {
  return api.get<PageResult<NodeSchemeLink>>(`${NODES_PREFIX}/${encodeURIComponent(nodeId)}/links`, { params: query, signal })
}

export function deleteNodeSchemeLink(id: string): Promise<MutationMessageResponse> {
  return api.delete<MutationMessageResponse>(resourcePath('node-links', id))
}