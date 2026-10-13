# 高频意图与 P0 修复交付报告

日期：2026-10-13。范围：backend，按实施 Prompt 完成阶段一至三；阶段四只审计并列出后续范围。此前静态审计见 `backend-p0-routing-audit-2026-10-12.md`。本次没有修改数据库 schema/migration、Matcher、计算公式、Snapshot/DocumentModel、Knowledge Recognition、PDF/Word、前端或部署配置。

## P0 根因影响与最小改动

| 根因 | 影响 | 本次改动 |
| --- | --- | --- |
| 领域路由之前对所有有候选消息调用动作模型 | 动作模型故障拦截问候、解释和原页读取 | 本轮 DomainTurnDecision 先分类目标，再决定是否调用动作 Parser；开放表达受控 JSON 分类、原话 evidence 与字段校验 |
| Agent 以有 Candidate 为强制 thermal 的条件 | 原页/完整表误查表 | Agent 首步消费同一决策；generation 的原页/详情在 Agent Loop 前完成 |
| VIEW/DETAIL 共用查询与发布路径 | 修改 QueryState、revision、可见顺序及 editable pool | 统一只读 Resolver；工具误调用同样进入只读分支 |
| 临时比较写 lookup.Selected；计算默认继承它或唯一候选 | 普通比较被当作正式选择和计算授权 | 比较范围只存本轮局部变量；计算先要求本轮明确执行授权，再核验对象；旧临时 Selected 不作为依据 |
| 工程事实缺少基层，片段可切开拼接 | K/R 正确但对应基层/厚度/型号错误 | 同一 Candidate 绑定基层材料、基层厚度、板厚、型号、编码、双 R/K；跨行无编码事实维持同一事实束 |
| 从体系名称/systemType 推导族身份 | 复杂名称漏约束或不可靠扩范围 | 生产目录不推导 family/category；无可靠族映射/部分映射则澄清，完整正式名/编码及已配置别名仍可核验 |
| 合规咨询和执行计算共享语义 | 问能否用可能启动新计算 | Domain、能力路由、Answer Contract 分开合规与执行授权；标准不明确时澄清 |

## 阶段一：单轮意图决策

新增 `src/modules/ai/ai-domain-turn-decision.ts` 与 `.service.ts`。高置信完整表达复用既有确定性指标/厚度解析及明确方案 Fast Path；开放目标调用已准入 `semantic_query` 模型，输出严格 Zod schema，提示词同时提供完整 JSON 字段合同。分类只输出目标与证据，不产生正式 ID。

`ai-generation.service.ts` 在动作解析前生成一次决策，供 `ai-agent.service.ts`、工具上下文、能力路由和最终回答合同消费。普通解释及问候不调用 Solution Action LLM；动作模型故障只影响真实方案动作。显式 Confirm 仍走既有 Fast Path，Final 不替代 Confirm。

已运行分类表、开放分类正常/故障/低置信/伪造 evidence/伪造 ID 合同，以及真实 prepareStep 服务路径。它们使用模型/SDK 传输替身，不是远程模型或完整 HTTP/SSE 验收。

## 阶段二：只读引用、比较与计算授权

新增 `reference-candidate-resolver.service.ts` 与 `reference-candidate-source.service.ts`，升级 `reference-candidate-selection.ts`：

- POSITION 绑定服务器保存的最近实际显示顺序；显式旧 revision、过期/损坏候选、跨项目、旧列表与越界序号拒绝引用。
- 编码、厚度、显示 K 对应多条当前记录时澄清，不挑第一条；“比较已选”只读真实 SolutionState.Selected。
- 复用 `assertSolutionAccess` 重验本人、真实客户端来源、会话有效状态/软删除及项目权限；输入 taskState 是服务器读取的当前会话状态，不接受客户端自由提交。
- 正式行按引用 ID 参数化读取，核验参考集、体系、方案、规格的发布/有效性/软删除关系及原值；计算候选重验记录归属、项目和冻结输入/结果。
- 来源复用当前可消费发布页、完整 renderModel 与签名流程；严格验证原 sourceVersionId、optionId、同构造四项值及基层。撤回/换版/确认快照变化时拒绝旧引用，不按数值重新绑定。
- VIEW/DETAIL/普通比较不调用 `querySolutionCandidates`，不写 QueryState/lookup/Selected/SolutionState，不发 `reference_candidates`。允许 `reference_pages`、`sources`、正文及正常消息元数据保存。
- 只读请求优先于已有 Agent 等待/报告续跑；避免打开原页时恢复其他任务。
- 存在硬冲突的真实已选候选仍可比较参数，事实集标为未满足当前条件，禁止冒充正式命中。

