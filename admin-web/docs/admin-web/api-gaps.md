# 接口缺口与风险清单

> 本文档统一登记 B 端管理后台开发时必须确认的后端契约缺口。编号在 `current-status.md`、`page-map.md`、`next-implementation-plan.md` 中保持一致。
>
> 判定依据：`backend/src/app.ts` 中实际注册的路由边界和 `backend/src/modules/**/*.routes.ts` 中真实路由。**数据库表、worker、内部 service 不等于可供后台开发的 HTTP 接口**，不能据此实现前端页面。

## 1. 缺口状态定义

| 状态 | 含义 | 前端处理 |
| --- | --- | --- |
| 可直接使用 | 后端已有接口，前端可进入开发 | 按契约实现 |
| 需要后端确认 | 后端有相近能力，但字段、权限、范围或语义不足 | 不写死，先确认契约 |
| 需要后端补齐 | 后端缺少独立接口或关键字段 | 不做完整页面能力 |
| 禁止 Mock | 如果缺口未补齐，前端不能用假数据伪装可用 | 页面仅保留入口或提示 |

## 2. 缺口总表

| 编号 | 缺口 | 状态 | 阻塞页面/模块 | 当前可用能力 | 建议后端补齐 |
| --- | --- | --- | --- | --- | --- |
| `GAP-001` | 工作台汇总接口缺失 | 需要后端补齐，禁止 Mock | `/dashboard` | 项目统计、AI 会话、AI 反馈、任务列表分散存在 | `GET /api/v1/platform/dashboard/summary`，按 B_ADMIN、权限、项目边界汇总 |
| `GAP-002` | 报告列表/筛选接口缺失 | 需要后端补齐，禁止 Mock | `/reports/list`、项目详情报告区 | 报告创建、详情、生成、发布、删除、产物下载已存在 | `GET /api/v1/reports` 或 `GET /api/v1/platform/reports`，支持项目、状态、创建人、发布时间筛选 |
| `GAP-003` | 分享后台列表、详情、统计接口缺失 | 需要后端补齐，禁止 Mock | `/shares/list`、`/shares/:id`、项目详情分享区 | 创建分享、禁用分享、匿名 token 访问已存在 | `GET /api/v1/shares`、`GET /api/v1/shares/:id`、`GET /api/v1/shares/:id/access-logs` 或统计字段 |
| `GAP-004` | 项目文件/知识文档查询能力不足 | 需要后端确认 | `/projects/:id` 文件区、`/files/:id` 知识处理详情 | 全局文件列表、上传、状态、下载、删除已存在 | 明确 `GET /api/v1/files?projectId=` 是否稳定；补知识切片/解析日志摘要接口 |
| `GAP-005` | 通用异步任务查询能力不足 | 需要后端确认 | 文件处理详情、报告生成、任务监控 | `GET /api/v1/platform/jobs` 是 cron 执行查询，不是通用 `asyncTasks` 管理；文件状态接口只返回最近一个文件任务 | 统一任务详情：`GET /api/v1/platform/tasks/:id`；业务任务关联 `fileId/reportId` |
| `GAP-006` | 当前用户资料修改与改密接口缺失 | 需要后端补齐 | `/account/profile` | `GET /api/v1/auth/b/getInfo`、退出登录已存在 | `PATCH /api/v1/auth/b/profile`、`POST /api/v1/auth/b/change-password` |
| `GAP-007` | 动态菜单种子未覆盖完整 B 端业务页面 | 需要后端确认 | 全部动态菜单与路由 | 后端种子仍只覆盖部分业务菜单；前端 `componentMap` 已通过构建期 glob 枚举全部现有 `src/views/**/*.vue` 页面，菜单表单兼容内部 key 与 `@/views/...vue` 路径 | 补齐工作台、项目中心、文件、报告、分享、AI 运营、AI 配置子菜单、登录日志，并为新增页面补充后端菜单数据 |
| `GAP-008` | 项目字段 `region/buildingType` 创建和修改输入不明确 | 需要后端确认 | `/projects/my`、`/projects/:id` | 数据库 projects 表存在 `region/buildingType`，但创建/更新 Zod schema 未开放这两个字段 | 在项目创建/更新 schema 中明确字段是否必填、来源字典和校验规则 |
| `GAP-009` | 系统管理相关 Swagger tag/目录归属不一致 | 需要后端确认 | OpenAPI 类型生成、接口文档导航 | 实际路由可用；字典相关 tag 与业务目录不一致 | 统一 tag：审计、登录日志、在线用户、缓存、任务、字典 |
| `GAP-010` | 项目/报告/分享操作缺少独立按钮权限码 | 需要后端确认 | 项目中心、报告中心、分享中心 | 主要依赖项目规则和少量 `project.create/system:project:list` | 增补按钮级权限码，例如 `project:update/delete/share`、`report:publish/delete`、`share:disable` |
| `GAP-011` | 权限列表缺少完整修改/删除能力 | 需要后端确认 | `/system/menus`、`/system/roles` 权限维护 | `GET/POST /platform/permissions` 已存在；菜单编辑器不再依赖该列表，角色权限范围仍可读取资源 | 若权限可由菜单按钮生成，则权限资源继续只读；若支持维护，补 `PATCH/DELETE /platform/permissions/:id` |
| `GAP-012` | 报告、分享与 AI 运营的项目级可见范围需要明确 | 需要后端确认 | AI 运营、报告详情、分享详情 | 后端已有项目规则和运营接口权限 | 明确运营接口是否仅 RBAC、是否支持渠道用户按项目范围过滤 |
| `GAP-013` | 知识文档、解析摘要、切片、重试/重建索引查询接口缺失 | 需要后端补齐，禁止 Mock | 文档资料库、文件处理详情 | `GET /api/v1/files/:id/status` 只返回最近文件任务；`knowledgeDocuments`/`knowledgeChunks` 只被 worker 和内部检索 service 使用 | 文档列表、解析摘要、切片、重建索引接口 |
| `GAP-014` | OCR 执行与结果接口缺失 | 需要后端补齐，禁止 Mock | 文件处理详情、文档资料库 | 当前扫描件只落到 `OCR_REQUIRED` 状态；OCR provider 未配置且无执行/结果接口 | OCR 任务创建、结果回填、重试接口 |
| `GAP-015` | Excel/CSV/表格提取与结构化结果接口缺失 | 需要后端补齐，禁止 Mock | 表格提取、结构化数据管理 | 文件上传与解析队列存在，但只支持 PDF/DOCX/PNG/JPEG 文本提取 | 表格文件提取任务、结构化结果存储和查询接口 |
| `GAP-016` | 结构化数据审核工作流、人工确认和审核意见接口缺失 | 需要后端补齐，禁止 Mock | 结构化数据审核 | 文件解析只产生 `knowledge_documents`/`knowledge_chunks`，无审核状态与意见字段 | 待审核列表、确认/驳回、审核意见接口 |
| `GAP-017` | 分类、关键词、同义词的实体、维护和审核接口缺失 | 需要后端补齐，禁止 Mock | 分类关键词和同义词 | 无对应表或路由 | 分类、关键词、同义词实体与维护/审核接口 |
| `GAP-018` | 公式规则库、版本和确定性执行接口缺失 | 需要后端补齐，禁止 Mock | 公式规则和方案库 | 无对应表或路由；AI 报告生成的公式计算不提供确定性执行接口 | 公式规则 CRUD、版本、测试执行接口 |
| `GAP-019` | 方案库的实体、版本、标签、发布和检索接口缺失 | 需要后端补齐，禁止 Mock | 方案库 | 无对应表或路由；项目、报告、分享只提供基础能力 | 方案 CRUD、版本、标签、发布、检索接口 |
| `GAP-020` | 节点图库的节点、素材、分类、缩略图和引用关系接口缺失 | 需要后端补齐，禁止 Mock | 节点图库 | 无对应表或路由；AI 会话中的 `aiRetrievalLogs`/`aiToolCalls` 不构成图库 | 节点、素材、分类、缩略图、引用关系接口 |
| `GAP-021` | AI 调用与费用统计聚合接口缺失 | 需要后端补齐，禁止 Mock | 调用与费用 | `aiMessages` 有 token/延迟/provider/model 原始字段，无聚合接口 | `GET /api/v1/platform/ai/usage/summary`，含 Token、次数、延迟、失败率、费用、服务商分布 |
| `GAP-022` | AI 调试台独立接口缺失 | 已解决 | AI 调试台 | `POST /api/v1/platform/ai/debug/chat`（SSE 流式）与 `POST /debug/:id/stop` 已存在，body 支持 scene/modelId/promptVersionId/reasoningMode/messages，不落库 | —（本轮已实现调试台页面） |
| `GAP-023` | 反馈处理状态、处理人与处理备注接口缺失 | 部分解决 | 反馈分析 | `PUT /api/v1/platform/ai/feedbacks/:id/handle` 已存在（body `{handlingNote, reasonCode?}`），表字段 `handledById/handledAt/handlingNote` | 缺"处理中"中间态与 handled 筛选（见 GAP-029） |
| `GAP-024` | 提示词发布、回滚与测试接口缺失 | 已解决 | 提示词管理 | `POST /prompts`（建草稿）、`PATCH /:id/draft`、`POST /:id/publish{versionId}`、`POST /:id/disable`、`POST /:id/versions/:vid/rollback`、`GET /:id/versions`、`GET /:id/versions/compare`、`DELETE /:id/versions/:vid` 全部存在 | —（本轮已实现三栏工作区） |
| `GAP-025` | 服务商默认标记与模型默认标记字段缺失 | 需要后端补齐 | 服务商、模型 | `ai_providers`/`ai_models` 无 `is_default`；默认模型由场景主模型绑定体现 | `is_default` 字段 + 切换默认接口 |
| `GAP-026` | 会话列表扩展筛选缺失 | 需要后端补齐 | 会话运营 | `GET /platform/ai/conversations` 仅支持 keyword/scene/clientApp/status 分页 | `modelId/timeRange/hasNegativeFeedback` 筛选 |
| `GAP-027` | 会话 token 汇总缺失 | 需要后端补齐 | 会话运营详情 | 消息级 token 已返回，会话级汇总需前端累加 | 详情响应补 `tokenSummary` |
| `GAP-028` | 模型 test-connection 为固定提示词非流式 | 需要后端补齐 | 模型列表"测试" | `POST /platform/ai/models/:id/test-connection` 固定 prompt、非流式、maxOutputTokens 16 | 自定义/流式测试统一走调试台（`debug/chat`），不再新增接口 |
| `GAP-029` | 反馈"处理中"中间态与 handled 筛选缺失 | 需要后端补齐 | 反馈分析 | 仅已处理/未处理两态；`GET /feedbacks` 无 handled 查询参数 | 表加处理中状态 + 查询参数 |
| `GAP-030` | 反馈处理人名称未 join | 需要后端确认 | 反馈分析 | `handledById` 仅返回 ID，未 join 用户名称 | 详情/列表响应 join `handled_by` 名称 |
| `GAP-031` | provider lastTestDurationMs 缺失 | 需要后端补齐 | 服务商"测试连接" | `POST /providers/:id/test-connection` 返回测试结果文本，无耗时字段 | 响应补耗时；当前前端本地计时 |

