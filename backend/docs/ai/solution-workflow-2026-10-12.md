# Human-in-the-loop 智配方案闭环

交付范围：Backend 候选池 → 多选 → 改条件/偏好 → 冲突处理 → 已选比较 → Final → 明确确认 → Immutable Solution Snapshot。预留 GENERATING/GENERATED；本轮不调用报告队列，不生成 HTML、PDF 或 Word。

## 1. Current Audit

改动前，`ConversationTaskState.lastReferenceLookup` 保存 QueryState、一次候选列表和可选 `selectedCandidateIds`，重查会覆盖整个列表。`compare_solutions` 已能比较冻结参考候选，但筛掉不满足现有条件的旧选择。`thermal_candidate_selections` 是单条最终参考行的确认记录，不能表示多选/refine/冲突。不存在独立 SolutionState。

已有 `report_context_snapshots` 是产品对比、资料选择与报告需求的上下文，`report_snapshots` 是模板报告章节快照；它们不能承担活跃方案池。项目/会话归属、审计、正式发布数据和页面快照已有统一服务。

## 2. Existing reusable modules

复用 Semantic Query Parser、`thermalQueryStateSchema`、`validateCandidateAgainstQueryState`、`rankByPreferences`、`queryThermalCandidates`、`compactCandidateResult`、`emitReferencePages`、`matchConfirmedPageOptions`、`readConsumableReferencePages`、完整 renderModel 与 `compare_solutions` 工具。`compare_products` 保持辅助产品解释；不覆盖方案数值。热工公式与 Matcher 主结构没有修改。

## 3. SolutionState design

`solution_states` 为 SSOT：会话/用户/可空项目、active、stage、version、candidateSetRevision、typed JSON payload、confirmedSnapshotId、创建/更新时间。payload 保存完整 QueryState、硬条件、软偏好、当前展示 poolCandidateIds、各候选值快照及状态、selected/rejected/final、冲突、保留比较 ID 与确定性推荐 ID。

`poolCandidateIds` 决定序号映射；保留的旧选择不插入新列表序号。历史可有多个 state，partial unique index 保证每个 conversation 只有一个 active。会话重新打开通过 GET 恢复，消息 metadata 仅保存定位/状态摘要，记忆与聊天正文不参与事实恢复。

## 4. Candidate lifecycle

REFERENCE：正式热工 row ID；知识回退使用当前发布人工确认档位的 optionId，标记 referenceKind=KNOWLEDGE_PAGE。CALCULATED：正式 calculationId；REFERENCE_TABLE 多结果用 calculationId+setId，保存该次引擎整体结果和所选原子结果。PRODUCT：正式 catalog product ID，只保存产品自身字段，不计算 K/双 R。

状态 AVAILABLE / SELECTED / REJECTED / CONFLICT / FINAL。重查增加候选集 revision；保留旧 selected/rejected；重算硬条件冲突并清 Final，要求用户重新指定。追加产品/计算候选保留当前池中其余候选。已确认后的修改创建新 state，历史 snapshot 保持原值。

## 5. Selection / Add / Remove

REST 支持 SELECT（替换）、ADD（集合并集）、REMOVE、REMOVE_CONFLICT、KEEP_FOR_COMPARISON、SET_FINAL、COMPARE、CONFIRM、START_NEW、REVISE。自然语言动作走独立 USER_SELECTION 适配器，支持第一个和第三个、选1和3、前两个、唯一构造编号、已选中唯一厚度“30那个不要了”。重复 ADD/REMOVE 幂等，REJECTED 可恢复。

构造编号在当前池仍有多个体系/厚度时澄清。“这个方案”没有唯一定位时澄清。模型不得指定候选事实；工具修改动作必须被本轮用户原话验证，模型 candidateIds 不扩展 SSOT 的已选比较范围。

## 6. Refine Loop

QueryState 的增改删及 NEW_QUERY/追问生命周期保持原入口。“更薄一点”是偏好，只排序；厚度必须20以内是硬条件。真实重查把正式候选写回 SolutionState，再向聊天返回结构化状态。C端 query API 接收完整 QueryState（包括 filters[]），不把 PATCH 当完整查询；条件取消应明确从完整 query 移除。

