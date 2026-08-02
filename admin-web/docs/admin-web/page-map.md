# 目标页面地图 + 当前实现状态

> 本文档定义蓝格 VICP 管理后台的目标页面地图，并为每个页面标注真实实现状态。状态只依据当前前端代码和后端实际注册路由；页面规划不作为“已实现”的依据。
>
> 状态定义：
>
> - **已实现**：前端页面存在且接入真实接口，形成业务闭环。
> - **壳层/空态**：页面存在，但数据为诚实空投影或仅骨架。
> - **后端可开发**：后端接口存在，前端尚未实现页面。
> - **后端部分可开发**：后端只能支撑页面的部分能力，需按边界实现。
> - **被缺口阻塞**：缺少后端接口或关键契约，暂不实现完整页面（缺口编号见 `api-gaps.md`）。
>
> 动态页面访问条件（缺一不可）：后端菜单返回合法 `component` 值 + 本地 `componentMap` 白名单存在该 key。当前白名单由构建期 `import.meta.glob('../views/**/*.vue')` 覆盖所有现有页面，并兼容 `Home` 等历史 key；菜单图标还必须命中 TDesign manifest、显式本地 SVG 注册表或统一 fallback；禁止用静态硬编码菜单掩盖后端菜单缺失。

## 1. 页面与模块统计

- 目标业务模块数：15 个。
- 一期目标主页面数：28 个，不含基础布局、错误页、抽屉、弹窗。
- 隐藏详情/流程路由：5 个，用于项目详情、文件处理详情、分享详情、AI 报告草稿、AI 运营详情。
- 后端种子菜单只覆盖部分页面；完整菜单需要由后端菜单数据补齐，详见 `GAP-007`。
- 当前前端只有登录、工作台（空态）、403/404 和系统基础数据工作区页面；动态业务页面均未接入。

15 个模块：

1. 认证与个人
2. 工作台
3. 项目中心
4. 文件与知识
5. AI 工作台
6. 报告中心
7. 分享中心
8. 用户管理
9. 角色权限
10. 菜单管理
11. 组织架构
12. 基础数据
13. AI 配置
14. AI 运营
15. 系统监控

## 2. 完整菜单树（目标）

```text
/login                                  登录页，不进主布局
/
├─ 工作台 /dashboard                     平台总览与业务态势
├─ 项目中心 /projects
│  ├─ 项目列表 /projects/list
│  ├─ 我的项目 /projects/my
│  └─ 项目详情 /projects/:id                 隐藏路由，由项目列表/我的项目进入
├─ AI 智配 /ai
│  ├─ AI 对话 /ai/conversations
│  ├─ 会话详情 /ai/conversations/:id
│  └─ AI 报告草稿 /ai/report-drafts/:conversationId  隐藏流程路由，由会话详情进入
├─ 报告中心 /reports
│  ├─ 报告列表 /reports/list
│  └─ 报告详情 /reports/:id
├─ 文件与知识 /files
│  ├─ 文件列表 /files/list
│  ├─ 文件处理详情 /files/:id                隐藏路由，由文件列表/项目详情进入
│  ├─ 文档资料库 /files/documents             目标页面，被 GAP-013 阻塞
│  ├─ 解析与结构化审核 /files/review          目标页面，被 GAP-015/GAP-016 阻塞
│  └─ 分类关键词和同义词 /files/taxonomy      目标页面，被 GAP-017 阻塞
├─ 分享中心 /shares
│  ├─ 分享列表 /shares/list
│  └─ 分享详情 /shares/:id                  隐藏路由，由分享列表/业务上下文进入
├─ AI 运营 /ai-ops
│  ├─ 会话运营 /ai-ops/conversations
│  ├─ 会话运营详情 /ai-ops/conversations/:id  隐藏路由，由会话运营进入
│  ├─ 反馈分析 /ai-ops/feedbacks
│  └─ AI 调试台 /ai-ops/debug
├─ AI 配置 /ai-config
│  ├─ 服务商 /ai-config/providers
│  ├─ 模型 /ai-config/models
│  ├─ 场景绑定 /ai-config/scenes
│  └─ 提示词 /ai-config/prompts
├─ 知识资产 /knowledge
│  ├─ 公式规则库 /knowledge/formulas          目标页面，被 GAP-018 阻塞
│  ├─ 方案库 /knowledge/solutions            目标页面，被 GAP-019 阻塞
│  └─ 节点图库 /knowledge/node-library       目标页面，被 GAP-020 阻塞
├─ 系统管理 /system
│  ├─ 用户管理 /system/user
│  ├─ 角色管理 /system/role
│  ├─ 菜单管理 /system/menu             已实现（权限资源只读选择）
│  ├─ 部门管理 /system/dept            已实现（成员详情 /system/dept/:id/members）
│  ├─ 岗位管理 /system/post            已实现
│  └─ 字典管理 /system/dict            已实现（字典项详情 /system/dict/:id/items）
├─ 系统监控 /monitor
│  ├─ 审计日志 /monitor/audit-logs
│  ├─ 登录日志 /monitor/login-logs
│  ├─ 在线用户 /monitor/online-users
│  ├─ 缓存监控 /monitor/cache
│  └─ 任务监控 /monitor/jobs
└─ 个人中心 /account/profile
```

