# 步骤 1｜跨轮业务状态与数据合同根因审计（只读）

- 日期：2026-10-19
- 依据：步骤 0 资料基准；真实账号 `15255334975`（用户 `7353aee7…`）登录 H5 后端；6 个复现会话；只读库；未改代码
- 结论：**不是单一 Prompt 问题，而是 5 条合同断裂**：澄清回执、参数作用域、方案候选、产品范围、模板/端状态。固定 35 问在“合成隔离库”通过，无法覆盖真实 79 页/890 档/2 条正式行的数据形态。

## 1. 复现与证据边界

| 编号 | 会话 ID | 原话 | 结果 |
| --- | --- | --- | --- |
| F4 | `cfb61380-e8f1-4544-a04c-d462342628eb` | “薄膜灰 小于 0.35有哪些方案” → “导热系数” | 稳定复现 **962 条**，列 24 条 |
| F1 | `ec6a9064-b6aa-464c-aebb-e4d6305d19ab` | “有什么保温 0.2的材料” → “热阻” | 复现二次泛化澄清，0.2 丢失 |
| F2a | `9ded7a66-b68c-47c2-bb79-467e15a7255d` | “VICP复合保温板有哪些产品” | 只给目录 1 款 + “完整系列待补充” |
| F2b | `97390b13-dab6-4073-ba7e-9b7bfce3d415` | “目前有哪些 VICP 产品” | 同义输入却答“名称没对上”，0 产品卡 |
| F3 | `e18b5f75-918c-474d-ba55-79fe3e353633` | “帮我介绍下 vlcp 产品” → “是的” | 连续两轮同一句“你是不是想了解 VICP…” |
| F6 | `8f48e263-c968-429d-86e5-1c23727cceb2`（既有） | “保温薄抹灰传热系数0.3方案有么？” → “基于 A3-1 生成方案” | 22 档只读表，无候选；生成方案/报告死循环 |
| S4 | `63e5abbe-9d7f-49bc-8a59-f828a9547871` | “薄抹灰K小于0.5的有吗” → “那20mm以内呢” | **旧“泛化拒绝”未复现**；返回 234→72 档只读，无候选 |

- 真实登录成功；HTTP/SSE 实际调用 DeepSeek Chat；会话写入测试账号，未做确认/报告等授权动作。
- 库仍只读事务；关键计数：`catalog_products=1`、`product_specs=1`、`thermal_reference_rows=2`、`product_knowledge_links=0`、`standard_documents=0`。
- **C 端浏览器 NOT_RUN**：本地 H5 已启动（`dist/build/h5`，200），但 `agent-browser` daemon 启动超时、未取得页面快照；因此 UI 结论分“代码已证实”与“未运行”两类，不把 Backend SSE 当页面验收。
- 脱敏 SSE 摘要：`docs/ai/evidence/phase1-2026-10-19/sse-summary.json`。

## 2. 字段流转对照

### F4｜“薄膜灰 <0.35 方案” → “导热系数” 返回 962

| 轮次 | 原话 | Semantic 关键字段 | State / 合同 | Tool → Service | SSE / C 端 |
| --- | --- | --- | --- | --- | --- |
| 1 | 薄膜灰 小于 0.35有哪些方案 | goal=CLARIFY；intent=REFERENCE_QUERY；requestedEffect=**QUERY**；relation=NEW；pageQuery.intent=REFERENCE_LOOKUP；constraints=[ENTITY systemHint=薄膜灰, METRIC unresolved 0.35]；unresolved.metric=“0.35未说明是K/产品R/整构造R”；candidateSet=0 | 待澄清问题=“λ/K/R？”；**该澄清被记为 requestedEffect=QUERY** | backend:clarify | 模板“这个数值指…” |
| 2 | 导热系数 | goal=**PRODUCT_PARAMETER_QUERY**；requestedEffect=READ_ONLY；relation=**NEW**；parameterQuery={parameter:LAMBDA, subjectType:**ANY**, subjectText:null, systemText:null, operator:**READ**, targetValue:**null**, unit:W/(m·K), evidence:导热系数}；pending=**null** | 0.35 / “<” / “方案” / “薄膜灰”全部丢失；查询比原问**更宽** | get_product_data(PARAMETER_QUERY) → `readProductParameters`：catalog 1 + spec 2 + materials 7 + **全部已确认构造层**；matched/scanned/identity=**962**；checkedSourceKinds 含 `CONFIRMED_LAYER` | sources + 单帧 delta；无 reference_pages / reference_candidates / product_cards；C 端只见文本清单 |

