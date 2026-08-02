# 后续实施计划

> 本文档按阶段定义 B 端管理后台的后续实施顺序。每个阶段只引用 `api-gaps.md` 中确认存在或确认缺失的接口，不创建假 API，不用静态数据冒充业务数据。缺口页面一律写为“等待后端补齐后实现”。
>
> 阶段顺序：通用 CRUD 基础设施 → 字典/部门/岗位 → 菜单 → 角色 → 用户 → 文件和异步任务 → 文档资料库 → 解析与结构化审核 → 分类关键词和同义词 → 公式规则和方案库 → 节点图库 → 项目中心 → AI 运营 → 报告和分享 → 系统监控 → 整体测试与交付。
>
> 状态：阶段 1（通用 CRUD 基础设施）、阶段 2（字典、部门、岗位）与阶段 3（菜单管理）已完成。

## 0. 职责分工（所有阶段通用）

| 层 | 职责 | 禁止事项 |
| --- | --- | --- |
| `src/api/modules/*` | 只描述网络契约：方法、路径、入参、出参、轻量字段适配 | 不写页面状态、不拼装业务逻辑 |
| `src/composables/*` | 页面流程状态：列表、抽屉、动作、筛选、分页、反馈 | 不直接改全局外观、不访问 `localStorage` |
| `src/stores/*` | 全局状态：认证、当前用户、动态菜单、外观 | 不承接单页表格查询状态 |
| `src/utils/*` | 纯函数投影与表单映射 | 不发请求、不读写 store |
| `src/components/business/*` | 业务组合：操作栏、抽屉、批量栏、导入上传、权限选择器 | 不做无职责薄包装 |
| `src/components/ui/*` | 通用 UI：数据表格、状态标签、空态、错误态 | 不写业务接口调用 |
| `src/views/**` | 只编排展示态与用户动作 | 不直接处理全局状态、不把契约逻辑扩散到 UI |
| `src/router/component-map.ts` | 后端 component key 到本地组件的白名单映射 | 不动态执行任意 import 路径 |

动态页面访问条件（每阶段页面交付时检查）：后端菜单返回合法 `component` 值 + `componentMap` 白名单存在该 key。缺失菜单由后端补种子（`GAP-007`），不用静态硬编码掩盖。

## 阶段 1：通用 CRUD 基础设施

**可使用的真实接口**：无（本阶段不调用业务接口，只建设复用层）。

**前端职责边界**：

- 通用表格组件：服务端分页、空态、错误态、加载态、行操作插槽。
- 通用操作栏：权限过滤、操作折叠、危险操作样式。
- 通用表单抽屉：打开/提交/关闭/提交中状态。
- 通用批量栏、导入上传、权限选择器。
- 通用列表/动作/抽屉 composable 与纯函数投影工具。
- 单元测试覆盖组件行为和 composable 状态流转。

**前置缺口**：无。

**完成判定**：`AppTableActions`、`useCrudList`、`useCrudDrawer`、`useCrudActions`、`usePermissionAccess` 及对应测试通过；不依赖任何后端业务接口。

**禁止 Mock 约束**：测试只使用通用协议夹具和浏览器能力替身；不把演示数据写入生产源码。

## 阶段 2：字典、部门、岗位

**可使用的真实接口**：

- 字典：`GET/POST /api/v1/platform/dictionaries`、`PATCH/DELETE /api/v1/platform/dictionaries/:id`、`GET/POST /api/v1/platform/dictionaries/:id/items`、`PATCH/DELETE /api/v1/platform/dictionaries/:id/items/:itemId`。
- 部门：`GET/POST /api/v1/platform/departments`、`GET /api/v1/platform/departments/tree`、`PATCH/DELETE /api/v1/platform/departments/:id`、`PATCH /api/v1/platform/departments/:id/status`、`GET /api/v1/platform/users?departmentId=`（成员查看）。
- 岗位：`GET/POST /api/v1/platform/posts`、`PATCH/DELETE /api/v1/platform/posts/:id`、`PATCH /api/v1/platform/posts/:id/status`。