## 2.1 一期目标页面口径与状态

| 模块 | 一期主页面数 | 页面 | 当前状态 |
| --- | ---: | --- | --- |
| 认证与个人 | 2 | 登录页、个人中心 | 登录页已实现；个人中心后端部分可开发（`GAP-006`） |
| 工作台 | 1 | 工作台 | 壳层/空态（`GAP-001`） |
| 项目中心 | 2 | 项目列表、我的项目 | 后端可开发 |
| 文件与知识 | 4 | 文件列表、文档资料库、解析与结构化审核、分类关键词和同义词 | 文件列表后端可开发；其余被缺口阻塞 |
| AI 工作台 | 2 | AI 对话、会话详情 | 后端可开发 |
| 报告中心 | 2 | 报告列表、报告详情 | 报告详情后端部分可开发；报告列表被 `GAP-002` 阻塞 |
| 分享中心 | 1 | 分享列表 | 被 `GAP-003` 阻塞 |
| 用户管理 | 1 | 用户管理 | 后端可开发 |
| 角色权限 | 1 | 角色管理 | 后端可开发 |
| 菜单管理 | 1 | 菜单管理 | 已实现（真实菜单 CRUD、运行时菜单刷新、组件/外链白名单；权限资源只读） |
| 组织架构 | 2 | 部门管理、岗位管理 | 已实现（路由 `/system/dept`、`/system/post`） |
| 基础数据 | 1 | 字典管理 | 已实现（路由 `/system/dict`） |
| AI 配置 | 4 | 服务商、模型、场景绑定、提示词 | **已实现**（路由 `/ai-config/providers`、`/ai-config/models`、`/ai-config/scenes`、`/ai-config/prompts`） |
| AI 运营 | 3 | 会话运营、反馈分析、AI 调试台 | **已实现**（路由 `/ai-ops/conversations`、`/ai-ops/feedbacks`、`/ai-ops/debug`；详情 `/ai-ops/conversations/:id` 隐藏路由） |
| 系统监控 | 5 | 审计日志、登录日志、在线用户、缓存监控、任务监控 | 后端可开发 |
| 知识资产 | 3 | 公式规则库、方案库、节点图库 | 全部被缺口阻塞 |

隐藏详情/流程路由不计入一期主页面，但必须实现权限守卫：`/projects/:id`、`/files/:id`、`/shares/:id`、`/ai/report-drafts/:conversationId`、`/ai-ops/conversations/:id`、`/system/dept/:id/members`、`/system/dict/:id/items`。

## 3. 页面明细

### 3.1 认证与个人

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 登录页 | `/login` | 验证码刷新、登录表单 | `GET /api/v1/auth/b/captchaImage`、`POST /api/v1/auth/b/login` | 无 | **已实现**；`NORMAL_USER` 后端禁止登录 B 端，`SUPER_ADMIN` 与 `CHANNEL_USER` 可登录 |
| 个人中心 | `/account/profile` | 基本资料、权限摘要、部门岗位摘要、退出确认 | `GET /api/v1/auth/b/getInfo`、`POST /api/v1/auth/logout` | 登录态 | **后端部分可开发**；暂无当前用户资料修改与改密接口，见 `GAP-006` |