**代码证据**
- `query-clarification-context.ts:24-41`：`recentQueryClarification()` 要求上一轮 assistant 的 `backendDecision.requestedEffect === "READ_ONLY"`；F4 的 CLARIFY 是 `QUERY`，直接返回 `null`，所以下一轮 `relation=NEW`。
- `product-parameter-query.ts:34-37`：`operator=READ` 时允许 `targetValue=null` 且不检查原问数值，于是“只补充指标名”成为“读全部 λ”。
- `product-parameter-read.service.ts:186-198`：不论 `subjectType`，先把所有发布页的构造层加入 `rows`；`evaluateLambdaFacts` 在 `ANY/READ` 下 `scoped=all`。
- `product-parameter-read.service.ts:86-106`：固定模板输出“共匹配 N 条，当前列出24条”。

### F1 / F5｜“0.2/0.3 + 热阻”被二次泛化澄清

| 轮次 | 原话 | Semantic | 决策 | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 有什么保温 0.2的材料 | CLARIFY；READ_ONLY；NEW；无 pageQuery | `SEMANTIC_AMBIGUOUS` | “λ/K/R？” |
| 2 | 热阻 | queryContext=CLARIFICATION_REPLY；relation=CONTINUE；无 parameterQuery/pageQuery | **`QUERY_CONTEXT_INVALID`** | “这轮希望查看的产品、参数或资料…”；0.2 丢失 |
| 3 | 帮我生成方案 | SOLUTION_ADVICE；READ_ONLY；CONTINUE；reference.scope=NONE | 候选=0 | 通用“先从基层材料和厚度开始…” |

- `ai-domain-policy.ts:66-68`：澄清回执只允许 `parameterRead` 或 `REFERENCE_QUERY + pageQuery`；用户只补充“热阻”时既不是参数读取，也没有 pageQuery → 被拒，回退为新的泛化澄清。
- `domain-clarification.ts:20-21`：`REFERENCE_QUERY` 的澄清句是通用“还有一项尚未明确”，不说明缺的是“产品 R / 构造 R / 芯层 R”，用户无法一次答对。
- 既有会话 `0feaa194` 第三轮“保温热阻0.3的材料”仍走同一分支，说明**已明确的 R=0.3 没有被合并进 state**，只是被当成原话背景。

### F2｜“VICP 产品”只查目录，不查知识库

| 轮次 | 原话 | Semantic | Tool → Service | 结果 |
| --- | --- | --- | --- | --- |
| 1 | VICP复合保温板有哪些产品 | PRODUCT_DISCOVERY；READ_ONLY；NEW；productQuery 未落库；granularity=SERIES（由回答“完整系列待补充”反推） | `product_search` → `searchProductCatalog`：只 `SELECT catalog_products`（1 行）+ 已发布规格（1 行）+ `product_knowledge_links`（0 行） | product_cards=1；模板“目前产品介绍资料还不完整…完整系列待补充” |
| 2 | 目前有哪些 VICP 产品 | 同为 PRODUCT_DISCOVERY | 实体绑定 `named=0`；按 `resolveProductConsultation` 的 IDENTITY 精确匹配分支，`VICP产品` 与别名 `VICP` 不等（semantic 未落库，属代码推断） | “VICP 这个名称我还没对上”，product_cards=0 |

- `product-read.service.ts:19-56`：产品检索的唯一数据源是 `catalogProducts`；`knowledgeDocuments` 只经 `productKnowledgeLinks` 关联，而该表为 0 行。
- `product-read.service.ts:57-91`：`index` 仍是目录 1 行；`seriesCoverageVerified:false`；`needsClarification` 只给目录名称建议。
- `product-answer-plan.ts:19-30`：summary 为空时固定写“资料还不完整”；`seriesRequested` 时固定追加“完整系列的型号清单还需要补充”。**没有引用 79 页/156 个构造系统/890 档中的任何事实。**
- 同一账号、同一意图，仅“VICP”与“VICP复合保温板”两种表述就产生“1 款产品”与“没对上”两种结果，说明实体绑定不稳定。

### F3｜VLCP 建议不是“可确认的待澄清身份”

