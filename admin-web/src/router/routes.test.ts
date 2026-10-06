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
      'ProjectList',
      'CollectionCenter',
      'CollectionManual',
      'CollectionSources',
      'CollectionTasks',
      'CollectionDashboard',
      'CollectionSkills',
      'CollectionRecords',
      'ProductDetail',
      'ProductManage',
      'ProductCompare',
      'ThermalCalc',
      'SystemAdmins',
      'SystemDeptMembers',
      'SystemDictItems',
      'ProjectDetail',
      'KnowledgeDocumentDetail',
      'KnowledgePublicLibrary',
      'ThermalCandidates',
      'AiConfigProviders',
      'AiConfigQuickPrompts',
      'AiConfigModels',
      'AiConfigAdvanced',
      'AiConfigBusinessPrompts',
      'AiConfigRuns',
      'AiConfigRunDetail',
      'AiConfigScenes',
      'AiConfigPrompts',
      'AiConfigFilters',
      'AiOpsConversations',
      'AiOpsConversationDetail',
      'AiOpsFeedbacks',
      'AiOpsDebug',
      'ReportCenter',
      'ReportSettings',
      'ReportTemplates',
      'ReportDetail',
      'SystemEnterprise',
      'ContentProfile',
      'ContentCertificates',
      'Login',
      'Forbidden',
      'NotFound',
    ])
  })

  it('marks login and error pages outside tabs', () => {
    for (const name of ['Login', 'Forbidden', 'NotFound', 'SystemDeptMembers', 'SystemDictItems', 'ProjectDetail', 'KnowledgeDocumentDetail', 'AiOpsConversationDetail', 'AiConfigRunDetail', 'ReportDetail']) {
      expect(routes.find(route => route.name === name)?.meta?.noTab).toBe(true)
    }
  })

  it('guards ai pages with permission codes', () => {
    expect(routes.find(route => route.name === 'AiConfigProviders')?.meta?.permissions).toEqual(['system:ai:provider:list'])
    expect(routes.find(route => route.name === 'AiConfigQuickPrompts')?.meta?.permissions).toEqual(['system:ai:quick-prompt:list'])
    expect(routes.find(route => route.name === 'AiConfigModels')?.meta?.permissions).toEqual(['system:ai:model:list'])
    expect(routes.find(route => route.name === 'AiConfigAdvanced')?.meta).toMatchObject({
      permissions: ['system:ai:model:edit', 'system:ai:debug:use'],
      title: '高级设置',
    })
    expect(routes.find(route => route.name === 'AiConfigRuns')?.meta?.permissions).toEqual(['system:ai:conversation:list'])
    expect(routes.find(route => route.name === 'AiConfigRunDetail')?.meta).toMatchObject({
      hidden: true,
      noTab: true,
      permissions: ['system:ai:conversation:detail'],
      title: '运行详情',
    })
    expect(routes.find(route => route.name === 'AiConfigScenes')?.meta).toMatchObject({
      hidden: true,
      permissions: ['system:ai:scene:list'],
      title: 'AI能力配置',
    })
    expect(routes.find(route => route.name === 'AiConfigPrompts')?.meta).toMatchObject({
      hidden: true,
      permissions: ['system:ai:prompt:list'],
      title: 'AI基础指令',
    })
    expect(routes.find(route => route.name === 'AiOpsConversations')?.meta?.permissions).toEqual(['system:ai:conversation:list'])
    expect(routes.find(route => route.name === 'AiOpsConversationDetail')?.meta?.permissions).toEqual(['system:ai:conversation:detail'])
    expect(routes.find(route => route.name === 'AiOpsFeedbacks')?.meta?.permissions).toEqual(['system:ai:feedback:list'])
    expect(routes.find(route => route.name === 'AiOpsDebug')?.meta?.permissions).toEqual(['system:ai:debug:use'])
  })

  it('guards new knowledge and thermal pages with existing list permissions', () => {
    expect(routes.find(route => route.name === 'KnowledgePublicLibrary')?.meta?.permissions).toEqual(['system:knowledge:doc:list'])
    expect(routes.find(route => route.name === 'ThermalCandidates')?.meta?.permissions).toEqual(['system:thermal:list'])
  })

  it('keeps home as the only cached fixed page', () => {
    const home = routes.find(route => route.name === 'Home')
    expect(home?.meta).toMatchObject({ affix: true, keepAlive: true })
  })

  it('guards report pages with backend permission codes', () => {
    expect(routes.find(route => route.name === 'ReportCenter')?.meta).toMatchObject({
      permissions: ['system:report:generate'],
      title: '报告列表',
    })
    expect(routes.find(route => route.name === 'ReportSettings')?.meta).toMatchObject({
      permissions: ['system:report:settings'],
      title: '报告设置',
    })
    expect(routes.find(route => route.name === 'ReportTemplates')?.meta).toMatchObject({
      hidden: true,
      permissions: ['system:report:template:list'],
      title: '报告模板',
    })
    expect(routes.find(route => route.name === 'ReportDetail')?.meta).toMatchObject({
      hidden: true,
      noTab: true,
      permissions: ['system:report:generate', 'system:report:review'],
      title: '报告详情',
    })
  })

  it('registers the unified enterprise page and keeps old paths as redirects', () => {
    expect(routes.find(route => route.name === 'SystemEnterprise')?.meta).toMatchObject({
      permissions: ['system:md:enterprise:list'],
      title: '企业信息',
    })
    expect(routes.find(route => route.name === 'ContentProfile')).toMatchObject({
      redirect: '/system/enterprise',
      meta: { hidden: true, title: '企业信息' },
    })
    expect(routes.find(route => route.name === 'ContentCertificates')).toMatchObject({
      redirect: '/system/enterprise',
      meta: { hidden: true, title: '企业信息' },
    })
  })

  it('carries the project list and product detail as static task pages', () => {
    expect(routes.find(route => route.name === 'ProjectList')?.meta).toMatchObject({ title: '项目管理' })
    const productDetail = routes.find(route => route.name === 'ProductDetail')
    expect(productDetail?.meta).toMatchObject({ hidden: true, noTab: true, title: '产品详情' })
  })

  it('redirects the retired 超级管理员 entry to unified user management', () => {
    expect(routes.find(route => route.name === 'SystemAdmins')).toMatchObject({
      redirect: '/system/user',
      meta: { hidden: true, title: '用户管理' },
    })
  })

  it('registers collection as a static workspace and keeps backend child paths as hidden redirects', () => {
    expect(routes.find(route => route.name === 'CollectionCenter')?.meta).toMatchObject({
      title: '采集管理',
      permissions: expect.arrayContaining(['system:collection:list', 'system:collection:manual:create']),
    })
    expect(routes.find(route => route.name === 'CollectionManual')).toMatchObject({
      redirect: { path: '/collection', query: { tab: 'manual' } },
      meta: { hidden: true, title: '手动采集' },
    })
    expect(routes.find(route => route.name === 'CollectionSources')).toMatchObject({
      redirect: { path: '/collection', query: { tab: 'auto' } },
      meta: { hidden: true, title: '自动采集' },
    })
    expect(routes.find(route => route.name === 'CollectionTasks')?.meta).toMatchObject({
      hidden: true,
    })
    expect(routes.find(route => route.name === 'CollectionDashboard')).toMatchObject({
      redirect: { path: '/collection', query: { tab: 'dashboard' } },
    })
    expect(routes.find(route => route.name === 'ProductManage')?.meta).toMatchObject({ title: '产品管理' })
    expect(routes.find(route => route.name === 'ProductCompare')?.meta).toMatchObject({ title: '产品对比' })
    expect(routes.find(route => route.name === 'ThermalCalc')?.meta).toMatchObject({ title: '热工计算' })
    expect(routes.find(route => route.name === 'AiConfigBusinessPrompts')?.meta).toMatchObject({ title: '提示词配置' })
    expect(routes.some(route => route.meta?.title === '产品中心')).toBe(false)
  })
})
