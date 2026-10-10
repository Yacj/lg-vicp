# 蓝格 VICP 后端

2026-10-10 知识页全文渲染与语义高亮：现有 B/C/AI 页面详情增量返回确认快照派生的 `renderModel`，保留公共 λ/α 与多厚度档位；AI `referencePages.semanticHighlights` 使用稳定 optionId 和正式字段名定位，严格同页同构造同档位核验，保留旧参数条与页图。无迁移，不改识别主链或热工公式。[后端契约与 B/C 接入说明](docs/knowledge/page-render-highlight-contract.md)。

2026-10-10 知识版本原文问答修复：传入检索文段的问答固定走 KNOWLEDGE，避免“有么/传热系数”抢入正式参考表；补充同页上下文以辨认表头和构造档位，原文数值保留，参考行未绑定不作为无方案结论。详见[修复记录](docs/ai/knowledge-test-routing-fix-2026-10-10.md)。

2026-10-10 热工自然对话最终优化：独立新问题清历史，追问局部增改删，族名按正式ID集合严格匹配，候选对比只读所选冻结记录。LLM基于Allowed Facts自然表达，实际出现事实逐段核验，不使用全文相等或回答数值容差；失败重生成一次再fallback。无迁移、公式或客户端协议修改。实现、回归与真实UAT阻塞记录见[最终优化报告](docs/ai/thermal-natural-dialogue-final-2026-10-10.md)。

知识库停用后可直接重新启用原版本：`POST /api/v1/platform/knowledge/versions/:versionId/enable`，要求 B_ADMIN 与知识库发布权限，重新校验发布门禁。版本号、审核记录、正文及页面保留；已有其他发布版本时需先停用。发布、停用和启用由文档行锁串行执行并同事务写审计，无数据库结构变更。真实前后端联调：向本机临时 PostgreSQL 设置 `KNOWLEDGE_ACTIVATION_DATABASE_URL`，在 backend 执行 `pnpm exec tsx scripts/verify-knowledge-activation.ts`；脚本只使用随机临时库并自动清理，不写既有数据库。

热工统一约束与事实门禁（2026-10-10）：会话 `lastReferenceLookup.query` 采用统一 Zod QueryState，硬条件/软偏好/歧义与 conditionTrace 分开；正式业务名称和启用别名解析实体，统一 Constraint Engine 对候选逐项 AND 校验，缺事实不能证明通过。未操作条件继承，取消指标/实体持久化 tombstone，模型重复摘要不得复活；相邻候选独立 nearbyCandidates/NOT_FULLY_MATCHED，不再进入正式 candidates。查表与计算切换保留状态，计算继承唯一或单选记录并校验正式对象关系；候选对比只读取所选冻结记录。热工正文在首个 SSE delta 前按后端完整事实句契约校验，失败重生成一次，仍失败使用确定性模板；不把数值白名单当字段/候选绑定证明。印刷页码只取 pageLabel，λ/α 继续严格确认快照绑定。合规必须证明所选标准、地区、建筑类型及必要结构类型。无数据库迁移、无公式变化；API 结构为增量字段，但 candidates 不再包含违规/缺事实/相邻项的行为变化需联调。详见 `docs/ai/thermal-constraint-closeout-2026-10-10.md`。


2026-10-09 热工回答质量：Candidate原子事实绑定、产品R/总R歧义澄清、真实印刷页码、销售简短回答与专业追问展开；无DB迁移或计算公式变化。实现、测试与真实UAT阻塞记录见[热工回答质量](docs/ai/thermal-answer-quality-2026-10-09.md)。

2026-10-07 最终交互 + 真实业务UAT：四个边界收口（查询/计算/合规路由、厚度省略追问、厚度口语与取消、指标省略连接词）。`pnpm uat:ai`运行销售20+设计院20、123轮真实HTTP/SSE场景；`pnpm uat:check`只做类型/结构检查。UAT使用独立临时库/用户/Redis队列/页图，事实全部确定性断言，默认规则体验评审，可用`--judge`启用只评价回答体验的AI Judge。Parser/Matcher主结构冻结，后续变更必须有真实失败Case。场景列表、运行依赖、报告及验收限制见[销售与设计院业务UAT](docs/ai/business-uat.md)。