| 轮次 | 原话 | Semantic | State | 结果 |
| --- | --- | --- | --- | --- |
| 1 | 帮我介绍下 vlcp 产品 | PRODUCT_DISCOVERY；READ_ONLY；NEW | 无正式 pending；只生成 suggestion | “你是不是想了解 VICP…” |
| 2 | 是的 | PRODUCT_DISCOVERY；READ_ONLY；CONTINUE | 仍以原 `vlcp` 身份检索，`named=0` | 同一句建议重复 |

- `product-read.service.ts:57-91` 的 suggestion 只是回答文本，没有写入 `pendingClarification`/identity 候选；下一轮“是的”没有可绑定的对象。
- `query-clarification-context.ts` 只把 `domainIntent=CLARIFY` 或参数缺容差当作 pending；`PRODUCT_DISCOVERY.needsClarification` 不会进入该合同。

### F6 / S4｜“方案”被当成只读查表，候选永不发布

| 轮次 | 原话 | Semantic | Service | SSE / 结果 |
| --- | --- | --- | --- | --- |
| 1 | 保温薄抹灰传热系数0.3方案有么？ | REFERENCE_QUERY；QUERY；NEW；**pageQuery**（K≈0.3，systemHint=保温薄抹灰） | `resolveReferenceQueryWithoutAgent` 在 `semantic.pageQuery` 存在时**提前 return**，不调用 `publishCandidateResult` | reference_pages；22 档/17 构造只读表；**无 reference_candidates / solution_state** |
| 2 | 介绍下 A3-1 | REFERENCE_VIEW；READ_ONLY；CONTINUE | 无 A3-1 正式候选 ID | 只读单行 |
| 3 | 基于 A3-1 生成方案 | SOLUTION_ADVICE；READ_ONLY；CONTINUE；reference.scope=**NONE** | `resolveSolutionAdvice` 无 candidates → 模板“当前没有可核验的候选” | 无 solution_state |
| 4 | 基于 A3-1 生成报告 | REPORT_REQUEST；REPORT_GENERATION | 无 Final/Snapshot | “请先明确最终方案并确认” |
| S4-1 | 薄抹灰K小于0.5的有吗 | REFERENCE_QUERY；pageQuery K<0.5 | 只读页事实 234 档/40 构造 | reference_pages；无候选 |
| S4-2 | 那20mm以内呢 | REFERENCE_REFINE；`queryChangedFields=[thicknessMax]` | 72 档/21 构造；**条件继承正确** | reference_pages；无候选 |

- `reference-query.service.ts:45`：`if (decision.semantic?.pageQuery) return { ...readOnly }`——把“带条件的查表”与“读某一页”合并成同一早退分支。
- `solution-candidate-query.service.ts:104-106`：`solutionCandidates` 只从 `matchedCandidates`（正式 `thermal_reference_rows`）生成；只读页事实 `readOnlyMatched` 不进入。
- 真实库 `thermal_reference_rows=2`（25mm 整体 / 35mm 分层），而知识页 890 档；因此“看得见 22/234 档、选不了、生成不了”是数据与合同的共同结果。
- **旧“薄抹灰K<0.5 被泛化拒绝”未复现**：当前版本能查 234 档；新问题是只读、无候选、厚度标签口径。

## 3. 产品知识库来源是否被遗漏

| 证据 | 事实 |
| --- | --- |
| `product-read.service.ts:19-56` | 产品 SEARCH/READ 只查 `catalog_products`、`product_specs`、`product_knowledge_links`；不查 `knowledge_pages`/`knowledge_chunks`/`structuredData` |
| `product_knowledge_links=0`、`product_attachments=0`、`knowledge_facts=0` | 目录产品与 79 页知识库没有任何关联 |
| `resolveProductConsultation` | `index` 仅有 1 个目录产品；`seriesCoverageVerified:false` |
| 知识库事实 | 79 页、156 个构造系统、890 个厚度档、71 个层名称；产品层含 I/II/III 型板、复合外模板、装饰板、屋面系统、金属夹芯板等 |
| `knowledge_aliases` | 4 条别名均以“真空绝热复合保温板”为 term，和目录名“VICP复合保温板”不一致；仅 `approvedCatalogAliases` 手工补了 `VICP`，仍受 entityText 精确匹配限制 |

**结论**：不是“知识库里没有产品”，而是**产品问答的查询合同把“独立产品目录”当唯一来源**，且没有“构造系统/产品层/材料层”的检索投影。回答层再用固定模板承认“资料不完整”，把数据缺口说成产品缺口。

