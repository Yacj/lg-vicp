# 蓝格 VICP 管理后台工程规则

复杂热工来源表（2026-10-15）：识别草稿编辑必须保留 v2 的 sourceColumns/fieldEvidence/layerValues 及原构造标签；空编号不补码，层热阻不填产品热阻。表头由后端来源字段驱动，旧页缺字段保守展示，不能固定写 R₀ 或按屋面更名源文表组。无编号引用只用服务端构造/行 ID 与回答位置；Fixture 浏览器验证不得冒充真实 Backend/OSS 验收。见 docs/ai/complex-atlas-phase2-2026-10-15.md。

## 项目定位

这是蓝格 VICP 建筑节能 AI 智配系统管理后台，不是通用后台模板。不得保留脚手架、内部规划、工程占位或演示项目文案。

## 开发前必读

修改以下范围前，必须先完整阅读 `.skills/vicp-admin-ui/SKILL.md`：

- `src/layouts/**`
- `src/styles/**`
- `src/components/ui/**`
- `src/components/layout/**`
- `src/views/login/**`
- `src/views/dashboard/**`
- `src/views/home/**`
- `src/stores/settings.ts`
- 任何布局、主题、登录、工作台和 UI 组件相关文件

未读取 Skill，不得开始上述范围的设计或实现。

## 技术约束

- Vue 3 + TypeScript + Vite
- TDesign Vue Next
- UnoCSS
- Pinia
- Vue Router
- Composition API
- TypeScript 严格模式
- Vue 组件使用 `<script setup lang="ts">`

## 模块边界

- API 模块只描述网络契约。
- 页面状态放 composable，全局状态放 Pinia。
- 外观配置统一由 settings store 管理。
- 优先纯函数、不可变数据投影和可判别联合类型。
- 路由组件必须从本地 `componentMap` 白名单加载。

## 后端边界

- 不修改 `../backend/`。
- 不编造后端接口。
- 不使用 Mock 冒充正式业务数据；测试仅使用通用协议夹具。
- 不破坏现有认证、Token 刷新、动态路由和 RBAC。

## UI 约束

- TDesign-first，不引入第二套完整 UI 组件库。
- 页面不得散落颜色、圆角和阴影值；主题值统一来自全局 Design Token。
- 系统管理页面保持专业、清晰、高密度。
- 项目、知识库和 AI 页面体现建筑科技产品感。
- 禁止纯黑侧边栏、大面积无意义渐变、卡片统一大圆角和重阴影。
- 禁止展示内部规划、工程占位或开发进度文案。

## TDesign 查询规则

对组件名称、属性、事件、插槽、类型或 DOM 有疑问时：

1. 先查询 TDesign MCP；
2. MCP 不可用时读取当前安装版本的类型声明；
3. 禁止凭记忆猜测 API。

## 验证

每次完成任务必须执行：

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