日常表达与局部条件收口（2026-10-07）：指标定位、数字抽取、比较语义分开；在/控制在/要求/达到/做到/目标等连接词不决定模式。多轮 filters 按 metric 增改删，未提及条件保留，同 metric 默认替换（含 mode），仅明确再加范围条件可追加同指标边界；取消条件不得由旧摘要或模型重复参数复活。厚度精确档 thicknessMm、单边/双边 thicknessMin/thicknessMax 独立解析与持久化，签名覆盖三字段；放宽单边厚度继承原边界含义，取消厚度清除三字段。尽量薄只在满足硬条件后按厚度升序展示，不编造范围。所有条件变化重查正式已发布数据，纯参数/原页指代可复用。无数据库结构变化，Thermal Engine 与 Knowledge 流程不变。 本轮实现与验证见 [日常表达与多轮条件验收](docs/thermal/daily-language-closeout-2026-10-07.md)。

2026-10-07 自然语言与多条件最终收口：支持“不应/不得/以上/以下”等规范比较词；普通大于/小于采用包含边界的工程筛选口径。API 与 Tool 新增可选 `filters[]`，多个指标全部 AND，旧单指标及 K/R 字段继续兼容。多轮规格/产品/型号切换清旧依赖并重新查询正式发布数据；双 R 查询不再误报 missing targetK。超限容差返回 requested/effective/adjusted 元信息与中文提示，会话 JSON 保留每项授权来源。详见 `docs/thermal/natural-language-closeout-2026-10-07.md`；无数据库结构修改。

2026-10-07 查询语义收口：参考查询统一使用 `metric`（K / TOTAL_R / PRODUCT_R）、`targetValue`、`mode`；双 R 均支持近似、上限、下限与固定精度匹配。保留旧 API 字段，AI 容差由用户原话与后端规则确定；切体系/型号/产品清理依赖 ID，条件变化重查已发布数据，跨体系回退先说明未命中。完整契约及验证记录见 `docs/thermal/lookup-closeout-2026-10-07.md`。本轮没有数据库结构修改。

2026-10-07 生产收口：精确厚度保留 K/型号/体系等硬筛选；参考查询模式按用户语义 → Tool 参数 → 历史 → APPROX，条件变化重查完整发布数据。候选状态完整保留双热阻、来源原页和正式字段；STRICT 与工作台共用发布 readiness，空 BROWSE_ONLY 版本返回 NO_PAGES。迁移检查及原页联调见 `scripts/verify-migrations.mjs`、`scripts/verify-reference-lookup.mjs` 与 `docs/production-closeout-2026-10-07.md`。

迁移验证：`pnpm db:verify` 默认使用 Docker；`node scripts/verify-migrations.mjs --static` 只检查 SQL/journal/snapshot。设置 `MIGRATION_VERIFY_DATABASE_URL` 后 `pnpm db:verify` 在指定 PostgreSQL 实例创建唯一命名的隔离临时库，验证真实 Drizzle 新库/漏 0032 升级/已手工执行/冲突回滚，再自动清理。该连接须有临时库创建权限，验证脚本不迁移连接指定的业务数据库。构建后运行 `node scripts/verify-reference-lookup.mjs` 做真实 Tool/状态/原页签名下载/STRICT 门禁联调；同样只在隔离临时库写业务数据。

蓝格 VICP 是面向外墙保温和建筑节能业务的 AI 智配系统后端，服务三个客户端：

- `B_ADMIN`：B 端管理后台和渠道工作台。
- `PC_AI`：PC AI 对话端。
- `C_APP`：C 端 App/小程序。

核心闭环是：项目管理、PDF/DOCX 资料解析、项目知识检索、AI 对话、确定性工程计算、结构化报告生成、公开分享和全流程审计。

## 业务边界

- 不使用租户模型，平台数据统一存储，以项目作为业务权限边界。
- `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER` 是固定业务角色，保留在 `users.role`。分端访问真源是 `user_app_access`（`ADMIN` / `CLIENT`）。B 端 Token `aud=admin` 且需 ACTIVE ADMIN access；C / PC AI 端 Token `aud=client` 且有效身份为 `NORMAL_USER`。同一手机号只对应一个 User；超级管理员第一次进 C 端会自动开通 CLIENT，不新建第二个账号，也不能用该令牌进入后台。渠道账号不能登录 B 端。
- 普通用户可在 C 端用手机号密码注册，或通过微信手机号快捷登录首次自动注册；可创建/编辑/删除自己的项目。B 端超级管理员可查看/删除全平台项目，不能新增。
- B 端用户为统一 `/api/v1/platform/users` 列表；后台只能新建超级管理员，普通用户资料不能通过编辑接口改，部门成员走 `/platform/departments/:id/members`。C 端可选部门：`GET /api/v1/client/me/departments`。
- 项目可见范围 P0 为 `PRIVATE` 与 `DEPARTMENT`（含子部门）；历史 `PUBLIC` 只读兼容。私有项目仅创建者可访问；B 端超级管理员可查看但不能用 C 端令牌绕过归属。
- 公开项目不公开源文件、知识库原文、原始 AI 会话和未发布报告，只允许查看已发布报告。
- 项目成员关系只保留数据结构，第一期不开放邀请和协作接口。