### 3.2 工作台

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 工作台 | `/dashboard` | 项目卡片、AI 使用态势、报告队列、快捷入口 | 后端无聚合接口 | 按卡片分权限 | **壳层/空态**；`GAP-001` 未补齐前不展示假统计，指标、趋势和任务分布均为空投影 |

### 3.3 项目中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 项目列表 | `/projects/list` | 筛选、统计、详情跳转 | `GET /api/v1/platform/projects`、`GET /api/v1/platform/projects/statistics` | `system:project:list` | **后端可开发**；高级字段筛选需确认 `GAP-008` |
| 我的项目 | `/projects/my` | 新建项目、编辑、可见性切换、删除确认 | `GET /api/v1/workspace/projects/my`、`POST /api/v1/workspace/projects`、`PATCH /api/v1/workspace/projects/:id`、`PATCH /api/v1/workspace/projects/:id/visibility`、`DELETE /api/v1/workspace/projects/:id` | `project.create` + 项目规则 | **后端可开发**；创建/更新 schema 未开放 `region/buildingType`，见 `GAP-008` |
| 项目详情 | `/projects/:id` | 基础信息、文件、AI 会话、报告、分享入口；编辑项目抽屉 | `GET /api/v1/projects/:id`、项目相关文件/报告/分享能力 | 项目规则优先 | **后端部分可开发**；文件区受 `GAP-004` 限制，报告区受 `GAP-002` 限制，分享区受 `GAP-003` 限制 |

### 3.4 文件与知识

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 文件列表 | `/files/list` | 上传文件、处理状态、下载、删除 | `GET /api/v1/files`、`POST /api/v1/files/upload-intents`、`POST /api/v1/files/:id/complete`、`GET /api/v1/files/:id/status`、`GET /api/v1/files/:id/download-url`、`DELETE /api/v1/files/:id` | 登录态 + 文件归属 | **后端可开发**；公开项目不开放源文件，文件详情/下载只允许 owner 或超级管理员 |
| 文件处理详情 | `/files/:id` | 处理时间线、任务信息、错误原因 | `GET /api/v1/files/:id/status` | 登录态 + 文件归属 | **后端部分可开发**；只展示文件状态与最近任务；知识切片详情缺口见 `GAP-004`，任务语义见 `GAP-005` |
| 文档资料库 | `/files/documents` | 文档列表、解析摘要、切片、重建索引 | 无独立接口 | 待定 | **被缺口阻塞**：`GAP-013`；数据库表与 worker 不等于可开发接口 |
| 解析与结构化审核 | `/files/review` | 待审核列表、确认/驳回、审核意见 | 无独立接口 | 待定 | **被缺口阻塞**：`GAP-015`、`GAP-016` |
| 分类关键词和同义词 | `/files/taxonomy` | 分类、关键词、同义词维护与审核 | 无独立接口 | 待定 | **被缺口阻塞**：`GAP-017`；不能用动态字典冒充业务分类 |

### 3.5 AI 智配

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| AI 对话 | `/ai/conversations` | 新建会话、搜索、置顶、恢复、删除 | `GET/POST /api/v1/ai/conversations`、`PUT /api/v1/ai/conversations/:id/pin`、`DELETE /api/v1/ai/conversations/:id`、`POST /api/v1/ai/conversations/:id/restore` | `ai.chat` 建议作为菜单权限；接口按登录态与归属 | **后端可开发**；超级管理员可通过共用接口看自己会话；平台全量运营走 AI 运营页 |
| 会话详情 | `/ai/conversations/:id` | SSE 输入区、停止、反馈、重新生成、移动项目、报告草稿、分享 | `GET /api/v1/ai/conversations/:id`、`POST /api/v1/ai/conversations/:id/messages`、`POST /api/v1/ai/messages/:id/stop`、`PUT /api/v1/ai/messages/:id/feedback`、`POST /api/v1/ai/messages/:id/regenerate`、`PATCH /api/v1/ai/conversations/:id/project`、`PATCH /api/v1/ai/conversations/:id/settings` | 登录态 + 会话归属 | **后端可开发**；私有项目会话仍需项目可见；报告生成必须可管理项目 |
| AI 报告草稿 | `/ai/report-drafts/:conversationId` | 草稿生成、草稿预览、转正式报告 | `POST /api/v1/ai/conversations/:id/report-draft`、`POST /api/v1/reports`、`POST /api/v1/reports/:id/generate` | 登录态 + 项目管理 | **后端可开发**；渠道用户只能对自己项目生成；公开只读用户不能生成报告 |

