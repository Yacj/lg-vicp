# B 端平台管理接口

前缀 `/api/v1/platform/ai`（另有场景/提示词配置在 `/api/v1/platform` 下）。全部要求 `B_ADMIN` 客户端 + JWT + 精确权限码；`SUPER_ADMIN` 直通。权限码与 `src/db/seed.ts`、`src/shared/ai-permissions.ts` 保持一致。

## AI 配置（`ai-config` 模块）

### 服务商

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/providers` | `system:ai:provider:list` |
| `POST /api/v1/platform/ai/providers` | `system:ai:provider:add` |
| `PATCH /api/v1/platform/ai/providers/:id` | `system:ai:provider:edit` |
| `DELETE /api/v1/platform/ai/providers/:id` | `system:ai:provider:remove` |
| `POST /api/v1/platform/ai/providers/:id/test-connection` | `system:ai:provider:test` |

### 模型

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/models` | `system:ai:model:list` |
| `POST /api/v1/platform/ai/models` | `system:ai:model:add` |
| `PATCH /api/v1/platform/ai/models/:id` | `system:ai:model:edit` |
| `DELETE /api/v1/platform/ai/models/:id` | `system:ai:model:remove` |
| `POST /api/v1/platform/ai/models/:id/test-connection` | `system:ai:model:test` |

### 场景 / 提示词

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/scene-bindings` | `system:ai:scene:list` |
| `PUT /api/v1/platform/ai/scene-bindings` | `system:ai:scene:edit` |
| `GET|POST /api/v1/platform/ai/prompts` | `system:ai:prompt:list` / `system:ai:prompt:add` |
| `GET /api/v1/platform/ai/prompts/:id` | `system:ai:prompt:list` |
| `PATCH /api/v1/platform/ai/prompts/:id/draft` | `system:ai:prompt:edit` |
| `POST /api/v1/platform/ai/prompts/:id/publish` | `system:ai:prompt:publish` |
| `POST /api/v1/platform/ai/prompts/:id/disable` | `system:ai:prompt:publish` |
| `GET /api/v1/platform/ai/prompts/:id/versions` | `system:ai:prompt:list` |
| `GET /api/v1/platform/ai/prompts/:id/versions/compare` | `system:ai:prompt:list` |
| `POST /api/v1/platform/ai/prompts/:id/versions/:versionId/rollback` | `system:ai:prompt:publish` |
| `DELETE /api/v1/platform/ai/prompts/:id` | `system:ai:prompt:remove` |

### 对话围栏（`ai-filter` 模块）

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/filters`（分页列表，支持关键词/匹配方式/启用筛选） | `system:ai:filter:list` |
| `POST /api/v1/platform/ai/filters` | `system:ai:filter:add` |
| `PATCH /api/v1/platform/ai/filters/:id` | `system:ai:filter:edit` |
| `DELETE /api/v1/platform/ai/filters/:id` | `system:ai:filter:remove` |

词条字段：`keyword`（关键词或正则）、`matchType`（`CONTAINS`/`REGEX`，REGEX 提交时校验合法性）、`sceneCodes`（空 = 全局，否则仅指定场景生效，取值见 `AI_SCENES`）、`hitMessage`（命中提示语，缺省使用默认中文提示）、`enabled`。增删改均写审计。

## AI 运营（`ai-admin` 模块）

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/conversations`（运营列表） | `system:ai:conversation:list` |
| `GET /api/v1/platform/ai/conversations/:id`（运营详情） | `system:ai:conversation:detail` |
| `GET /api/v1/platform/ai/messages/:id`（消息详情） | `system:ai:conversation:detail` |

消息详情返回：完整消息字段（provider / model / promptVersion / usage / errorCode / requestId）、所属会话摘要、用户、该消息的反馈与重新生成记录。

## AI 反馈（`ai-feedback` 模块）

| 接口 | 权限码 |
| --- | --- |
| `GET /api/v1/platform/ai/feedbacks` | `system:ai:feedback:list` |
| `PUT /api/v1/platform/ai/feedbacks/:id/handle` | `system:ai:feedback:handle` |

处理接口写入 `handledById / handledAt / handlingNote` 并记审计。

## AI 调试（`ai-debug` 模块，Swagger 标签 `B端 / 平台 / AI调试`）

| 接口 | 权限码 |
| --- | --- |
| `POST /api/v1/platform/ai/debug/chat`（SSE） | `system:ai:debug:use` |
| `POST /api/v1/platform/ai/debug/:id/stop` | `system:ai:debug:use` |

- 请求体：`{ scene?, modelId?, promptVersionId?, reasoningMode?, messages[] }`（至少指定一项）。
- 事件流与业务对话一致（见 `sse-protocol.md`）；**不落 `ai_messages` 库**，每次调用写审计（含结果）。
- 停止复用内存生成表，进程重启即失效，不影响业务会话。

## 菜单与按钮（seed）

- `AI 配置` 菜单（`/system/ai`）+ 按钮：测试服务商连接、提示词发布、AI 调试。
- `AI 运营` 菜单（`/monitor/ai`）挂 `system:ai:conversation:list`。