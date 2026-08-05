# 蓝格 VICP 后端 AI 开发规则

## 项目定位

本仓库是“蓝格智配 VICP 建筑节能 AI 智配系统”统一后端，服务于 PC AI 对话端、B 端管理后台和 C 端 App/小程序。核心业务包括项目管理、VICP 资料知识库、AI 辅助问答、工程报告生成和全流程审计。

当前不使用租户模型。平台数据统一存储，以项目作为业务访问边界。

## 固定技术栈

- Node.js LTS、TypeScript、pnpm。
- Fastify、Zod、Swagger。
- PostgreSQL、Drizzle ORM、postgres.js。
- Redis、BullMQ。
- AI SDK、OpenAI-compatible 模型服务商。
- MinIO（开发）、阿里云 OSS（生产）。
- Docker Compose、Nginx。

普通 CRUD 使用 Drizzle 查询构建器。全文检索、`pg_trgm`、未来 `pgvector` 及复杂排序可以使用参数化原生 SQL。禁止拼接用户输入生成 SQL。

## 常用命令

- 安装依赖：`pnpm install --frozen-lockfile`
- 启动 API：`pnpm dev`
- 启动 Worker：`pnpm dev:worker`
- 类型检查：`pnpm lint`
- 构建：`pnpm build`
- 测试：`pnpm test`
- 生成迁移：`pnpm db:generate`
- 执行迁移：`pnpm db:migrate`
- 初始化数据：`pnpm db:seed`
- 启动完整环境：`docker compose up --build`

## 架构约束

- 在 `src/plugins` 注册 Fastify 基础设施。
- 在 `src/modules/<模块>` 内维护业务路由、schema 和服务。
- 在 `src/db/schema.ts` 定义持久化模型；修改后必须生成并检查 migration。
- API 与 Worker 共用数据库、存储和业务服务，不复制业务规则。
- 请求输入和 AI 结构化输出使用 Zod 校验。
- 成功响应保持 `{ success, data, requestId }`；失败响应保持 `{ success, error, requestId }`。
- 业务错误统一返回 HTTP `200`，`error.code` 使用数值型 HTTP 语义码：访问令牌、刷新令牌和当前登录态无效使用 `401`；权限不足使用 `403`；参数错误使用 `400`；其他业务处理失败使用 `500`；未捕获的服务器异常返回 HTTP `500` 且 `error.code` 为 `500`。
- 面向用户、管理员和开发人员的提示、Swagger 描述、日志与 AI 提示词使用中文。
- API 路径、JSON 字段、错误码、数据库字段、枚举和代码标识符保持英文。

路由边界：

- `/api/v1/platform/*`：B 端平台管理，先校验 `B_ADMIN`，再按具体权限码授权；超级管理员全量放行。
- `/api/v1/platform/knowledge/*`：B 端平台知识库管理（分类/文档/版本/解析/审核/发布/检索日志/别名词典/批量导入/抓取源/排序规则/检索评测），按 `system:knowledge:*` 权限码授权；批量导入返回预签名地址，直传后走 upload-complete 确认。
- `/api/v1/platform/masterdata/*`：B 端平台主数据管理（企业内容/证书、产品系列/规格/性能参数/附件、材料/材料参数版本），按 `system:md:*` 权限码授权；统一审核状态机 DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED（可驳回 REJECTED，发布后 new-version 派生新草稿），已发布读取接口 `/published/*` 只返回 PUBLISHED 且生效中的数据，供计算模块确定性取数。
- `/api/v1/platform/construction/*`：B 端平台构造方案管理（保温系统、构造方案/构造层/产品选项/方案文档），按 `system:construction:*` 权限码授权；版本化状态机复用 masterdata `md-workflow.service.ts`（`registerVersionedEntity` 注册 + 共用工作流工厂），new-version 同事务复制子表；submit/publish 前强制结构校验（层序连续、基层/产品层唯一、产品层厚度落在选项区间、引用规格/材料已发布生效）；已发布读取接口 `/published/*` 只返回 PUBLISHED 且生效中的数据，供未来图集热工查表模块取数。详见 `docs/construction/README.md`。
- `/api/v1/internal/knowledge/*`：服务间受控接口（静态密钥 `x-internal-key` = `env.INTERNAL_API_KEY`，未配置则整体禁用）；服务端直写对象存储并投递解析，产物为 DRAFT 待审核，不自动发布；不校验 B_ADMIN 客户端。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- `/api/v1/workspace/*`：B 端渠道工作台，先校验 `B_ADMIN`，再执行项目级权限。
- `/api/v1/projects/*`：登录用户共享项目读取。
- `/api/v1/files/*`：源文件上传、状态和受控下载。
- `/api/v1/ai/*`：AI 会话与流式对话。
- `/api/v1/reports/*`：报告生成、发布和下载。
- `/api/v1/shares/*`：登录用户创建和禁用公开分享链接。
- `/api/v1/public/shares/*`：匿名访问公开分享快照或报告文件。

