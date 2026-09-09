import type { RouteRecordRaw } from 'vue-router'

export const staticRoutes: RouteRecordRaw[] = [  {
    path: '/',
    name: 'AdminRoot',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      {
        path: '',
        name: 'Home',
        component: () => import('@/views/home/index.vue'),
        meta: {
          affix: true,
          keepAlive: true,
          title: '工作台',
        },
      },
      {
        path: 'projects',
        name: 'ProjectList',
        component: () => import('@/views/projects/index.vue'),
        meta: {
          title: '项目管理',
        },
      },
      {
        path: 'products/detail',
        name: 'ProductDetail',
        component: () => import('@/views/products/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          title: '产品详情',
        },
      },
      {
        path: 'system/dept/:id/members',
        name: 'SystemDeptMembers',
        component: () => import('@/views/system/dept/members.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:user:list'],
          title: '部门成员',
        },
      },
      {
        path: 'system/dict/:id/items',
        name: 'SystemDictItems',
        component: () => import('@/views/system/dict/items.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:dict:list'],
          title: '字典项',
        },
      },
      {
        path: 'projects/:id',
        name: 'ProjectDetail',
        component: () => import('@/views/projects/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          title: '项目详情',
        },
      },
      {
        path: 'knowledge/documents/:id',
        name: 'KnowledgeDocumentDetail',
        component: () => import('@/views/knowledge/documents/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:knowledge:doc:list'],
          title: '文档详情',
        },
      },
      {
        path: 'knowledge/public-library',
        name: 'KnowledgePublicLibrary',
        component: () => import('@/views/knowledge/public-library/index.vue'),
        meta: {
          permissions: ['system:knowledge:doc:list'],
          title: '公开文库',
        },
      },
      {
        path: 'thermal/candidates',
        name: 'ThermalCandidates',
        component: () => import('@/views/thermal/candidates/index.vue'),
        meta: {
          permissions: ['system:thermal:list'],
          title: '候选方案试算',
        },
      },
      {
        path: 'ai-config/providers',
        name: 'AiConfigProviders',
        component: () => import('@/views/ai-config/providers/index.vue'),
        meta: {
          permissions: ['system:ai:provider:list'],
          title: '服务商',
        },
      },
      {
        path: 'ai-config/models',
        name: 'AiConfigModels',
        component: () => import('@/views/ai-config/models/index.vue'),
        meta: {
          permissions: ['system:ai:model:list'],
          title: '模型管理',
        },
      },
      {
        path: 'ai-config/scenes',
        name: 'AiConfigScenes',
        component: () => import('@/views/ai-config/scenes/index.vue'),
        meta: {
          permissions: ['system:ai:scene:list'],
          title: '场景配置',
        },
      },
      {
        path: 'ai-config/prompts',
        name: 'AiConfigPrompts',
        component: () => import('@/views/ai-config/prompts/index.vue'),
        meta: {
          permissions: ['system:ai:prompt:list'],
          title: '提示词管理',
        },
      },
      {
        path: 'ai-config/filters',
        name: 'AiConfigFilters',
        component: () => import('@/views/ai-config/filters/index.vue'),
        meta: {
          permissions: ['system:ai:filter:list'],
          title: '对话围栏',
        },
      },
      {
        path: 'ai-ops/conversations',
        name: 'AiOpsConversations',
        component: () => import('@/views/ai-ops/conversations/index.vue'),
        meta: {
          permissions: ['system:ai:conversation:list'],
          title: '会话运营',
        },
      },
      {
        path: 'ai-ops/conversations/:id',
        name: 'AiOpsConversationDetail',
        component: () => import('@/views/ai-ops/conversations/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:ai:conversation:detail'],
          title: '会话运营详情',
        },
      },
      {
        path: 'ai-ops/feedbacks',
        name: 'AiOpsFeedbacks',
        component: () => import('@/views/ai-ops/feedbacks/index.vue'),
        meta: {
          permissions: ['system:ai:feedback:list'],
          title: '反馈分析',
        },
      },
      {
        path: 'ai-ops/debug',
        name: 'AiOpsDebug',
        component: () => import('@/views/ai-ops/debug/index.vue'),
        meta: {
          permissions: ['system:ai:debug:use'],
          title: 'AI 调试台',
        },
      },
      {
        path: 'reports',
        name: 'ReportCenter',
        component: () => import('@/views/reports/index.vue'),
        meta: {
          title: '报告管理',
        },
      },
      {
        path: 'reports/:id',
        name: 'ReportDetail',
        component: () => import('@/views/reports/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          title: '报告详情',
        },
      },
    ],
  },
  {
    path: '/login',
    component: () => import('@/layouts/LoginLayout.vue'),
    meta: { hidden: true, noTab: true },
    children: [
      {
        path: '',
        name: 'Login',
        component: () => import('@/views/login/index.vue'),
        meta: { hidden: true, noTab: true, title: '登录' },
      },
    ],
  },
  {
    path: '/403',
    component: () => import('@/layouts/BlankLayout.vue'),
    meta: { hidden: true, noTab: true },
    children: [
      {
        path: '',
        name: 'Forbidden',
        component: () => import('@/views/error/403.vue'),
        meta: { hidden: true, noTab: true, title: '无权访问' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    component: () => import('@/layouts/BlankLayout.vue'),
    meta: { hidden: true, noTab: true },
    children: [
      {
        path: '',
        name: 'NotFound',
        component: () => import('@/views/error/404.vue'),
        meta: { hidden: true, noTab: true, title: '页面不存在' },
      },
    ],
  },
]

/**
 * AdminShell 下静态承载的绝对路径（不含参数路由）。
 * 动态菜单投影遇到同路径叶子时不再重复注册路由，直接复用静态页面
 * （如公开文库：后端菜单与静态路由指向同一视图、同一权限码）。
 */
export const STATIC_OWNED_PATHS: ReadonlySet<string> = new Set(
  (staticRoutes[0]?.children ?? [])
    .map(child => (typeof child.path === 'string' ? child.path : ''))
    .filter(path => path.length > 0 && !path.includes(':'))
    .map(path => `/${path}`.replace(/\/{2,}/g, '/')),
)
