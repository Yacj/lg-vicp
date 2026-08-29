# 客户端对话接口

前缀 `/api/v1/ai`，`B_ADMIN` / `C_APP` / `PC_AI` 共用，全部要求 JWT，不依赖后台 RBAC（仍需客户端来源、项目可见性、会话归属校验）。

## 会话

| 接口 | 说明 |
| --- | --- |
| `POST /conversations` | 创建会话（scene 默认为 `general_chat`；专业场景必须携带 `insulationSystemId`） |
| `GET /context/insulation-systems` | 获取可选保温体系（PUBLISHED+生效中，C 端/PC AI 端会话前置选择） |
| `PATCH /conversations/:id/insulation-system` | 切换会话保温体系（可传 null 清空；写审计；历史消息不变） |
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
| `GET /ai/knowledge/source-detail`（前缀 `/api/v1/ai/knowledge`） | AI 来源详情：`?documentId=&sectionId=&pageId=&blockId=&chunkId=&matchedText=` 任一定位入口 → 文档 + 章节路径 + 完整页（fullText+blocks）+ 命中高亮（blockId 优先，matchedText 兜底） |

## 业务规则

- `general_chat`：`requireProject=false`、`allowFileUpload=false`、`allowKnowledgeSearch=false`、`allowTools=false`、`allowReasoning=true`。
- 会话保温体系：专业场景（非 `general_chat`）创建会话与发送消息前必须已选体系，否则返回 `AI_INSULATION_SYSTEM_REQUIRED`（400）；体系为会话级上下文，切换后历史消息不变，后续知识检索/候选查询/Prompt 组装自动携带（候选查询可传 `conversationId` 自动注入 `systemId`）。
- 知识检索为 Wiki 层级检索（体系 → 文档 → 章节/页面/内容块，Chunk 辅助召回）；范围覆盖项目文档 + 平台已发布文档，会话体系标注文档优先；`done.sources` 为统一 AiSourceRef 契约（见 `sse-protocol.md`）。
- 检索仅在 `allowKnowledgeSearch` 为 true 且会话绑定项目时执行；未执行检索不得发送"核对检索资料"阶段。
- 历史窗口按 Token 预算裁剪（`AI_CONTEXT_MAX_MESSAGES` 默认 20 条，输出预留 + 10% 安全余量），超长从最早历史裁剪。
- 停止 / 重新生成 / 反馈均保留原始消息，可追踪。
- 每条消息落库：实际 provider / model / `promptVersionId` / `reasoningMode` / usage / `errorCode` / `requestId`。