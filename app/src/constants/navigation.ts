export const TABBAR_ITEMS = [
  {
    name: 'home',
    title: '首页',
    icon: '/static/tabbar/home.png',
    iconActive: '/static/tabbar/home-active.png',
    pagePath: 'pages/index/index',
  },
  {
    name: 'projects',
    title: '项目',
    icon: '/static/tabbar/project.png',
    iconActive: '/static/tabbar/project-active.png',
    pagePath: 'pages/projects/index',
  },
  {
    name: 'assistant',
    title: '筑小格',
    icon: '/static/tabbar/ai.png',
    iconActive: '/static/tabbar/ai-active.png',
    pagePath: 'pages/assistant/index',
  },
  {
    name: 'profile',
    title: '我的',
    icon: '/static/tabbar/user.png',
    iconActive: '/static/tabbar/user-active.png',
    pagePath: 'pages/profile/index',
  },
] as const

export type TabbarName = typeof TABBAR_ITEMS[number]['name']