## 客户端与权限

- `/api/v1/platform/*` 和 `/api/v1/workspace/*` 必须使用 `aud=admin` 的 `B_ADMIN` 令牌，并具备 ACTIVE ADMIN access。
- `/api/v1/client/*` 为 C 端/PC AI 端只读内容接口（企业介绍兼容入口、公开文库），要求 JWT、`aud=client` 且客户端为 `C_APP`/`PC_AI`，不依赖后台 RBAC。普通企业介绍请用 `GET /api/v1/company/about`。ADMIN Token 不得冒充 C 端 Token。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- B 端后台接口必须先通过 JWT 和客户端校验，再通过具体按钮权限码校验；超级管理员直通。例外：当前账号可见范围内的只读项目统计（`GET /platform/projects/statistics`）不要求按钮权限码。
- 知识库采用“原文档导航 + 原始页面 + AI 检索索引”：平台管理路径 `/api/v1/platform/knowledge/*` 要求 `B_ADMIN` 与精确 `system:knowledge:*` 权限；C_APP/PC_AI 公开读取仅使用 `/api/v1/client/knowledge/*`。普通 B 端新建走 `POST /documents/create-with-file`（只收 fileId，自动解析），草稿验证走 `POST /versions/:versionId/test-qa`（只检索当前版本）。Knowledge Version 只有 DRAFT 可修改内容；进入 PENDING_REVIEW/APPROVED/PUBLISHED/DISABLED 后只读，修改需创建新 DRAFT。生产 AI 只检索当前、已发布、未过期且 `AI_ENABLED` 的版本；有 page-aware 分块时排除无页定位的 Mammoth `DOCUMENT_TEXT` 回退块；离线页图版本发布为 AI_ENABLED 前每页必须有原页图且识别已 CONFIRMED。`BROWSE_ONLY` 仅可浏览原文件。DOCX：Mammoth 负责文本/RAG；页面视觉通过离线高保真 PNG/ZIP 上传并人工确认，LibreOffice 默认关闭且仅作 fallback。同页识别以稳定 BullMQ jobId + `recognitionRunId` 单飞，旧任务不得覆盖新结果，只有 `REVIEW_REQUIRED` 可确认。热工参考行通过 `sourcePageId` 绑定页面；参考集发布前要求来源页属于当前、有效的 PUBLISHED Knowledge Version，AI 输出 `reference_pages` 前再次校验并只签名合法页。
- 页面视觉识别的 AI SDK 调用将识别规则传入 `instructions`，图片和页码传入用户 `messages`，以兼容当前 SDK 的提示词校验。
- 图集页面结构化识别使用独立 `PAGE_RECOGNITION` 预算（最多 8192 输出 token、120 秒）；聊天图片观察仍使用 `VISION` 的 1200 token 预算。
- 视觉模型的兼容网关可能不支持 JSON schema 约束，识别提示词同时明确列出结构化结果字段与层级，防止输出字段别名被解析器丢弃。
- 页面识别结果对明确的格式偏差做确定性修复并重新校验 schema；含义不明的热工值留给人工审核，失败日志不记录模型原文。
- 页面识别的服务商余额不足单独提示用户联系平台管理员处理后重试，不展示服务商原始错误。
- 多厚度表格按构造和同行数值生成选项；产品层共用参数保留在构造层，可变厚度与热阻逐档保存。页面确认后若未选择可编辑热工参考集，资料问答可用，参考档位仍需关联后同步。
- 知识库详情提供一键识别和无风险页一键核对，结果逐页列出成功、失败和跳过原因；模型解释性备注不等同识别失败。查看内容优先已确认目录，其次正文章节，并始终允许按文件页浏览。
- 不允许使用任意 `system:*` 作为模块级通行证；查看、新增、修改、删除、导出、分配和测试使用独立权限码。
- C 端和 PC AI 端不能访问后台管理接口，但可以访问明确开放的 AI、公开项目、本人项目、受控文件、报告和分享业务接口。
- 项目权限独立于后台 RBAC，必须继续执行 `canViewProject`、`canManageProject`、会话归属和文件归属校验。

