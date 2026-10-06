# 权限与项目

业务身份：

- `users.role` 暂时保留兼容，分端访问真源是 `user_app_access`（`ADMIN` / `CLIENT`）。
- `SUPER_ADMIN`：B 端 Token `{ aud: 'admin', role: 'SUPER_ADMIN' }` 可查看/删除全平台项目，不能新增项目。同一手机号第一次登录 C / PC AI 端时自动开通 CLIENT / NORMAL_USER，该令牌 `{ aud: 'client', role: 'NORMAL_USER' }`，不继承后台权限。
- CLIENT access 不等于部门归属；无部门也可登录、使用 AI、创建 PRIVATE 项目。项目 / Conversation / Memory 归属同一个 `users.id`。



B 端用户管理：

- 统一列表 `/api/v1/platform/users`，筛选 `role` / `status` / `keyword` / `departmentId`。不要再拆一套超级管理员 CRUD。
- 新增/导入只能创建 `SUPER_ADMIN`。
- `SUPER_ADMIN` 可创建、查看、编辑、启停、删除、重置密码。
- `NORMAL_USER` 只允许查看、启停、删除；`PATCH /users/:id` 禁止改姓名/手机/邮箱/账号类型/角色。
- 部门成员收口：`GET/POST /platform/departments/:id/members`、`DELETE /platform/departments/:id/members/:userId`。C 端可选部门：`GET /api/v1/client/me/departments`。

动态 RBAC 只控制后台菜单和操作，项目权限必须独立校验。B 端 `/platform` 与 `/workspace` 当前仅 `SUPER_ADMIN` 可进入。

项目规则：

- `PRIVATE`：仅创建者可访问；B 端超级管理员可查看/删除。
- `DEPARTMENT`：`visibleDepartmentId` + `includeChildDepartments`；过滤必须在 Backend 按部门树完成。
- `PUBLIC`：历史全员可见，P0 不再作为新建选项。
- 源文件、未发布报告和原始 AI 会话仅创建者和 B 端超级管理员访问。
- 仅创建者可以修改项目信息和可见性；删除可由创建者或 B 端超级管理员执行。
- `ProjectMember` 仅预留，不开放协作路由。

必须审计项目、用户状态、角色权限、部门、字典、文件、AI 配置、AI 调用和报告操作。可见性切换保存前后值；审计包含操作者、项目、请求 ID、IP、User-Agent 和时间。
- 客户端边界：`aud=admin` 的 `B_ADMIN` 才能访问 `/api/v1/platform/*` 和 `/api/v1/workspace/*`；`C_APP`、`PC_AI` 访问这些路径必须被拒绝。ADMIN Token 不得访问 `/api/v1/client/*`。
- B 端后台系统管理接口需要具体权限码，禁止用任意 `system:*` 作为模块通行证。查看、新增、修改、删除、导出、分配分别定义权限码。
- 当前账号可见范围内的只读项目统计（`GET /platform/projects/statistics`）与工作台「我的项目」相同，只要求 JWT + `B_ADMIN` + 数据范围，不要求 `system:project:list`。平台项目列表 `GET /platform/projects` 仍需该权限码。
- 权限查询必须过滤启用角色；`roles.enabled = false` 的角色不能授予菜单、按钮或接口权限。
- C/AI 端允许访问明确开放的 AI 和业务接口，但仍必须执行项目、会话、文件和报告的业务权限校验。
