# SSE 流式协议

对话接口 `POST /api/v1/ai/conversations/:id/messages` 与重新生成、AI 调试共用同一事件流。`Content-Type: text/event-stream`，帧格式 `event: <name>\ndata: <json>\n\n`。

## 事件清单

### `message`

握手事件（首帧）。发消息：

```json
{ "messageId": "uuid", "conversationId": "uuid", "requestId": "请求ID" }
```

重新生成额外携带 `originalMessageId`；AI 调试的 `messageId` 为虚拟 ID（不落库）。

### `progress`

处理阶段，客户端据此展示中文状态。`stage` 仅四种：

| stage | 含义 |
| --- | --- |
| `analyzing` | 分析项目资料 / 问题 |
| `checking` | 核对检索资料和计算结果（**仅真实执行检索时发送**，不伪造检索/计算阶段） |
| `composing` | 整理回答 |
| `completed` | 完成 |

### `delta`

```json
{ "text": "增量文本" }
```

### `done`

```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "finishReason": "COMPLETED",
  "usage": { "inputTokens": 0, "outputTokens": 0, "reasoningTokens": 0 },
  "model": { "id": "模型行ID" },
  "promptVersion": { "id": "版本ID", "version": 1 },
  "sources": [{ "title": "来源标题", "page": 1 }],
  "latencyMs": 1234
}
```

### `stopped`

```json
{ "messageId": "uuid", "partialContent": "已生成内容", "content": "已生成内容" }
```

停止只结束当前生成，已生成内容落库为 `STOPPED`，会话可继续。

### `error`

```json
{ "code": "AI_*错误码", "message": "中文提示", "requestId": "请求ID", "retryable": true }
```

错误码见 `docs/ai/error-codes.md`。

## 行为约定

- SSE 握手（hijack）前发生的错误按全局 JSON 信封返回（`{ success:false, error, requestId }`）；握手后错误一律走 SSE `error` 事件。
- 停止通道：Redis `ai:message:{id}:stop` + `AbortController` 双通道；客户端断开（`close`）触发自动中止，标记 `CLIENT_DISCONNECTED`。
- 所有完成/停止/失败均落库 `errorCode` / `requestId` / `durationMs`，便于运营追踪。
- 后向兼容：字段只增不改，存量客户端忽略未知字段即可。