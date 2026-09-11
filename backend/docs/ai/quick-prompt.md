# 快捷提问与自动能力路由

> 快捷提问是 C 端可选入口，不是 System Prompt，也不是 Scene。
> 用户点击后把 `content` 作为普通用户消息，走现有 `POST /conversations/:id/messages` SSE。

## 数据模型 `ai_quick_prompts`

| 字段 | 说明 |
| --- | --- |
| `title` | C 端展示标题 |
| `description` | 辅助说明 |
| `content` | 点击后真正发给 AI 的用户文本 |
| `icon` | icon key（`book` / `project` / `material` / `standard` / `calc` / `compare` / `chat`） |
| `position` | `AI_HOME` / `PROJECT_AI` |
| `sortOrder` | 升序 |
| `enabled` | 启停 |
| `actionType` | 内部提示，默认 `AUTO`，不强制路由场景 |

## B 端管理

前缀 `/api/v1/platform/ai/quick-prompts`，权限码 `system:ai:quick-prompt:{list,create,update,delete}`。

| 接口 | 权限 |
| --- | --- |
| `GET /` | list |
| `POST /` | create |
| `PUT /:id` | update |
| `DELETE /:id` | delete |
| `POST /:id/enable` | update |
| `POST /:id/disable` | update |

写入与审计同事务，并清除 Redis 缓存 `ai:quick-prompts:client`（TTL 10 分钟）。

## C 端只读

`GET /api/v1/ai/quick-prompts?position=AI_HOME`

只返回 `enabled=true`，按 `sortOrder ASC`。不返回 `createdBy` / `actionType` 等管理字段。

不要求 `quickPromptId`。自由输入与快捷提问走同一套对话编排。

## 能力路由

`resolveAiCapabilities({ message, projectId? })` 用规则判断：

- `needKnowledgeSearch` / `explicitKnowledgeRequest`
- `needProjectContext`
- `needThermalTool`
- `needComparisonTool`
- `needReportContext`

正式 C 端会话默认 `scene=general_chat`，用户不选择场景或系统指令。基础 System Instruction 由 Backend 自动附加。
