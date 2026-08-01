import type { Component } from 'vue'
import {
  AppIcon,
  BookIcon,
  Building1Icon,
  ChartIcon,
  ControlPlatformIcon,
  FileIcon,
  FolderIcon,
  HomeIcon,
  LayersIcon,
  MenuIcon,
  RobotIcon,
  SettingIcon,
  SystemSettingIcon,
  UsergroupIcon,
  UserIcon,
} from 'tdesign-icons-vue-next'

const iconMap: Record<string, Component> = {
  ai: RobotIcon,
  app: AppIcon,
  architecture: Building1Icon,
  building: Building1Icon,
  chart: ChartIcon,
  control: ControlPlatformIcon,
  dashboard: ControlPlatformIcon,
  file: FileIcon,
  folder: FolderIcon,
  home: HomeIcon,
  knowledge: BookIcon,
  layers: LayersIcon,
  menu: MenuIcon,
  monitor: ControlPlatformIcon,
  project: Building1Icon,
  role: UsergroupIcon,
  setting: SettingIcon,
  settings: SystemSettingIcon,
  system: SystemSettingIcon,
  user: UserIcon,
  users: UsergroupIcon,
}

export function resolveMenuIcon(icon: string | null): Component {
  return (icon && iconMap[icon.toLowerCase()]) || AppIcon
}