**前端职责边界**：

- 字典：主列表真实全量请求、客户端确定性筛选/分页投影；选中字典后独立请求字典项；字典与字典项各自维护列表、抽屉、删除、反馈状态；变更后由后端缓存失效语义保证数据一致，不显示伪“刷新缓存”按钮。
- 部门：真实部门树；搜索保留匹配节点与祖先链；父级选择排除当前节点及全部后代，阻止循环层级；新增/编辑字段不对称（新增不接收负责人、电话、邮箱等编辑字段），前端分别映射；成员操作仅在拥有 `system:user:list` 权限时显示。
- 岗位：服务端分页；不做岗位成员功能（后端无对应接口）；删除/状态变更按真实接口执行。
- 权限：`system:dept:*`、`system:post:*`、`system:dict:*` 按实际 preHandler 校验。

**前置缺口**：无。

**完成判定**：三个页面均接入真实接口并通过定向回归测试；`componentMap` 增加三个实际 component key 映射；后端菜单返回合法 component 后可访问。

**禁止 Mock 约束**：不添加导入、导出、批量处理、手动刷新缓存或岗位成员等无真实路由支撑的操作。

## 阶段 3：菜单管理

**可使用的真实接口**：`GET/POST /api/v1/platform/menus`、`PATCH/DELETE /api/v1/platform/menus/:id`、`GET /api/v1/platform/permissions`。

**前端职责边界**：

- 目录/菜单/按钮三类节点的树形维护，主展示使用 `AppDataTable` 树形表格，保留展开收起、祖先链搜索和操作列。
- 动态组件标识允许手动输入或从候选搜索，但最终只能命中本地 `componentMap` 白名单，禁止自由输入并拼接 import 路径。
- 菜单图标只从 TDesign `manifest` 和 `src/assets/menu-icons/index.ts` 的显式本地 SVG 注册表选择；旧裸值只做已知别名兼容，未知值 fallback。
- 按钮节点写入 `permissionCode` 时由后端 `ensurePermissionCode` 最终校验；菜单编辑器允许手动输入权限码，前端不以权限资源列表阻止保存，权限资源列表仍服务于角色权限等业务。
- 层级循环保护（后端 `ensureMenuParent` 已实现，前端同步给出提示）。
- 外链菜单只接受绝对 HTTP(S) 地址，不注册 Vue 路由；内部菜单才注册动态路由。
- 菜单变更后重新获取运行时菜单，清理失效动态路由和 tabs，并在当前页面失效时安全回退。

**前置缺口**：`GAP-007` 菜单种子仍未覆盖完整业务页面；`GAP-011` 权限是否独立维护仍需确认，因此权限资源保持只读。

**完成判定**：已完成。菜单 CRUD 全链路可用；动态路由刷新后侧栏、路由、按钮权限、外链导航和失效 tabs 按职责收敛。

**禁止 Mock 约束**：不静态硬编码菜单来掩盖后端菜单缺失。

## 阶段 4：角色管理

**可使用的真实接口**：`GET/POST /api/v1/platform/roles`、`PATCH/DELETE /api/v1/platform/roles/:id`、`PATCH /api/v1/platform/roles/:id/status`、`GET /api/v1/platform/roles/export`、`PUT /api/v1/platform/roles/:id/permissions`、`PUT /api/v1/platform/roles/:id/departments`、`GET /api/v1/platform/roles/:id/users`、`PUT /api/v1/platform/users/:id/roles`。

**前端职责边界**：

- 角色 CRUD、状态、权限分配、数据范围、角色用户分页。
- 权限分配使用权限树；数据范围选择 `ALL/DEPT/DEPT_AND_CHILDREN/SELF/CUSTOM/PROJECT_OWNER`。
- 禁用角色权限立即失效的语义在前端状态展示中同步。