AI 流式要求：

- 发送消息与重新生成均使用 `fetch + AbortController`。
- 不允许用 Axios JSON 请求替代 SSE。
- UI 状态机必须保留 `STOPPED` 内容。

### 3.6 报告中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 报告列表 | `/reports/list` | 筛选、状态、下载、发布、删除 | 现有只有 `GET /api/v1/reports/:id` 等详情/操作接口 | 项目规则 | **被缺口阻塞**：`GAP-002` |
| 报告详情 | `/reports/:id` | 来源快照、产物下载、发布、重新生成、删除、创建分享 | `GET /api/v1/reports/:id`、`POST /api/v1/reports/:id/generate`、`POST /api/v1/reports/:id/publish`、`GET /api/v1/reports/:id/artifacts/:type/download-url`、`DELETE /api/v1/reports/:id`、`POST /api/v1/shares` | 项目规则 | **后端部分可开发**；非项目管理者只能查看已发布报告并下载已发布产物 |

### 3.7 分享中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 分享列表 | `/shares/list` | 复制链接、禁用、访问统计 | `PATCH /api/v1/shares/:id/disable`；创建散落在 AI/报告/项目动作中 | 登录态 + 分享创建者/超级管理员 | **被缺口阻塞**：`GAP-003`；禁用能力只能从已知分享 id 的上下文触发 |
| 分享详情 | `/shares/:id` | 快照预览、访问记录 | 无登录态详情接口；匿名访问为 `GET /api/v1/public/shares/:token` | 登录态缺口 | **被缺口阻塞**：`GAP-003` |

### 3.8 AI 运营

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 会话运营 | `/ai-ops/conversations` | 关键词/场景/客户端/状态筛选、分页、推理模式列、详情跳转 | `GET /api/v1/platform/ai/conversations` | `system:ai:conversation:list` | **已实现**；超管直通，渠道用户需动态权限；无 `modelId/timeRange/hasNegativeFeedback` 筛选（`GAP-026`） |
| 会话运营详情 | `/ai-ops/conversations/:id` | 会话信息、消息时间线、异常（FAILED + errorMessage）、检索、工具调用、反馈、重新生成、审计摘要、关联报告；消息行含 requestId/提示词版本 | `GET /api/v1/platform/ai/conversations/:id` | `system:ai:conversation:detail` | **已实现**（静态隐藏路由，无 tab、keepAlive，标题经 query 传递）；不返回模型原始思考链和密钥；无会话级 token 汇总（`GAP-027`） |
| 反馈分析 | `/ai-ops/feedbacks` | 反应/场景筛选、消息全文查看、标记已处理、处理状态/备注/时间/处理人列 | `GET /api/v1/platform/ai/feedbacks`、`PUT /api/v1/platform/ai/feedbacks/:id/handle` | `system:ai:feedback:list/handle` | **已实现**；无"处理中"中间态与 handled 筛选（`GAP-029`），处理人仅 ID（`GAP-030`） |
| AI 调试台 | `/ai-ops/debug` | 场景/服务商/模型/提示词版本/快速与深度配置、上下文编辑、SSE 流式对话、停止、重新测试、清空、复制、请求详情（requestId/实际模型/首字延迟/耗时/usage/事件日志/错误重试） | `POST /api/v1/platform/ai/debug/chat`（SSE）、`POST /api/v1/platform/ai/debug/:id/stop` | `system:ai:debug:use` | **已实现**；不落库；调试台 body 不支持 temperature/maxOutputTokens（后端未定义，前端不提供）；`done` 事件仅含 usage/model/latencyMs |