## 技术架构

- API：Fastify + TypeScript + Zod + Swagger。
- 数据库：PostgreSQL + Drizzle ORM + `postgres.js`。
- 缓存与任务：Redis + BullMQ；API 创建任务，Worker 处理解析、报告和维护任务。
- AI：AI SDK + OpenAI-compatible provider；服务商、模型从数据库读取。C 端默认 `general_chat`，不要求用户选择场景/系统指令；快捷提问独立配置；Chat Agent 核心 Tools 为知识/项目状态/热工/对比/报告 5 个；`resolveAiCapabilities` 只做预路由，支持 tools 的模型走 `streamText` Agent Loop。
- 存储：开发环境 MinIO，生产环境优先阿里云 OSS。
- 部署：Docker Compose + Nginx；可选 PM2 托管宿主机 API/Worker。

## 接口响应约定

- 成功响应使用 HTTP `200`，结构为 `{ success: true, data, requestId }`。
- 业务错误统一使用 HTTP `200`，`error.code` 使用数值型 HTTP 语义码：访问令牌、刷新令牌和当前登录态无效使用 `401`；权限不足使用 `403`；参数错误使用 `400`；其他业务处理失败使用 `500`。未捕获的服务器异常使用 HTTP `500`，返回数值型 `500`。

## Swagger 文档规范

新增或修改 Fastify 路由时，必须在路由 `schema.tags` 中声明文档标签，并遵守以下约定：

- 标签格式统一为“客户端边界 / 业务模块”。
- 客户端边界仅允许：`B端`、`C端`、`PC AI端`、`共用`、`公共`。
- B 端平台管理使用 `B端 / 平台 / <模块>`，B 端工作台使用 `B端 / 工作台 / <模块>`。
- 多客户端共用的业务能力根据真实访问边界使用 `共用 / <模块>`；匿名接口使用 `公共 / <模块>`。
- 不得继续使用没有客户端前缀的标签，例如 `用户管理`、`AI 对话`、`文件`、`报告`。
- 新增标签必须同步登记到 `src/plugins/swagger.ts` 的 OpenAPI 标签目录。
- Swagger 标签只用于文档分类，不能替代 JWT、客户端隔离、按钮权限码、项目权限、文件归属或会话归属校验。

示例：

```typescript
schema: {
  tags: ["B端 / 平台 / 用户管理"]
}
```

目录职责：

| 目录 | 职责 |
| --- | --- |
| `src/app.ts` | Fastify 插件和路由注册 |
| `src/server.ts` | API 进程入口 |
| `src/worker.ts` | BullMQ Worker 入口 |
| `src/db` | Drizzle schema、迁移入口和 seed |
| `src/plugins` | 数据库、Redis、队列、存储、认证、错误和 Swagger |
| `src/modules` | 认证、项目、用户、权限、AI、文件、报告和分享业务 |
| `src/workers` | 文档处理和报告生成处理器 |
| `src/storage` | MinIO/OSS 统一对象存储适配器 |
| `src/shared` | 权限、错误、响应、分页和常量 |
| `drizzle` | 已提交的 PostgreSQL migration |

## AI 规则

- AI 不能执行任意 SQL、Shell、服务器文件操作或绕过项目权限。
- AI 围栏顺序为身份、项目权限、频控、输入限制、工具白名单、知识范围、确定性计算、引用检查、输出检查和落库审计。
- 深度思考是会话级配置，默认 `OFF`；每条消息保存实际 `reasoningMode`。
- 流式对话支持停止，停止后保存已生成内容并标记为 `STOPPED`，会话仍可继续。
- 用户端详情只展示本人消息、处理阶段、检索摘要、反馈、报告和分享；不展示模型原始思考链。
- B 端 AI 运营详情是独立后台接口，需要 `system:ai:conversation:*` 权限，可查看工具调用、任务、分享访问和审计摘要。
- AI 配置（服务商/模型准入测试/快捷提问/场景/提示词版本化）、SSE 协议、错误码、配额与安全细则见 `docs/ai/`。正式模型必须通过文本/工具/推理准入测试后才能启用。
- 主数据/企业信息/构造方案/图集热工/标准采集/材料对比/节点图库/报告与审核中心细则见 `docs/masterdata|company|construction|thermal|standard|comparison|nodes|reports/README.md`；采集管理见 `docs/collection/README.md`；B 端菜单信息架构见 `docs/menus/README.md`。
- API Key 使用 AES-256-GCM 加密，任何接口都不能返回密钥明文或完整密文。
- 报告来源通过 `report_sources` 保存回答快照和顺序，报告由 Worker 导出 HTML、PDF、图片和 Word。