`reference-query.service.ts`、`thermal-calculate.tool.ts`、`compare-solutions.tool.ts` 共用该边界。计算只有在本轮用户明确要求执行且对象经核验后才消费候选；候选唯一可以定位对象，但不能替代用户执行授权。“这个 K 怎么算”不创建计算记录。条件变化仍走原语义查询和 Query Service，不改变 Matcher 或公式。

## 阶段三：工程事实与正式数据绑定

升级 `thermal-answer-validation.ts`、`thermal-answer-semantics.ts`、`thermal-answer-facts.ts`、`reference-page.ts` 与会话候选事实清单：

- 模型清单与确定性文本携带基层材料/基层厚度，卡片 summary 增加可选同名字段；缺失字段禁止补写。
- 仅归一明确同义表示，例如钢筋砼、蒸压加气混凝土砌块；不同基层类型不能互换。基层厚度和保温板厚度分别验证，不能交换。
- 型号、构造编码、正式 ID、来源和热工数值保留在同一结构化 Candidate。无构造编码、多行自由文本不能切段解除事实约束；无法验证时沿用 Canonical Answer。
- “最薄/最省/必然达标”等未经授权的结论拒绝。正式命中、nearby、身份相同但指标失败继续分开。
- 高亮继续使用 optionId + fieldKeys，不扫描回答数字；完整页不裁剪。
- `thermal-query-dictionary.service.ts`、`thermal-entity-resolver.ts` 与 semantic Grounding 不从名称或自由 systemType 推导正式族关系；`normalizeSystemFamily` 仅保留旧显示/事实别名诊断用途。

真实资料关联 fixture 已拒绝“加气混凝土200mm + 板45mm + K=0.294/R₀=3.398”，也覆盖无编码换行、基层在编码之前、错误型号、板厚与基层厚度交换以及缺失基层被补写。fixture 数值只存在于测试。

## 变更文件及原因

