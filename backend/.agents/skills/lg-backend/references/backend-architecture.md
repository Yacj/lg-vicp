# 后端架构

技术栈：Fastify、TypeScript、Zod、PostgreSQL、Drizzle ORM、postgres.js、Redis、BullMQ、AI SDK、MinIO/阿里云 OSS、Docker Compose、Nginx。

目录职责：

- `src/app.ts`：Fastify 实例、插件和路由注册。
- `src/server.ts`：API 进程入口。
- `src/worker.ts`：文档、报告和维护 Worker 入口。
- `src/db`：Drizzle schema、数据库客户端、生产迁移和 seed。
- `src/plugins`：数据库、Redis、队列、存储、认证、错误、Swagger。
- `src/modules`：业务模块。
- `src/workers`：BullMQ 处理器。
- `src/storage`：对象存储接口与适配器。
- `src/shared`：权限、错误、响应、分页和常量。

实现要求：

- 路由处理器负责协议适配，复用逻辑放服务中。
- 输入使用 Zod；返回统一响应结构。
- 普通查询使用 Drizzle，PostgreSQL 特性使用参数化 SQL。
- 数据变更与对应审计使用同一事务。
- API 不执行耗时解析或导出，只创建任务并返回任务 ID。
- Worker 处理幂等、重试、进度和失败落库。
- migration 必须提交到 `drizzle/`，生产只运行已提交 migration。
- 所有后台接口都必须先通过 JWT 和 `B_ADMIN` 客户端校验，再执行具体权限码校验。C/AI 客户端不能访问 `/platform` 或 `/workspace`。
- Fastify 请求上下文中的权限编码来自启用角色；禁用角色不会参与权限计算。
