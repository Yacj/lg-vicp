# 蓝格 VICP 管理后台

蓝格 VICP 管理后台是建筑节能 AI 智配系统的运营与配置入口，用于承载平台管理、项目协作、知识库、AI 能力和报告相关功能。

本仓库目录仅包含管理后台前端。后端服务位于独立工程中，前端不得自行编造接口或使用 Mock 数据冒充正式业务结果。

## 技术栈

- Vue 3、TypeScript、Vite
- TDesign Vue Next、TDesign Icons
- UnoCSS
- Pinia、Vue Router
- Axios、VueUse、Day.js
- Vitest、ESLint

## 工程职责

- `src/api/`：HTTP 基础设施与网络契约
- `src/stores/`：认证、用户、路由、标签页和全局外观状态
- `src/composables/`：可复用流程状态与交互逻辑
- `src/layouts/`：应用壳层与路由出口
- `src/components/ui/`：通用 UI 组合
- `src/components/business/`：业务组件组合
- `src/styles/`：全局 Design Token、主题与布局样式
- `src/views/`：路由页面
- `skills/vicp-admin-ui/SKILL.md`：布局、主题、登录、工作台和 UI 组件的设计规范

## 外观配置

外观配置统一由 `src/stores/settings.ts` 管理，使用 `vicp-admin-appearance-v1` 在浏览器本地持久化。页面不得直接读写 `localStorage`。

配置覆盖主题模式、布局模式、侧栏主题、内容宽度、页面密度、Tabs 样式、圆角等级、主题预设及壳层显示偏好。有效配置通过 `document.documentElement` 的 `data-*` 属性投影到全局样式层。

## 本地开发

```bash
pnpm install
pnpm dev
```

环境变量示例见 `.env.example`。开发、测试和生产环境分别使用对应的 Vite mode 配置。

## 常用命令

```bash
pnpm dev        # 启动开发服务器
pnpm lint       # 代码规范检查
pnpm typecheck  # TypeScript 类型检查
pnpm test       # 运行单元测试
pnpm build      # 类型检查并构建生产产物
pnpm preview    # 预览构建产物
```

## 质量要求

完成变更至少执行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

修改布局、主题、登录、工作台或 `src/components/ui/**` 前，必须先阅读 `skills/vicp-admin-ui/SKILL.md`。