### 3.9 AI 配置

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 服务商 | `/ai-config/providers` | 新建/编辑服务商（描述/优先级/响应等待时间）、API Key 状态（脱敏值）、测试连接（结果弹窗+本地耗时+重试）、最近测试状态/时间列、启停、删除 | `GET/POST/PATCH/DELETE /api/v1/platform/ai/providers`、`PATCH /api/v1/platform/ai/providers/:id/status`、`POST /api/v1/platform/ai/providers/:id/test-connection` | `system:ai:provider:list/add/edit/remove/test` | **已实现**；密钥永不回显（`apiKeyMasked`），编辑留空保留原密钥；无默认服务商字段（`GAP-025`）；测试耗时前端本地计时（`GAP-031`） |
| 模型 | `/ai-config/models` | 新建/编辑模型（描述/优先级/记忆容量/单次回答长度/回答风格/响应等待时间/能力开关 8 键）、能力标签全键展示、连通性测试、启停、删除 | `GET/POST/PATCH/DELETE /api/v1/platform/ai/models`、`PATCH /api/v1/platform/ai/models/:id/status`、`POST /api/v1/platform/ai/models/:id/test-connection` | `system:ai:model:list/add/edit/remove/test` | **已实现**；无默认模型字段，"默认"由场景主模型绑定体现（`GAP-025`）；测试为固定提示词非流式（`GAP-028`，自定义测试走调试台） |
| 场景绑定 | `/ai-config/scenes` | 固定 6 场景、开放/未开放标记、场景编码、默认/深度分析/备用模型、当前提示词版本、温度列；编辑：描述/模型三选/提示词模板/能力开关（推理、项目、文件、知识检索、工具）/回答风格/单次回答长度/排序/启停 | `GET /api/v1/platform/ai/scene-bindings`、`PUT /api/v1/platform/ai/scene-bindings` | `system:ai:scene:list/edit` | **已实现**；场景为固定枚举（无 CRUD）；`enabled` 开放标记如实展示（seed 仅 general_chat 开放） |
| 提示词 | `/ai-config/prompts` | 三栏工作区（场景→模板→版本树｜编辑器｜变量/版本信息/发布状态+操作）；草稿编辑/保存（变更说明）、发布、停用、基于历史版本创建草稿（回滚）、删除草稿/未发布模板、版本对比（行级 diff）、未保存确认 | `GET/POST /api/v1/platform/ai/prompts`、`PATCH /api/v1/platform/ai/prompts/:id/draft`、`POST /api/v1/platform/ai/prompts/:id/publish`、`POST /api/v1/platform/ai/prompts/:id/disable`、`POST /api/v1/platform/ai/prompts/:id/versions/:vid/rollback`、`GET /api/v1/platform/ai/prompts/:id/versions`、`GET /api/v1/platform/ai/prompts/:id/versions/compare`、`DELETE /api/v1/platform/ai/prompts/:id/versions/:vid`、`DELETE /api/v1/platform/ai/prompts/:id` | `system:ai:prompt:list/add/edit/publish/remove` | **已实现**；版本流（DRAFT/PUBLISHED/DISABLED）与发布人/时间/变更说明全量对接；`<1024px` 左栏折叠为顶部选择器，`<768px` 右栏变抽屉 |

