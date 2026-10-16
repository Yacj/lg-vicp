# 后端架构

2026-10-16 用户确认：实际开发、隔离验收及生产均只使用阿里云OSS，没有MinIO服务。测试入口必须检查STORAGE_PROVIDER=oss并隔离对象前缀，不能把旧示例配置造成的MinIO连接失败当作OSS故障；密钥仅本机.env保存，不入交付证据。

PM2报告部署（2026-10-14）：数据库步骤/重载前真实中文PDF自检；默认检查复用，显式安装只支持白名单Linux（含线上Alibaba Cloud Linux3/x64，RPM只查缺失项后DNF安装）。使用锁文件对应CLI/国内镜像/固定缓存；路径核验记录传给Worker，显式.env优先，不改.env/软件源。失败恢复dist且不执行后续数据库/PM2；pnpm11需pnpm run deploy调用仓库脚本。本次用户授权线上发布成功且未跑测试，见docs/reports/pm2-report-runtime-2026-10-14.md。

2026-10-07 迁移收口：0032 journal 漏登记以补登记 + 0051 前向补偿处理，0032 CASE 索引括号仅作语法修正；0051 对正确索引跳过，对旧索引先锁表/归一化冲突校验后同事务更新。`db:verify` 必须先校验 SQL/journal/snapshot；早期 0017–0019 的已部署命名及遗失 snapshot 仅按脚本内精确限定旧记录兼容，禁止新增通用跳号例外。可用 `MIGRATION_VERIFY_DATABASE_URL` 运行隔离临时数据库验证，禁止直接迁移生产验证。

技术栈：Fastify、TypeScript、Zod、PostgreSQL、Drizzle ORM、postgres.js、Redis、BullMQ、AI SDK、MinIO/阿里云 OSS、Docker Compose、Nginx；生产可选 PM2 托管 API/Worker。

目录职责：

- `src/app.ts`：Fastify 实例、插件和路由注册。
- `src/server.ts`：API 进程入口。
- `src/worker.ts`：文档、报告和维护 Worker 入口。
- `src/db`：Drizzle schema、数据库客户端、生产迁移和 seed。
- `src/plugins`：数据库、Redis、队列、存储、认证、错误、Swagger。
- `src/modules`：业务模块（普通企业信息见 `src/modules/company/`；C 端微信手机号快捷登录与 `user_app_access` 分端访问见 `src/modules/auth/`）。
- `src/workers`：BullMQ 处理器。
- `src/storage`：对象存储接口与适配器。
- `src/shared`：权限、错误、响应、分页和常量。

实现要求：

- 路由处理器负责协议适配，复用逻辑放服务中。
- 输入使用 Zod；返回统一响应结构。
- 统一错误处理器独立序列化 `{ success:false, error, requestId }`，不套用路由成功响应 schema；业务错误为 HTTP 200 + 数值语义码（未登录/无效/过期令牌为 401），成功响应仍按路由 schema 校验。
- 普通查询使用 Drizzle，PostgreSQL 特性使用参数化 SQL。
- 数据变更与对应审计使用同一事务。
- API 不执行耗时解析或导出，只创建任务并返回任务 ID。
- Worker 处理幂等、重试、进度和失败落库。
- migration 必须提交到 `drizzle/`，生产只运行已提交 migration。
- 日常发布用 `pnpm deploy`：本地构建后 SSH 上传 `dist` 与 `drizzle/`，不覆盖服务器 `.env`，迁移失败不重载 PM2。
- 所有后台接口都必须先通过 JWT 和 `B_ADMIN` 客户端校验；系统管理类接口再执行具体权限码校验。C/AI 客户端不能访问 `/platform` 或 `/workspace`。当前账号可见范围内的只读项目统计（`GET /platform/projects/statistics`）不要求按钮权限码。
- Fastify 请求上下文中的权限编码来自启用角色；禁用角色不会参与权限计算。
- 跨域对任意 Origin 放行（`@fastify/cors` 回显请求 Origin）；鉴权不依赖浏览器同源。
