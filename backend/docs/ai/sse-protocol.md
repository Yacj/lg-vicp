# SSE 流式协议

对话接口 `POST /api/v1/ai/conversations/:id/messages` 与重新生成、AI 调试共用同一事件流。`Content-Type: text/event-stream`，帧格式 `event: <name>\ndata: <json>\n\n`。

## 事件清单

### `message`

握手事件（首帧）。发消息：

```json
{ "messageId": "uuid", "conversationId": "uuid", "requestId": "请求ID" }
```

重新生成额外携带 `originalMessageId`；AI 调试的 `messageId` 为虚拟 ID（不落库）。
同帧兼容发送 `message_start`，字段相同。

### `agent_status` / `progress`

处理阶段，客户端据此展示中文状态。`progress.stage` 仍为四种：`analyzing` / `checking` / `composing` / `completed`。
`agent_status` 用于工具级状态，例如「正在查询知识库…」「正在进行热工计算…」。不发送 Chain of Thought 或模型隐藏 reasoning。

### `tool_start` / `tool_result`

Agent 调用工具时发送。`tool_start` 含 `toolName` 与中文 `message`；`tool_result` 含 `success`，不返回超长 raw 全文。

### `need_user_input`

Agent 进入 `WAITING_USER_INPUT`（多方案选择、缺少关键条件、覆盖已确认方案等）。

```json
{ "runId": "uuid", "prompt": "请从候选方案中选择一个", "options": [] }
```

下一句用户消息或 `POST /agent-runs/:id/resume` 恢复原 Run，不重新创建任务。

### `delta` / `text_delta`

```json
{ "text": "增量文本" }
```

`text_delta` 与 `delta` 同内容，便于新客户端迁移。

### `done` / `message_done`

```json
{
  "messageId": "uuid",
  "conversationId": "uuid",
  "finishReason": "COMPLETED | WAITING_USER_INPUT",
  "usage": { "inputTokens": 0, "outputTokens": 0, "reasoningTokens": 0 },
  "model": { "id": "模型行ID" },
  "promptVersion": { "id": "版本ID", "version": 1 },
  "sources": [AiSourceRef],
  "latencyMs": 1234
}
```

`sources` 为统一原文溯源契约（`src/modules/ai/ai-source.mapper.ts`，正常生成与 regenerate 同构）：

```json
{
  "sourceType": "KNOWLEDGE",
  "retrievalUnit": "SECTION | PAGE | BLOCK | CHUNK",
  "documentId": "uuid", "versionId": "uuid",
  "sectionId": "uuid?", "pageId": "uuid?", "blockId": "uuid?", "chunkId": "uuid?（仅 Chunk 辅助索引场景存在）",
  "title": "文档标题",
  "tocPath": ["A VICP薄抹灰外保温系统", "窗洞口"],
  "sectionTitle": "窗洞口",
  "chapter": "A VICP薄抹灰外保温系统", "section": "窗洞口",
  "sectionPath": ["A VICP薄抹灰外保温系统", "窗洞口"],
  "citationAnchor": "5.2.3",
  "physicalPageNumber": 105,
  "pageLabel": "A7",
  "pageTitle": "窗洞口",
  "originalFileId": "uuid",
  "pageNumber": 21, "pageStart": 21, "pageEnd": 23, "page": 21,
  "matchedText": "本次实际命中的章节/页面/块/切片内容",
  "quote": "本次实际命中的章节/页面/块/切片内容",
  "snippet": "命中词 ±40 字截取",
  "highlightRanges": [{ "pageId": "uuid", "pageNumber": 21, "blockId": "uuid", "text": "命中原文" }],
  "evidenceLevel": "A", "score": 12.5
}
```

无知识检索证据时 `sources` 为空数组，不伪造来源。C 端主要使用 `title` / `tocPath` / `sectionTitle` / `pageLabel` / `quote`；`physicalPageNumber` + `originalFileId` 只用于打开正式原文页。点击来源后调用 `GET /api/v1/ai/knowledge/source-detail` 获取 TOC 路径、ORIGINAL 页面预览图与高亮定位。

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
- 停止通道：Redis `ai:message:{id}:stop` + `AbortController` 双通道；客户端断开（`close`）触发自动中止，标记 `CLIENT_DISCONNECTED`。停止必须同时取消 model stream、停止后续 Tool，Agent Run → `CANCELLED`；已完成 ToolCalls 保留。
- 客户端断线不丢 Agent Run。用 `GET /conversations/:id/active-agent-run` 与 `GET /agent-runs/:id` 恢复 RUNNING / WAITING_USER_INPUT / COMPLETED。
- 所有完成/停止/失败均落库 `errorCode` / `requestId` / `durationMs`，便于运营追踪。
- 后向兼容：字段只增不改，存量客户端忽略未知字段即可。旧事件 `message` / `progress` / `delta` / `done` / `stopped` / `error` 继续发送。