### 3.10 系统管理

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 用户管理 | `/system/user` | 新建/编辑、状态、删除/恢复、重置密码、导入导出、岗位/部门/角色分配 | `GET /api/v1/platform/users`、`GET /api/v1/platform/users/export`、`POST /api/v1/platform/users/import`、`POST /api/v1/platform/users`、`GET/PATCH/DELETE /api/v1/platform/users/:id`、`PATCH /api/v1/platform/users/:id/status`、`POST /api/v1/platform/users/:id/restore`、`POST /api/v1/platform/users/:id/reset-password`、`PUT /api/v1/platform/users/:id/posts`、`PUT /api/v1/platform/users/:id/departments`、`PUT /api/v1/platform/users/:id/roles` | `system:user:*` | **后端可开发**；创建/编辑时必须区分 `role` 与 `channelType` |
| 角色管理 | `/system/role` | 新建/编辑、状态、删除、权限分配、数据范围、角色用户 | `GET/POST /api/v1/platform/roles`、`PATCH/DELETE /api/v1/platform/roles/:id`、`PATCH /api/v1/platform/roles/:id/status`、`GET /api/v1/platform/roles/export`、`PUT /api/v1/platform/roles/:id/permissions`、`PUT /api/v1/platform/roles/:id/departments`、`GET /api/v1/platform/roles/:id/users` | `system:role:*`、`system:user:role` | **后端可开发**；禁用角色权限立即失效 |
| 菜单管理 | `/system/menu` | 新建/编辑/删除目录/菜单/按钮、启停、树搜索、树形表格展开收起 | `GET/POST /api/v1/platform/menus`、`PATCH/DELETE /api/v1/platform/menus/:id`、`GET /api/v1/platform/permissions` | `system:menu:*`、读取权限资源需 `system:permission:list` | **已实现**；按钮只提交权限码，目录不提交组件，内部菜单只允许本地白名单组件，外链只允许 HTTP(S)；图标只走 TDesign manifest 或显式本地 SVG 注册表；权限资源不提供 CRUD |
| 部门管理 | `/system/dept` | 部门树、新建/编辑、状态、删除；成员详情页跳转 | `GET /api/v1/platform/departments`、`GET /api/v1/platform/departments/tree`、`POST /api/v1/platform/departments`、`PATCH/DELETE /api/v1/platform/departments/:id`、`PATCH /api/v1/platform/departments/:id/status`、`GET /api/v1/platform/users?departmentId=` | `system:dept:*`、成员入口需 `system:user:list` | **已实现**；删除前需无下级和用户；父级选择排除自身及后代 |
| 部门成员 | `/system/dept/:id/members` | 成员搜索（昵称/状态）、分页 | `GET /api/v1/platform/users?departmentId=` | `system:user:list` | **已实现**；静态隐藏路由（无 tab、keepAlive），部门名经 query 传递，返回按钮回列表页 |
| 岗位管理 | `/system/post` | 新建/编辑、状态、删除 | `GET/POST /api/v1/platform/posts`、`PATCH/DELETE /api/v1/platform/posts/:id`、`PATCH /api/v1/platform/posts/:id/status` | `system:post:*` | **已实现**；作为用户岗位标签，不是 RBAC；没有岗位成员查询接口，不能实现岗位成员功能；列表为服务端分页，无关键词/状态筛选参数 |
| 字典管理 | `/system/dict` | 字典维护、字典项详情页跳转 | `GET/POST /api/v1/platform/dictionaries`、`PATCH/DELETE /api/v1/platform/dictionaries/:id`、`GET/POST /api/v1/platform/dictionaries/:id/items`、`PATCH/DELETE /api/v1/platform/dictionaries/:id/items/:itemId` | `system:dict:*` | **已实现**；字典变更自动使后端缓存失效，没有手动刷新缓存接口；列表为真实全量请求 + 前端确定性筛选分页 |
| 字典项 | `/system/dict/:id/items` | 字典项搜索/分页、新增/编辑/删除/状态 | `GET/POST /api/v1/platform/dictionaries/:id/items`、`PATCH/DELETE /api/v1/platform/dictionaries/:id/items/:itemId` | `system:dict:list`、新增需 `system:dict:item:add`，编辑/删除沿用 `system:dict:edit/remove` | **已实现**；静态隐藏路由（无 tab、keepAlive），字典名经 query 传递，返回按钮回列表页 |

契约事实：角色、部门、字典的创建接口位于 `system-management.routes.ts`，修改/删除/状态/子资源接口位于 `platform-ops.routes.ts`；前端 API 模块按路径组织，页面不感知文件归属。部门新增接口不接收负责人、电话、邮箱等编辑字段，前端必须分别映射，不能伪装成统一原子保存。

