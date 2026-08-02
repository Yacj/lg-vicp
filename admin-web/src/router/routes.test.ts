import type { RouteRecordRaw } from 'vue-router'
import { describe, expect, it } from 'vitest'
import { staticRoutes } from './routes'

function flatten(routes: RouteRecordRaw[]): RouteRecordRaw[] {
  return routes.flatMap(route => [route, ...flatten(route.children || [])])
}

describe('static route boundaries', () => {
  const routes = flatten(staticRoutes)

  it('contains the admin shell and public route names', () => {
    const names = routes
      .map(route => route.name)
      .filter((name): name is string => typeof name === 'string')

    expect(names).toEqual([
      'AdminRoot',
      'Home',
      'SystemDeptMembers',
      'SystemDictItems',
      'ProjectDetail',
      'AiConfigProviders',
      'AiConfigModels',
      'AiConfigScenes',
      'AiConfigPrompts',
      'AiOpsConversations',
      'AiOpsConversationDetail',
      'AiOpsFeedbacks',
      'AiOpsDebug',
      'ReportCenter',
      'ReportDetail',
      'Login',
      'Forbidden',
      'NotFound',
    ])
  })

  it('marks login and error pages outside tabs', () => {
    for (const name of ['Login', 'Forbidden', 'NotFound', 'SystemDeptMembers', 'SystemDictItems', 'ProjectDetail', 'AiOpsConversationDetail', 'ReportDetail']) {
      expect(routes.find(route => route.name === name)?.meta?.noTab).toBe(true)
    }
  })

  it('guards ai pages with permission codes', () => {
    expect(routes.find(route => route.name === 'AiConfigProviders')?.meta?.permissions).toEqual(['system:ai:provider:list'])
    expect(routes.find(route => route.name === 'AiConfigModels')?.meta?.permissions).toEqual(['system:ai:model:list'])
    expect(routes.find(route => route.name === 'AiConfigScenes')?.meta?.permissions).toEqual(['system:ai:scene:list'])
    expect(routes.find(route => route.name === 'AiConfigPrompts')?.meta?.permissions).toEqual(['system:ai:prompt:list'])
    expect(routes.find(route => route.name === 'AiOpsConversations')?.meta?.permissions).toEqual(['system:ai:conversation:list'])
    expect(routes.find(route => route.name === 'AiOpsConversationDetail')?.meta?.permissions).toEqual(['system:ai:conversation:detail'])
    expect(routes.find(route => route.name === 'AiOpsFeedbacks')?.meta?.permissions).toEqual(['system:ai:feedback:list'])
    expect(routes.find(route => route.name === 'AiOpsDebug')?.meta?.permissions).toEqual(['system:ai:debug:use'])
  })

  it('keeps home as the only cached fixed page', () => {
    const home = routes.find(route => route.name === 'Home')
    expect(home?.meta).toMatchObject({ affix: true, keepAlive: true })
  })
})