## 4. 共性根因（≤5，代码已证实）

| # | 根因 | 证据 | 影响场景 |
| --- | --- | --- | --- |
| R1 | **澄清回执合同过窄且不持久**：pending 仅从“上一条 assistant + 上一条 user”推导，要求 `requestedEffect=READ_ONLY`；policy 又只允许 parameterRead/pageQuery 回执 | `query-clarification-context.ts:24-41`；`ai-domain-policy.ts:66-68`；`ai-domain-turn-decision.service.ts:145,189,201-221` | F4 962、F1/F5 重复追问、F3 身份循环 |
| R2 | **指标补充被当成全库 READ**：`operator=READ` 允许 `targetValue=null`，`subjectType=ANY` 把 962 个产品/规格/材料/构造层当作同一查询域 | `product-parameter-query.ts:34-37`；`product-parameter-read.service.ts:38-83,186-203` | F4 962、对象口径混淆 |
| R3 | **“方案”没有独立查询合同**：带条件的“方案”被路由为 REFERENCE_QUERY；`pageQuery` 早退，候选不发布；正式候选只有 2 行，890 档只读事实不可选 | `reference-query.service.ts:45`；`solution-candidate-query.service.ts:104-106`；`thermal_reference_rows=2` | F6 全链路、S4 只读 |
| R4 | **产品问答只查目录**：`catalog_products` 是唯一来源，`product_knowledge_links=0`；entityText 精确匹配使“VICP/VICP产品/vlcp”表现不稳定 | `product-read.service.ts:19-91`；`product-answer-plan.ts:19-30`；`product-identity-approvals.ts` | F2、F3 |
| R5 | **模板优先 + 候选无“失效事件”**：参数/建议/只读表格直接写固定 `answer`；只读页/参数查询不发布空 `reference_candidates`，Backend `lastReferenceLookup` 也不清除，App 页面级候选面板只有收到新事件才覆盖 | `ai-generation.service.ts:743-756`；`candidate-result.service.ts:46-68`；`reference-query.service.ts:45`；`app/src/store/assistant.ts:1161` 与 `assistant/index.vue:655` | 所有“固定模板回复”；有候选后转只读查询时可能残留旧候选（代码推断，未在浏览器验证） |

**测试层共性**：`scripts/run-ai-uat.ts:52` 明确“随机隔离数据库 + 固定正式 fixture”；`tests/uat/fixtures/facts.ts` 只有 **4 条参考事实 / 3 个目录产品**，而真实库是 **2 条正式行 / 1 个目录产品 / 79 页 890 档**。因此 35/35 PASS 证明的是“合成世界正确”，不能证明真实资料形态可用。

## 5. 最小改动文件清单（步骤 2 用，本轮未改）

| 文件 | 最小改动 | 不变量 |
| --- | --- | --- |
| `src/modules/ai/query-clarification-context.ts` | 允许 CLARIFY 的 `requestedEffect=QUERY` 进入 pending；把 pending 写入 task state（含原话、已填槽、未解决槽），不只靠最后两条消息；处理同时间戳排序 | 同一 pending 只能被同一用户/端/项目/24h 使用 |
| `src/modules/ai/ai-domain-policy.ts` | 允许 CLARIFICATION_REPLY 产出“仍待澄清但已收窄”的状态；不得因只补充指标就重置任务 | 不得放宽证据/置信度；数值必须来自原问或本轮 |
| `src/modules/ai/ai-domain-turn-decision.service.ts` | 把 pending 的 value/operator/filters 合并进本轮 semantic；`groundClarificationMetricEvidence` 同时 ground subject | 本轮明确改值才替换旧值 |
| `src/modules/ai/product-parameter-query.ts` + `product-parameter-read.service.ts` | `subjectType=ANY` 仅允许显式“列出所有 λ”；澄清回执必须继承 subject 或默认 PRODUCT_EQUIVALENT；`MATERIAL_LAYER` 才查构造层；`READ` 不得作为“全库扫描” | 结果每条必须满足指标、对象、来源、权限 |
| `src/modules/ai/product-read.service.ts` | 产品 DISCOVERY 增加知识页/结构化数据检索：区分产品/系列/构造系统/材料层；目录只作 SKU 来源，不作产品全集 | 目录 1 条不能推出“只有 1 款” |
| `src/modules/ai/reference-query.service.ts` | 区分“显式读页”与“带条件方案查询”；后者不得因 `semantic.pageQuery` 早退；有正式行时发布 `reference_candidates`，无正式行时发空集+revision | 只读页事实不得被标成可 Confirm 候选 |
| `src/modules/ai/solution-candidate-query.service.ts` | 明确 `readOnlyMatched` 的可寻址投影（只读 ID），或在 UI 明确“不可选”；不得让用户对不可寻址行说“基于它生成” | 选择≠Final≠Confirm≠PDF |
| `src/modules/ai/ai-generation.service.ts` + `knowledge-test-reference.ts` | 参数/建议路径允许模型在事实集内组织，或至少让模板带真实槽位与“分层/芯材厚度”口径；把 page audit issues 注入行级提示 | 模板不得覆盖已核验事实；不得把芯层 4.8 说成整体 5.0 |
| `src/modules/ai/candidate-result.service.ts` + `app/src/store/assistant.ts` | 只读页/参数查询发布“空候选 + 新 revision”或在 answer 中标记候选失效；App 按 queryRevision/messageId 绑定候选，收到空集时清空 | 新查询不得继续显示上一轮候选 |
| `tests/uat/*` | 增加“真实 79 页 + 2 条正式行 + 1 目录产品”形态的回归；增加 requestedEffect=QUERY 澄清、VICP/VICP产品、962 ANY、pageQuery 候选、端清空候选 | 不修改原 35 问预期；新增独立用例 |

