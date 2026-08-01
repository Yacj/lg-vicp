# 页面地图

本文档定义 Vue 3 B 端管理后台的菜单、页面、子页面、抽屉/弹窗、接口与权限边界。页面规划基于已实现后端能力；缺失能力统一引用 `api-gaps.md`。

## 1. 页面与模块统计

- 业务模块数：15 个。
- 一期主页面数：28 个，不含基础布局、错误页、抽屉、弹窗。
- 隐藏详情/流程路由：5 个，用于项目详情、文件处理详情、分享详情、AI 报告草稿、AI 运营详情。
- 后端种子菜单只覆盖部分页面；完整菜单需要由前端规划与后端菜单数据补齐配合，详见 `GAP-007`。

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

## 2. 完整菜单树

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
│  └─ 文件处理详情 /files/:id                隐藏路由，由文件列表/项目详情进入
├─ 分享中心 /shares
│  ├─ 分享列表 /shares/list
│  └─ 分享详情 /shares/:id                  隐藏路由，由分享列表/业务上下文进入
├─ AI 运营 /ai-ops
│  ├─ 会话运营 /ai-ops/conversations
│  ├─ 会话运营详情 /ai-ops/conversations/:id  隐藏路由，由会话运营进入
│  └─ 反馈分析 /ai-ops/feedbacks
├─ AI 配置 /ai-config
│  ├─ 服务商 /ai-config/providers
│  ├─ 模型 /ai-config/models
│  ├─ 场景绑定 /ai-config/scenes
│  └─ 提示词 /ai-config/prompts
├─ 系统管理 /system
│  ├─ 用户管理 /system/users
│  ├─ 角色管理 /system/roles
│  ├─ 菜单管理 /system/menus
│  ├─ 部门管理 /system/departments
│  ├─ 岗位管理 /system/posts
│  └─ 字典管理 /system/dictionaries
├─ 系统监控 /monitor
│  ├─ 审计日志 /monitor/audit-logs
│  ├─ 登录日志 /monitor/login-logs
│  ├─ 在线用户 /monitor/online-users
│  ├─ 缓存监控 /monitor/cache
│  └─ 任务监控 /monitor/jobs
└─ 个人中心 /account/profile
```

## 2.1 28 个一期主页面口径

| 模块 | 一期主页面数 | 页面 |
| --- | ---: | --- |
| 认证与个人 | 2 | 登录页、个人中心 |
| 工作台 | 1 | 工作台 |
| 项目中心 | 2 | 项目列表、我的项目 |
| 文件与知识 | 1 | 文件列表 |
| AI 工作台 | 2 | AI 对话、会话详情 |
| 报告中心 | 2 | 报告列表、报告详情 |
| 分享中心 | 1 | 分享列表 |
| 用户管理 | 1 | 用户管理 |
| 角色权限 | 1 | 角色管理 |
| 菜单管理 | 1 | 菜单管理 |
| 组织架构 | 2 | 部门管理、岗位管理 |
| 基础数据 | 1 | 字典管理 |
| AI 配置 | 4 | 服务商、模型、场景绑定、提示词 |
| AI 运营 | 2 | 会话运营、反馈分析 |
| 系统监控 | 5 | 审计日志、登录日志、在线用户、缓存监控、任务监控 |

隐藏详情/流程路由不计入 28 个一期主页面，但必须实现权限守卫：`/projects/:id`、`/files/:id`、`/shares/:id`、`/ai/report-drafts/:conversationId`、`/ai-ops/conversations/:id`。

## 3. 页面明细

### 3.1 认证与个人

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 超级管理员与渠道用户差异 |
| --- | --- | --- | --- | --- | --- |
| 登录页 | `/login` | 验证码刷新、登录表单 | `GET /api/v1/auth/b/captchaImage`、`POST /api/v1/auth/b/login` | 无 | `NORMAL_USER` 后端禁止登录 B 端；`SUPER_ADMIN` 与 `CHANNEL_USER` 都可登录 |
| 个人中心 | `/account/profile` | 基本资料、权限摘要、部门岗位摘要、退出确认 | `GET /api/v1/auth/b/getInfo`、`POST /api/v1/auth/logout` | 登录态 | 暂无当前用户资料修改与改密接口，见 `GAP-006` |

### 3.2 工作台

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 工作台 | `/dashboard` | 项目卡片、AI 使用态势、报告队列、快捷入口 | 已有能力分散：`GET /api/v1/platform/projects/statistics`、`GET /api/v1/ai/conversations`、`GET /api/v1/platform/ai/feedbacks`、`GET /api/v1/platform/jobs` | 按卡片分权限 | 缺少汇总接口，见 `GAP-001`；渠道用户只能展示本人项目和本人会话 |

### 3.3 项目中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 超级管理员与渠道用户差异 |
| --- | --- | --- | --- | --- | --- |
| 项目列表 | `/projects/list` | 筛选、统计、详情跳转 | `GET /api/v1/platform/projects`、`GET /api/v1/platform/projects/statistics`、`GET /api/v1/projects/public` | `system:project:list` 或登录态公开项目读取 | 超级管理员可看平台全量；渠道用户若无 `system:project:list` 只能看我的项目/公开项目 |
| 我的项目 | `/projects/my` | 新建项目、编辑、可见性切换、删除确认 | `GET /api/v1/workspace/projects/my`、`POST /api/v1/workspace/projects`、`PATCH /api/v1/workspace/projects/:id`、`PATCH /api/v1/workspace/projects/:id/visibility`、`DELETE /api/v1/workspace/projects/:id` | `project.create` + 项目规则 | 超级管理员和渠道用户可创建；渠道用户只能管理自己创建的项目 |
| 项目详情 | `/projects/:id` | 基础信息、文件、AI 会话、报告、分享入口；编辑项目抽屉 | `GET /api/v1/projects/:id`、项目相关文件/报告/分享能力 | 项目规则优先 | 私有项目仅创建者和超级管理员；公开项目其他登录用户只读 |

项目详情内嵌区域说明：

- 文件区：受 `GAP-004` 限制，目前只有全局文件列表按 `projectId` 查询，无知识文档专用接口。
- 报告区：受 `GAP-002` 限制，目前没有项目报告列表接口。
- 分享区：受 `GAP-003` 限制，目前没有分享列表接口。

### 3.4 文件与知识

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 文件列表 | `/files/list` | 上传文件、处理状态、下载、删除 | `GET /api/v1/files`、`POST /api/v1/files/upload-intents`、`POST /api/v1/files/:id/complete`、`GET /api/v1/files/:id/status`、`GET /api/v1/files/:id/download-url`、`DELETE /api/v1/files/:id` | 登录态 + 文件归属 | 超级管理员可看全部文件；渠道用户只能看自己文件；公开项目不开放源文件 |
| 文件处理详情 | `/files/:id` | 处理时间线、任务信息、错误原因 | `GET /api/v1/files/:id/status` | 登录态 + 文件归属 | 只展示文件状态与最近任务；知识切片详情缺口见 `GAP-004` |

### 3.5 AI 智配

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| AI 对话 | `/ai/conversations` | 新建会话、搜索、置顶、恢复、删除 | `GET/POST /api/v1/ai/conversations`、`PUT /api/v1/ai/conversations/:id/pin`、`DELETE /api/v1/ai/conversations/:id`、`POST /api/v1/ai/conversations/:id/restore` | `ai.chat` 建议作为菜单权限；接口按登录态与归属 | 超级管理员可通过共用接口看自己会话；平台全量运营走 AI 运营页 |
| 会话详情 | `/ai/conversations/:id` | SSE 输入区、停止、反馈、重新生成、移动项目、报告草稿、分享 | `GET /api/v1/ai/conversations/:id`、`POST /api/v1/ai/conversations/:id/messages`、`POST /api/v1/ai/messages/:id/stop`、`PUT /api/v1/ai/messages/:id/feedback`、`POST /api/v1/ai/messages/:id/regenerate`、`PATCH /api/v1/ai/conversations/:id/project`、`PATCH /api/v1/ai/conversations/:id/settings` | 登录态 + 会话归属 | 私有项目会话仍需项目可见；报告生成必须可管理项目 |
| AI 报告草稿 | `/ai/report-drafts/:conversationId` | 草稿生成、草稿预览、转正式报告 | `POST /api/v1/ai/conversations/:id/report-draft`、`POST /api/v1/reports`、`POST /api/v1/reports/:id/generate` | 登录态 + 项目管理 | 渠道用户只能对自己项目生成；公开只读用户不能生成报告 |

AI 流式要求：

- 发送消息与重新生成均使用 `fetch + AbortController`。
- 不允许用 Axios JSON 请求替代 SSE。
- UI 状态机必须保留 `STOPPED` 内容。

### 3.6 报告中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 报告列表 | `/reports/list` | 筛选、状态、下载、发布、删除 | 现有只有 `GET /api/v1/reports/:id` 等详情/操作接口 | 项目规则 | 缺少列表/筛选接口，见 `GAP-002` |
| 报告详情 | `/reports/:id` | 来源快照、产物下载、发布、重新生成、删除、创建分享 | `GET /api/v1/reports/:id`、`POST /api/v1/reports/:id/generate`、`POST /api/v1/reports/:id/publish`、`GET /api/v1/reports/:id/artifacts/:type/download-url`、`DELETE /api/v1/reports/:id`、`POST /api/v1/shares` | 项目规则 | 非项目管理者只能查看已发布报告并下载已发布产物 |

### 3.7 分享中心

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 分享列表 | `/shares/list` | 复制链接、禁用、访问统计 | `PATCH /api/v1/shares/:id/disable`；创建散落在 AI/报告/项目动作中 | 登录态 + 分享创建者/超级管理员 | 缺少分享列表与统计接口，见 `GAP-003` |
| 分享详情 | `/shares/:id` | 快照预览、访问记录 | 无登录态详情接口；匿名访问为 `GET /api/v1/public/shares/:token` | 登录态缺口 | 后台详情和访问记录缺口见 `GAP-003` |

### 3.8 AI 运营

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 会话运营 | `/ai-ops/conversations` | 筛选、用户/项目跳转、详情 | `GET /api/v1/platform/ai/conversations` | `system:ai:conversation:list` | 超级管理员直通；渠道用户需动态权限，但仍不是项目规则替代品 |
| 会话运营详情 | `/ai-ops/conversations/:id` | 消息、检索、工具调用、反馈、报告、分享访问、审计摘要 | `GET /api/v1/platform/ai/conversations/:id` | `system:ai:conversation:detail` | 可见范围由后台权限控制；不返回模型原始思考链和密钥 |
| 反馈分析 | `/ai-ops/feedbacks` | 反馈筛选、消息预览、用户/项目跳转 | `GET /api/v1/platform/ai/feedbacks` | `system:ai:feedback:list` | 渠道用户除非授予权限，否则不显示 |

### 3.9 AI 配置

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 服务商 | `/ai-config/providers` | 新建/编辑服务商、API Key 状态 | `GET/POST/PATCH/DELETE /api/v1/platform/ai/providers` | `system:ai:provider:list/add/edit/remove` | 不返回密钥；仅 `hasApiKey` |
| 模型 | `/ai-config/models` | 新建/编辑模型、连接测试 | `GET/POST/PATCH/DELETE /api/v1/platform/ai/models`、`POST /api/v1/platform/ai/models/:id/test-connection` | `system:ai:model:list/add/edit/remove/test` | 渠道用户通常不授予 |
| 场景绑定 | `/ai-config/scenes` | 设置主模型/备用模型/提示词 | `GET /api/v1/platform/ai/scene-bindings`、`PUT /api/v1/platform/ai/scene-bindings` | `system:ai:scene:list/edit` | 影响全部业务场景，默认平台管理员能力 |
| 提示词 | `/ai-config/prompts` | 新增版本、删除版本、查看系统提示词 | `GET/POST /api/v1/platform/ai/prompts`、`DELETE /api/v1/platform/ai/prompts/:id` | `system:ai:prompt:list/add/remove` | 不支持编辑，只能新增版本或删除 |

### 3.10 系统管理

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 用户管理 | `/system/users` | 新建/编辑、状态、删除/恢复、重置密码、导入导出、岗位/部门/角色分配 | 用户管理全部接口 | `system:user:*` | 创建/编辑时必须区分 `role` 与 `channelType` |
| 角色管理 | `/system/roles` | 新建/编辑、状态、删除、权限分配、数据范围、角色用户 | 角色相关接口 | `system:role:*`、`system:user:role` | 禁用角色权限立即失效 |
| 菜单管理 | `/system/menus` | 新建/编辑/删除目录/菜单/按钮 | 菜单接口、权限列表接口 | `system:menu:*`、`system:permission:list` | 动态组件标识必须映射本地白名单 |
| 部门管理 | `/system/departments` | 部门树、新建/编辑、状态、删除 | 部门接口 | `system:dept:*` | 删除前需无下级和用户 |
| 岗位管理 | `/system/posts` | 新建/编辑、状态、删除 | 岗位接口 | `system:post:*` | 作为用户岗位标签，不是 RBAC |
| 字典管理 | `/system/dictionaries` | 字典项抽屉、字典/字典项维护 | 字典接口 | `system:dict:*` | 部分 Swagger 标签不一致，见 `GAP-009` |

### 3.11 系统监控

| 页面 | 路由 | 子页面/弹窗 | 使用接口 | 权限码 | 差异 |
| --- | --- | --- | --- | --- | --- |
| 审计日志 | `/monitor/audit-logs` | 筛选、导出、JSON 展开 | `GET /api/v1/platform/audit-logs`、`GET /api/v1/platform/audit-logs/export` | `monitor:audit:list/export` | 超级管理员直通 |
| 登录日志 | `/monitor/login-logs` | 登录结果、客户端筛选 | `GET /api/v1/platform/login-logs` | `monitor:login-log:list` | 无导出接口 |
| 在线用户 | `/monitor/online-users` | 强制下线确认 | `GET /api/v1/platform/online-users`、`DELETE /api/v1/platform/online-users/:id` | `monitor:online:list/kick` | 强制下线会黑名单 access token |
| 缓存监控 | `/monitor/cache` | Redis 信息、白名单 Key 查询、删除 Key | `GET /api/v1/platform/cache/info`、`GET /api/v1/platform/cache/keys`、`DELETE /api/v1/platform/cache/keys` | `monitor:cache:list/remove` | 只能操作白名单前缀 |
| 任务监控 | `/monitor/jobs` | 异步执行、定时任务、手动运行、状态切换 | `GET /api/v1/platform/jobs`、`GET/POST /api/v1/platform/cron-jobs`、`PATCH /api/v1/platform/cron-jobs/:id/status`、`POST /api/v1/platform/cron-jobs/:id/run` | `monitor:job:list/add/edit/run` | 通用异步任务查询能力不足，见 `GAP-005` |

## 4. 动态菜单与页面差异

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
- AI 运营独立菜单。
- AI 配置拆成服务商、模型、场景、提示词。
- 登录日志页面。

这些缺口不允许用前端硬编码长期掩盖，应记录为 `GAP-007`。

## 5. 抽屉与弹窗清单

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
| JSON 查看弹窗 | 审计/AI 运营/任务 | 展开复杂 JSON |

## 6. 页面级实施约束

- 所有后台接口必须带 `B_ADMIN` access token。
- 菜单和按钮按 RBAC 控制；项目详情、文件、报告、分享和 AI 会话仍必须按后端项目/归属规则判断。
- 私有项目只有创建者和超级管理员访问；公开项目其他登录用户只读。
- 动态路由的 `component` 字段只作为白名单 key，不可直接拼接 import 路径执行。
- 未实现接口不写成页面真实能力；统一进入 `api-gaps.md`。