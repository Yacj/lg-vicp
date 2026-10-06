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

写入与审计同事务，并清除 Redis 缓存 `ai:quick-prompts:client:v2`（TTL 10 分钟）。

## C 端只读

`GET /api/v1/ai/quick-prompts?position=AI_HOME`

只返回 `enabled=true`，按 `sortOrder ASC`。不返回 `createdBy` / `actionType` 等管理字段。

不要求 `quickPromptId`。自由输入与快捷提问走同一套对话编排。

`content` 必须是用户会说的自然问题，不要包含“当前已发布 / 不要编造 / 找不到可靠依据”等系统指令。平台预置 4 条：

| 标题 | 发送文本 |
| --- | --- |
| 查询图集 | 帮我查一下和当前问题相关的图集做法，并告诉我出处。 |
| 分析当前项目 | 结合当前项目，帮我看看这个问题需要注意什么。 |
| 匹配保温方案 | 根据当前条件，帮我找几个可以参考的保温方案，并附上依据。 |
| 查询节能标准 | 帮我查一下和当前问题相关的节能标准，告诉我关键要求和出处。 |

存量更新：`pnpm db:seed` 会插入缺失项，并**仅当现有 content 仍是旧系统味文案**时覆盖这 4 条；管理员已改写成其他问题的记录不会被覆盖。业务 Prompt 已发布版本不会被 seed 覆盖；如需新默认模板，走 B 端「恢复默认」。

## 能力路由

`resolveAiCapabilities({ message, projectId? })` 用规则判断（供预路由、寒暄优化、非 Agent 回退注入）：

- `idle`
- `needKnowledgeSearch` / `explicitKnowledgeRequest`
- `needProjectContext`
- `needReferenceLookup`
- `needThermalTool`
- `needComparisonTool`
- `needReportContext`

Chat Agent 核心 Tools 只有 5 个时，非寒暄消息向模型开放完整领域 Tool 集合；regex 不再作为某 Tool 能否被模型看到的唯一依据。

正式 C 端会话默认 `scene=general_chat`，用户不选择场景或系统指令。基础 System Instruction 由 Backend 自动附加。