## 6. UI 测试建议（步骤 2/3）

1. H5 输入 F4 两轮：断言第二轮不出现 962 列表；若无法确定对象，必须只问“产品 R / 构造 R”，并保留 0.35。
2. H5 输入 F1/F5 三轮：断言“热阻”后不再泛化追问；0.2/0.3 出现在后续回答或明确“先按产品 R 查”。
3. H5 输入 F2 两种表述：断言产品卡数量一致、回答引用知识库构造系统，不只 1 条目录。
4. H5 输入 F6：断言 22 档表出现时要么有可选候选，要么明确“只读、不可选”，且“生成方案”不再死循环。
5. 输入 S4 后“那20mm以内呢”：断言 K<0.5 继承、厚度条件收窄、候选/只读状态一致。
6. 从有候选的会话发一个只读页查询（如“A3-1 介绍”）：断言旧候选卡被清空或明确标记“上一轮候选”，不得让用户误以为仍可 Final；刷新历史会话后按 Backend 当前 revision 恢复。
7. 每次切换会话/刷新，检查候选面板、表格、原页、按钮与 SSE 的 revision 一致。

## 7. 未复现 / 未验证 / 风险

- **未复现**：旧“薄抹灰K<0.5 被以未给型号/基层/厚度为由泛化拒绝”。当前版本返回 234 档只读；不能把旧结论继续当现状。
- **未验证**：H5 真实点击与 DOM（`agent-browser` 无 Chromium/daemon 超时）；微信小程序、App、真实 OSS 原图、PDF 链路。以上均 **NOT_RUN**，不用 Backend/SSE 代替。
- **风险 1**：即使修好合同，真实库仍只有 2 条正式参考行；要让 890 档可选，必须走资料导入/确认/发布，不能用代码“补造候选”。
- **风险 2**：A2-2 15mm、A3-3 λ=0.0012 等原文疑点仍在；答案层目前只在页码上“待核”，未在数值行上提示。
- **风险 3**：模型语义有随机性（同一“VICP”两次结果不同）；步骤 2/3 必须重复运行，不得用单次成功证明稳定。
- **风险 4**：修改澄清/候选合同会触碰既有 35 问与 UAT fixture；必须保留原预期，用新增盲测验证，不得改期望值。

## 8. 结论

5 条根因均有代码与真实会话双重证据。**最小修复不应从 Prompt 或关键词入手**，而应先统一三件事：
1. 一个可持久化的“用户任务状态”（pending + 已填槽 + 查询 revision）；
2. 一个“不得比用户条件更宽”的查询合同（ANY/READ 只能用于显式全量读取）；
3. 一个“产品/构造/材料三层来源”的产品检索合同，以及“只读参考≠正式候选”的端到端状态合同。

按总控要求，**步骤 1 到此停止**，未修改任何代码或业务数据。等待允许后进入步骤 2。