## 7. Conflict handling

用共用约束校验器逐项生成 THICKNESS/SYSTEM/PRODUCT/METRIC/STANDARD/REGION/CONDITION_MISMATCH。缺数据也不能证明满足条件。冲突保留原选择；REMOVE_CONFLICT 明确移除，KEEP_FOR_COMPARISON 只处理备选用途，不解除硬条件。Final 不得包含冲突；其他已选冲突也必须先处理。

## 8. Compare Selected

默认只读取 selectedCandidateIds，少于两个返回 SOLUTION_COMPARE_MINIMUM，不补其他候选。返回体系、构造、产品/规格 ID、厚度、产品 R、总 R、K、来源、冲突和推荐。对比数值读候选值快照；允许比较已明确保留的冲突方案，但明确标注。recommendation 只给硬条件通过的已选记录，按正式偏好排序，不写 Final。聊天确定性动作输出对比表，Agent 对比继续经过 Allowed Fact Set 校验。

## 9. Final Confirm

SET_FINAL 进入 READY_TO_CONFIRM，不冻结。“确认生成方案”/“确认最终方案”才触发聊天 CONFIRM，“行”“可以”不冻结。C端确认按钮发显式 CONFIRM。

事务内锁会话和 state → 检查 expectedVersion → 检查 Final/完整数值/未处理冲突 → 重验正式候选及原页确认 optionId → 插入 snapshot → 更新 confirmedSnapshotId/stage=CONFIRMED → 写审计。任一步失败回滚。重复 CONFIRM 返回原 snapshot，兼容重复请求携带旧版本。其他旧版本写入返回 400 业务错误及 `error.details.errorCode=SOLUTION_VERSION_CONFLICT`。

## 10. Immutable Solution Snapshot

独立值快照含 query/conditions/preferences、Final、已选备选、项目当时摘要、selected/final/recommended ID、完整来源页 renderModel、objectKey/页/文档/版本、warnings、confirmedBy/At、schemaVersion。计算候选额外保存 input/result/rule/formulas/steps/parameters/layers/standard；不跨候选补值。来源未提供已核验印刷页码时记 warning，不填物理页序。

数据库 BEFORE UPDATE OR DELETE 触发器拒绝变更。snapshot 不保存签名 URL；读取图片时重验当前发布/项目/版本/对象键及确认模型一致性后重签。失效来源仅关闭图片，冻结值与当时表格仍可在有权访问快照时阅读。FK 不 cascade，以保留确认历史。

`toSolutionDocumentModel(snapshot)` 是纯函数，后续文档只能消费该模型；禁止重新跑 QueryState、重查参考行、让模型猜 Final。现有其他类型报告流程保持兼容，本轮未接通方案报告生成。

## 11. API / Tool contracts

前缀 `/api/v1/ai/conversations/:conversationId/solution`，只允许 C_APP / PC_AI；每次服务调用重验会话属于本人、登录客户端一致和项目可见性。

|方法/相对路径|输入|输出|
|---|---|---|
|GET /|无|active solution DTO 或 null|
|POST /|expectedVersion 可选|新 active state|
|POST /query|expectedVersion、完整 query|刷新后的 DTO|
|POST /actions|solutionStateId、expectedVersion、action、candidateIds 或 positions、candidateSetRevision|solutionState；COMPARE 附 comparison；CONFIRM 附 snapshot|
|POST /calculations|calculationId|追加本人同项目计算记录后的 DTO|
|POST /products|expectedVersion、productIds|追加 ACTIVE 产品原子字段后的 DTO|
|GET /snapshots/:snapshotId|无|值快照及另行重签的 referenceImages|

B端调试读取 `GET /api/v1/platform/ai/debug/conversations/:id/solution`，强制 B_ADMIN 和 `system:ai:debug:use`，返回 DTO/debug；运营详情也附 active solutionState。

序号写操作必须带当前 candidateSetRevision；稳定 ID 仍必须属于该 state，所有 mutation 使用 version。Tool 复用 `compare_solutions` 增加 operation/positions，无另一套选择业务服务。正式参考查询/计算/知识确认回退自动落入同一服务。

## 12. DB / Migration

