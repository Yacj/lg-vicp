import type { TabbarName } from '@/constants/navigation'
import { TABBAR_ITEMS } from '@/constants/navigation'

export interface TabbarItem {
  name: TabbarName
  value?: number
  active: boolean
  title: string
  icon: string
  iconActive: string
}

const tabbarItems = ref<TabbarItem[]>(
  TABBAR_ITEMS.map(item => ({
    ...item,
    active: item.name === 'home',
  })),
)

export function useTabbar() {
  const tabbarList = computed(() => tabbarItems.value)

  const activeTabbar = computed(() => {
    return tabbarItems.value.find(item => item.active) || tabbarItems.value[0]
  })

  const getTabbarItemValue = (name: TabbarName) => {
    return tabbarItems.value.find(item => item.name === name)?.value
  }

  const setTabbarItem = (name: TabbarName, value: number) => {
    const tabbarItem = tabbarItems.value.find(item => item.name === name)
    if (tabbarItem) {
      tabbarItem.value = value
    }
  }

  const setTabbarItemActive = (name: string) => {
    const tabbarItem = tabbarItems.value.find(item => item.name === name)
    if (!tabbarItem) {
      return
    }

    tabbarItems.value.forEach((item) => {
      item.active = item.name === tabbarItem.name
    })
  }

  return {
    tabbarList,
    activeTabbar,
    getTabbarItemValue,
    setTabbarItem,
    setTabbarItemActive,
  }
}