## 开发启动

1. 安装 Node.js LTS、pnpm；本地基础设施使用 Docker（`docker compose up -d postgres redis minio`），或单独安装 PostgreSQL 和 Redis。
2. 复制环境变量模板：

   ```powershell
   Copy-Item .env.example .env
   ```

3. 修改 `.env` 中的 JWT 密钥、AI 加密密钥和管理员密码。
   `DATABASE_URL` 与 `REDIS_URL` 必须指向本地服务（默认值即本地地址），**禁止指向生产库**；生产连接只存在于服务器 `.env`。
4. 安装依赖并执行迁移、初始化数据：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm db:migrate
   pnpm db:seed
   ```

5. 分别启动 API 和 Worker：

   ```powershell
   pnpm dev
   pnpm dev:worker
   ```

完整基础设施可以使用：

```powershell
docker compose up --build
```

健康检查：`/health/live`、`/health/ready`，`/health` 保留兼容接口。

## 部署到服务器

推荐在开发机执行 `pnpm deploy`：本地编译打包，经 SSH 上传到服务器，**不走 git、不拖拽文件、不在 2G 机器上跑 tsc**。

### 日常一键发布（本地打包 + SSH）

1. 复制 `deploy/.env.deploy.example` 为 `deploy/.env.deploy`（已 gitignore，不会上传）。
2. 填写服务器地址、密码（或私钥）、存放路径：

```
DEPLOY_SSH_HOST=服务器IP或域名
DEPLOY_SSH_USER=root
DEPLOY_SSH_PORT=22
DEPLOY_SSH_PASSWORD=登录密码
DEPLOY_REMOTE_DIR=/www/wwwroot/lgapi.zblack.cn
```

`DEPLOY_REMOTE_DIR` 必须与线上 PM2 运行目录一致（含 `package.json` 的那一层），不要填 `dist/`。

3. 在 `backend/` 执行：

```powershell
pnpm deploy
```

脚本会：本地 `pnpm build` → 打包 `dist` + `drizzle` + 锁文件 → SSH 上传 → 服务器安装依赖 → **迁移前备份数据库（有 pg_dump 时）** → 只执行已提交的 Drizzle migration → 成功后才重载 PM2。

SQL 约束：

- 不上传、不覆盖服务器 `.env`（生产库连接以服务器为准）。
- 不执行 `schema push`、不删库、不重置表。
- 迁移失败则回滚 `dist` 且 **不重载 PM2**，当前进程继续跑旧代码。
- `seed` 幂等：首次落地会跑一次，已存在管理员不会被覆盖。

首次在空目录部署时，服务器会生成 `.env` 并退出，请登录改好 `DATABASE_URL`、`BOOTSTRAP_ADMIN_PASSWORD` 等后再执行一次 `pnpm deploy`。

宝塔 Nginx 反代到 `http://127.0.0.1:3000`。健康检查：`/health/live`，文档：`/docs`。

`bash deploy/deploy.sh` 已停用（不再 `git pull`）。生产只走上面的 `pnpm deploy`。

### 修改管理员密码

`BOOTSTRAP_ADMIN_PASSWORD` 只在首次 seed 时生效（`src/db/seed.ts` 不会覆盖已存在用户）。修改管理员密码的正确方式：

- 后台 UI（推荐）：登录后进入「用户管理 -> 重置密码」（权限码 `system:user:reset-password`，超级管理员直通，操作会写入审计日志）。
- 接口：`POST /api/v1/platform/users/:id/reset-password`，请求体 `{ "password": "<至少12位新密码>" }`。B 端登录接口 `POST /api/v1/auth/b/login` 需要图形验证码，命令行调用较繁琐，建议直接使用后台界面。

