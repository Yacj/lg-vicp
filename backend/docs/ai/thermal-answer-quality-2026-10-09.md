# 热工问答回答质量与来源一致性（2026-10-09）

## 问题原因

- 跨 Candidate 拼字段：候选会话 schema 没有 λ、α、构造层；页面文字与结构化候选没有共用原子事实约束。同一来源页的多个候选还会把参数条扁平混排。
- 最高值误判：当前查询只输出最多12条候选，没有完整范围统计标记，却缺少禁止将命中范围当全量范围的明确契约。
- 页码 fallback：`knowledge.service.ts` 的页面导航回填与模型上下文会将物理页序转换为 pageLabel，造成缺失印刷页码时出现虚假页码。
- 回答过长：查表合同要求直接回答“有”，没有优先处理指标歧义，也没有限制首轮主方案数量和行数。

## Prompt / Contract

`THERMAL_FACT_RULES` 共用于 REFERENCE_LOOKUP / THERMAL 最终合同、thermal Tool 描述、查表结果与历史候选上下文。约束同一候选绑定厚度/λ/α/双R/K/构造/规格/来源；禁止跨候选区间、全量极值和无依据合规；统一产品层热阻 R、外墙主断面总热阻 R₀、传热系数 K。图集值和计算值分开。默认3～8行、一个主方案、一个澄清问题；详细追问才展开参数与公式。

模型上下文新增 `answerIntent`、`interpretation`、`primaryCandidate`、`alternativeCandidates`（最多2个）、`sourcePages`、`warnings` 和 `scope=CURRENT_MATCHES`。完整 `candidates` 保留供明确要求列出全部本次候选的追问，不把它作为全量数据库。

真实失败问句“有传热8.3的保温板么”进入参考查询合同；thermal 与 search_knowledge 均按原始用户消息守卫，模型改写查询或猜指标不能绕过澄清。没有已核验的该目标候选时先问产品层R还是整墙总R（若指K请说明），不提前宣称有8.3的板。用户明确产品热阻、总热阻或K时继续原查询链。已有明确指标上下文的普通追问仍由既有查询归一逻辑处理。

用户给出的“就是8.3”Case触发局部修复：仅在 EXACT 词汇和目标连接词中补充“就是”。Parser/Matcher主结构及匹配规则不变。

## Formatter / 候选事实

正式参考行没有 λ、α 列；已有 `knowledge_pages.metadata.confirmedStructuredData` 保存人工确认的构造层。只读该快照，不使用识别草稿或从 Chunk 抽取补值。

补充参数必须满足：当前已发布有效来源页；文档一致；构造唯一绑定（已确认schemeId优先，否则相同构造编号）；型号不冲突；厚度/已有规格/目录关系一致；唯一选项双R/K与正式候选在数据库精度范围内相等。只有唯一明确VICP/保温板产品层才透传 λ、α。不反算参数。每次重读来源页时重新绑定，清除历史派生参数，防止确认快照变化后复活旧α。

冲突或无法唯一绑定时记录中文 integrity warning，仍使用正式候选双R/K。补充后的同一候选再保存会话，Zod schema保留λ/α/layers。完整参数追问从该结构化记录展开。

ReferencePage的`matches`逐候选保留参数；兼容扁平`highlights`仅对应主候选，避免同页不同档位混排。summary可选透传λ/α；总热阻标签使用R₀。

## Source Page

去掉导航回填和模型上下文的两处物理页码fallback。用户文案只使用真实pageLabel；缺失时使用“当前来源页未记录印刷页码，可直接查看原始页面”。

来源页加载后以当前页真实标签同步候选`sourcePageLabel`，包括明确null；标签冲突记录warning。`pageNumber`/`physicalPageNumber`兼容定位字段保留，不作为印刷页码。`atlasPage`/`evidenceRef`不得代替pageLabel。既有`formatSourceForUser`已经只使用pageLabel，无需改其API。

## 测试与验收