## 3. 分项说明

### GAP-001 工作台汇总接口缺失

工作台需要一次性展示：

- 项目数量、公开/私有分布、最近项目。
- AI 会话量、消息量、反馈趋势。
- 报告生成队列与失败状态。
- 待处理文件解析状态。
- 快捷入口权限状态。

当前这些能力散落在多个接口中，且不同接口的权限边界不完全一致。前端不应通过并发调用多个列表接口拼装“平台总览”，否则会导致统计口径、权限过滤和性能问题扩散到 UI 层。

建议后端提供（当前约定路径，前端尚未调用）：

```http
GET /api/v1/platform/dashboard/summary?range=7d
```

返回结构按模块拆分，并在服务端完成权限裁剪：

```jsonc
{
  "summary": {
    "projectTotal": 0,
    "pendingDocuments": 0,
    "pendingReviewData": 0,
    "reportTasks": 0
  },
  "attentionItems": [
    {
      "id": "",
      "priority": "high | medium | low",
      "type": "",
      "title": "",
      "description": "",
      "count": 0,
      "time": "",
      "route": "",
      "permission": ""
    }
  ],
  "knowledgePipeline": [
    { "stage": "PENDING_PARSE | PARSING | PENDING_REVIEW | STORED | FAILED", "count": 0 }
  ],
  "recentProjects": [
    { "id": "", "name": "", "region": "", "visibility": "PUBLIC | PRIVATE", "stage": "", "updatedAt": "", "ownerName": "" }
  ],
  "recentActivities": [
    { "id": "", "actor": "", "action": "", "objectName": "", "type": "", "time": "" }
  ],
  "trend": [
    { "date": "2026-03-14", "stored": 0, "reviewed": 0, "reports": 0 }
  ],
  "taskDistribution": [
    { "status": "PENDING | PROCESSING | COMPLETED | FAILED", "count": 0 }
  ]
}
```

