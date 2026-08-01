---
name: vicp-admin-ui
description: 蓝格 VICP 管理后台的布局、主题、页面结构和组件设计规范。
---

# 蓝格 VICP Admin UI Skill

## 使用要求

修改以下内容前必须完整阅读本 Skill：

- 布局与壳层
- 全局主题与 Design Token
- 登录页
- 工作台与首页
- `src/components/ui/**`
- `src/stores/settings.ts`

## 产品气质

目标是专业、现代、可信、可追溯的建筑科技与 AI 辅助产品，保持高信息密度。

禁止做成：

- RuoYi 默认风格或黑灰传统后台
- 大量渐变的 AI 营销页
- C 端玩具化界面
- 通用 SaaS 模板

## 视觉边界

- 页面背景使用低对比度浅灰蓝，内容表面使用白色或对应的深色容器。
- 普通卡片以细边框为主；阴影仅用于浮层、弹窗、下拉菜单和 AI 浮动区域。
- 系统主色默认使用 VICP 中深蓝。
- 成功色用于完成和发布，警告色用于待处理和需复核，错误色用于失败和异常。
- 禁止纯黑侧边栏、大面积无意义渐变、所有卡片统一大圆角和重阴影。
- 颜色以 TDesign `--td-*` 为来源；`--vicp-*` 仅表达布局尺寸、壳层语义或兼容别名。

## TDesign-first

- TDesign-first 不等于禁止自定义复杂壳层组件。
- Tabs、布局导航和命令面板在 TDesign 无法满足要求时，允许使用 Vue + UnoCSS 自定义。
- Dialog、Popup、Dropdown、Tooltip、Drawer 等基础交互仍优先使用 `tdesign-vue-next`。
- 对组件 API、事件、插槽、类型或 DOM 存疑时，先查询 TDesign MCP；不可用时必须读取当前安装版本类型声明。

## 页面与组件职责

标准页面由标题区、操作区、筛选区、数据内容区、分页或状态区组成。

- 禁止每个页面自行设计标题、搜索和表格结构。
- 通用组合放 `components/ui`。
- 业务组合放 `components/business`。
- 流程状态放 `composables`。
- 仅在多处复用或存在统一复杂行为时二次封装。

## 布局

支持 `side`、`top`、`mixed`、`dual`。四种布局必须拥有不同 DOM 和菜单投影逻辑，不能只切换 class 或文案。

## 外观配置协议

外观配置统一由 settings store 管理，页面不得直接读写 `localStorage`。

固定枚举：

- `themeMode`: `light | dark | system`
- `layoutMode`: `side | top | mixed | dual`
- `sidebarTheme`: `light | dark | auto`
- `contentWidth`: `fluid | fixed`
- `density`: `comfortable | compact`
- `tabsStyle`: `line | card | chrome`
- `radiusLevel`: `square | small | medium | large`
- `systemThemePreset` / `componentThemePreset`: `vicp-blue | technology-blue | indigo | cyan | emerald | purple`
- `syncThemeColors`: `boolean`
- `fixedHeader`: `boolean`

默认配置：

```ts
export const defaultAppearanceSettings = {
  themeMode: 'system',
  layoutMode: 'mixed',
  sidebarTheme: 'dark',
  contentWidth: 'fluid',
  density: 'comfortable',
  tabsStyle: 'line',
  radiusLevel: 'medium',
  systemThemePreset: 'vicp-blue',
  componentThemePreset: 'vicp-blue',
  syncThemeColors: true,
  fixedHeader: true,
  showTabs: true,
  sidebarCollapsed: false,
} as const
```

持久化键固定为 `vicp-admin-appearance-v1`。配置必须支持实时应用、刷新恢复、系统主题同步、更新、单项补丁、重置和导入导出。

根节点投影固定为：

- `data-theme`
- `data-layout`
- `data-sidebar-theme`
- `data-content-width`
- `data-density`
- `data-tabs-style`
- `data-radius`

主题切换不得刷新路由；布局和页面只消费 settings store，不自行维护外观副本。

## 验收

涉及本 Skill 范围的变更至少执行：

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`