// SVG 作为静态资源由 uni-app image 组件跨端渲染
export const TABBAR_ITEMS = [
  {
    name: 'home',
    title: '首页',
    icon: '/static/my-icons/tab-home.svg',
    iconActive: '/static/my-icons/tab-home-active.svg',
    pagePath: 'pages/index/index',
  },
  {
    name: 'projects',
    title: '项目',
    icon: '/static/my-icons/tab-project.svg',
    iconActive: '/static/my-icons/tab-project-active.svg',
    pagePath: 'pages/projects/index',
  },
  {
    name: 'assistant',
    title: '筑小格',
    icon: '/static/my-icons/tab-assistant.svg',
    iconActive: '/static/my-icons/tab-assistant-active.svg',
    pagePath: 'pages/assistant/index',
  },
  {
    name: 'profile',
    title: '我的',
    icon: '/static/my-icons/tab-profile.svg',
    iconActive: '/static/my-icons/tab-profile-active.svg',
    pagePath: 'pages/profile/index',
  },
] as const

export type TabbarName = typeof TABBAR_ITEMS[number]['name']