缺口未补齐前，前端行为：

- 不请求多个列表接口自行拼装精确统计。
- 不使用随机 Mock 或伪造趋势。
- `summary`、`trend`、`taskDistribution` 为 `null`，列表为空数组。
- 页面正常展示 `--` 和空状态，快捷操作只来自真实动态菜单。

前端类型定义见 `src/types/dashboard.ts` 的 `DashboardOverview`。

### GAP-002 报告列表/筛选接口缺失

报告中心的列表页、项目详情报告区都依赖报告列表能力。当前详情和操作接口已足够支撑详情页，但不能反推出列表页。

最低需要：

- 分页。
- 项目筛选。
- 状态筛选。
- 创建人筛选。
- 关键字搜索。
- 是否已发布。
- 最近生成状态。

未补齐前，前端只能从明确入口进入报告详情，例如 AI 报告草稿转正式报告后跳转。

### GAP-003 分享后台列表、详情、统计接口缺失

当前分享能力偏“动作型”：创建、禁用、匿名访问。后台管理需要“管理型”查询：

- 我创建的分享。
- 项目下分享。
- 分享详情。
- 访问次数、最近访问时间。
- 访问记录。

未补齐前不实现完整分享中心列表；创建分享弹窗可以接真实 `POST /api/v1/shares`，禁用能力只能从已知分享 id 的上下文触发。

### GAP-004 项目文件/知识文档查询能力不足

文件模块已有全局文件列表和状态查询，但项目详情内嵌文件区、知识处理详情需要明确：

- `GET /api/v1/files?projectId=` 是否是稳定支持参数。
- 文件处理状态是否能返回解析、OCR、索引等阶段详情。
- 是否需要展示知识切片、索引数量、解析日志。

约束（已从运行时代码确认）：

- 文件列表接口只返回“我的源文件”，超级管理员可看全部；公开项目不开放源文件。
- 文件详情/状态/下载/删除仍只允许文件所有者或超级管理员访问（`canAccessSourceFile`），**不能推断项目成员共享访问**。
- 如果后端不打算开放知识切片，前端只能展示文件状态和错误摘要。

### GAP-005 通用异步任务查询能力不足

文件解析、报告生成、AI 处理、定时任务都涉及异步任务。当前事实：

- `GET /api/v1/platform/jobs` 是 **cron execution 查询**，不是通用 `asyncTasks` 管理。
- `GET /api/v1/files/:id/status` 返回文件与最近一个文件任务，但不提供任务历史、重试、取消。
- `GET /api/v1/platform/ai/conversations/:id` 只附带报告任务列表，不构成通用任务监控。