**前置缺口**：`GAP-011` 权限维护语义需确认；`GAP-012` 渠道用户可见范围需确认。

**完成判定**：角色 CRUD 与权限分配闭环可用；角色用户与用户角色双向入口一致。

**禁止 Mock 约束**：不自行实现后端没有的“数据范围执行”逻辑，展示以真实数据为准。

## 阶段 5：用户管理

**可使用的真实接口**：`GET /api/v1/platform/users`、`GET /api/v1/platform/users/export`、`POST /api/v1/platform/users/import`、`POST /api/v1/platform/users`、`GET/PATCH/DELETE /api/v1/platform/users/:id`、`PATCH /api/v1/platform/users/:id/status`、`POST /api/v1/platform/users/:id/restore`、`POST /api/v1/platform/users/:id/reset-password`、`PUT /api/v1/platform/users/:id/posts`、`PUT /api/v1/platform/users/:id/departments`、`PUT /api/v1/platform/users/:id/roles`。

**前端职责边界**：

- 用户列表（部门/角色/状态/关键字筛选）、创建、编辑、状态、删除/恢复、重置密码。
- 导入导出：CSV 模板、dryRun 校验、错误行展示。
- 岗位/部门/角色分配抽屉。
- `role` 与 `channelType` 强校验：渠道用户必须选择经销商/业务员，非渠道用户不能设置渠道类型。
- 不能禁用/删除当前登录账号的后端规则在前端同步提示。

**前置缺口**：`GAP-006`（自助资料修改不阻塞本阶段，个人中心单独处理）。

**完成判定**：用户全生命周期操作闭环；导入导出错误反馈准确；岗位/部门/角色分配与阶段 2、阶段 4 数据一致。

**禁止 Mock 约束**：CSV 导入/导出只走真实接口，不本地模拟导入结果。

## 阶段 6：文件和异步任务

**可使用的真实接口**：`GET /api/v1/files?projectId=`、`POST /api/v1/files/upload-intents`、`POST /api/v1/files/:id/complete`、`GET /api/v1/files/:id/status`、`GET /api/v1/files/:id/download-url`、`DELETE /api/v1/files/:id`。

**前端职责边界**：

- 预签名上传四步：计算 SHA-256 → 创建 upload intent → 直传对象存储 → complete 校验。
- 文件状态机展示：`UPLOADING/QUEUED/PARSING/OCR_REQUIRED/INDEXING/READY/FAILED/DELETED`。
- 状态轮询封装在 composable；上传成功不等于解析成功。
- 访问边界：只展示当前用户可见文件（owner 或超级管理员）；公开项目不开放源文件。

**前置缺口**：`GAP-005` 通用异步任务查询；`GAP-004` 知识处理详情。

**完成判定**：上传/状态/下载/删除闭环可用；`OCR_REQUIRED` 状态如实展示且不提供伪执行按钮。

**禁止 Mock 约束**：不本地模拟解析进度；不做“任务历史”等无接口能力。

## 阶段 7：文档资料库

**前置缺口**：`GAP-013`（知识文档、解析摘要、切片、重试/重建索引接口缺失）、`GAP-014`（OCR 执行与结果接口缺失）。

**完成判定**：等待后端补齐后实现，本阶段不写页面代码。后端补齐后按契约实现：文档列表、解析摘要、切片、重建索引、OCR 执行与结果。

**禁止 Mock 约束**：数据库表 `knowledge_documents`/`knowledge_chunks` 与 worker 不等于可开发接口；不得用文件列表冒充文档资料库。

## 阶段 8：解析与结构化审核

**前置缺口**：`GAP-015`（Excel/CSV/表格提取与结构化结果接口缺失）、`GAP-016`（结构化数据审核工作流、人工确认和审核意见接口缺失）。

**完成判定**：等待后端补齐后实现。后端补齐后按契约实现：表格提取任务、结构化结果、待审核列表、确认/驳回、审核意见。