`0054_thankful_mindworm.sql` 与 Drizzle snapshot/journal 同步生成。两个表，用户/会话/项目 FK，state↔snapshot FK，一 state 一 snapshot unique、会话 active partial unique、project/user/stage/时间索引，snapshot mutation 触发器。不运行生产迁移验证、不使用 db push。

`version` 用于写冲突；`candidateSetRevision` 用于展示与序号身份，两者不能混用。DB 迁移须在应用更新前运行；本地隔离库尚不可连接，真实执行验证 BLOCKED。

## 13. Modified files

新增：`solution-workflow.ts`（状态、校验、卡片）、`solution-selection.ts`（动作语义）、`solution-state.service.ts`（权限/事务/来源）、`solution.routes.ts`（REST）、`solution-document-model.ts`（未来文档契约）及三组专门测试。

集成：`schema.ts`、`app.ts`、Swagger；聊天 generation/会话恢复/运营详情；正式参考 query、thermal、search_knowledge、compare_solutions；原页适配；0054 SQL/snapshot/journal；本说明、AGENTS、README、Cursor rule、skill references。

同时修正计算 Tool 的参数契约：缺省 scheme/spec/厚度可从唯一正式选择确定性继承，多个或冲突时澄清；执行前必须齐全并调用原引擎。没有改计算公式。

## 14. Tests

新增测试覆盖：创建/恢复/单 active、用户/客户端权限、多选/恢复/幂等、偏好重查/旧选择保留、硬条件冲突、保留比较但拒绝冲突 Final、少于两项、序号 revision/非法 ID、明确确认/歧义、事务原子性/审计失败回滚、来源变更/撤回、重复确认、确认后新 state、REST 输入事实注入/版本缺失/客户端拒绝。

服务事务测试使用真实 Drizzle WHERE 编译结果的内存 DB 测试替身，不能替代 PostgreSQL 真并发与 SQL 触发器实测。Fastify inject 是路由契约验收，不能替代真实 HTTP/SSE AI UAT。

`pnpm uat:solutions` 新增11轮真实HTTP/SSE闭环（使用既有隔离fixture的25mm冲突档位），同时断言数据库禁止 snapshot UPDATE/DELETE、重复确认不重建、修订不改旧快照。`pnpm uat:solutions --check` 仅检查流程定义。共享 UAT 环境注册方案路由，沿用随机隔离数据库/Redis/队列/对象键/用户及 finally 清理。

`pnpm db:check`、迁移静态链检查、`pnpm lint`、`pnpm build` 通过。`pnpm test --maxWorkers=4` 完整回归168个文件通过、1748项测试通过、1项原有测试跳过；之后补齐备选来源冻结的服务测试8项通过。类型检查包括 `tsconfig.uat.json`；11轮智配定义与45场景/138轮业务定义的离线检查均通过。

## 15. Remaining issues

真实隔离 PostgreSQL、Redis/对象存储/AI HTTP-SSE UAT 因本地 PostgreSQL ECONNREFUSED 127.0.0.1:5432 标记 BLOCKED，未宣称通过。本次`uat:ai`为45场景/138轮，执行0轮，138轮BLOCKED；`uat:solutions`为11轮，执行0轮，BLOCKED。恢复隔离环境后须验证 0054 实际执行、UPDATE/DELETE 触发器、双请求竞争与完整选择流程，再上线。

目录产品通常没有构造/K/双R，所以可选/比较但不能冒充完整工程方案；必须使用正式参考档位或计算结果后再 Final Confirm。未做大规模 C端 UI 改造、报告队列、HTML/PDF/Word。

自然语言动作以高置信原话解析；含糊指代、多厚度同构造、超出当前池的历史序号会澄清。推荐不提供无证据的成本/施工/环保结论。

## 16. Contract for C-end next stage

启动页面先读取 solution DTO，显示 `candidateCards`、selected/final/conflicts/stage，不能从 assistant text 解析状态。卡片使用稳定 candidateId；序号只取 position，旧选择 position=null 可单独显示。