建议明确：

- 任务 id 与业务对象 id 的关联关系。
- 任务详情接口。
- 任务日志接口。
- 任务重试或取消能力是否开放。

### GAP-006 当前用户资料修改与改密接口缺失

个人中心当前只能展示 `getInfo` 和退出登录。资料编辑与修改密码不能复用用户管理接口，因为普通渠道用户不应拥有 `system:user:edit`。

建议补齐当前用户自助能力，并在后端内部限制只能修改本人允许字段。

### GAP-007 动态菜单种子未覆盖完整 B 端业务页面

当前种子菜单与完整 B 端产品地图不一致。前端可以临时用静态路由白名单承接动态菜单 key，但不应长期硬编码缺失菜单，否则按钮权限、菜单排序、面包屑、收藏和审计会出现多套来源。

后端应补齐菜单和权限种子，并明确：

- 目录、菜单、按钮类型枚举。
- `component` key 命名规范。
- `permission` 命名规范。
- 隐藏菜单和详情页的建模方式。

补充事实：前端本地 `componentMap` 现在通过构建期 `import.meta.glob('../views/**/*.vue')` 覆盖所有现有页面，并保留 `Home`、`home/index` 等历史 key；其余后端业务页面只有在对应 `.vue` 页面存在且后端菜单返回合法 component 时才能注册路由。

菜单管理页已经按该边界实现：管理列表读取扁平 `GET /api/v1/platform/menus` 并由前端构建树，运行时导航仍只读取 `GET /api/v1/auth/b/getRouters`；内部菜单组件使用可搜索但最终必须命中 `componentMap` 的候选输入，候选由全部 `src/views/**/*.vue` 页面构建并展示可读路径。权限码改为手动输入，前端只做格式校验；保存是否绑定到后端权限资源仍由菜单接口最终校验。菜单图标不拼接用户输入路径，只允许 TDesign manifest 图标、显式登记的 `local:<key>` SVG 资源和已知旧别名，未知值使用 fallback。

### GAP-008 项目字段 `region/buildingType` 创建和修改输入不明确

数据库 projects 表存在 `region`、`buildingType`，但 `createProjectBodySchema` 与 `updateProjectBodySchema` 未开放这两个字段。前端项目表单需要知道：

- `region` 是文本、省市区编码，还是级联对象。
- `buildingType` 来自字典还是自由输入。
- 创建时是否必填。
- 更新时是否允许修改。

该缺口会影响项目创建表单、筛选条件和统计卡片。未补齐前，前端不得在项目创建/更新请求中提交这两个字段。

### GAP-009 系统管理相关 Swagger tag/目录归属不一致

OpenAPI 类型生成依赖稳定 tag 和 schema。当前字典相关路由的 tag 为 `字典管理`，与 `B端 / 平台 / 基础数据` 不一致；部分平台运维接口 tag 为 `审计监控` 但实际属于多个模块。

处理原则：

- 前端 API 模块以实际路径为准。
- 文档导航和生成类型按后端 tag 读取。
- 不因 tag 混乱推测接口不存在。

### GAP-010 项目/报告/分享操作缺少独立按钮权限码

目前这些业务更多依赖项目规则，能保障安全，但后台按钮控制会不够细。例如：

- 能管理项目，不一定应该能删除项目。
- 能查看报告，不一定应该能发布报告。
- 能创建分享，不一定应该能禁用他人分享。

建议后端按业务动作补充按钮权限码。前端在补齐前按“项目规则 + 已有权限”保守展示。

### GAP-011 权限列表缺少完整修改/删除能力

已有 `GET/POST /platform/permissions`，但如果权限来源应由菜单按钮生成，权限本身不应该开放随意编辑。这里需要后端确认产品语义：

- 权限是否独立维护。
- 权限是否只读展示。
- 菜单按钮是否自动生成权限码。

前端在未确认前，权限列表只作为选择数据源，不做完整权限 CRUD。

### GAP-012 报告、分享与 AI 运营的项目级可见范围需要明确

AI 运营接口属于 `platform` 后台入口，天然 RBAC 强于项目规则。但渠道用户如果被授予部分运营权限，是否只能看自己项目相关会话和反馈，需要后端明确。

前端不能自行按项目过滤假装安全，因为真实数据仍以后端返回为准。

### GAP-013 知识文档、解析摘要、切片、重试/重建索引查询接口缺失

现状：

- `knowledgeDocuments` 与 `knowledgeChunks` 由 `document.worker.ts` 在解析成功后写入，只被内部 `searchProjectKnowledge` service 使用。
- `GET /api/v1/files/:id/status` 只返回文件和最近任务，不返回解析摘要、切片列表或索引数量。
- 没有“重建索引/重试解析”的管理接口。

禁止的前端假设：不能因为数据库有 `knowledge_documents`/`knowledge_chunks` 表，就认为后台可以查询或管理知识文档。

建议后端契约：

```http
GET    /api/v1/platform/knowledge/documents?projectId=&page=&pageSize=
GET    /api/v1/platform/knowledge/documents/:id
GET    /api/v1/platform/knowledge/documents/:id/chunks
POST   /api/v1/platform/knowledge/documents/:id/reindex
```

### GAP-014 OCR 执行与结果接口缺失

现状：

