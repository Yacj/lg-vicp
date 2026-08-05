# 四 Tab 改造 · 阶段 1 审计报告

> 日期：2026-08-05
> 范围：APP 仓库（`e:\code\lg\app`）只读审计 + 后端（`e:\code\lg\backend`）契约核对
> 结论依据：以仓库实时代码为准，非文档

## 1. 四个 Tab 实际代码状态

| Tab | 页面 | 状态 | 主要问题 |
| --- | --- | --- | --- |
| 首页 | `src/pages/index/index.vue` | 工作台 + 数据区块（阶段 5） | 最近会话/推荐项目接真实接口；「我的项目」入口仍需登录 | 
| 项目 | `src/pages/projects/index.vue` | 真实接口（阶段 6） | 我的/公开双范围接 `/client/projects` + `/projects/public`，本地搜索 + 分页；新建入口按 `capabilities.canCreateProject` 控制 |
| 筑小格 | `src/pages/assistant/index.vue` | 静态占位 | 固定欢迎消息 + 假回复，无附件/hero/抽屉 |
| 我的 | `src/pages/profile/index.vue` | 结构基本可用 | Tab 根页有返回箭头；协议内容为占位文案 |

**关键结论：当前 APP 没有可视底部 TabBar。**
- `src/layouts/tabbar.vue` 仅 `<slot />` 透传，无 TabBar UI
- `src/composables/useTabbar.ts` 定义了 `tabbarList/setTabbarItemActive` 等状态，但全仓库无调用点
- `src/customize-tab-bar/`（支付宝端）为空实现
- `pages.config.ts` 已配置 `tabBar: { custom: true, height: '0' }`，原生 TabBar 被禁用
- 四 Tab 顺序与 pagePath 在 `src/constants/navigation.ts` 已正确：home → projects → assistant → profile
- Tab 图标资源：`src/static/tabbar/` 有 8 张 PNG（疑似 4 图标 × 2 状态），文件名无语义（`ChatGPT Image 2026-08-03 ...`），需人工确认映射

## 2. 首页与筑小格重复点

首页 AI 交互需整体迁移到筑小格（阶段 3）：

- AI 欢迎区（hero 视觉、`home-hero-art`、欢迎语"你好，我是筑小格"）
- 快捷问题（`suggestions` + 横向滑动）
- 输入区（折叠/展开 composer、`wd-textarea`、发送按钮）
- 附件选择（`src/services/attachments` 的 pickAttachment/previewAttachment）
- 消息流（气泡、头像、角色反转）
- 模型选择器（静态 deepseek，**后端无 C 端模型接口，应移除**）
- 左侧导航抽屉（`AppDrawer.vue`，已接真实接口，随迁移由筑小格持有）

## 3. 真实 API 清单与 APP 声明差异

### 3.1 认证（`/api/v1/auth`）— 匹配，可用

| 接口 | 状态 |
| --- | --- |
| `POST /client/login/password`、`/client/sms/send`、`/client/login/sms` | 真实可用 |
| `POST /client/login/wechat` | 后端未配置时返回 Forbidden("微信登录尚未配置")，前端"即将上线"占位合理 |
| `POST /refresh`、`/logout`、`GET /client/getInfo`、`GET /me` | 真实可用 |

### 3.2 AI（`/api/v1/ai`）— 能力完整，APP 声明匹配

真实存在：创建/列表/详情/重命名/置顶/移动/删除/恢复/settings/发送/停止/反馈/重新生成/report-draft/scene/group/quota。

SSE 事件帧（`backend/src/modules/ai/ai-sse.ts` + `ai.routes.ts`）：
`message` → `progress{stage: analyzing|checking|composing|completed}` → `delta{text}` → `done{messageId, finishReason, usage, model, promptVersion, sources:[{title,page}], latencyMs}`；停止时 `stopped`；失败时 `error{code,message,retryable}`。

契约差异：
- `sendMessageBodySchema` 仅 `content`，**无附件 ID 字段** → 附件引用为后端依赖
- 反馈支持 `reasonCode/tags/content`（APP types 已声明）
- 会话列表返回 `project{id,name}`、`messageCount`、`lastMessage{role,status,preview}`（APP `ConversationRecord` 未声明这些字段，阶段 4 补充）
- 会话详情返回 `processingSummary/retrievals/feedbacks/regenerations/reports/shareLinks`（APP `ConversationDetail` 用 `unknown[]` 声明，阶段 4 收敛类型）

### 3.3 项目（`/api/v1` + `/workspace`）— 部分可用，权限受限

- `GET /projects/public`、`GET /projects/:id`：可用（需登录）
- `POST /projects`：C_APP 可调，但后端 `canCreateProject` 仅 CHANNEL_USER / SUPER_ADMIN 放行 → **C 端普通用户无创建权限**（`capabilities.canCreateProject` 也仅在 B_ADMIN 下为 true）
- `GET /workspace/projects/my`：B 端工作台接口，无 requireClient 限制，C 端是否可用需联调确认；**无正式 C 端"我的项目"列表接口**
- 创建/编辑 schema 仅 `name/description/visibility` → **地区、建筑类型字段后端不接收**
- 项目表 `status` 为字符串（active/deleted 等运维态），无"计算待确认/报告生成中"等业务状态；`metadata` JSON 可承载扩展 → 业务状态字段为后端依赖