- 原子事实：测试A4-1/60mm/产品R8.000/总R8.313/K0.120与λ0.005/α1.5同档绑定，状态往返不丢字段。这是合成回归fixture，不是本机正式资料验收结论。
- 不跨候选：50mm/α1.25、60mm/α1.5、70mm/R9.333逐条保留；重复选项、文档不一致、双R冲突拒绝补充；同页参数条不混排。
- 歧义：四种模糊用语；thermal模型猜PRODUCT_R/TOTAL_R/K都不查询；search_knowledge改写总R也先澄清。
- 指标分离：PRODUCT_R8.3近似不能拿TOTAL_R8.313冒充；TOTAL_R8.3及K0.12近似独立命中；“就是/等于8.3”走EXACT。
- 页码：physical1/pageLabel21显示21；pageLabel null不回退physical5；Tool/SSE与候选标签同步。
- 销售长度与设计追问、精确/近似文案、合规必须标准依据均进入最终合同。

验证：`pnpm lint`、`pnpm build`、`pnpm db:check`、`pnpm uat:check`通过；完整`pnpm test`为145个测试文件通过，1370项通过、1项既有跳过。`git diff --check`无空白错误。

真实命令：`pnpm uat:ai --case SALES-017 --out logs/ai-uat/thermal-answer-quality-2026-10-09`。SALES-017首轮改为用户提供的真实问句，保持原40场景123轮结构。配置数据库读取阶段ECONNREFUSED，计划3轮、执行0轮、BLOCKED3、通过0；报告在上述目录。未调用真实模型，不能据此宣称最终自然语言业务验收通过。数据库恢复后重跑该Case及完整UAT，检查模型实际回答的数值绑定、页码和长度。

## 修改文件与兼容性

运行代码：`src/modules/ai/thermal-answer-facts.ts`、`conversation-task.ts`、`reference-page.ts`、`tools/{thermal-calculate.tool,search-knowledge.tool,tool-result-normalizer}.ts`、`src/shared/ai-answer-contract.ts`、`src/modules/knowledge/knowledge.service.ts`、`src/modules/thermal/thermal-lookup-mode.ts`。

回归：`thermal-answer-facts.test.ts`、`tools/search-knowledge-thermal-clarification.test.ts`、`reference-page.test.ts`、`tools/{thermal-lookup,thermal-lookup.tool,thermal-reference-page-guard}.test.ts`、`src/shared/ai-answer-contract.test.ts`、`src/modules/knowledge/knowledge-context.test.ts`、`tests/uat/cases/sales/index.ts`。

约束同步：AGENTS.md、README.md、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`。

无DB结构或migration，无新增路由、无新SSE事件、未改B/C端、上传、Recognition、Index Rebuild或Thermal Engine公式。模型Tool上下文和会话JSON增加可选字段，ReferencePage summary增加可选λ/α。兼容字段仍保留；唯一展示行为变化是旧扁平参数条只含主候选，全部候选仍在matches。

## 线上发布（2026-10-09）

按用户授权执行本地打包 + SSH发布。隔离发布目录仅覆盖本轮9个业务源码；工作区此前两处Recognition改动经SHA-256核对已在线上，因此保持其现有版本，管理端未发布。

`pnpm deploy`成功，API与Worker已重载且online；服务器`.env`保留，seed跳过。发布前数据库备份：`logs/db-backups/pre-migrate-20261009201011.dump`（服务器应用目录内）。迁移水位发布前后均为53条、latest `1791378724366`，本次没有应用新迁移。

发布后9个热工问答文件及2个保留的Recognition构建文件均通过远程SHA-256核验；服务内`/health/live`、`/health/ready`正常，Redis/数据库/存储均ready。公网HTTPS健康接口通过curl验证。部署后的纯函数冒烟验证了真实歧义问句、同档双R/K、真实页标签与null标签，无生产业务数据写入。这不替代此前BLOCKED的真实模型HTTP/SSE业务UAT。