- `document.worker.ts` 对无法提取文本的文件写入 `OCR_REQUIRED` 状态后完成，没有 OCR 执行入口。
- `src/services/ocr/ocr-provider.ts` 的 `OcrNotConfiguredProvider` 抛出“OCR 服务尚未配置”。

禁止的前端假设：不能把 `OCR_REQUIRED` 状态展示为“可以点击执行 OCR”。没有接口就不做执行按钮。

建议后端契约：

```http
POST   /api/v1/platform/files/:id/ocr
GET    /api/v1/platform/files/:id/ocr/result
POST   /api/v1/platform/files/:id/ocr/retry
```

### GAP-015 Excel/CSV/表格提取与结构化结果接口缺失

现状：

- 文件解析只支持 PDF、DOCX 文本提取；PNG/JPEG 会落入 `OCR_REQUIRED`。
- 没有 Excel/CSV 表格提取任务或结构化结果存储。

禁止的前端假设：不能把通用文件上传接口当作“表格提取”能力，也不能把用户 CSV 导入（用户管理）当作业务表格提取。

建议后端契约：

```http
POST   /api/v1/platform/files/:id/table-extract
GET    /api/v1/platform/files/:id/table-result
```

### GAP-016 结构化数据审核工作流、人工确认和审核意见接口缺失

现状：

- 文件解析结果直接进入 `knowledge_documents`/`knowledge_chunks`，没有待审核状态、审核人、审核意见字段。
- 没有审核列表、确认、驳回接口。

禁止的前端假设：不能把知识文档列表当作审核工作台，也不能把文件状态当作审核状态。

建议后端契约：

```http
GET    /api/v1/platform/review/tasks?status=pending
POST   /api/v1/platform/review/tasks/:id/approve
POST   /api/v1/platform/review/tasks/:id/reject
```

### GAP-017 分类、关键词、同义词的实体、维护和审核接口缺失

现状：没有分类、关键词、同义词的数据库表或路由。

禁止的前端假设：不能复用 `dictionaries`（动态字典）冒充业务分类体系；动态字典只是通用枚举配置，不具备业务分类的层级、审核和引用语义。

建议后端契约：

```http
GET/POST   /api/v1/platform/knowledge/categories
GET/POST   /api/v1/platform/knowledge/keywords
GET/POST   /api/v1/platform/knowledge/synonyms
```

### GAP-018 公式规则库、版本和确定性执行接口缺失

现状：没有公式规则表或路由；AI 报告生成过程不提供可审计的确定性公式执行接口。

禁止的前端假设：不能把 AI 生成的报告内容当作“公式规则库”，也不能把提示词模板当作公式规则。

建议后端契约：

```http
GET/POST        /api/v1/platform/formulas
GET/PATCH/DELETE /api/v1/platform/formulas/:id
POST            /api/v1/platform/formulas/:id/versions
POST            /api/v1/platform/formulas/:id/evaluate
```

### GAP-019 方案库的实体、版本、标签、发布和检索接口缺失

现状：没有方案库表或路由；项目、报告、分享只提供基础能力。

禁止的前端假设：不能把报告中心当作方案库，也不能把分享快照当作方案版本。

建议后端契约：

```http
GET/POST        /api/v1/platform/solutions
GET/PATCH/DELETE /api/v1/platform/solutions/:id
POST            /api/v1/platform/solutions/:id/versions
POST            /api/v1/platform/solutions/:id/publish
GET             /api/v1/platform/solutions/search
```

### GAP-020 节点图库的节点、素材、分类、缩略图和引用关系接口缺失

现状：没有节点图库表或路由；AI 会话的 `aiRetrievalLogs`/`aiToolCalls` 不构成图库。

禁止的前端假设：不能把 AI 会话记录当作图库节点，也不能把文件列表当作节点素材库。

建议后端契约：

```http
GET/POST        /api/v1/platform/node-library/nodes
GET/PATCH/DELETE /api/v1/platform/node-library/nodes/:id
GET/POST        /api/v1/platform/node-library/assets
GET/POST        /api/v1/platform/node-library/categories
GET             /api/v1/platform/node-library/nodes/:id/references
```

### GAP-021 AI 调用与费用统计聚合接口缺失

现状：`aiMessages` 已记录 `tokenInput/tokenOutput/reasoningTokens/durationMs/provider/model/status` 等原始数据，但后端无任何聚合统计接口（全库仅 projects 模块有 `/platform/projects/statistics`）。

禁止的前端假设：不能在页面随机生成或本地推导统计数字冒充真实数据。

建议后端契约：

```http
GET /api/v1/platform/ai/usage/summary?from=&to=&providerId=&scene=
# 响应：{ token, requestCount, avgLatencyMs, failRate, cost, providerDistribution[] }
```

对应页面：调用与费用（Token、请求次数、延迟、失败率、费用、服务商分布），需配套权限码（如 `system:ai:usage:list`）。

### GAP-022 AI 调试台独立接口缺失（已解决）

**现状（本轮核对，以代码为准）**：`backend/src/modules/ai/ai-debug.routes.ts` 已提供完整调试台接口：