按钮调用 actions 并带 version；列表序号必须带 candidateSetRevision。收到 SOLUTION_VERSION_CONFLICT/REVISION_CONFLICT 后刷新，让用户重选。硬冲突提供“移除”和“保留比较”；确认按钮只能在 READY_TO_CONFIRM 发 CONFIRM，成功后使用返回 snapshot ID。

聊天 `solution_state` SSE 事件和 done.solutionState 提供同一 DTO；会话详情同时返回 active solutionState。消息 metadata 的定位信息仅供回放，正式读写仍走服务。B端运营详情附完整 DTO/debug。

未来报告入口仅传确认 snapshotId，服务读取该值快照转换 DocumentModel；来源图片签名与文档值模型分开处理，不重查候选、不重算、不以 AI 摘要替代 Final。

## Solution Loop Contract 冻结补充（2026-10-12）

本次仅修复以下三项，不重建State/Snapshot/Pool/Selected/Final/Confirm/DocumentModel，不开发PDF/Word或C端。

1. 开放动作不再依靠动词Regex。`solution-action-semantic.service.ts`复用已准入场景模型与SEMANTIC_QUERY预算，执行Fast Path→LLM structured output→Backend Grounding。Fast Path只保留完整按钮式确认/新建/修订，明确热工符号交还原Fast Path。动作包括SELECT/ADD/REMOVE/SET_FINAL/COMPARE_SELECTED/KEEP_CONFLICT/REMOVE_CONFLICT/NONE/CLARIFY；引用包括POSITION/CONSTRUCTION_CODE/THICKNESS/CURRENT_SELECTION/POOL_PREFIX，并有INCLUDE/EXCLUDE、引用范围/时间范围、原话evidence、confidence与unresolved。模型不接收或输出正式ID，schema禁止Confirm；只有“确认生成方案/确认最终方案/确认提交”可进入原确认服务。“行/可以/就这样/没问题”不触发确认。
2. 引用必须来自用户本轮原话，数字须一致、序号须在当前池/revision、编码/厚度须唯一。任一引用非法、schema伪造ID、低置信度或解析故障都澄清，不部分执行。最终只使用原`actOnSolution`/`applySolutionAction`，REST mutation不变。
3. 冲突确认采用最小修复：规范化有效Hard Constraint指纹变化时清空旧keptForComparisonIds，重新生成未确认冲突。指纹只包含实体/厚度/有效指标条件/排除条件/未决硬条件，不包含偏好、意图、置信度或追踪；filters和集合顺序不影响指纹。同条件刷新保持确认，软偏好变化不重置。
4. `solution-candidate-query.service.ts`为Chat、REST、Agent、refine、refresh唯一正式候选查询入口。共享默认policy为neighborTolerance=1、maxCandidates=12、nearbyLimit=12、identityLimit=12；先正式规则与硬条件过滤、再偏好排序/截断、最后共用来源页验证。nearby仅说明，身份指标失败独立，不跨体系放宽；知识回退保留既有“已选发布资料”权限流程，不混入正式命中池。内部override必须说明业务用途。Confirm仍用全量同身份原值校验（非候选池查询，不截断、不允许邻档替代），没有重构确认流程。

本次未新增migration，未修改REST路径/请求schema/响应schema。自然语言“留下明确集合”现在按SELECT替换已选，“加进来”按ADD追加；REST刷新与Chat共享12项正式池上限，这是行为修正。State版本锁、来源/计算provenance、不可变快照与DocumentModel保持原链。

新增自动测试覆盖开放选择/撤掉/厚度/前缀/排除集合、非法ID/引用/原话证据/批量原子Grounding、确认安全、旧厚度keep不能接受新体系冲突、纯偏好/追踪不重置，以及Chat/REST/Agent/refresh的命中/nearby/排序/limit一致性。模型分类结果在自动测试中使用结构化替身；未宣称真实模型语义UAT通过。最终pnpm test/lint/build结果以本轮交付为准。

本次文件清单：

