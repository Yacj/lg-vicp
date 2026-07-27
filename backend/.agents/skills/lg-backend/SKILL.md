---
name: lg-backend
description: 开发和维护蓝格 VICP Fastify 后端。用于修改 Drizzle 数据模型、项目权限、用户/RBAC、文件上传与解析、BullMQ Worker、AI 多模型配置与围栏、AI 对话、AI 回答反馈、公开分享、报告生成、审计日志、Codex/Cursor 规则或后端架构。
---

# 蓝格 VICP 后端

修改代码前，按任务读取对应参考：

- 了解产品目标和一期范围时，读取 `references/project-brief.md`。
- 修改 Fastify、Drizzle、Redis、队列、存储或部署时，读取 `references/backend-architecture.md`。
- 修改用户、角色、部门、项目公开/私有或审计时，读取 `references/permissions-and-projects.md`。
- 修改 AI 配置、对话、知识检索或报告时，读取 `references/ai-and-reports.md`。
- 修改上传、解析、OCR 或异步任务时，读取 `references/files-and-jobs.md`。

始终执行以下规则：

- 保持统一平台数据和项目级业务边界，不添加租户数据库或租户路由。
- 使用 Drizzle migration 管理数据结构，不使用 `push` 修改生产数据库。
- 保持经销商和业务员同属 `CHANNEL_USER`，只用 `channelType` 区分。
- 不允许 AI 替代权限、工程计算、持久化或审计。
- 面向人的提示、文档和日志使用中文；程序标识和稳定错误码使用英文。
- 业务错误统一返回 HTTP `200`，通过 `error.code` 和 `error.message` 表达错误；未捕获的服务器异常返回 HTTP `500`。
- 修改长期约束时，同步更新 `AGENTS.md`、`README.md` 和 `.cursor/rules`。

交付前执行：

- 运行 `pnpm db:check` 检查迁移。
- 运行 `pnpm lint`、`pnpm test` 和 `pnpm build`。
- 权限、可见性、密钥处理或队列行为变化时补充针对性测试。
- 修改认证、RBAC 或后台路由时，必须同时检查客户端隔离和接口级权限：`B_ADMIN` 才能访问 `/platform`、`/workspace`；C/AI 只允许明确开放的业务接口。
- 新增或修改 Fastify 路由时，必须在 `schema.tags` 中使用“客户端边界 / 业务模块”格式；客户端边界只能是 `B端`、`C端`、`PC AI端`、`共用` 或 `公共`。
- Swagger 标签只用于文档分类，不能替代 JWT、客户端类型、精确权限码、项目权限或文件/会话归属校验；新增标签必须登记到 `src/plugins/swagger.ts` 的 OpenAPI 标签目录。
- 权限查询必须排除禁用角色；每个查看、新增、修改、删除、导出和分配接口使用独立权限码。
- 完成后必须同步更新 `AGENTS.md`、`README.md`、`.cursor/rules` 和 references，并运行 `pnpm lint`、`pnpm test`、`pnpm build`。