### 3.11 系统监控

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态与差异 |
| --- | --- | --- | --- | --- | --- |
| 审计日志 | `/monitor/audit-logs` | 筛选、导出、JSON 展开 | `GET /api/v1/platform/audit-logs`、`GET /api/v1/platform/audit-logs/export` | `monitor:audit:list/export` | **后端可开发**；超级管理员直通 |
| 登录日志 | `/monitor/login-logs` | 登录结果、客户端筛选 | `GET /api/v1/platform/login-logs` | `monitor:login-log:list` | **后端可开发**；无导出接口 |
| 在线用户 | `/monitor/online-users` | 强制下线确认 | `GET /api/v1/platform/online-users`、`DELETE /api/v1/platform/online-users/:id` | `monitor:online:list/kick` | **后端可开发**；强制下线会黑名单 access token |
| 缓存监控 | `/monitor/cache` | Redis 信息、白名单 Key 查询、删除 Key | `GET /api/v1/platform/cache/info`、`GET /api/v1/platform/cache/keys`、`DELETE /api/v1/platform/cache/keys` | `monitor:cache:list/remove` | **后端可开发**；只能操作白名单前缀 |
| 任务监控 | `/monitor/jobs` | 定时任务、cron 执行记录、状态切换、手动运行 | `GET /api/v1/platform/jobs`、`GET/POST /api/v1/platform/cron-jobs`、`PATCH /api/v1/platform/cron-jobs/:id/status`、`POST /api/v1/platform/cron-jobs/:id/run` | `monitor:job:list/add/edit/run` | **后端可开发（cron 范围）**；`/jobs` 是 cron 执行查询，不是通用异步任务管理，见 `GAP-005` |

### 3.12 知识资产（目标模块）

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| 公式规则库 | `/knowledge/formulas` | 规则列表、版本、测试执行 | 无 | 待定 | **被缺口阻塞**：`GAP-018` |
| 方案库 | `/knowledge/solutions` | 方案列表、版本、标签、发布、检索 | 无 | 待定 | **被缺口阻塞**：`GAP-019` |
| 节点图库 | `/knowledge/node-library` | 节点、素材、分类、缩略图、引用关系 | 无 | 待定 | **被缺口阻塞**：`GAP-020` |

## 4. 知识库能力真实状态

| 能力 | 真实状态 | 说明 |
| --- | --- | --- |
| 文档资料库 | **后端无管理接口** | `knowledge_documents`/`knowledge_chunks` 由 worker 写入、内部检索 service 使用；无后台查询/管理路由（`GAP-013`） |
| PDF 解析 | **部分可用（无管理面）** | PDF/DOCX 文本提取和切片由 worker 完成，文件状态可查；无解析摘要、切片、重建索引接口（`GAP-013`） |
| OCR | **不可用** | 扫描件只落 `OCR_REQUIRED`；OCR provider 未配置且无执行/结果接口（`GAP-014`） |
| 表格提取 | **不可用** | 文件解析不支持 Excel/CSV 表格提取；无结构化结果接口（`GAP-015`） |
| 结构化审核 | **不可用** | 无审核状态、审核人、审核意见字段和接口（`GAP-016`） |
| 分类/关键词/同义词 | **不可用** | 无对应表或路由；动态字典不是业务分类体系（`GAP-017`） |
| 公式规则库 | **不可用** | 无对应表或路由；AI 报告不提供确定性公式执行接口（`GAP-018`） |
| 方案库 | **不可用** | 无对应表或路由；报告中心不是方案库（`GAP-019`） |
| 节点图库 | **不可用** | 无对应表或路由；AI 检索/工具调用日志不是图库（`GAP-020`） |

## 5. 动态菜单与页面差异

后端种子菜单当前包括：

- 系统管理：用户、角色、菜单、部门、岗位、字典、AI 配置。
- 系统监控：审计日志、在线用户、定时任务、缓存监控。
- 一级菜单：项目管理、AI 对话。

前端完整产品菜单还需要补齐：

- 工作台。
- 项目中心细分页面。
- 文件与知识。
- 报告中心。
- 分享中心。
- AI 运营独立菜单（AI 配置与 AI 运营 8 个页面组件已就绪，后端菜单数据补齐后即可按 `ai-config/providers`、`ai-config/models`、`ai-config/scenes`、`ai-config/prompts`、`ai-ops/conversations`、`ai-ops/feedbacks`、`ai-ops/debug` 的 component 值挂载）。
- 登录日志页面。
- 知识资产（公式、方案、节点图库）在接口补齐后加入。