```http
POST /api/v1/platform/ai/debug/chat
# body: { scene?, modelId?, promptVersionId?, reasoningMode: 'OFF'|'ON', messages: [{role:'user'|'assistant', content≤60000}] 1-30 条 }
# 至少指定 scene/modelId/promptVersionId 之一；不落库
# SSE 事件：message{messageId,requestId} → progress{stage,message} → delta{text} → done{finishReason,usage,model,latencyMs} / stopped{messageId,partialContent,content,usage?} / error{code,message,requestId,retryable}
POST /api/v1/platform/ai/debug/:id/stop
```

已实现：`src/views/ai-ops/debug/index.vue` + `src/composables/useAiDebugger.ts` + `src/api/ai-sse.ts`（fetch + ReadableStream SSE 客户端，不经过 axios envelope）。`done` 事件仅含 `usage/model/latencyMs`（无 promptVersion/sources 字段，以代码为准）。SSE 线上格式为 `event: <name>\ndata: <json>\n\n`。权限码 `system:ai:debug:use`。

注意：调试台 body 不支持 `temperature/maxOutputTokens`（后端未定义），前端不提供这两个参数。

### GAP-023 反馈处理状态、处理人与处理备注接口缺失（部分解决）

**现状（本轮核对）**：`PUT /api/v1/platform/ai/feedbacks/:id/handle` 已存在，body `{handlingNote≤1000, reasonCode?}`，写入 `handledById/handledAt/handlingNote`（表字段无"处理中"中间态）。权限码 `system:ai:feedback:handle`。已实现"标记已处理"弹窗与处理状态/备注/时间/处理人列。

仍缺失：反馈"处理中"中间态、`GET /feedbacks` 的 handled 筛选（见 GAP-029）、处理人名称 join（见 GAP-030）。

### GAP-024 提示词发布、回滚与测试接口缺失（已解决）

**现状（本轮核对）**：`backend/src/modules/ai-config/ai-config.routes.ts` 已提供完整版本流：

```http
POST   /api/v1/platform/ai/prompts                        # 创建新模板+首个草稿（body: scene/name/description?/systemPrompt≥10/changeNote?）
PATCH  /api/v1/platform/ai/prompts/:id/draft              # 编辑草稿（body: name?/description?/systemPrompt/changeNote?）
POST   /api/v1/platform/ai/prompts/:id/publish            # 发布（body: {versionId}）
POST   /api/v1/platform/ai/prompts/:id/disable            # 停用当前生效版本
POST   /api/v1/platform/ai/prompts/:id/versions/:vid/rollback  # 基于历史版本创建新草稿
GET    /api/v1/platform/ai/prompts/:id/versions           # 版本列表（按版本号倒序，全行含 content）
GET    /api/v1/platform/ai/prompts/:id/versions/compare   # 版本元信息对比（from/to，不含 content）
DELETE /api/v1/platform/ai/prompts/:id/versions/:vid      # 删除草稿版本
DELETE /api/v1/platform/ai/prompts/:id                    # 删除未发布过的模板
```

权限映射：`add`→PROMPT_CREATE、`edit`→PROMPT_EDIT（draft/rollback/删版本）、`publish`→PROMPT_PUBLISH（publish/disable）、`remove`→PROMPT_DELETE。已实现三栏工作区（场景→模板→版本 + 草稿/发布/停用/回滚/删除 + 行级 diff 对比）。

注意：`compare` 接口不返回 content，前端 diff 直接使用 `GET /:id/versions` 返回的 `content` 字段（`diffPromptVersions` 行级对比）。

### GAP-025 服务商默认标记与模型默认标记字段缺失

现状：`ai_providers` 与 `ai_models` 均无 `isDefault` 字段；"默认模型"由场景绑定的 `primaryModelId` 体现，模型列表无默认标识。

禁止的前端假设：不能把"启用"或场景主模型绑定数当作默认标记。

建议后端契约：`ai_providers.is_default`、`ai_models.is_default`（数据库唯一部分索引保证单条默认），并提供切换默认接口。

### GAP-026 会话列表扩展筛选缺失

现状：`GET /platform/ai/conversations` 支持 `keyword/scene/clientApp/status` 分页筛选，无 `modelId/timeRange/hasNegativeFeedback`。前端不提供这些筛选（页面仅展示现有列）。

### GAP-027 会话 token 汇总缺失

现状：会话详情 `messages[]` 有 token 字段，但会话级汇总需前端累加，后端无 `tokenSummary` 字段。前端不做伪汇总展示。

### GAP-028 模型 test-connection 为固定提示词非流式

现状：`POST /platform/ai/models/:id/test-connection` 固定 prompt、非流式、`maxOutputTokens 16`。模型列表"连通性测试"保留该行为；自定义问题/流式/停止测试统一由 AI 调试台（`debug/chat`）承接，不在模型列表堆叠。

### GAP-029 反馈"处理中"中间态与 handled 筛选缺失

现状：`aiMessageFeedbacks` 仅 `handledById/handledAt/handlingNote` 三字段，无"处理中"状态；`GET /feedbacks` 无 handled 查询参数。前端仅提供两态展示（已处理/未处理），不提供"处理中"操作与筛选。

### GAP-030 反馈处理人名称未 join

现状：`handledById` 仅返回用户 ID，后端未 join 处理人名称。前端按 ID 展示。

### GAP-031 provider lastTestDurationMs 缺失

现状：`POST /providers/:id/test-connection` 返回测试结果文本并写库 `lastTestStatus/lastTestMessage/lastTestAt`，无耗时字段。前端在测试弹窗本地计时展示耗时，不写库。

