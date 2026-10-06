# AI 服务商与模型配置

## 服务商（`ai_providers`）

- 协议：一期仅 `OPENAI_COMPATIBLE`（AI SDK `createOpenAICompatible` 适配）。DeepSeek 走同一协议，差异由 Provider Adapter 消化。
- API Key：AES-256-GCM 加密落库（ciphertext + iv + tag 分列），响应只返回 `hasApiKey`，任何接口、日志、审计不得出现密钥材料。
- 编辑时留空 `apiKey` 表示不覆盖原密钥。
- 字段：`code`（唯一）、`baseUrl`、`timeoutMs`（默认 60000）、`priority`、`description`、`enabled`。
- 删除：存在关联模型时拒绝（ConflictError）。
- 修改 `baseUrl` 或凭证会使该服务商下全部模型准入状态失效为 `UNTESTED`，并取消启用/默认。
- 测试连接：`POST /api/v1/platform/ai/providers/:id/test-connection`（`system:ai:provider:test`），选取该服务商下模型发起最小请求，结果写服务商 `lastTestStatus/lastTestMessage/lastTestAt` + 审计；错误信息脱敏。这不等于模型准入测试。

## 模型（`ai_models`）

模型配置只负责：这个模型是谁、怎么连接、是否参与图片输入、默认推理强度、是否启用、是否默认、当前是否通过准入测试。

业务字段：

| 字段 | 说明 |
| --- | --- |
| `name` / `displayName` | 显示名称 |
| `providerId` | 服务商 |
| `modelId` | 服务商侧模型标识 |
| `supportsVision` | 是否参与图片输入 |
| `reasoningLevel` | `LOW` / `HIGH` / `MAX`，默认 `HIGH` |
| `enabled` | 启用前必须 `lastTestStatus=PASSED` |
| `isDefault` | 设默认前必须已准入 |
| `lastTestStatus` | `UNTESTED` / `PASSED` / `FAILED`（只读） |
| `lastTestAt` / `lastTestError` | 最近一次准入测试（只读） |

以下字段保留兼容，停止普通 API 写入，也不再参与通用 Runtime：

- `defaultTemperature` / `maxOutputTokens` / `timeoutMs` / `contextWindow`
- `capabilities.tools` / `supportsAgent` / 回答风格

回答风格归 Global Response Policy；业务 Prompt（`/platform/ai/business-prompts`）只写该场景关注点。采样与输出上限归内部 `getAiTaskRuntimePolicy(taskType)`。

## 准入测试

`POST /api/v1/platform/ai/models/:id/test`（兼容旧路径 `/test-connection`）。仅超级管理员。必须真实调用：

- TEXT：获得有效文本
- TOOL_CALLING：`tool()` → inputSchema 校验 → execute → tool result → 模型继续 → 最终回答
- REASONING：按当前 `LOW/HIGH/MAX` 映射并成功调用，不支持则失败，禁止 `MAX → HIGH` 静默降级
- VISION：仅 `supportsVision=true` 时发送真实图片；声明与实际能力不一致则失败

返回：

```json
{
  "ok": true,
  "checks": {
    "connection": { "ok": true, "message": "..." },
    "text": { "ok": true, "message": "..." },
    "toolCalling": { "ok": true, "message": "..." },
    "reasoning": { "ok": true, "message": "..." },
    "vision": { "ok": true, "message": "..." }
  }
}
```

关键信息变化（provider / modelId / baseUrl / credential / supportsVision / reasoningLevel）会使 `PASSED` 失效为 `UNTESTED`。

## 运行时选择

- 正式 Runtime 只选择 `enabled=true` 且 `lastTestStatus=PASSED`
- 图片输入额外要求 `supportsVision=true`
- 不再查询用户勾选的 `supportsAgent` / `supportsTools`
- Agent-Compatible ≠ 所有请求走 Agent：寒暄可直接 `streamText`

## Reasoning

业务层只使用 `LOW` / `HIGH` / `MAX`。`resolveReasoningConfig({ provider, modelId, level })` 由 Adapter 映射。

DeepSeek：`LOW → low`，`HIGH → high`，`MAX → max`。`reasoning_content` 由 `@ai-sdk/openai-compatible` 在 tool 多轮消息中回传，不在业务层重复实现，也不暴露给 B 端或用户。

C 端会话 `reasoningMode` 仍为 `OFF` / `ON`：OFF 不传推理参数；ON 使用模型默认 `reasoningLevel`。
