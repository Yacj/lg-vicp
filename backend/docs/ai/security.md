# AI 安全

## 密钥与凭据

- API Key 使用 AES-256-GCM 加密落库（`api_key_ciphertext` / `api_key_iv` / `api_key_tag` 分列），主密钥仅来自环境变量 `AI_CONFIG_ENCRYPTION_KEY`。
- 任何响应、Swagger、审计、日志都不得返回密钥材料；响应只暴露 `hasApiKey`。
- 测试连接错误信息脱敏：不出现完整 Key、Base URL 内部细节；完整堆栈只进日志。
- 密钥加密/脱敏规则见 `src/modules/ai-config/ai-config.crypto.ts` 与对应单测。

## 提示词与上下文

- 平台基础安全提示词（`src/shared/prompt-assembly.ts`）强制：中文回答、不得虚构规范编号/来源/参数/计算结果、信息不足说明缺失条件、未调用确定性计算工具不得宣称精确计算、说明适用边界。
- 检索资料与用户上传内容视为**不可信上下文**，不得覆盖系统规则（提示词内明确声明）。
- 组装顺序固定（平台基础 → 场景 → 项目 → 检索 → 历史），客户端不得自行拼装系统提示词。

## 权限与边界

- B 端管理接口：`B_ADMIN` 客户端 + 精确 `system:ai:*` 权限码，禁用宽权限兜底；`SUPER_ADMIN` 直通。
- C 端 / PC AI 端可访问 `/api/v1/ai/*` 业务接口，但不可访问 `/api/v1/platform/ai/*`。
- 会话归属：非管理员只能访问本人会话；项目可见性校验独立于 RBAC。
- 永久删除会话仅 `SUPER_ADMIN` 且写审计。
- AI 不能执行任意 SQL / Shell / 文件操作；工程计算由确定性代码完成。

## 对话敏感词围栏

- 发送消息前（`POST /api/v1/ai/conversations/:id/messages`）对 `ai_content_filters` 启用的词条做确定性校验，命中即拦截，**不发模型请求**（省 token、结果可控），不依赖模型自觉规避。
- 匹配方式：`CONTAINS` 包含匹配 / `REGEX` 正则（配置时校验正则合法性，运行时非法正则自动跳过）。
- 词条可按场景配置生效范围：`scene_codes` 为空表示全局，否则仅对列出的场景生效。
- 命中处理：用户消息以 `BLOCKED` 状态落库（metadata 记录命中词条），同事务写审计 `ai.message_blocked`，返回 `AI_CONTENT_BLOCKED`（400 语义码）与词条自定义提示语（未配置时使用默认中文提示）。
- 管理接口 `/api/v1/platform/ai/filters` 按 `system:ai:filter:list/add/edit/remove` 权限码授权，增删改均写审计。
- 校验逻辑为纯函数（`src/modules/ai/ai-content-filter.service.ts`），词条在内存中匹配，不拼接用户输入构造 SQL。

## 配额与防滥用

- Redis 并发限制（默认 2/用户）+ 每日请求限制（默认 200/用户），`SUPER_ADMIN` 豁免；上限见 `AI_MAX_CONCURRENT_GENERATIONS` / `AI_DAILY_REQUEST_LIMIT`。
- 每分钟限流沿用 `AI_RATE_LIMIT_PER_MINUTE`（默认 20）。
- 停止通道（Redis + AbortController）避免长连接占用。

## 可追踪性

- 每条消息落库：实际模型、提示词版本、reasoningMode、Token、耗时、`errorCode`、`requestId`。
- 配置变更（服务商/模型/场景/提示词）、连接测试、反馈处理、调试调用、会话永久删除均写审计（与业务写入同事务）。
- AI 调试不落业务库，但审计记录每次调用内容摘要。

## 运行配置（环境变量）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_RATE_LIMIT_PER_MINUTE` | 20 | 每分钟请求限流 |
| `AI_MAX_CONCURRENT_GENERATIONS` | 2 | 单用户并发生成数 |
| `AI_DAILY_REQUEST_LIMIT` | 200 | 单用户每日请求数 |
| `AI_CONTEXT_MAX_MESSAGES` | 20 | 历史窗口最大条数 |
| `AI_CONTEXT_OUTPUT_RESERVE_RATIO` | 0.1 | 输出预留 + 安全余量比例 |
| `AI_CONFIG_ENCRYPTION_KEY` | 无默认 | 密钥加密主密钥（32 字节） |