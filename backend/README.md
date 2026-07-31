# 蓝格 VICP 后端

蓝格 VICP 是面向外墙保温和建筑节能业务的 AI 智配系统后端，服务三个客户端：

- `B_ADMIN`：B 端管理后台和渠道工作台。
- `PC_AI`：PC AI 对话端。
- `C_APP`：C 端 App/小程序。

核心闭环是：项目管理、PDF/DOCX 资料解析、项目知识检索、AI 对话、确定性工程计算、结构化报告生成、公开分享和全流程审计。

## 业务边界

- 不使用租户模型，平台数据统一存储，以项目作为业务权限边界。
- `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER` 是固定业务角色；经销商和业务员通过 `channelType` 区分。
- 渠道用户和超级管理员可以创建项目，普通用户第一期不能创建项目。
- 私有项目仅创建者和超级管理员可访问；公开项目允许登录用户只读查看。
- 公开项目不公开源文件、知识库原文、原始 AI 会话和未发布报告，只允许查看已发布报告。
- 项目成员关系只保留数据结构，第一期不开放邀请和协作接口。

## 客户端与权限

- `/api/v1/platform/*` 和 `/api/v1/workspace/*` 必须使用 `B_ADMIN` 令牌。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- B 端后台接口必须先通过 JWT 和客户端校验，再通过具体按钮权限码校验；超级管理员直通。
- 不允许使用任意 `system:*` 作为模块级通行证；查看、新增、修改、删除、导出、分配和测试使用独立权限码。
- C 端和 PC AI 端不能访问后台管理接口，但可以访问明确开放的 AI、公开项目、本人项目、受控文件、报告和分享业务接口。
- 项目权限独立于后台 RBAC，必须继续执行 `canViewProject`、`canManageProject`、会话归属和文件归属校验。

## 技术架构

- API：Fastify + TypeScript + Zod + Swagger。
- 数据库：PostgreSQL + Drizzle ORM + `postgres.js`。
- 缓存与任务：Redis + BullMQ；API 创建任务，Worker 处理解析、报告和维护任务。
- AI：AI SDK + OpenAI-compatible provider；服务商、模型、场景和提示词从数据库读取。
- 存储：开发环境 MinIO，生产环境优先阿里云 OSS。
- 部署：Docker Compose + Nginx。

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
- API Key 使用 AES-256-GCM 加密，任何接口都不能返回密钥明文或完整密文。
- 报告来源通过 `report_sources` 保存回答快照和顺序，报告由 Worker 导出 HTML、PDF、图片和 Word。

## 开发启动

1. 安装 Node.js LTS、pnpm、PostgreSQL 和 Redis；或准备 Docker。
2. 复制环境变量模板：

   ```powershell
   Copy-Item .env.example .env
   ```

3. 修改 `.env` 中的数据库地址、JWT 密钥、AI 加密密钥和管理员密码。
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

前置条件：服务器安装 Docker、Docker Compose v2、Git，防火墙/安全组放行 `8080` 端口。

### 首次部署

在服务器空目录执行（`deploy/deploy.sh` 会克隆代码并生成 `.env`）：

```bash
bash deploy/deploy.sh <git 仓库地址>
```

脚本首次运行会生成随机 `JWT_SECRET`、`AI_CONFIG_ENCRYPTION_KEY`、`POSTGRES_PASSWORD` 和 MinIO 凭证，随后退出并提示你编辑 `.env`：

- `BOOTSTRAP_ADMIN_PASSWORD`：管理员登录密码，至少 12 位。
- `CORS_ORIGIN`：前端实际访问地址，例如 `https://admin.example.com`。

修改完成后再次运行同一命令，脚本校验必填配置、构建镜像并启动 `postgres`、`redis`、`minio`、`api`、`worker`、`nginx` 六个服务，最后自动健康检查（最多 120 秒）。访问地址为 `http://<服务器IP>:8080`。

### 一键部署（本地执行）

配置好服务器 SSH 密钥免密登录，并在本地 `backend/.env` 中填写（不会上传到服务器）：

```
DEPLOY_SSH_HOST=服务器IP或域名
DEPLOY_SSH_USER=root        # 默认 root
DEPLOY_SSH_PORT=22          # 默认 22
DEPLOY_REMOTE_DIR=/opt/lg-vicp   # 服务器上仓库目录，默认 /opt/lg-vicp
```

然后执行（在 `backend/` 目录）：

```powershell
pnpm deploy
```

