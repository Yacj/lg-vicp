export const TABBAR_ITEMS = [
  {
    name: 'home',
    title: '首页',
    icon: 'home',
    pagePath: 'pages/index/index',
  },
  {
    name: 'projects',
    title: '项目',
    icon: 'folder',
    pagePath: 'pages/projects/index',
  },
  {
    name: 'assistant',
    title: '筑小格',
    icon: 'chat',
    pagePath: 'pages/assistant/index',
  },
  {
    name: 'profile',
    title: '我的',
    icon: 'user',
    pagePath: 'pages/profile/index',
  },
] as const

export type TabbarName = typeof TABBAR_ITEMS[number]['name']