## 4. 后端已有接口清单（以实际注册为准）

以下接口全部来自 `backend/src/app.ts` 注册边界和 `backend/src/modules/**/*.routes.ts` 真实路由；统一省略 `/api/v1` 前缀。

### 4.1 认证与公共

| 模块 | 接口 |
| --- | --- |
| 认证 | `GET /auth/b/captchaImage`、`POST /auth/b/login`、`GET /auth/b/getInfo`、`GET /auth/b/getRouters`、`POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me`、`POST /auth/client/*`（C 端/PC 端） |
| 公共字典 | `GET /dicts`（固定基础枚举：项目可见性、用户角色、渠道类型、报告状态、文件状态） |
| 当前权限 | `GET /permissions/me` |

### 4.2 系统管理

| 模块 | 接口 | 路由文件 |
| --- | --- | --- |
| 用户 | `GET /platform/users`、`GET /platform/users/export`、`POST /platform/users/import`、`POST /platform/users`、`GET/PATCH/DELETE /platform/users/:id`、`PATCH /platform/users/:id/status`、`POST /platform/users/:id/restore`、`POST /platform/users/:id/reset-password`、`PUT /platform/users/:id/posts`、`PUT /platform/users/:id/departments` | `users.routes.ts` |
| 角色 | `GET/POST /platform/roles`、`PATCH/DELETE /platform/roles/:id`、`PATCH /platform/roles/:id/status`、`GET /platform/roles/export`、`PUT /platform/roles/:id/permissions`、`PUT /platform/roles/:id/departments`、`GET /platform/roles/:id/users`、`PUT /platform/users/:id/roles` | `system-management.routes.ts` + `platform-ops.routes.ts` |
| 权限 | `GET/POST /platform/permissions` | `system-management.routes.ts` |
| 菜单 | `GET/POST /platform/menus`、`PATCH/DELETE /platform/menus/:id` | `system-management.routes.ts` |
| 部门 | `GET/POST /platform/departments`、`GET /platform/departments/tree`、`PATCH/DELETE /platform/departments/:id`、`PATCH /platform/departments/:id/status` | `system-management.routes.ts` + `platform-ops.routes.ts` |
| 岗位 | `GET/POST /platform/posts`、`PATCH/DELETE /platform/posts/:id`、`PATCH /platform/posts/:id/status` | `platform-ops.routes.ts` |
| 字典 | `GET/POST /platform/dictionaries`、`PATCH/DELETE /platform/dictionaries/:id`、`GET/POST /platform/dictionaries/:id/items`、`PATCH/DELETE /platform/dictionaries/:id/items/:itemId` | `system-management.routes.ts` + `platform-ops.routes.ts` |

注意：角色、部门、字典的“创建”接口位于 `system-management.routes.ts`，“修改/删除/状态/子资源”位于 `platform-ops.routes.ts`；前端 API 模块按路径组织，页面不感知文件归属。

### 4.3 项目

| 边界 | 接口 |
| --- | --- |
| 工作台 | `POST /workspace/projects`、`GET /workspace/projects/my`、`PATCH /workspace/projects/:id`、`PATCH /workspace/projects/:id/visibility`、`DELETE /workspace/projects/:id` |
| 共用 | `POST /projects`、`GET /projects/public`、`GET /projects/:id` |
| 平台 | `GET /platform/projects/statistics`、`GET /platform/projects` |

项目权限由 `src/shared/permissions.ts` 控制，独立于后台 RBAC；公开项目只读、私有项目仅创建者与超级管理员可访问。

### 4.4 文件与解析任务

| 接口 | 说明 |
| --- | --- |
| `GET /files?projectId=` | 我的源文件列表（超级管理员可看全部；公开项目不开放） |
| `POST /files/upload-intents` | 创建直传凭证 |
| `POST /files/:id/complete` | 确认上传完成，进入解析队列 |
| `GET /files/:id/status` | 文件状态 + 最近一个文件任务 |
| `GET /files/:id/download-url` | 源文件下载地址 |
| `DELETE /files/:id` | 删除文件（软删除） |

访问边界：文件详情/状态/下载/删除只允许文件所有者或超级管理员，不能推断项目成员共享访问。

### 4.5 AI 对话与 AI 运营

