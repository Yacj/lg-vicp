# .env 线上连接复测

最新进展：权限与新库访问均已放行，真实138轮完整UAT已执行但未通过，详见 [最新完整复测结果](uat-access-recheck-2026-10-13.md)。CREATEDB/28000诊断见 [历史权限复测](uat-permission-recheck-2026-10-13.md)。下表42501为前一轮记录，保留时间顺序。

2026-10-13，按当前 `.env` 实际连接。数据库核验连接强制 `default_transaction_read_only=on`，已用 `current_setting('transaction_read_only')` 验证；未输出连接密码、API Key、JWT、签名URL或私人聊天。

| 实际检查 | 结果与范围 |
| --- | --- |
| PostgreSQL只读连接 | PASS；当前账号 `rolcreatedb=false` |
| Redis CONNECT/PING | PASS；未写业务键 |
| 当前准入模型真实JSON请求 | PASS；实际使用配置中的 deepseek-chat；只验证一次结构化连接，不是多轮业务验收 |
| OSS签名HEAD | PASS；探测不存在对象，不创建对象 |
| OSS实际公共发布原页下载 | PASS，946866字节；未输出对象键或签名URL |
| 正式ACTIVE产品字段 | PASS；读取1个产品，产品类型、λ/α、可选厚度字段可用；不把产品字段当整墙合规值 |
| 正式目录/后台别名 | PASS；7个实体、4条别名、1个体系 |
| 正式K≈0.3查询Service | PASS（服务执行）；当前0条命中，原服务说明没有落在0.3±0.02窗口的已发布行；没有将空命中算作业务选型成功 |
| 正式合规依据 | DATA_UNAVAILABLE；当前已发布标准限值0条，不能测试有正式依据的达标结论 |
| `pnpm uat:check` | PASS，45场景/138轮；仅类型及结构检查 |
| `pnpm uat:ai --out logs/ai-uat/online-recheck-2026-10-13` | 实际执行，创建随机隔离数据库时失败，PostgreSQL `42501`；执行0/138轮，全部BLOCKED |

真实UAT读取线上模型/Prompt后尝试创建随机临时库；账号没有CREATEDB权限，准备阶段已中止。未创建测试用户、会话、业务fixture、报告或对象；没有改写线上Candidate、SolutionState、Snapshot或业务数据。源配置读取与Redis连接已关闭。当前没有配置 `AI_UAT_DATABASE_ADMIN_URL` 或 `AI_UAT_CONFIG_DATABASE_URL`；本机未发现Docker/PostgreSQL命令，未以线上会话代替隔离测试。

连接可用与业务验收通过分别计数：线上模型请求通过，HTTP/SSE多轮仍未执行。接下来在本地 `.env` 配置具有创建临时库能力的独立测试PostgreSQL连接 `AI_UAT_DATABASE_ADMIN_URL`；配置来源继续使用线上 `DATABASE_URL` 的只读读取，或另设 `AI_UAT_CONFIG_DATABASE_URL`。不需要向对话粘贴连接密码。

实际产物：`logs/ai-uat/online-recheck-2026-10-13/report.md`、`report.json` 和 `readonly-data.json`。前两项记录45场景/138轮的BLOCKED；最后一项记录实际正式数据只读服务及OSS下载结果。这些不是Mock、不是生产会话UAT，也没有据此部署代码。