- 新增核心：`src/modules/ai/solution-action-semantic.ts`、`solution-action-semantic.service.ts`、`solution-candidate-query-policy.ts`、`solution-candidate-query.service.ts`。
- 修改接线：`src/modules/ai/solution-selection.ts`、`ai-generation.service.ts`、`reference-query.service.ts`、`solution-state.service.ts`、`solution-workflow.ts`，以及`src/modules/ai/tools/compare-solutions.tool.ts`、`thermal-calculate.tool.ts`、`thermal-lookup.ts`。
- 测试：新增`src/modules/ai/solution-action-semantic.service.test.ts`，补充`solution-workflow.test.ts`、`solution-state.service.test.ts`。
- 规则/说明：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、本文。

本次最终验证：`pnpm test --maxWorkers=4`为169个文件通过、1773项测试通过、1项原有跳过；`pnpm lint`、`pnpm build`、`tsconfig.uat.json`类型检查、`pnpm db:check`与diff空白检查通过。本轮未增加或改写迁移文件。

## Candidate Result 与 Solution Workflow 生命周期补充（2026-10-12）

本节覆盖前文查询自动创建状态的旧行为。`recordSolutionCandidates` 的隐式创建职责已移除；`refreshActiveSolutionCandidates` 只刷新同项目、active、editable、未确认的现有状态，无可编辑状态返回 null。查表（非 Agent/thermal Tool）、知识确认页回退（普通生成/search_knowledge Tool）与正式计算共用 `publishCandidateResult`。无 active 或旧方案已 Confirmed 时，仅发布结果，不创建新 state，也不发 `solution_state` 或在 done 中附旧确认状态。

Candidate Result 事件为 `reference_candidates`：`{ queryRevision, candidates: [{ candidateId, position, sourceType, constructionCode?, systemName?, productName?, thicknessMm?, productThermalResistance?, totalThermalResistance?, kValue?, sourcePageId?, sourcePageLabel?, optionId?, calculationId? }] }`。该 contract 不包含 Selected、Conflict、Final 或方案 stage，不能作为已进入 Workspace 的信号。`reference_pages` 继续采用既有完整页合同；done 可附同一 `referenceCandidates`，消息 metadata 只保存 query revision 定位。

复用 `ai_conversation_states.taskStateJson.lastReferenceLookup`，保存 query/candidates/createdAt 与 `candidateQueryRevision`、projectId；计算候选也在此保存同一计算记录的 input/result/provenance，知识候选保留 KNOWLEDGE_PAGE 身份。不建重复候选缓存。候选发布与方案刷新在会话行锁内提交，query revision 单调增加；其他任务状态保存使用同一锁，不能覆盖更高 revision。历史候选解析损坏时拒绝激活，避免过滤坏记录后改变序号。

自然语言仍走 Solution Action Semantic Parser → Backend Grounding；没有可编辑方案时使用最近 lookup 构建只用于 Grounding 的视图，不持久化 SolutionState。CURRENT_SELECTION 仍只定位真实已选，CURRENT_POOL 可定位用户原话“这些/这几个”。首次 SELECT/ADD/SET_FINAL 通过 `activateSolutionFromLastLookup` 事务重验本人会话、客户端、项目、完整候选来源、24h 有效期及 query revision，再创建/seed/执行原 applySolutionAction/写审计。过期、版本失配、来源变更或权限失败都拒绝；查不到候选时提示先查询或选择。

按钮使用新增 `POST /api/v1/ai/conversations/:conversationId/solution/activate`，body 为 `{ candidateQueryRevision, action: ADD|SELECT|SET_FINAL, candidateIds?: string[], positions?: number[] }`，正式ID与序号二选一，不接受事实值。返回 `{ solutionState }`，与聊天 SSE 结构一致。现有 actions/版本锁保留。已有 start 接口可选传 candidateQueryRevision，一次开始并 seed；不传时保留开始空工作流的行为。聊天 send-message/knowledge-qa 新增可选 candidateQueryRevision：从旧卡片发起自然语言动作时须回传其 revision；不带时按最近结果解释，无法推断客户端未发送的旧 UI 状态。

已有可编辑方案的查询继续刷新并推进 candidateSetRevision，保留 Selected/Rejected，重算 Conflict、清除旧 Final，所有既有 Keep/Compare/Final/Explicit Confirm/不可变 Snapshot 合同不变。计算只追加当前池；没有可编辑方案时计算只返回 calculated Candidate Result，明确加入才激活。计算结果的序号按本次可见结果解释，与整个方案池的序号分开。Confirmed 后普通查询继续只返回 Candidate Result；显式 START_NEW/REVISE/加入才创建新 editable 状态。