| 模块 | 接口 |
| --- | --- |
| AI 对话 | `POST /ai/conversations`、`GET /ai/conversations`、`GET /ai/conversations/:id`、`PATCH /ai/conversations/:id`、`PUT /ai/conversations/:id/pin`、`PATCH /ai/conversations/:id/project`、`DELETE /ai/conversations/:id`、`POST /ai/conversations/:id/restore`、`PATCH /ai/conversations/:id/settings`、`POST /ai/conversations/:id/messages`、`POST /ai/messages/:id/stop`、`PUT /ai/messages/:id/feedback`、`POST /ai/messages/:id/regenerate`、`POST /ai/conversations/:id/report-draft` |
| AI 配置 | `GET/POST /platform/ai/providers`、`PATCH/DELETE /platform/ai/providers/:id`、`PATCH /platform/ai/providers/:id/status`、`POST /platform/ai/providers/:id/test-connection`（provider 级，非流式，写库测试结果）、`GET/POST /platform/ai/models`、`PATCH/DELETE /platform/ai/models/:id`、`PATCH /platform/ai/models/:id/status`、`POST /platform/ai/models/:id/test-connection`、`GET /platform/ai/scene-bindings`、`PUT /platform/ai/scene-bindings`、`GET/POST /platform/ai/prompts`、`PATCH /platform/ai/prompts/:id/draft`、`POST /platform/ai/prompts/:id/publish`、`POST /platform/ai/prompts/:id/disable`、`POST /platform/ai/prompts/:id/versions/:vid/rollback`、`GET /platform/ai/prompts/:id/versions`、`GET /platform/ai/prompts/:id/versions/compare`、`DELETE /platform/ai/prompts/:id/versions/:vid`、`DELETE /platform/ai/prompts/:id` |
| AI 运营 | `GET /platform/ai/conversations`、`GET /platform/ai/conversations/:id`、`GET /platform/ai/feedbacks`、`PUT /platform/ai/feedbacks/:id/handle`、`POST /platform/ai/debug/chat`（SSE 流式）、`POST /platform/ai/debug/:id/stop` |

### 4.6 报告与分享

| 模块 | 接口 |
| --- | --- |
| 报告 | `POST /reports`、`GET /reports/:id`、`POST /reports/:id/generate`、`POST /reports/:id/publish`、`GET /reports/:id/artifacts/:type/download-url`、`DELETE /reports/:id` |
| 分享 | `POST /shares`、`PATCH /shares/:id/disable`、`GET /public/shares/:token`（匿名） |

### 4.7 监控

| 模块 | 接口 |
| --- | --- |
| 审计 | `GET /platform/audit-logs`、`GET /platform/audit-logs/export` |
| 登录日志 | `GET /platform/login-logs` |
| 在线用户 | `GET /platform/online-users`、`DELETE /platform/online-users/:id` |
| 缓存 | `GET /platform/cache/info`、`GET /platform/cache/keys`、`DELETE /platform/cache/keys`（只允许白名单前缀） |
| 任务 | `GET /platform/jobs`（cron execution）、`GET/POST /platform/cron-jobs`、`PATCH /platform/cron-jobs/:id/status`、`POST /platform/cron-jobs/:id/run` |

## 5. 页面阻塞矩阵

| 页面 | 阻塞缺口 | 可先实现范围 |
| --- | --- | --- |
| `/dashboard` | `GAP-001` | 仅搭建静态布局和空状态；不展示假统计 |
| `/projects/list` | `GAP-008`、`GAP-010` | 平台项目列表和统计可用；高级字段筛选需确认 |
| `/projects/my` | `GAP-008`、`GAP-010` | 我的项目 CRUD 可用；字段按后端 schema 确认后实现 |
| `/projects/:id` | `GAP-002`、`GAP-003`、`GAP-004`、`GAP-010` | 基础详情可用；文件/报告/分享区受限 |
| `/files/list` | `GAP-004` | 上传、状态、下载、删除可用 |
| `/files/:id` | `GAP-004`、`GAP-005` | 文件状态可用；处理时间线需确认 |
| `/ai/conversations` | `GAP-010` | 我的会话可用 |
| `/ai/conversations/:id` | `GAP-010`、`GAP-012` | SSE、反馈、停止、重新生成可用 |
| `/reports/list` | `GAP-002`、`GAP-010` | 暂不实现完整列表 |
| `/reports/:id` | `GAP-010` | 详情、生成、发布、下载、删除可用 |
| `/shares/list` | `GAP-003`、`GAP-010` | 暂不实现完整列表 |
| `/shares/:id` | `GAP-003`、`GAP-012` | 暂不实现后台详情 |
| `/account/profile` | `GAP-006` | 只读资料、退出登录可用 |
| 文档资料库 | `GAP-013`、`GAP-014`、`GAP-015`、`GAP-016` | 暂不实现完整能力；可复用文件列表展示状态 |
| 表格提取/结构化审核 | `GAP-015`、`GAP-016` | 暂不实现 |
| 分类关键词和同义词 | `GAP-017` | 暂不实现 |
| 公式规则和方案库 | `GAP-018`、`GAP-019` | 暂不实现 |
| 节点图库 | `GAP-020` | 暂不实现 |
| 动态菜单 | `GAP-007` | 可实现白名单投影；缺失菜单需后端补种子 |
| OpenAPI 类型生成 | `GAP-009` | 可生成，但模块归属需人工校正 |

## 6. 实施闸门

后续开发前必须确认：

1. `GAP-001`、`GAP-002`、`GAP-003` 是否进入一期后端补齐范围。
2. `GAP-007` 的完整菜单种子是否由后端维护。
3. 项目表单字段来源，尤其是 `region` 与 `buildingType`。
4. 项目/报告/分享是否需要按钮级权限码。
5. AI 运营接口对渠道用户的可见范围。
6. `GAP-013` 至 `GAP-020` 的知识库后台是否进入产品范围，以及对应的实体与流程定义。

未确认前的前端原则：

- 不创建假接口。
- 不展示假统计。
- 不用 Mock 伪装列表。
- 不把“接口可调用”写成“产品能力完整”。
- 不把数据库表、worker 或内部 service 当作可开发接口。
- 对已存在能力先做窄路径闭环：登录、动态路由、系统管理、项目基础、AI SSE。