## Swagger 文档规范

- 所有新增或修改的 Fastify 路由必须在 `schema.tags` 中声明标签。
- 标签统一使用“客户端边界 / 业务模块”格式，客户端边界只能是 `B端`、`C端`、`PC AI端`、`共用` 或 `公共`。
- B 端平台管理使用 `B端 / 平台 / <模块>`，B 端工作台使用 `B端 / 工作台 / <模块>`；认证、AI、文件、报告和分享等能力必须根据真实访问边界选择标签。
- 标签只用于 Swagger 文档分类，不替代 JWT、客户端类型、精确权限码、项目权限或文件/会话归属校验。
- 不得新增没有客户端前缀的旧式标签，例如 `用户管理`、`AI 对话`、`文件` 或 `报告`；新增标签应同时登记到 `src/plugins/swagger.ts` 的 OpenAPI 标签目录。

## 权限与审计

- 固定业务身份为 `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER`。
- 经销商和业务员统一为 `CHANNEL_USER`，通过 `channelType` 标签区分。
- 超级管理员和渠道用户可以创建项目；普通用户第一期不能创建。
- 私有项目仅创建者和超级管理员访问。
- 公开项目允许所有登录用户只读；只开放已发布报告，不开放源文件和原始 AI 会话。
- 动态 RBAC 控制后台菜单和功能，不能覆盖项目访问规则。
- `ProjectMember` 只作为扩展点，第一期不开放协作接口。
- 项目变更、权限变更、AI 配置、AI 调用、文件和报告操作必须记录审计。
- 业务写入和对应审计应处于同一个数据库事务。

## AI、文件与报告边界

- AI 不能执行任意 SQL、Shell、服务器文件操作或绕过权限读取数据。
- AI 只能调用具有 Zod 输入、权限检查和审计的后端工具。
- 工程计算由确定性代码完成；AI 负责参数提取、检索、解释和结构化报告草稿。
- 标准条文和技术结论必须引用检索来源；资料不足时明确说明不确定，禁止编造。
- 模型按业务场景从数据库解析，禁止在业务代码写死 DeepSeek 或模型 ID。
- API Key 必须 AES-256-GCM 加密保存，任何响应都不得返回密钥。
- AI 回答点赞、反馈和重新生成都必须保留原始消息，不覆盖历史回答。
- AI 流式回答支持停止：停止只结束当前生成，必须保存已生成内容并将消息标记为 `STOPPED`；会话保持可继续发送新消息。
- 深度思考是会话级设置，默认 `OFF`；每条消息保存实际 `reasoningMode`，不能用全局开关覆盖用户会话。
- AI 场景与提示词版本化：模型按场景解析（`ai_scenes` + `prompts` + `prompt_versions`），提示词只有 DRAFT/PUBLISHED/DISABLED 三种状态、同场景全局唯一生效版本；已发布版本不可直接修改（编辑派生新草稿）。
- 仅 `general_chat` 场景对外开放；其他场景未具备知识库/公式/工具能力前不得对外宣称完整业务能力（`enabled` 门控）。
- AI 配额：并发生成（Redis 计数）+ 每日请求数双重限制，`SUPER_ADMIN` 豁免；错误使用统一 `AI_*` 错误码（`src/shared/ai-errors.ts`）。
- AI 配置、运营、反馈处理与调试使用独立 `system:ai:*` 权限码并写审计，详见 `docs/ai/`。
- AI 会话历史支持分页、搜索、来源筛选、项目筛选、重命名、按用户置顶、移动项目、软删除和恢复；删除会话必须禁用由该会话产生的有效 AI 分享链接。
- 多条 AI 回答生成报告时，通过 `report_sources` 保存来源顺序和回答快照。
- 公开分享只暴露分享快照或已生成报告文件，不开放源文件、知识库原文或原始 AI 会话。
- `PROJECT` 分享只暴露项目摘要和已发布报告快照；不得返回项目源文件、知识库原文、未发布报告、原始会话或后台权限信息。
- 源文件使用预签名直传；解析、OCR、索引和报告导出必须通过 BullMQ Worker。
- OCR 未配置时将文件标记为 `OCR_REQUIRED`，不得把空解析结果当成功。
- 知识库文档版本化：版本状态机 DRAFT -> APPROVED -> PUBLISHED -> DISABLED（照抄 prompt_versions 风格），只有 PUBLISHED 版本参与检索，已发布版本不可直接修改（编辑派生新草稿）；解析任务走 `parsing_jobs` 领域表，与通用 `async_tasks` 职责分离；知识库多来源（B 端上传/批量导入/爬虫/内部 API）统一走 `knowledge-ingest.service` 入库链路，插入 `files` 前按 SHA-256 查重（已发布版本冲突抛 409，仅草稿提示先处理），爬虫与内部 API 产物默认 DRAFT/REVIEW_PENDING 待审核；检索权重来自 `knowledge_ranking_rules` 可配置，检索评测存 `knowledge_search_evaluations`。详见 `docs/knowledge/README.md`。
- 报告以结构化 JSON 为事实源，模板生成 HTML、图片、Word 和 PDF。

