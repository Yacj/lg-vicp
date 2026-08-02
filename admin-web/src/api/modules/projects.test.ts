import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/api/http/client'
import {
  createProject,
  deleteProject,
  fetchMyProjects,
  fetchPlatformProjects,
  fetchProjectDetail,
  fetchPublicProjects,
  updateProject,
  updateProjectVisibility,
} from './projects'

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

describe('project api contracts', () => {
  it('fetches my projects from workspace route with pagination', async () => {
    const signal = new AbortController().signal
    await fetchMyProjects({ page: 2, pageSize: 20 }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/workspace/projects/my', {
      params: { page: 2, pageSize: 20 },
      signal,
    })
  })

  it('fetches public projects from shared route', async () => {
    const signal = new AbortController().signal
    await fetchPublicProjects({ page: 1, pageSize: 10 }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/projects/public', {
      params: { page: 1, pageSize: 10 },
      signal,
    })
  })

  it('fetches platform projects with optional visibility filter', async () => {
    const signal = new AbortController().signal
    await fetchPlatformProjects({ page: 1, pageSize: 20, visibility: 'PUBLIC' }, signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/platform/projects', {
      params: { page: 1, pageSize: 20, visibility: 'PUBLIC' },
      signal,
    })
  })

  it('fetches project detail by id', async () => {
    const signal = new AbortController().signal
    await fetchProjectDetail('project-1', signal)

    expect(mockedApi.get).toHaveBeenCalledWith('/api/v1/projects/project-1', { signal })
  })

  it('creates project with only backend-valid fields', async () => {
    await createProject({ name: '某商业楼节能改造', description: '测试描述', visibility: 'PRIVATE' })

    expect(mockedApi.post).toHaveBeenCalledWith('/api/v1/workspace/projects', {
      name: '某商业楼节能改造',
      description: '测试描述',
      visibility: 'PRIVATE',
    })
  })

  it('updates project name and description without visibility', async () => {
    await updateProject('project-1', { name: '新名称', description: '新描述' })

    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/workspace/projects/project-1', {
      name: '新名称',
      description: '新描述',
    })
  })

  it('switches project visibility through dedicated endpoint', async () => {
    await updateProjectVisibility('project-1', 'PUBLIC')

    expect(mockedApi.patch).toHaveBeenCalledWith('/api/v1/workspace/projects/project-1/visibility', {
      visibility: 'PUBLIC',
    })
  })

  it('deletes project by id', async () => {
    await deleteProject('project-1')

    expect(mockedApi.delete).toHaveBeenCalledWith('/api/v1/workspace/projects/project-1')
  })
})