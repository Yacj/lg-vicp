# C 端 Human-in-the-loop 智配方案接入

交付日期：2026-10-12。范围为候选池 → 已选 → 调整/重查 → 冲突处理 → 已选比较 → 多方案 Final → 明确确认 → Immutable Solution Snapshot。

## 1. Current App Audit

修改前检查了 assistant 页面、assistant store、ai API/types、aiStream、aiUserSelection、aiComparison，以及 AiMessageList、AiSelectionCard、AiComparisonSelection、AiComparisonCard、AiThermalSolutionCard、AiReferenceAnswer。

| 分类 | 当前能力与处理 |
| --- | --- |
| 已有能力 | AI 流式聊天、产品选择/比较、知识来源选择、报告任务、ReferencePage、原文高亮、历史会话恢复 |
| 可以复用 | request/alova、聊天发送入口、全局反馈、主题 token、knowledge-source 路由、ReferencePageViewer 与结构化来源表格 |
| 需要扩展 | 独立 Solution Client DTO、会话级状态、正式动作 API、solution_state SSE、工作区、快照查看与启动恢复 |
| 不能复用的旧产品报告逻辑 | PRODUCT selection、selectionSelectedIds、ProductComparisonView、GENERATE_REPORT 与方案状态机语义不同；保留原流程 |

对照本地 Backend 的 solution.routes.ts、solution-workflow.ts、solution-state.service.ts 和 solution_snapshots schema 读取实际契约；没有修改 Backend。

## 2. 新增 Solution Types

`src/api/solution-types.ts` 定义 SolutionStage、SolutionAction、SolutionCandidate/Card、SolutionConflict、SolutionStateDto、SolutionComparisonResult、SolutionSnapshotDto、SolutionQueryState、SolutionActionBody 和 SolutionUpdate。

Client 状态投影只保留消费字段，丢弃 Backend debug、raw candidates、内部 payload 与候选 provenance。推荐、已选、Final 各自独立。正式 R、R₀、K、厚度均来自 Backend。

快照按实际契约读取 `confirmedAt`、`payload.candidates`、`payload.alternatives`、`payload.referencePages`、`payload.warnings` 和可选 `referenceImages`。

## 3. 新增 API

全部位于 `src/api/modules/ai.ts`，使用原 request/alova 与路径参数编码。

| 方法 | 路径（前缀 /ai/conversations/{conversationId}） | Client 方法 |
| --- | --- | --- |
| GET | /solution | getSolution |
| POST | /solution | startSolution |
| POST | /solution/query | querySolution |
| POST | /solution/actions | solutionAction |
| POST | /solution/calculations | addSolutionCalculation |
| POST | /solution/products | addSolutionProducts |
| GET | /solution/snapshots/{snapshotId} | getSolutionSnapshot |

GET/start/query/calculations/products 返回直接 DTO；actions 返回 `{ solutionState, comparison?, snapshot? }`。动作始终带 solutionStateId、当前 expectedVersion、当前 candidateSetRevision 和正式 candidateIds，不提交 positions。

实际 Backend calculations 的严格 body 只接受 calculationId，并在服务端读取 active version；客户端遵循该契约，没有增加会被拒绝的 expectedVersion 字段。query API 接收完整查询条件，自然语言调整仍走 Chat，不在客户端解析。

## 4. SSE solution_state

AiStreamEventPayload 增加 solution_state；parseStreamEvent 校验正式状态并透传可选 comparison/snapshot。assistant.handleStreamEvent 调用 applySolutionState 覆盖会话状态。done.solutionState 同样支持兜底恢复。

原 comparison_ready 继续服务产品比较，未覆盖 comparisonView。没有从 Assistant Markdown 提取方案、参数或状态。

## 5. Assistant Store 改动

Solution 状态仍归 assistant Pinia store。动作实现抽到 `src/store/solution.ts`，通过 createSolutionActions 注入现有 aiApi，便于测试异步行为。

- 独立维护 solutionState、solutionComparison、solutionSnapshot、局部 loading、当前动作和 candidateIds。
- applySolutionState/restoreSolutionState/refreshSolutionState/performSolutionAction/loadSolutionSnapshot 明确分工。
- REST 成功响应才更新状态；不乐观修改 selected 或 stage。
- 相同 state 的旧版本不能覆盖 SSE 新版本；新一轮切换后，已退休 state 的迟到 SSE/GET/动作不能切回旧状态。
- 会话切换、新会话、账号切换会清理方案与 pending 请求上下文；重复点击同一轮动作只发送一次。
- version/revision conflict 自动 GET 刷新，提示重新确认，不自动重放 mutation。
- source changed 提示重新查询并刷新状态；刷新失败提供手动刷新入口。
- 对 compare minimum、hard conflict、unhandled conflict、final required、facts incomplete 分别给出中文提示。

## 6. Workspace UI

仅新增三个业务组件：AiSolutionWorkspace、AiSolutionCandidateCard、AiSolutionComparisonCard。工作区位于 AiMessageList 后、旧 Selection 前，仅当 solutionState 存在时显示，属于 Conversation 级，不绑定历史消息。

沿用现有 Wot Button/Checkbox、750rpx 尺寸与浅/深色语义 token。工作区显示中文 Stage、候选数量和已选数量；Composer 根据 Stage 提示自然语言选择/调整。

## 7. Candidate / Selected / Conflict / Final UI