## 需求变更定位

- 数据模型或索引：`src/db/schema.ts` 和 `drizzle/`。
- 项目可见性：`src/shared/permissions.ts` 与项目模块。
- 用户、角色、部门、字典：用户、权限和系统管理模块。
- 文件上传、解析、OCR：文件模块、存储适配器和文档 Worker。
- 知识库文档、版本、解析、检索：知识库模块（`src/modules/knowledge/`）、`knowledge_*`/`parsing_jobs` 表及 `drizzle/` 最新迁移；后台知识库接口按 `system:knowledge:*` 权限码授权。
- 企业/产品/材料参数主数据：主数据模块（`src/modules/masterdata/`，服务层 + `md-workflow.service.ts` 通用状态机 + `md.schemas.ts` DTO + `masterdata.routes.ts`）、`md_*` 表；权限码见 `src/shared/md-permissions.ts`；已发布读取服务 `md-read.service.ts` 只返回 PUBLISHED 且生效中的数据；导入示例 `pnpm md:import-example`。详见 `docs/masterdata/README.md`。
- 保温系统/构造方案/构造层/产品选项/方案文档：构造模块（`src/modules/construction/`，服务层 + 结构校验器 `construction-structure.service.ts` + 已发布读取 `construction-read.service.ts` + `construction.schemas.ts` DTO + `construction.routes.ts`）、`insulation_systems`/`construction_schemes`/`construction_layers`/`scheme_product_options`/`scheme_documents` 表；版本化状态机与工作流工厂复用 masterdata（`registerVersionedEntity`/`registerVersionedWorkflow`，见 `src/modules/masterdata/md-workflow.service.ts` 与 `workflow-routes.ts`）；权限码见 `src/shared/construction-permissions.ts`；导入示例 `pnpm construction:import-example`。详见 `docs/construction/README.md`。
- AI 模型配置、围栏、对话：AI 配置模块、AI 模块和知识检索模块；后台 AI 配置与运营接口按 `system:ai:*` 权限码授权。
- AI 停止生成和会话深度思考：`src/modules/ai/ai.routes.ts`、`ai_messages`/`ai_conversations` 状态字段及 `drizzle/` 最新迁移。
- AI 回答点赞、反馈和重新生成：AI 模块、平台 AI 反馈模块、`ai_message_feedbacks`、`ai_message_regenerations`。
- 报告来源和报告输出：报告模块、报告 Worker、`report_sources`。
- 公开分享：分享模块、`share_links`、`share_views`。
- Redis/BullMQ：队列定义、插件和 Worker 入口。
- 全局错误、响应和中文提示：共享错误、响应及错误处理插件。

修改长期约束时，同步更新本文件、`README.md`、`.agents/skills/lg-backend` 和 `.cursor/rules`。
- 客户端固定为 `B_ADMIN`、`C_APP`、`PC_AI`。所有 `/api/v1/platform/*` 和 `/api/v1/workspace/*` 接口必须先通过 JWT 和 `B_ADMIN` 客户端校验，C 端和 PC AI 端不得调用后台管理接口。
- B 端后台接口必须同时具备认证和接口级权限码校验。超级管理员可以直通；其他 B 端账号必须拥有对应按钮权限，例如 `system:user:list`、`system:user:add`、`system:menu:edit`、`system:ai:model:test`。
- 不允许使用“拥有任意 `system:*` 权限即可访问整个模块”的宽权限判断。新增、修改、删除、导出、分配和查看必须使用不同权限码。
- 角色权限查询必须过滤 `roles.enabled = true`。禁用角色不能继续授予菜单或接口权限。
- C 端和 PC AI 端虽然不能访问后台管理接口，但可以访问明确开放的业务接口（AI、公开项目、本人项目、受控文件、报告和分享）；这些接口必须继续执行项目所有者、项目可见性、会话归属和文件归属校验。
- 项目业务权限独立于后台 RBAC。RBAC 只控制后台菜单和按钮，不能替代 `canViewProject`、`canManageProject` 等项目级校验。
- 动态路由只返回当前 B 端账号拥有权限的目录、页面和按钮；Vue 端只能从组件白名单加载组件，不能执行数据库任意路径。

### 权限变更验收

- 用 C_APP 和 PC_AI 令牌请求任意 `/platform`、`/workspace` 接口必须返回 `FORBIDDEN`。
- B_ADMIN 无权限时，查看、新增、修改、删除、导出和分配接口分别返回 `FORBIDDEN`。
- 禁用角色后重新请求接口，原角色权限立即失效。
- B 端仍可访问 AI 业务接口，但必须通过场景、客户端来源、项目和会话权限校验。
