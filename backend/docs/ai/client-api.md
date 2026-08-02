# 客户端对话接口

前缀 `/api/v1/ai`，`B_ADMIN` / `C_APP` / `PC_AI` 共用，全部要求 JWT，不依赖后台 RBAC（仍需客户端来源、项目可见性、会话归属校验）。

## 会话

| 接口 | 说明 |
| --- | --- |
| `POST /conversations` | 创建会话（scene 默认为 `general_chat`） |
| `GET /conversations` | 会话列表（分页 / 关键词 / 项目 / 置顶） |
| `GET /conversations/:id` | 会话详情（消息 / 处理阶段 / 反馈 / 报告 / 分享摘要） |
| `PATCH /conversations/:id` | 重命名 |
| `PUT /conversations/:id/pin` | 置顶（写 `pinnedAt`） |
| `PATCH /conversations/:id/project` | 移动项目 |
| `PATCH /conversations/:id/settings` | 深度思考开关（reasoningMode，会话级，默认 OFF） |
| `PATCH /conversations/:id/scene` | 切换场景（校验目标场景 `enabled` 且项目依赖匹配） |
| `PUT /conversations/:id/group` | 分组（groupId） |
| `DELETE /conversations/:id` | 软删除（禁用关联有效分享链接） |
| `POST /conversations/:id/restore` | 恢复 |
| `DELETE /conversations/:id/permanent` | 永久删除（仅 `SUPER_ADMIN`，消息级联删除，删前写审计） |

## 对话

| 接口 | 说明 |
| --- | --- |
| `POST /conversations/:id/messages` | 发消息（SSE，见 `sse-protocol.md`） |
| `POST /messages/:id/stop` | 停止生成 |
| `POST /messages/:id/regenerate` | 重新生成（新建助手消息 + `ai_message_regenerations` 关系，不覆盖原回答） |
| `PUT /messages/:id/feedback` | 点赞 / 反馈（upsert，`reasonCode` + 标签） |
| `POST /conversations/:id/report-draft` | 报告草稿（场景 `report_generate` 门控） |
| `GET /quota` | 查询当日已用 / 上限与并发占用 |

## 业务规则

- `general_chat`：`requireProject=false`、`allowFileUpload=false`、`allowKnowledgeSearch=false`、`allowTools=false`、`allowReasoning=true`。
- 检索仅在 `allowKnowledgeSearch` 为 true 且会话绑定项目时执行；未执行检索不得发送"核对检索资料"阶段。
- 历史窗口按 Token 预算裁剪（`AI_CONTEXT_MAX_MESSAGES` 默认 20 条，输出预留 + 10% 安全余量），超长从最早历史裁剪。
- 停止 / 重新生成 / 反馈均保留原始消息，可追踪。
- 每条消息落库：实际 provider / model / `promptVersionId` / `reasoningMode` / usage / `errorCode` / `requestId`。