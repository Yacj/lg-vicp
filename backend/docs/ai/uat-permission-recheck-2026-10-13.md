# 隔离UAT权限更新后的复测

后续新库连接已放行，138轮完整业务测试已执行但未通过，详见 [最新完整复测结果](uat-access-recheck-2026-10-13.md)。下面28000/TLS诊断保留为历史记录。

2026-10-13，使用当前.env真实执行 `pnpm uat:ai --out logs/ai-uat/permission-recheck-2026-10-13`，没有修改.env或线上业务数据。

1. `CREATEDB` 已生效，实际角色查询为true；Runner成功创建随机 `vicp_ai_uat_<uuid>` 测试库。
2. 在连接新库执行迁移时被拒绝：PostgreSQL `28000`。45场景/138轮全部BLOCKED，执行0轮，不计PASS。
3. 用另一随机测试库复现连接策略：当前配置返回28000，错误明确含pg_hba与SSL off/no encryption；不是密码错误，也不是CREATEDB权限错误。
4. 独立TLS required只读连接试验返回ECONNRESET，未解决新库访问问题。未修改服务器或代理的访问规则。
5. 诊断前UAT临时库计数为0，证明上一轮Runner创建的临时库已经清理；本轮诊断库也成功DROP。未创建测试用户/会话、fixture、报告/队列任务或OSS对象，未在生产库执行迁移。

现在需要解决的是新测试库连接策略：为该测试账号和测试执行端放行随机隔离数据库的连接（服务器pg_hba或数据库代理策略），或者在 `.env` 配置可创建并连接随机库的独立测试PostgreSQL连接 `AI_UAT_DATABASE_ADMIN_URL`。线上模型/Prompt配置仍可由默认DATABASE_URL只读提供；不需要在聊天中提交密码。

真实报告：[UAT报告](../../logs/ai-uat/permission-recheck-2026-10-13/report.md) 与同目录report.json。原始连接密码、服务商API Key、JWT、签名URL均未输出。业务断言、Agent开关/超时、权限/撤回和方案报告PDF仍未执行，不能用连接诊断代替真实HTTP/SSE验收。
