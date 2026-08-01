import type { RouteRecordRaw } from 'vue-router'

export const staticRoutes: RouteRecordRaw[] = [
  {
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
