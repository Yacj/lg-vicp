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
        path: 'collection',
        name: 'CollectionCenter',
        component: () => import('@/views/collection/index.vue'),
        meta: {
          keepAlive: true,
          permissions: [
            'system:collection:list',
            'system:collection:task:view',
            'system:collection:task:import',
            'system:collection:manual:create',
            'system:collection:auto:list',
            'system:collection:auto:create',
            'system:collection:auto:update',
            'system:collection:auto:toggle',
            'system:collection:skill:list',
            'system:collection:skill:create',
            'system:collection:skill:update',
            'system:collection:dashboard',
            'system:collection:record:list',
          ],
          title: '采集管理',
        },
      },
      {
        path: 'collection/manual',
        name: 'CollectionManual',
        redirect: { path: '/collection', query: { tab: 'manual' } },
        meta: {
          hidden: true,
          title: '手动采集',
        },
      },
      {
        path: 'collection/sources',
        name: 'CollectionSources',
        redirect: { path: '/collection', query: { tab: 'auto' } },
        meta: {
          hidden: true,
          title: '自动采集',
        },
      },
      {
        path: 'collection/tasks',
        name: 'CollectionTasks',
        redirect: { path: '/collection', query: { tab: 'manual' } },
        meta: {
          hidden: true,
          title: '采集管理',
        },
      },
      {
        path: 'collection/dashboard',
        name: 'CollectionDashboard',
        redirect: { path: '/collection', query: { tab: 'dashboard' } },
        meta: {
          hidden: true,
          title: '采集看板',
        },
      },
      {
        path: 'collection/skills',
        name: 'CollectionSkills',
        redirect: { path: '/collection', query: { tab: 'auto' } },
        meta: {
          hidden: true,
          title: '采集技能',
        },
      },
      {
        path: 'collection/records',
        name: 'CollectionRecords',
        redirect: { path: '/collection', query: { tab: 'dashboard' } },
        meta: {
          hidden: true,
          title: '采集记录',
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
        path: 'products/manage',
        name: 'ProductManage',
        component: () => import('@/views/products/manage/index.vue'),
        meta: {
          permissions: ['system:md:product:list'],
          title: '产品管理',
        },
      },
      {
        path: 'products/compare',
        name: 'ProductCompare',
        component: () => import('@/views/products/compare/index.vue'),
        meta: {
          permissions: ['system:md:product:list'],
          title: '产品对比',
        },
      },
      {
        path: 'thermal/calc',
        name: 'ThermalCalc',
        component: () => import('@/views/thermal/calc/index.vue'),
        meta: {
          permissions: ['system:thermal:list'],
          title: '热工计算',
        },
      },
      {
        path: 'system/admins',
        name: 'SystemAdmins',
        redirect: '/system/user',
        meta: {
          hidden: true,
          title: '用户管理',
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
          title: '知识库',
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
        path: 'ai-config/quick-prompts',
        name: 'AiConfigQuickPrompts',
        component: () => import('@/views/ai-config/quick-prompts/index.vue'),
        meta: {
          permissions: ['system:ai:quick-prompt:list'],
          title: '快捷提问',
        },
      },
      {
        path: 'ai-config/models',
        name: 'AiConfigModels',
        component: () => import('@/views/ai-config/models/index.vue'),
        meta: {
          permissions: ['system:ai:model:list'],
          title: '模型配置',
        },
      },
      {
        path: 'ai-config/advanced',
        name: 'AiConfigAdvanced',
        component: () => import('@/views/ai-config/advanced/index.vue'),
        meta: {
          permissions: ['system:ai:model:edit', 'system:ai:debug:use'],
          title: '高级设置',
        },
      },
      {
        path: 'ai-config/business-prompts',
        name: 'AiConfigBusinessPrompts',
        component: () => import('@/views/ai-config/business-prompts/index.vue'),
        meta: {
          permissions: ['system:ai:prompt:list'],
          title: '提示词配置',
        },
      },
      {
        path: 'ai-config/runs',
        name: 'AiConfigRuns',
        component: () => import('@/views/ai-config/runs/index.vue'),
        meta: {
          permissions: ['system:ai:conversation:list'],
          title: 'AI运行记录',
        },
      },
      {
        path: 'ai-config/runs/:id',
        name: 'AiConfigRunDetail',
        component: () => import('@/views/ai-config/runs/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:ai:conversation:detail'],
          title: '运行详情',
        },
      },
      {
        path: 'ai-config/scenes',
        name: 'AiConfigScenes',
        component: () => import('@/views/ai-config/scenes/index.vue'),
        meta: {
          hidden: true,
          permissions: ['system:ai:scene:list'],
          title: 'AI能力配置',
        },
      },
      {
        path: 'ai-config/prompts',
        name: 'AiConfigPrompts',
        component: () => import('@/views/ai-config/prompts/index.vue'),
        meta: {
          hidden: true,
          permissions: ['system:ai:prompt:list'],
          title: 'AI基础指令',
        },
      },
      {
        path: 'ai-config/filters',
        name: 'AiConfigFilters',
        component: () => import('@/views/ai-config/filters/index.vue'),
        meta: {
          permissions: ['system:ai:filter:list'],
          title: '内容安全',
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
          permissions: ['system:report:generate'],
          title: '报告列表',
        },
      },
      {
        path: 'reports/settings',
        name: 'ReportSettings',
        component: () => import('@/views/reports/settings/index.vue'),
        meta: {
          permissions: ['system:report:settings'],
          title: '报告设置',
        },
      },
      {
        path: 'reports/templates',
        name: 'ReportTemplates',
        component: () => import('@/views/reports/templates/index.vue'),
        meta: {
          hidden: true,
          permissions: ['system:report:template:list'],
          title: '报告模板',
        },
      },
      {
        path: 'reports/:id',
        name: 'ReportDetail',
        component: () => import('@/views/reports/detail.vue'),
        meta: {
          hidden: true,
          noTab: true,
          permissions: ['system:report:generate', 'system:report:review'],
          title: '报告详情',
        },
      },
      {
        path: 'system/enterprise',
        name: 'SystemEnterprise',
        component: () => import('@/views/system/enterprise/index.vue'),
        meta: {
          permissions: ['system:md:enterprise:list'],
          title: '企业信息',
        },
      },
      {
        path: 'content/profile',
        name: 'ContentProfile',
        redirect: '/system/enterprise',
        meta: {
          hidden: true,
          title: '企业信息',
        },
      },
      {
        path: 'content/certificates',
        name: 'ContentCertificates',
        redirect: '/system/enterprise',
        meta: {
          hidden: true,
          title: '企业信息',
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