- 本轮候选只取 position 非空，按 Backend position 排序；默认前四项，selected/conflict/final 不因折叠隐藏。
- 已选单独分区，position=null 的历史保留项继续展示。
- 卡片展示体系、构造、产品、正式厚度/K/双 R、状态及来源。
- PRODUCT 缺参数明确显示「热工/构造参数待补齐」，不补零或推算数值。
- 冲突用橙色说明，提供 REMOVE_CONFLICT 与 KEEP_FOR_COMPARISON；保留后仍显示冲突，新冲突按 Backend 当前 keptForComparison 状态重新处理。
- Final 支持临时多选草稿；SET_FINAL 成功才成为正式 Final，Backend 更新会重置草稿。
- Final 草稿未提交、Final 存在冲突或备选冲突未处理时，禁用确认并提示先处理。

## 8. Compare UI

COMPARE 只提交当前 selectedCandidateIds；SolutionComparisonResult 独立于 ProductComparisonView。移动端横向卡片显示正式体系、构造、产品、厚度、双 R、K、来源、冲突和 Backend 推荐。状态版本或候选 revision 变化后清除旧比较，不做客户端评分、计算或排名。

## 9. Confirm / Snapshot UI

READY_TO_CONFIRM 显示全部 Final 的参数与来源，明确按钮「确认生成方案」调用 CONFIRM。成功后显示「方案已确认」，不进入报告生成流程。

「查看已确认方案」GET 快照，展开最终/备选方案、warnings 和冻结来源表格。冻结表格复用 ReferencePageViewer；来源按钮通过 knowledge-source 传递 pageId、pageLabel、optionId。

「继续调整」调用 REVISE；「重新做一套方案」调用 START_NEW；切换到 Backend 返回的新 active state，不修改旧快照。

## 10. 历史恢复

ConversationDetail 新增 solutionState；loadConversation 同步恢复正式候选、已选、冲突、Final、Stage。重新进入已加载的会话时，recoverActiveRun 并行读取 active SolutionState。

持久化保留消费用的方案状态，但移除 action/snapshot loading 锁、临时比较、通知和快照缓存；快照通过正式 API 重读，避免跨启动保留签名图片。旧缓存兼容缺少方案字段；串会话缓存清空。

## 11. 修改文件

| 类型 | 文件 |
| --- | --- |
| 新增 Types | src/api/solution-types.ts |
| API/协议 | src/api/modules/ai.ts、src/api/types.ts、src/utils/aiStream.ts |
| 状态/生命周期 | src/store/solution.ts（新增）、src/store/assistant.ts、src/store/persist.ts |
| Client 投影/展示辅助 | src/utils/aiSolution.ts（新增） |
| 工作区组件 | src/components/ai/AiSolutionWorkspace.vue、AiSolutionCandidateCard.vue、AiSolutionComparisonCard.vue（新增） |
| 页面接入 | src/pages/assistant/index.vue |
| 测试 | src/utils/aiSolution.test.ts、src/store/solution.test.ts、src/components/ai/AiSolutionWorkspace.test.ts、src/test/fixtures/solution.ts（新增） |
| 测试配置 | eslint.config.mjs：Node test 文件不应用会改写为 Vitest 的规则 |
| 生成声明 | src/auto-imports.d.ts、src/components.d.ts 的 Solution 导出/组件声明 |
| 说明 | docs/ai-solution-workflow.md |

工作区原有及检查期间的其他改动，包括 package/lock 文件，未由本次任务修改或覆盖。未修改报告中心、ReferencePage 渲染实现、旧 PRODUCT selection、首页或 Backend。

## 12. 新增测试

共 27 项：utils 9 项、store 11 项、UI 7 项。使用原 Node test runner；组件测试使用真实 Vue SFC 的 SSR 与最小 Vue host（按钮/Checkbox 为测试替身）。API 使用依赖注入模拟正式响应与异步竞态。

覆盖 SSE state/comparison/snapshot、done 兜底、历史状态恢复、ADD/REMOVE、按钮与自然语言混合、重查保留旧 selected、冲突保留及新冲突、selected-only compare、多 Final、确认/快照/修订、新一轮隔离、重复点击、version/source conflict、来源定位参数、启动锁清理与 Client debug 字段裁剪。

## 13. 实际运行的检查

| 命令 | 结果 |
| --- | --- |
| pnpm test | 通过，72 项，0 失败（包含 27 项新增测试） |
| pnpm type-check | 未通过，17 个原有错误；没有新增 Solution 代码/测试的类型错误 |
| pnpm lint | 未通过，59 个存量错误，主要为旧文件导入排序、测试单行多语句、未使用变量等 |
| pnpm build | 通过，当前默认目标为 H5 production |
| 本次修改文件 eslint | 通过，0 错误/警告 |
| git diff --check（业务改动） | 通过 |

type-check 原有错误包括 login.vue 的 open-type、aiAgentUi/aiSource/aiStream 的 .ts import、aiStream 中旧 confirm nullable、markdown.ts 的类型及参数、wechatPhoneLogin 的 nullable loginCode。没有借本轮方案接入重构这些旧逻辑。

构建有现有 Browserslist 数据过期和 UnoCSS icon "-" 提示，不阻止 H5 构建。

完整日志保存在：

`C:/Users/admin/.codex/visualizations/2026/10/12/01a12f38-96ea-73c2-863c-869ee6db667f/solution-validation/`

文件为 test.log、type-check.log、lint.log、build.log、changed-files-lint.log。

## 14. 剩余问题

本次完成代码接入、模拟 API/竞态与组件交互验证、H5 生产构建。尚未执行真实 Backend 登录会话的端到端验收、浏览器视觉验收、App/微信小程序真机验收；不能将这些自动化测试描述为线上联调已通过。

全仓类型与 lint 的存量问题仍需另行修复。PDF/Word、报告中心迁移与 SolutionDocumentModel 输出按本轮范围留在下一阶段。