### 常见运维

- 日志：`docker compose logs -f`（指定服务：`docker compose logs -f api`）。PM2 运行时用 `pm2 logs`、`pm2 status`（进程名 `lg-vicp-api` / `lg-vicp-worker`）。
- 使用 80 端口：修改 `docker-compose.yml` 中 nginx（或 PM2 的 `gateway`）的端口映射 `8080:80` 为 `80:80`。
- 数据备份：数据保存在 Docker 卷 `postgres_data`、`redis_data`、`minio_data`，备份 `docker compose exec postgres pg_dump` 输出和 MinIO 对象即可。

## 常用命令

```powershell
pnpm deploy     # 本地打包后 SSH 发布（不走 git）
pnpm lint       # TypeScript 检查
pnpm test       # Vitest 测试
pnpm build      # 构建 API 和 Worker
pnpm db:check   # 检查 Drizzle migration
pnpm db:generate
pnpm db:migrate
pnpm db:verify  # 临时容器验证全部迁移（干净库 + 脏数据模拟两个场景）
pnpm db:studio
pnpm pm2:start  # 服务器：按 deploy/ecosystem.config.cjs 启动或重载 PM2
pnpm pm2:logs   # 服务器：查看 PM2 日志
```

## 修改流程

1. 先阅读 `AGENTS.md`、`.cursor/rules/00-project-context.mdc` 和对应参考文档。
2. 按 `.cursor/rules/90-change-map.mdc` 找到正确模块，不跨模块复制业务规则。
3. 修改数据模型时先改 `src/db/schema.ts`，再生成并检查 migration；数据迁移按旧数据形态编写防御性 SQL（去重、空值兜底、幂等），并用 `pnpm db:verify` 在临时容器验证；生产禁止使用 schema push。
4. 新增或修改后台接口时同时添加客户端校验、精确权限码、项目级校验和审计日志。
5. 数据写入和对应审计尽量放在同一个数据库事务中；耗时解析和导出必须交给 BullMQ Worker。
6. AI 相关改动必须检查围栏、来源引用、密钥处理、停止生成、会话详情和报告来源。
7. 长期业务或架构变化必须同步更新 `AGENTS.md`、`.agents/skills/lg-backend`、`.cursor/rules` 和本 README。
8. 交付前执行 `pnpm db:check`、`pnpm lint`、`pnpm test` 和 `pnpm build`。

## 变更定位

- 用户、角色、部门、岗位、字典：`src/modules/users`、`src/modules/system-management`、`src/modules/platform-ops`。
- 客户端认证和动态路由：`src/modules/auth`、`src/plugins/auth.ts`、`src/modules/menus`。
- 项目可见性和项目权限：`src/modules/projects`、`src/shared/permissions.ts`。
- AI 配置、对话、围栏和检索：`src/modules/ai-config`、`src/modules/ai`、`src/modules/knowledge`。聊天图片走 `ai_message_attachments` + `purpose=CHAT_IMAGE`，会话可不关联项目。
- 文件、解析、OCR 和队列：`src/modules/files`（含文件资产中心：列表/引用/预览/回收站/SHA-256 复用，详见 `docs/files/README.md`）、`src/workers`、`src/queues`、`src/storage`。
- 报告、来源和导出：`src/modules/reports`、`src/workers/report.worker.ts`。AI 会话报告 `projectId` 可空；`GET /api/v1/reports/my` 查当前用户报告。
- 分享和匿名访问：`src/modules/shares`、`share_links`、`share_views`。
- 全局响应、错误和中文提示：`src/shared/response.ts`、`src/shared/errors.ts`、`src/plugins/error-handler.ts`。

更多细则按任务读取：

- `.agents/skills/lg-backend/references/project-brief.md`
- `.agents/skills/lg-backend/references/backend-architecture.md`
- `.agents/skills/lg-backend/references/permissions-and-projects.md`
- `.agents/skills/lg-backend/references/ai-and-reports.md`
- `.agents/skills/lg-backend/references/files-and-jobs.md`

页面识别备注（2026-10-09）：notes 仅逐条抄录原图明确出现的注/备注，无原文备注返回空数组；禁止混入字段映射、null 原因与多厚度拆分解释。正常多厚度留空说明不再从 warnings 移入 notes；真实歧义/数值冲突保留 warnings。存量识别结果需在可编辑草稿重新识别或人工修订，不自动改写已确认数据。