### 3.4 文件（`/api/v1/files`）— 可用，类型受限

intent → 直传 `uploadUrl` → `complete` → `status` 轮询，流程完整。支持 MIME 仅：pdf / docx / png / jpeg（`file.schemas.ts`）。

**契约差异：前端附件选择器允许 `.txt`（`src/services/attachments/index.ts` allowedFileExtensions），后端不支持** → 阶段 4 对齐（移除 txt 或选择后明确提示）。

### 3.5 报告（`/api/v1/reports`）— 无列表接口

创建/详情/重新生成/发布/制品下载/删除均存在；**`GET /reports` 列表不存在** → 报告页只能空状态 + 功能开关，列表接口列入后端依赖。

### 3.6 分享（`/api/v1/shares`）— 可用

创建（AI 消息/报告/报告制品/项目四种 target）/禁用/公开查看。

### 3.7 其他

- **节点图收藏：后端无任何相关接口**（全文搜索无 favorite 相关代码）→ 功能开关 + 待接入提示
- **首页聚合：无 `client/home/overview`** → 阶段 5 已用现有接口组合（`/ai/conversations` 最近会话 + `/projects/public` 推荐项目 + 登录引导），模块失败隔离

## 4. 后端依赖清单

> 阶段 6 已消化项已标注 ✅（2026-08-05 后端补口后复核）

| 功能 | 当前问题 | 需要的接口或字段 | 优先级 |
| --- | --- | --- | --- |
| 我的项目列表 | ✅ 已新增 `GET /client/projects`（C 端分页，按 createdById 过滤）；`/workspace/projects/my` 被 auth 插件限定 B_ADMIN，C 端不可用 | — | 高（阶段 6） |
| C 端新建项目权限 | NORMAL_USER 被 `canCreateProjectFromClient` 拒绝（仅 CHANNEL_USER / SUPER_ADMIN 放行）；`/client/getInfo` 的 `capabilities.canCreateProject` 已改为与真实权限一致，前端按能力位控制入口 | 产品确认 C 端是否允许普通用户创建，或放开权限 | 高（阶段 6，待产品决策） |
| 项目地区/建筑类型 | ✅ create/update schema 已增加 `region`、`buildingType`（DB 表字段本就存在） | — | 高（阶段 6） |
| 项目业务状态 | 无业务状态/进度字段（status 仅 active/deleted 运维态）；详情页已改为展示真实档案信息，流程区块降级为静态指引 | 状态枚举 + 进度规则（或约定 metadata 结构） | 中（阶段 6 未消化） |
| C 端模型列表与切换 | 无接口；创建会话无 model 字段 | `GET /ai/client/models` 或由服务端按场景分配 | 中（阶段 4） |
| 消息附件引用 | `sendMessageBody` 仅 content | content 增加附件 ID 列表（或 message 级 attachments） | 中（阶段 4） |
| 报告列表 | 无 `GET /reports` | C 端报告列表接口 | 中（阶段 7） |
| 节点图收藏 | 无任何收藏接口 | 收藏/列表/删除接口 | 低（阶段 7） |
| 首页聚合 | 无 overview | `GET /client/home/overview`（可后置，先前端组合） | 低（阶段 5） |

## 5. 功能开关建议（阶段 2 落地 `src/constants/features.ts`）

```ts
export const appFeatures = {
  homeRecentProjects: true,        // 阶段 5 用 /projects/public + 我的项目组合
  homeRecentConversation: true,    // 阶段 5 用 /ai/conversations
  projectListMine: false,          // 后端无 C 端我的项目接口
  projectListPublic: true,         // /projects/public 可用
  aiAttachments: false,            // 消息接口不接收附件 ID
  aiSources: true,                 // done 事件携带 sources
  aiModelPicker: false,            // 无 C 端模型接口
  reportsList: false,              // 无报告列表接口
  nodeFavorites: false,            // 无收藏接口
  smartSelection: false,           // 专业工具未接入
  thermalCalculation: false,
  materialComparison: false,
}
```

## 6. 跨端风险记录

- `src/services/platform/index.ts` 的 `createAiStreamRequest`：H5 用 fetch 流式；App/小程序端走 `uni.request` **整包接收后再解析**（无增量、长回答可能超时，Alova timeout 60s）。阶段 4 需真机验证，微信小程序可评估 `wx.request({enableChunked})` 条件编译方案，App 端若不可行则退化为非流式并保留"生成中"状态。
- 自定义 TabBar（阶段 2）：需处理底部安全区（`env(safe-area-inset-bottom)`）与内容遮挡（`--app-content-bottom-space` 已定义）；H5/小程序/App 三端验证。
- 附件选择：H5 用 input[file]、小程序用 `chooseMessageFile`、App 端**未适配**（返回 unsupported）→ 阶段 4 补 App 端或开关隐藏。

## 7. 阶段 1 输出要求核对

- [x] 当前四个 Tab 的实际代码状态（第 1 节）
- [x] 当前首页和筑小格重复点（第 2 节）
- [x] 现有真实 API 清单（第 3 节）
- [x] APP 与后端字段差异（第 3 节契约差异）
- [x] 无法实现的功能（收藏、模型切换、报告列表等，第 4 节）
- [x] 需要新增的后端接口（第 4 节）
- 本阶段未修改任何页面代码（仅本报告）。