脚本流程：自动提交并推送 `backend/` 目录的改动（不波及 `app`/`admin-web`），然后 SSH 到服务器执行 `bash deploy/deploy.sh`（git pull + 构建镜像 + 健康检查）。服务器首次部署时需先手动完成 `.env` 初始化（见上节），初始化后即可一键更新。

类型检查与单元测试不在部署链路内：类型错误由服务器镜像构建时的 tsc 编译兜底（构建失败即中止，不会上线坏代码）；回归测试建议由 CI 承担，部署前需要的话可手动执行 `pnpm lint` / `pnpm test`。

### 更新部署

进入服务器上的项目目录后执行：

```bash
bash deploy/deploy.sh
```

脚本会 `git pull`（fast-forward）、重新构建并滚动启动服务。`.env` 已被 git 忽略，不会被覆盖；如需修改环境变量直接编辑 `.env` 后重新运行脚本。

### 修改管理员密码

`BOOTSTRAP_ADMIN_PASSWORD` 只在首次 seed 时生效（`src/db/seed.ts` 不会覆盖已存在用户）。修改管理员密码的正确方式：

- 后台 UI（推荐）：登录后进入「用户管理 -> 重置密码」（权限码 `system:user:reset-password`，超级管理员直通，操作会写入审计日志）。
- 接口：`POST /api/v1/platform/users/:id/reset-password`，请求体 `{ "password": "<至少12位新密码>" }`。B 端登录接口 `POST /api/v1/auth/b/login` 需要图形验证码，命令行调用较繁琐，建议直接使用后台界面。

### 常见运维

- 日志：`docker compose logs -f`（指定服务：`docker compose logs -f api`）。
- 使用 80 端口：修改 `docker-compose.yml` 中 nginx 的端口映射 `8080:80` 为 `80:80`。
- 数据备份：数据保存在 Docker 卷 `postgres_data`、`redis_data`、`minio_data`，备份 `docker compose exec postgres pg_dump` 输出和 MinIO 对象即可。

## 常用命令

```powershell
pnpm lint       # TypeScript 检查
pnpm test       # Vitest 测试
pnpm build      # 构建 API 和 Worker
pnpm db:check   # 检查 Drizzle migration
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

## 修改流程

1. 先阅读 `AGENTS.md`、`.cursor/rules/00-project-context.mdc` 和对应参考文档。
2. 按 `.cursor/rules/90-change-map.mdc` 找到正确模块，不跨模块复制业务规则。
3. 修改数据模型时先改 `src/db/schema.ts`，再生成并检查 migration；生产禁止使用 schema push。
4. 新增或修改后台接口时同时添加客户端校验、精确权限码、项目级校验和审计日志。
5. 数据写入和对应审计尽量放在同一个数据库事务中；耗时解析和导出必须交给 BullMQ Worker。
6. AI 相关改动必须检查围栏、来源引用、密钥处理、停止生成、会话详情和报告来源。
7. 长期业务或架构变化必须同步更新 `AGENTS.md`、`.agents/skills/lg-backend`、`.cursor/rules` 和本 README。
8. 交付前执行 `pnpm db:check`、`pnpm lint`、`pnpm test` 和 `pnpm build`。

## 变更定位

- 用户、角色、部门、岗位、字典：`src/modules/users`、`src/modules/system-management`、`src/modules/platform-ops`。
- 客户端认证和动态路由：`src/modules/auth`、`src/plugins/auth.ts`、`src/modules/menus`。
- 项目可见性和项目权限：`src/modules/projects`、`src/shared/permissions.ts`。
- AI 配置、对话、围栏和检索：`src/modules/ai-config`、`src/modules/ai`、`src/modules/knowledge`。
- 文件、解析、OCR 和队列：`src/modules/files`、`src/workers`、`src/queues`、`src/storage`。
- 报告、来源和导出：`src/modules/reports`、`src/workers/report.worker.ts`。
- 分享和匿名访问：`src/modules/shares`、`share_links`、`share_views`。
- 全局响应、错误和中文提示：`src/shared/response.ts`、`src/shared/errors.ts`、`src/plugins/error-handler.ts`。

更多细则按任务读取：

- `.agents/skills/lg-backend/references/project-brief.md`
- `.agents/skills/lg-backend/references/backend-architecture.md`
- `.agents/skills/lg-backend/references/permissions-and-projects.md`
- `.agents/skills/lg-backend/references/ai-and-reports.md`
- `.agents/skills/lg-backend/references/files-and-jobs.md`
