# AI 错误码

统一错误码（`src/shared/ai-errors.ts` 的 `AI_ERROR_CODES`）。用于 SSE `error` 事件、消息落库 `errorCode` 与运营查询。

| 错误码 | HTTP 语义码 | retryable | 场景 |
| --- | --- | --- | --- |
| `AI_PROVIDER_UNAVAILABLE` | 500 | true | 服务商不可用 / 未识别错误兜底 |
| `AI_MODEL_UNAVAILABLE` | 500 | true | 模型不可用或停用 |
| `AI_MODEL_TIMEOUT` | 500 | true | 模型响应超时 |
| `AI_PROVIDER_RATE_LIMIT` | 429 | true | 服务商限流（HTTP 429 / rate limit 文案） |
| `AI_CONTENT_REJECTED` | 400 | false | 模型拒绝内容（内容审查 / refusal） |
| `AI_CONTENT_BLOCKED` | 400 | false | 命中对话围栏敏感词，消息已拦截落库（`BLOCKED`） |
| `AI_CONTEXT_TOO_LONG` | 400 | false | 上下文超长 |
| `AI_STREAM_INTERRUPTED` | 500 | true | 流式生成中断（预留） |
| `AI_CONFIG_INVALID` | 500 | false | 场景/提示词/密钥配置不完整 |
| `AI_CONVERSATION_NOT_FOUND` | 404 | false | 会话不存在 |
| `AI_CONVERSATION_FORBIDDEN` | 403 | false | 无权访问会话 |
| `AI_MESSAGE_NOT_FOUND` | 404 | false | 消息不存在 |
| `AI_GENERATION_NOT_RUNNING` | 409 | false | 没有正在进行的生成任务 |
| `AI_REASONING_NOT_SUPPORTED` | 400 | false | 场景/模型不支持深度思考 |
| `AI_QUOTA_EXCEEDED` | 429 | true | 并发或每日配额超限 |

## 底层错误映射（`toAiError`）

按顺序匹配（命中即返回）：

1. HTTP `429` 或 `rate limit` / `too many` 文案 → `AI_PROVIDER_RATE_LIMIT`
2. `Timeout` 名称或 `timeout` / `timed out` 文案 → `AI_MODEL_TIMEOUT`
3. `content filter` / `ContentPolicy` / `refus` 文案 → `AI_CONTENT_REJECTED`
4. `context too long` / `maximum context` 文案 → `AI_CONTEXT_TOO_LONG`
5. HTTP `401` / `403` 或 `unauthoriz` / `invalid key` / `api key` 文案 → `AI_CONFIG_INVALID`
6. 其他 → `AI_PROVIDER_UNAVAILABLE`

## 约定

- 面向用户/运营的提示与日志只使用中文友好信息，不暴露内部 URL 与密钥。
- 完整堆栈只写日志，不进入响应。