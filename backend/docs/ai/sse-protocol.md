# SSE 流式协议

对话接口 `POST /api/v1/ai/conversations/:id/messages` 与重新生成、AI 调试共用同一事件流。`Content-Type: text/event-stream`，帧格式 `event: <name>\ndata: <json>\n\n`。

## 事件清单

### `message`

握手事件（首帧）。发消息：

```json
{ "messageId": "uuid", "conversationId": "uuid", "requestId": "请求ID" }
```

重新生成额外携带 `originalMessageId`；AI 调试的 `messageId` 为虚拟 ID（不落库）。

### `agent_status` / `progress`

处理阶段，客户端据此展示中文状态。`progress.stage` 仍为四种：`analyzing` / `checking` / `composing` / `completed`。
`agent_status` 用于工具级状态，例如「正在查询知识库…」「正在进行热工计算…」。不发送 Chain of Thought 或模型隐藏 reasoning。

### `tool_start` / `tool_result`

Agent 调用工具时发送。`tool_start` 含 `toolName` 与中文 `message`；`tool_result` 含 `success`，不返回超长 raw 全文。

### `reference_pages`

参考方案查表命中且页面已有图片时发送。载荷 `{ referencePages: ReferencePageBlock[] }`，每项含 `summary`、`page.imageUrl` 和 `highlights`（厚度、产品层 R、总 R、K）。没有来源页或没有页图时不发送该事件，正文说明尚未关联原始页面。`done` 可同时带已保存的 `referencePages`（不含会过期的 URL，历史读取时再签名）。

### `comparison_ready`

产品/方案对比工具完成后发送结构化摘要（维度数量、thermalStatus、missingNotes）。随后通常进入 `waiting_user_input`。

### `need_user_input` / `waiting_user_input`

Agent 进入 `WAITING_USER_INPUT`。新客户端优先监听 `waiting_user_input`；`need_user_input` 为兼容旧事件，载荷相同。

产品对比等待类型为统一 `USER_SELECTION`（`selectionKind=PRODUCT`，可多选，`minSelections=1`，`confirmAction.GENERATE_REPORT`）。图集/知识来源为 `KNOWLEDGE_SOURCE`（可多选；仅 1 个候选时自动选中，不进入等待）。报告类型不明确时为 `REPORT_TYPE`，不要让模型把类型写成 Markdown 编号。旧单选 `CHOICE` / `COMPARISON_SELECTION` 仍可读取。用户勾选并点击「确认并生成报告」后不再二次 Approval。

```json
{
  "runId": "uuid",
  "type": "USER_SELECTION",
  "selectionKind": "PRODUCT",
  "legacyType": "COMPARISON_SELECTION",
  "request": {
    "type": "USER_SELECTION",
    "selectionKind": "PRODUCT",
    "title": "请选择需要纳入报告的产品/方案",
    "multiple": true,
    "minSelections": 1,
    "autoSelectWhenSingle": true,
    "confirmAction": { "type": "GENERATE_REPORT", "label": "确认并生成报告" },
    "options": [{ "id": "uuid", "title": "VICP", "description": "..." }]
  },
  "title": "请选择需要纳入报告的产品/方案",
  "prompt": "可选择一个或多个，确认后系统将自动生成对比报告。",
  "multiple": true,
  "minSelections": 1,
  "confirmAction": { "type": "GENERATE_REPORT", "label": "确认并生成报告" },
  "options": [{ "id": "uuid", "label": "VICP", "summary": "..." }]
}
```

下一句用户消息或 `POST /agent-runs/:id/resume` 可带 `selectedIds` + `selectionKind`（兼容 `optionIds` + `confirmAction=GENERATE_REPORT`）。确认后 Backend 固化 Report Context Snapshot 并排队生成报告。

### `report_started` / `report_queued`

用户确认生成报告后，Backend 完成 Snapshot + 报告记录 + 入队即结束当前 AI 交互。`report_queued` 含 `reportId`、`taskId`、`snapshotId`、`status=QUEUED`。此时不要保持模型 Stream 等待 Worker。

`report_completed` **只在报告 `READY` 之后**由 C 端通过报告 API 轮询确认，禁止在刚插入 DRAFT 记录时发送。中间 BullMQ 重试对用户保持 `GENERATING`。

### `delta`

```json
{ "text": "增量文本" }
```

只发送 `delta`（即协议中的 text_delta）。不再双发 `text_delta`，避免客户端把同一段正文拼接两次。

### `done`

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

- C 端普通用户聊天正文只来自 `delta`（text_delta）。`tool_start` / `tool_result` / `agent_status` / `progress` 是内部处理状态，默认不要当聊天正文显示。
- 来源单独走 `sources`（`done.sources` 或独立 `sources` 事件），不要把“如何检索到来源”写进正文。
- 结构化对比单独走 `comparison_ready`；报告入队走 `report_queued`，可下载完成以报告 `READY` 为准。
- SSE 握手（hijack）前发生的错误按全局 JSON 信封返回（`{ success:false, error, requestId }`）；握手后错误一律走 SSE `error` 事件。
- 停止通道：Redis `ai:message:{id}:stop` + `AbortController` 双通道；客户端断开（`close`）触发自动中止，标记 `CLIENT_DISCONNECTED`。停止必须同时取消 model stream、停止后续 Tool，Agent Run → `CANCELLED`；已完成 ToolCalls 保留。
- 客户端断线不丢 Agent Run。用 `GET /conversations/:id/active-agent-run` 与 `GET /agent-runs/:id` 恢复 RUNNING / WAITING_USER_INPUT / COMPLETED。
- 所有完成/停止/失败均落库 `errorCode` / `requestId` / `durationMs`，便于运营追踪。
- 后向兼容：字段只增不改，存量客户端忽略未知字段即可。正文只发 `delta`，完成只发 `done`，不再双发 `text_delta` / `message_start` / `message_done`。