**禁止 Mock 约束**：不得把文件状态当作审核状态；不得把知识文档列表当作审核工作台。

## 阶段 9：分类关键词和同义词

**前置缺口**：`GAP-017`（分类、关键词、同义词的实体、维护和审核接口缺失）。

**完成判定**：等待后端补齐后实现。后端补齐后按契约实现：分类/关键词/同义词的维护与审核。

**禁止 Mock 约束**：不得用动态字典（`dictionaries`）冒充业务分类体系。

## 阶段 10：公式规则和方案库

**前置缺口**：`GAP-018`（公式规则库、版本和确定性执行接口缺失）、`GAP-019`（方案库的实体、版本、标签、发布和检索接口缺失）。

**完成判定**：等待后端补齐后实现。后端补齐后按契约实现：公式 CRUD/版本/测试执行；方案 CRUD/版本/标签/发布/检索。

**禁止 Mock 约束**：不得把 AI 报告内容当作公式规则库；不得把报告中心当作方案库。

## 阶段 11：节点图库

**前置缺口**：`GAP-020`（节点图库的节点、素材、分类、缩略图和引用关系接口缺失）。

**完成判定**：等待后端补齐后实现。后端补齐后按契约实现：节点、素材、分类、缩略图、引用关系。

**禁止 Mock 约束**：不得把 AI 会话记录或文件列表当作图库节点/素材。

## 阶段 12：项目中心

**可使用的真实接口**：

- 平台：`GET /api/v1/platform/projects`、`GET /api/v1/platform/projects/statistics`。
- 工作台：`POST /api/v1/workspace/projects`、`GET /api/v1/workspace/projects/my`、`PATCH /api/v1/workspace/projects/:id`、`PATCH /api/v1/workspace/projects/:id/visibility`、`DELETE /api/v1/workspace/projects/:id`。
- 共用：`POST /api/v1/projects`、`GET /api/v1/projects/public`、`GET /api/v1/projects/:id`。

**前端职责边界**：

- 项目列表、我的项目、项目详情、创建/编辑/可见性/删除。
- 项目可见性规则展示：私有项目仅创建者与超级管理员；公开项目登录用户只读。
- 项目详情内嵌文件/报告/分享区按 `GAP-002`/`GAP-003`/`GAP-004` 边界实现。

**前置缺口**：`GAP-008`（`region/buildingType` 未开放）、`GAP-010`（按钮权限码）。

**完成判定**：项目 CRUD 与可见性切换闭环可用；创建/编辑表单只提交后端 schema 允许的字段。

**禁止 Mock 约束**：不提交 `region/buildingType`；不用项目列表拼装工作台统计（`GAP-001`）。

## 阶段 13：AI 运营

**可使用的真实接口**：`GET /api/v1/platform/ai/conversations`、`GET /api/v1/platform/ai/conversations/:id`、`GET /api/v1/platform/ai/feedbacks`。

**前端职责边界**：

- 会话运营列表（关键字/用户/项目/客户端/场景/状态筛选）、会话运营详情（消息、检索、工具调用、反馈、报告、分享、审计摘要）。
- 反馈分析列表与消息预览。
- 不返回模型原始思考链和密钥的边界在 UI 中体现。

**前置缺口**：`GAP-012`（渠道用户可见范围需后端确认）。

**完成判定**：运营列表/详情/反馈闭环可用；权限按 `system:ai:conversation:list/detail`、`system:ai:feedback:list` 校验。

**禁止 Mock 约束**：不按项目自行过滤假装安全；不展示后端未返回的处理阶段。

## 阶段 14：报告和分享

**可使用的真实接口**：

- 报告：`POST /api/v1/reports`、`GET /api/v1/reports/:id`、`POST /api/v1/reports/:id/generate`、`POST /api/v1/reports/:id/publish`、`GET /api/v1/reports/:id/artifacts/:type/download-url`、`DELETE /api/v1/reports/:id`。
- 分享：`POST /api/v1/shares`、`PATCH /api/v1/shares/:id/disable`。