| 文件组 | 用途 |
| --- | --- |
| `ai-domain-turn-decision.ts/.service.ts`、`ai-generation.service.ts`、`ai-agent.service.ts`、`ai-capability-router.ts`、`tools/tool-runtime.ts`、`shared/ai-answer-contract.ts` | 单轮目标、执行授权、回答形态分层；Agent/非 Agent 共享 |
| `reference-candidate-selection.ts`、`reference-candidate-resolver.service.ts`、`reference-candidate-source.service.ts`、`reference-query.service.ts` | 最近可见范围解析、当前权限/发布/来源验证与只读结果 |
| `solution-action-semantic.service.ts`、`tools/thermal-calculate.tool.ts`、`tools/compare-solutions.tool.ts` | 动作 Parser 隔离、工具侧写入门禁与比较/计算授权 |
| `thermal-substrate-facts.ts`、`thermal-answer-validation.ts`、`thermal-answer-semantics.ts`、`thermal-answer-facts.ts`、`reference-page.ts`、`conversation-task.ts` | 基层/型号/厚度和数值的原子事实及可选卡片字段 |
| `thermal-query-dictionary.service.ts`、`thermal-entity-resolver.ts`、`semantic-query.ts`、`thermal-query-state.ts`、`thermal-query-debug.ts` | 不可靠族映射 fail-closed；明确条件不能被模型省略；日志去除原话、语义原始输出与数字证据文本 |
| 5 个新增测试文件、`reference-read.fixture.ts` | 目标分类、语义模型合同、只读 Resolver、正式行读取、真实基层关联；fixture 只被测试调用 |
| 3 个 P0 audit 测试与关联回归测试 | 原 16 个 expected-fail 全部改为普通 `it`；保留案例并升级旧授权/族推导假设，未删除或跳过失败合同 |
| `AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、技能 `references/ai-and-reports.md` | 同步本轮长期边界与报告入口 |

表中除 `shared/`、thermal 文件与文档外均位于 `src/modules/ai/`。涉及的测试也覆盖原有容差、AND 增改删、发布后新数据、懒激活、Final/Confirm 和不可变快照合同。

## 协议与诊断影响

没有新增 REST 路由、请求必填字段、迁移或客户端任务。已有可选 candidateQueryRevision 透传到只读范围验证；SSE 事件名继续使用现有协议。原页/详情不再推进 revision 或发 Candidate Result；候选页 summary 增加可选 substrateMaterial/substrateThickness。后台 backendDecision 增加领域意图、mutation、引用 scope/revision、是否改变查询、候选/页 ID 与事实校验状态，不记录原话 evidence 或密钥。合规咨询的 Answer Contract 改为 KNOWLEDGE；正式执行仍为 THERMAL。

## 实际执行

| 检查 | 结果 | 证据范围 |
| --- | --- | --- |
| 原 3 个 P0 audit 文件，全部普通断言 | PASS：27/27 | Parser 故障、Agent prepareStep、非 Agent 服务与工具副作用；不是 UAT |
| 新增/相关集中回归 | PASS | 模型正常/故障、只读状态、授权、来源失效及基层事实 |
| `pnpm test --maxWorkers=4` | PASS：178 文件通过、1 跳过；1916 条通过、1 跳过，150.27 秒 | 全量本地测试；使用隔离替身的测试不升级为真实业务验收 |
| `pnpm lint` | PASS | TypeScript 业务源码检查 |
| 新增测试 + P0 测试临时独立 tsc | PASS | 原项目配置排除 test，另行核验新增测试类型；临时配置已删除 |
| `pnpm build` | PASS | 本地清理受控 dist 并构建；没有部署 |
| `pnpm db:check` | PASS：Everything’s fine | migration 元数据静态检查，不证明实际迁移执行 |
| 已配置 PostgreSQL 只读 `SELECT 1` | BLOCKED：Error / ECONNREFUSED | 没有写数据库，未输出连接信息或密钥 |
| 隔离真实 HTTP/SSE UAT | BLOCKED | PostgreSQL 不可连接，未执行真实业务轮次 |
| 真实远程模型、对象存储重签/真实撤回四组合 | NOT RUN | 不以 SDK/数据库/模型替身宣称通过 |

## 阶段四审计与未处理范围

1. 产品发现：`get-product-data.tool.ts` 仍要求 productIds，仅能读取 ACTIVE catalog 产品；没有可按名称/型号发现正式产品的独立 Tool。本轮未添加 SEARCH 操作，也不让模型猜 ID。后续单独实现发布规格/ACTIVE 目录的受控发现能力。
2. 知识解释：节点、施工做法和“热工计算表”与执行计算已分层；独立主题使用原知识工具。缺已证实来源时不能虚构页码；真实知识服务与生产资料效果尚待 UAT。
3. 规范咨询：已隔离新计算授权，标准不明确时澄清。现有 `resolveScopedThermalStandard` 已能验证地区、建筑类型、结构类型和正式标准；本轮没有扩展为完整的自然语言标准发现/多标准交互式合规服务。
4. 方案/报告：普通查表不自动创建 SolutionState、明确动作懒激活、Final 后显式 Confirm 和既有报告 Snapshot 门禁由原服务保留；未扩展报告生成流程。
5. 正式族映射：没有 familyCode，也没有业务确认的回填清单。只完成 fail-closed 保护；名称简称可能因此要求完整正式名/编码。新增可空字段、增量迁移和人工审计回填应另立任务，经确认后在隔离库验证，不能用 LIKE 批量猜归属。

后续已收到《高频用户问法与多轮场景回归矩阵》，原文保存至 `high-frequency-scenario-matrix-2026-10-13.md`；补测、修复、覆盖范围与未关闭的 S4 口径差异见 [矩阵覆盖报告](high-frequency-matrix-coverage-2026-10-13.md)。完整 generation 的 HTTP/SSE 与四组合仍需隔离依赖恢复后实跑。

下一步优先恢复隔离 PostgreSQL/Redis/对象存储与已准入模型，运行真实多轮 HTTP/SSE 验收，再按业务确认的族映射计划处理产品发现与完整规范咨询。本报告不宣称生产修复已部署或真实 UAT 通过。