这些缺口不允许用前端硬编码长期掩盖，应记录为 `GAP-007`。

动态访问条件：后端菜单返回的 `component` 值必须命中本地 `componentMap` 白名单，否则该菜单被丢弃并记录投影问题；外链菜单不进入 `componentMap`，只接受绝对 HTTP(S) 地址并在新窗口打开。当前白名单覆盖 Home 与系统菜单、字典、部门、岗位页面及 AI 配置/AI 运营全部页面；新增页面必须同时完成“后端菜单配置”和“前端白名单映射”两步。菜单管理页使用扁平 `/api/v1/platform/menus` 构建树形 `AppDataTable`，不把 `/api/v1/auth/b/getRouters` 当作管理数据源。图标值只允许 `tdesign:<stem>`、显式登记的 `local:<key>` 或已知旧别名，未知值统一 fallback。

## 6. 抽屉与弹窗清单（目标）

| 类型 | 所属页面 | 说明 |
| --- | --- | --- |
| 登录验证码刷新 | 登录页 | 刷新验证码图片 |
| 项目编辑抽屉 | 我的项目/项目详情 | 新建、编辑、切换可见性 |
| 文件上传弹窗 | 文件列表/项目详情 | 创建 upload intent、直传、complete |
| AI 会话设置抽屉 | AI 会话详情 | 重命名、移动项目、深度思考 |
| AI 反馈弹窗 | AI 会话详情 | 点赞/点踩、标签、文本反馈 |
| 报告草稿预览抽屉 | AI 报告草稿/报告详情 | 展示结构化 JSON 与来源 |
| 创建分享弹窗 | AI/报告/项目详情 | 目标类型、过期时间、访问次数 |
| 用户表单抽屉 | 用户管理 | 角色和渠道类型强校验 |
| 权限分配抽屉 | 角色管理 | 权限树和数据范围 |
| 菜单表单抽屉 | 菜单管理 | 动态组件白名单提示 |
| 字典项抽屉 | 字典管理 | 字典项维护 |
| 服务商表单弹窗 | 服务商 | 名称/API 地址/API Key（不可回显）/描述/优先级/响应等待时间/启停 |
| 模型表单弹窗 | 模型管理 | 服务商/名称/编码/描述/优先级/上下文/能力开关 8 键/超时/启停 |
| 场景绑定弹窗 | 场景配置 | 描述/默认模型/深度分析模型/备用模型/提示词模板/能力开关组/回答风格/单次回答长度/排序/启停（scene 只读） |
| 服务商测试结果弹窗 | 服务商 | 测试结果文本、耗时、requestId、失败重试 |
| 提示词新增模板弹窗 | 提示词管理 | 场景/名称/系统提示词/变更说明（创建模板+草稿） |
| 提示词保存草稿弹窗 | 提示词管理 | 变更说明收集 |
| 提示词版本对比弹窗/抽屉 | 提示词管理 | 旧/新版本选择 + 行级 LCS diff |
| 模型连通性测试弹窗 | 模型管理 | 展示模型返回文本 |
| 反馈消息抽屉 | 反馈分析 | 消息全文、模型、Token、耗时 |
| 反馈处理弹窗 | 反馈分析 | 处理备注（≤1000 字） |
| 反馈处理信息弹窗 | 反馈分析 | 处理人/时间/备注 |
| JSON 查看弹窗 | 审计/AI 运营/任务 | 展开复杂 JSON |

## 7. 页面级实施约束

- 所有后台接口必须带 `B_ADMIN` access token。
- 菜单和按钮按 RBAC 控制；项目详情、文件、报告、分享和 AI 会话仍必须按后端项目/归属规则判断。
- 私有项目只有创建者和超级管理员访问；公开项目其他登录用户只读。
- 动态路由的 `component` 字段只作为白名单 key，不可直接拼接 import 路径执行。
- 未实现接口不写成页面真实能力；统一进入 `api-gaps.md`。
- 数据库表、worker、内部 service 不作为页面能力依据。