**前端职责边界**：

- 报告详情：来源快照、产物下载、发布、重新生成、删除、创建分享。
- 分享创建弹窗：目标类型（`AI_MESSAGES/REPORT/REPORT_ARTIFACT/PROJECT`）、过期时间、最大访问次数。
- 已知分享上下文的禁用入口。

**前置缺口**：`GAP-002`（报告列表）、`GAP-003`（分享列表/详情/统计）。

**完成判定**：报告详情与分享创建/禁用闭环可用；列表页保持“等待后端补齐”状态。

**禁止 Mock 约束**：不实现报告列表假分页；不展示分享访问统计假数据。

## 阶段 15：系统监控

**可使用的真实接口**：`GET /api/v1/platform/audit-logs`、`GET /api/v1/platform/audit-logs/export`、`GET /api/v1/platform/login-logs`、`GET /api/v1/platform/online-users`、`DELETE /api/v1/platform/online-users/:id`、`GET /api/v1/platform/cache/info`、`GET /api/v1/platform/cache/keys`、`DELETE /api/v1/platform/cache/keys`、`GET /api/v1/platform/jobs`、`GET/POST /api/v1/platform/cron-jobs`、`PATCH /api/v1/platform/cron-jobs/:id/status`、`POST /api/v1/platform/cron-jobs/:id/run`。

**前端职责边界**：

- 审计日志：筛选、导出、JSON 展开。
- 登录日志：结果与客户端筛选（无导出接口，不显示导出按钮）。
- 在线用户：列表与强制下线确认。
- 缓存监控：Redis 信息、白名单前缀 Key 查询、删除 Key。
- 任务监控：cron 任务 CRUD/状态/立即执行与 cron 执行记录；不冒充通用异步任务管理（`GAP-005`）。

**前置缺口**：`GAP-005`（通用异步任务语义）。

**完成判定**：监控各页按真实接口闭环；任务监控只展示 cron 范围能力。

**禁止 Mock 约束**：不显示 `asyncTasks` 假列表；缓存删除只允许白名单前缀。

## 阶段 16：整体测试与交付

**质量门禁**：

- `pnpm test`：40 个测试文件、168 个测试通过。
- `pnpm exec vitest run src/components/ui/menu-icons.test.ts src/utils/system-menu.test.ts`：2 个测试文件、11 个测试通过。
- `pnpm exec vite build`：通过，转换 4247 个模块。
- `git diff --check HEAD`：通过；仅有 Git 的换行格式提示。
- `pnpm typecheck`：受既有 `vue-tsc@3.3.9` 与 `typescript@7.0.2` 不兼容阻断，未修改依赖或 `tsconfig`。
- `pnpm lint`：受既有 `typescript-eslint` 与 TypeScript 7 不兼容阻断；本轮重点文件的 `ReadLints` 未返回具体诊断。

后续整体交付仍需保留上述门禁；工具链兼容问题应单独处理，不通过回退依赖掩盖源码状态。

**一致性检查**：

- 四份文档（`current-status.md`、`api-gaps.md`、`page-map.md`、`next-implementation-plan.md`）的缺口编号连续、路径一致、状态一致、页面引用一致。
- `GAP-001` 至 `GAP-020` 无遗漏、无重复；所有“后端可开发”页面引用真实 endpoint；所有“被缺口阻塞”页面只引用 `GAP-*` 编号。
- 动态页面访问条件逐页核对：`componentMap` 白名单 + 后端菜单 component 值。

**交付口径**：

- 运行时界面不得展示内部规划、工程占位或开发进度文案。
- 未接入真实接口的页面保持壳层/空态或入口提示，不显示假数据。
- 后端未修改；前端工作区保留全部未提交改动。