本轮无数据库 schema/migration、计算公式、Semantic Query、QueryState、Matcher、Snapshot/DocumentModel/报告或前端改动。REST 为新增路径/可选字段；SSE 的自动进入方案行为有意改变，依赖旧自动 solution_state 的调用方需接入 reference_candidates 和显式激活。

自动测试覆盖用户要求的九类生命周期及来源/项目/权限/审计回滚、坏缓存序号、并发任务保存、当前可见计算序号；服务事务使用内存 Drizzle 替身，动作模型用结构化替身，不能等同真实 PostgreSQL/模型 HTTP-SSE UAT。`uat:solutions` 更新为13轮，首轮及 Confirmed 后普通查询断言无状态创建/事件，首次选择懒激活，再验收原 Loop。

本轮修改文件：

- 新增：`src/modules/ai/candidate-result.service.ts`。
- 入口：`src/modules/ai/reference-query.service.ts`、`ai-generation.service.ts`、`ai.routes.ts`、`tools/thermal-calculate.tool.ts`、`tools/search-knowledge.tool.ts`、`tools/compare-solutions.tool.ts`。
- 生命周期与Grounding：`src/modules/ai/solution-state.service.ts`、`solution.routes.ts`、`conversation-task.ts`、`ai-conversation-state.service.ts`、`solution-action-semantic.ts`、`solution-action-semantic.service.ts`。
- 测试：`src/modules/ai/solution-state.service.test.ts`、`solution.routes.test.ts`、`solution-action-semantic.service.test.ts`；真实验收脚本：`scripts/run-solution-uat.ts`。
- 规则与说明：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、本文。

本轮最终实跑：`pnpm test --maxWorkers=4` 为170个文件通过、1个文件跳过，1809项测试通过、1项跳过；`pnpm lint`、`pnpm build`、`pnpm exec tsc -p tsconfig.uat.json --noEmit`、`pnpm db:check`、`git diff --check` 通过。`pnpm uat:solutions` 在只读加载模型/提示词配置时因数据库 ECONNREFUSED 而 BLOCKED，实际0/13轮；报告 `logs/solution-uat/2026-10-12T11-28-46-945Z/report.json`。没有宣称真实模型或 PostgreSQL/HTTP-SSE 生命周期验收通过。

## 普通问答动作误拦截回归修复（2026-10-12）

真实失败case：会话 `edebf5ce-6a99-45cb-ba60-88e6dc0c7526` 首轮“保温0.3有材料么”无任何候选，却输出“暂时无法可靠理解方案动作”。只读线上核对确认未进入正式问答；原动作提示词不含 JSON，配置模型使用 json_object 时直接 HTTP 400。仅补 JSON 仍不够：网关不支持传入 responseFormat.schema，模型会猜错 type/evidence/unresolved 字段。修复为无候选普通提问直接交还原 Runtime；有效 lookup 视图仍保留动作解析与懒激活。动作提示词明确 JSON，并从 `parsedSolutionActionSchema` 派生完整 JSON Schema 注入，保持正式输出校验、原话Grounding与mutation不变。失败日志附安全的errorType/statusCode，禁止记录原话/模型正文。

真实已配置模型的独立分类调用验证：“保温0.3有材料么”输出 NONE；“第一个和第三个留下”输出 SELECT，经Grounding为 A/C。只读模型配置、使用内存候选，不写生产会话、方案或发布数据。这是模型分类兼容性验证，不等同完整HTTP/SSE UAT。补充自动测试覆盖无候选普通查询/寒暄/产品问答不调用动作模型、JSON与完整字段合同、lookup首次选择及安全错误日志。无迁移、前端或Semantic Query/Matcher改动。

回归修复实跑结果：`pnpm test --maxWorkers=4` 为1815项通过、1项跳过；`pnpm lint`、`pnpm db:check`、diff检查通过。`pnpm deploy` 构建/数据库备份/迁移检查/PM2重载成功；公网live/ready通过（Redis、数据库、存储均正常），线上动作解析产物SHA-256与本地构建一致。
