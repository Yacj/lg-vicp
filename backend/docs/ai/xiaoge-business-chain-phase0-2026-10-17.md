# 小格 AI 业务理解、检索与热工问答：阶段 0 只读审计

审计日期：2026-10-17（Asia/Hong_Kong）。本轮仅执行阶段 0；未进入阶段 1。

## 1. 基准、证据等级与结论

基准是当前 **Backend 工作区源码**，HEAD 为 `f747eace4353711c27431757111db73b2f9988b6`。工作区开始时已存在大量已修改及未跟踪文件，包括此前阶段 0～4 文档、热工算法及上下文改动；本报告不将这些既有内容计为本轮实现，也不据旧报告判断当前代码。未核验服务器部署版本与本地一致。

本轮新增的只有本报告和配套审计摘要 JSON。源码、测试、规则、配置、历史失败记录均未修改。没有部署、迁移、seed、正式计算落库、对象存储写入、方案操作、Snapshot 或报告生成。

证据分为：

- **已证实**：当前源码可直接证明，或本轮纯函数/只读数据库探针复现。
- **待真实对话复验**：存在代码风险或既有记录，但本轮未调用真实模型及 HTTP/SSE，不能标记当前端到端 PASS/FAIL。
- **证据不足**：不能从回答文字或空候选反推出原始模型错误、隐藏资料存在、用户真正想问 K 等结论。

| 编号 | 发现与触发条件 | 证据与影响 |
|---|---|---|
| A1 / P0 | `querySolutionCandidates` 在正式表至少有一个有效候选时跳过知识确认页；正式候选经来源绑定被清空后也不会再补查 | 源码已证实。当前 `K≈0.2`：正式表 1 条、独立知识只读查询 119 档、共享候选查询 1 条；两类结果资格不同，不能称为漏了 118 个可确认方案 |
| A2 / P0 | 跨来源冲突按“构造编号优先＋厚度”归组，忽略体系、型号、基层、资料版本、屋面形式等身份 | 纯函数已复现：两个完全不同构造共用 `A1-1 / 35mm` 时，被错误报告 K 来源冲突 |
| A3 / P0 | 知识候选去重身份与只读确认事实身份不统一；完整四字段知识候选仍可使用构造 ID 作为缺失的方案/规格 ID | 代码已证实存在两套准入与身份表示；实际错误合并或正式流程越权尚未证明，不能把只读 119 档提升为可确认候选 |
| B1 / P0 | `metricScope`、`missingMetricFields` 从共享服务返回，但非 Agent 查表和 Thermal Tool 构造 AnswerFacts 时均未传入 | 源码已证实。回答层虽然有诊断分支，调用链并未接通 |
| B2 / P0 | 数值图集 `pageQuery` 走独立确认事实读取，空结果只有统一话术，没有可供回答消费的失败原因集合 | 三组真实对话中的前两组实际经过此分支；并非经 Thermal Tool 查询后丢失数字 |
| B3 / P0 | 正式表的可用值概览仅应用部分 ID 条件，未应用体系、型号、基层、厚度等其余硬条件 | 本轮数据库探针：`PRODUCT_R≈0.3 + III型 + 35mm` 的身份范围为 0，仍返回 `metricScope=[4,5]`。接通诊断前必须先修统计范围 |
| B4 / P1 | 只读事实查询未进入统一查询变化与事实校验诊断口径 | 真实案例保存了 `confirmedPageLookup`，但消息为 `queryChanged=false`、`queryChangedFields=[]`、`factValidationCode=NOT_EVALUATED` |
| C1 / P0 | `PRODUCT_DISCOVERY / PRODUCT_DETAIL` 直接使用服务固定参数模板，跳过回答模型组织 | 案例三数据库记录及代码吻合，非“模型不理解非工程师”即可解释的故障 |
| D1 / 待复验 | 第二组的“薄膜灰”没有进入正式体系约束或待澄清项 | 已存提案仅包含 PRODUCT_R 数值约束。不能证明用户必然指“薄抹灰”，也不能声称已完成术语归一 |
| E1 / P1 | 计算所得 PRODUCT_LAYER 热阻与产品整体热阻仍有口径差；通用 TOTAL_R 标签仍固定使用 R₀ | 现有分层 fixture 纯函数得到芯材 4.8，完整产品期望 5.0；该断言为 expected fail。来源列头读取分支已有保守展示，不能把所有路径说成都错误 |
| E2 / P1 | Thermal Tool 正式计算分支以关键词重写已验证的 `referenceScope` | 源码已证实，违反本轮要求的 Semantic 下游不覆盖原则；实际错算、误授权尚未执行或证明 |

关键判断：**不能把前两组当前零命中一概判成数据检索错误，也不能把全部异常归因于模型。** 数值继承在这两次已存会话中成功；当前同条件只读探针也没有命中。已证实的问题主要是诊断与范围解释不足、来源路径不统一，以及产品回答被固定模板接管。

## 2. 三组异常的逐轮追踪

本轮以 PostgreSQL 单连接、连接启动参数 `default_transaction_read_only=on` 读取三组原会话；探针开始和结束的 `SHOW transaction_read_only` 均为 `on`。读取时间约为 14:22～14:23。没有调用正常聊天入口，因此没有新消息、检索日志、任务状态或审计写入。

读取的是 **已存 backendDecision / pageQuery / 会话任务状态**。它们是经过 Backend Policy 的决策与提案，不是原始模型输出全文；重试前提案、当时数据库每一步行数、每行拒绝原因及完整模型 prompt 没有保存在这些消息中。下文不虚构这些缺失信息。

### 案例一：保温 0.3 → 产品热阻

会话：`95726326-8491-4cc3-8b93-2e9690cc4007`，`c_app / general_chat`，无项目。

| 环节 | 已存实际证据 |
|---|---|
| 首问，10:37:11 | `保温 0.3的材料有么`；`domainIntent=CLARIFY`，`semanticConfidence=0.62`，`requestedEffect=READ_ONLY`，`mutation=NONE`，`policyReason=SEMANTIC_AMBIGUOUS` |
| 首问执行 | `toolRoute=[backend:clarify]`；未查知识、未执行 thermal、未建候选；回答询问 K / 构造 R / 产品 R |
| 追问，10:37:40 | `产品热阻`；`REFERENCE_QUERY / QUERY / CONTINUE`；Domain 及 pageQuery 置信度均 0.9，`policyReason=READ_ONLY_QUERY` |
| 完整查询条件 | pageQuery 为 `NEW_QUERY`，唯一 METRIC：`PRODUCT_R / 0.3 / APPROX / SET`；evidence 绑定首问原文，`queryContextMessageId` 指向首问。没有体系、型号、基层、厚度条件 |
| 查询执行 | `toolRoute=[backend:knowledge, backend:reference_query]`，`thermal=false`，`agentEnabled=false` |
| 保存上下文 | `confirmedPageLookup.query` 保留 PRODUCT_R、0.3、APPROX、默认容差 0.05，以及实际读取的 document/version 范围。不是 lastReferenceLookup Candidate |
| 候选/来源 | `candidateIdList=[]`、`referencePageIds=[]`、`solutionStateMutated=false`、`reportQueued=false` |
| 最终分支 | 当前源码中 pageQuery 使 `reference-query.service` 不查询正式候选；随后 `loadPublishedKnowledgeReferences → queryConfirmedPageFacts → formatConfirmedLookupAnswer(readOnlyPageFacts=true)` 直接返回统一空结果文案，`streamBody` 直接输出该文案 |

`NEW_QUERY` 与外层 `CONTINUE` 在这里不冲突：紧邻首问尚未建立成功查询，澄清后的完整目标作为首次有效查询，不应继承其他旧任务。当前代码由 `pendingClarification.inheritPrevious` 决定这种情况。

本轮对照当前数据：正式表查询前 2 行，指标筛选后 0，最终 0；知识确认事实查询也为 0。正式表实际值为 4、5，PRODUCT_R 的默认近似窗口是 `0.3±0.05`。**这些 4、5 只属于正式表范围，不能代表整个知识库的全部取值，也不能用于猜测用户其实想问 K。**

结论：这次已存案例没有数值丢失证据；空结果文案未说明“在所读已发布确认范围内按产品热阻近似筛选未命中”，也没有缺列、范围覆盖和其他拒绝原因。不能据此断定资料根本没有产品，亦不能扩大容差制造命中。

### 案例二：薄膜灰系数 0.3 → 产品热阻

会话：`26e31d13-3bfe-4259-8d63-038b7b6e32bc`，`c_app / general_chat`，无项目。

| 环节 | 已存实际证据 |
|---|---|
| 首问，11:25:51 | `薄膜灰系数0.3的产品有么`；`CLARIFY / READ_ONLY / NONE`，置信度 0.55，`SEMANTIC_AMBIGUOUS`，只询问指标 |
| 追问，11:26:01 | `产品热阻`；Domain 置信度 0.9，pageQuery 置信度 0.85；`REFERENCE_QUERY / QUERY / CONTINUE` |
| Policy | `VERIFY_QUERY_FACTS_ONLY`，`queryResultMode=FACTS_ONLY`；中等置信提案只能读事实，不能发布正式 Candidate 或授权方案操作 |
| 查询条件 | `PRODUCT_R / 0.3 / APPROX / SET`，原问数值证据完整；**没有 systemHint、specClass 或尚未确认体系词的 unresolved 条目** |
| 执行/上下文 | 与案例一相同知识只读分支；保存 `confirmedPageLookup` 的默认容差 0.05、资料版本范围；无 Candidate、引用页或正式操作 |
| 最终回答 | 同一确认事实空结果模板，未说明原问体系词未得到可靠确认 |

可以证明数字和指标被接上，不能证明“薄膜灰”已被可靠识别为某正式体系。现有提案没有保留它作为体系硬条件；如该词实际指“薄抹灰”，此处会缺少用户原有体系意图。但其真实含义、后台别名支持情况及真实模型处理稳定性仍需复验，不能新增该原句专用正则或擅自改词后查表。

当前只读探针对只有 PRODUCT_R≈0.3 的完整已授权确认范围仍为零。因此不能将这次空结果直接归因于误归一，也不能以一次当前零命中证明未来体系约束可以省略。

### 案例三：非工程师产品介绍

会话：`a62d8723-d531-4725-bbd2-dda53695a6af`，`c_app / general_chat`，无项目；10:36:16。

- 原问：`你们 VICP 产品主要有什么？我不是工程师，简单介绍`。
- 实际决策：`PRODUCT_DISCOVERY / READ_ONLY / NONE / NEW`，置信度 0.9，`READ_ONLY_SEMANTIC`，`answerContract=PRODUCT`。
- 实际路由：`backend:product_search`；知识检索、thermal、报告均未执行；不是热工查询串台。
- 实际回答：VICP 复合保温板、25mm、λ=0.005、α=1.25，再附“适用场景及比较结论须以已发布资料或审核规则为依据”。
- `searchProductCatalog` 读取 ACTIVE 产品目录、已发布生效规格和当前可读关联文档；DTO 含名称、summary、类型、规格、热工字段及文档标识。
- `resolveProductConsultation` 将这些事实拼成固定 `answer`；`ai-generation.service:720` 直接 `fullText=productRead.answer`，不调用回答模型。
- `tool-result-normalizer.ts:153–179` 其实已有按介绍/技术问题区分表达、仅依据 name/summary、不编优势的模型指引；它由 `get-product-data.tool.ts:35` 等 Tool 归一化路径使用。上述产品直出分支未消费这份指引，因此 Normalizer 的相关测试通过不能证明案例三已修复。
- 关联文档在这个服务中只读取标识和标题，没有读取其正文以取得用途、特点。产品 summary 缺乏介绍内容时，单纯改提示词也无法获得有依据的用途与优势。
- `CATALOG_VERIFIED` 是此分支的固定诊断标记，不能代表已通过面向普通用户的表达校验或产品优势事实校验。

因此，事实取得和解释组织在代码中没有分开。面向普通用户、销售和工程师的表达目标不会影响这份模板；这是已证实的应用层根因。

补充：现有 `_stage0_convs.json` 还包含 B 端版本测试的类似提问，其回答由另一条知识注入路径生成，带技术比较且 `NOT_EVALUATED`。B 端 test-qa 使用 `providedChunks`、不经过上述 C 端 Domain 产品目录直出分支，不能混为同一根因或用它证明 C 端介绍正常。本轮未重跑 B 端。

## 3. 文件、函数与调用关系

以下行号对应本轮读取的工作区版本。

### 3.1 统一 Semantic / Query Context

`ai-generation.service:369 → resolveDomainTurn → applyDomainPolicy → parseSemanticQuery → applySemanticQuery`。

- `ai-domain-turn-decision.service:101–130`：读取紧邻待澄清问答、优先有效 confirmedPageLookup，再读取 lastReferenceLookup；澄清时使用核验原问＋本轮作为数值证据；有限复核最多一次。
- `query-clarification-context.ts:11–44`：仅补充本轮已明确指标对应的原问唯一数值；限制本人、同端、同项目、紧邻已完成问答、24h。不创建候选，不提供计算/报告授权。
- `semantic-query.service:49–71`：存在已验证 pageQuery 时直接使用其合同，不另让查询分类器重做决定；局部追问和独立查询按 relation 选择生命周期。
- `thermal/semantic-query.ts:87–101,196–215`：NEW 清旧条件，REFINE 继承；METRIC REPLACE 清旧指标；逐字段验证数值和 evidence。

### 3.2 当前存在的两条查询路径

**正式候选路径**：

```text
resolveReferenceQueryWithoutAgent（没有 pageQuery）/ Thermal Tool LOOKUP
  → querySolutionCandidates
    → queryThermalCandidates → 发布有效关系、来源权限、硬条件过滤/排序
    → 仅 formal.length==0 才 querySelectedKnowledgeCandidates
    → emitReferencePages → 当前确认档绑定、optionId、版本/访问核验
  → buildAllowedAnswerFacts → 模型组织/确定性回答 → validateAnswerFacts
```

**已验证 pageQuery 的知识事实路径（本次两组真实数值案例）**：

```text
resolveReferenceQueryWithoutAgent:44 返回查询事实合同，不执行正式表查询
  → ai-generation:508–512 的 loadPublishedKnowledgeReferences
    → freshFactScope 时读取当前有权发布资料全页；否则读取已选/已检索版本
    → readConsumableReferencePages 重验当前版本、有效期、项目和 AI_ENABLED
    → 确认快照中存在 v2 时，整个所读集合走 queryConfirmedPageFacts
    → 其他情况走 matchConfirmedPageOptions（完整四字段准入）
  → budgetKnowledgeTestReferences → 完整 RenderModel + 可引用 optionId
  → formatConfirmedLookupAnswer → ai-generation:623 直接输出
```

这里的 `freshFactScope` 已能使独立且可靠的结构化知识查表不依赖检索 top-N，故不能笼统声称“当前所有数值查询只查 top-N”。但它也没有与正式候选路径形成联合覆盖。

### 3.3 来源覆盖、身份和冲突

- `solution-candidate-query.service:18–38`：正式有命中即停止另一来源；来源页绑定发生在决定是否回退之后。`matchedCount` 也是绑定前数量，可能与实际返回不同，缺少绑定拒绝数量。
- `ai-reference-pages.service:22–35`：知识候选回退必须已有 `documentIds / knowledgeVersionIds`，否则直接空数组。正式零命中本身不保证已查所有可读知识页。
- `knowledge-test-reference.ts:174–229`：完整四字段候选与只读事实准入不同；缺正式 scheme/spec 时回退 constructionId。去重键含版本、体系名/映射、编号、基层、型号、规格/目录、厚度、三指标，**未包含正置/倒置、屋面形式和完整层构造**，也没有保留全部等值来源关联。因此在这些键相同而真实构造不同的情况下不能证明可合并；本轮没有在业务库证实这种实际误合并。
- `confirmed-page-facts.ts:37–84`：只读事实支持部位/屋面形式/正倒置、原编号和缺列资料，没有伪造正式方案/规格 ID；返回值只有命中数组，没有每一类排除诊断。
- `thermal-answer-validation.ts:84–121`：冲突检测使用 `schemeCode ?? constructionCode ?? schemeId ?? systemName` 加厚度。纯函数证明不同体系、版本、型号、基层、正倒置共用编号时会误判；每个来源只取第一条，第三条同来源不同值也没有完整比较。
- `candidate-result.service.ts`、`solution-state.service:211–251`：已有只读结果发布与正式确认来源重验；但 `readOnlyPageFacts`、`referenceKind`、合成 ID 与正式方案资格尚不是同一套明确资格合同。阶段 1 不能把两路数组相加后送入现有 Confirm。

### 3.4 无结果诊断的断点

| 层 | 当前行为及断点 |
|---|---|
| 正式查询 Service | `thermal-candidate.service:270` 无已发布参考集会给 notes；`429–451` 产生 metricScope / 缺指标 notes；`stageCounts` 只覆盖正式来源 |
| 指标缺列判定 | `thermal-candidate-matcher:380–385` 在传入的整批行检查有无列，没有先应用全部身份条件；其他型号有该字段可能掩盖所问型号缺列 |
| 值概览 | `thermal-candidate.service:434–439` 只应用 schemeId/code、productSpecId、catalogProductId 的 scopedRows，没有应用其余身份和厚度。仅单指标零命中时生成，值最多 8 个；count 为去重值数，不是行数 |
| 共享服务 | `solution-candidate-query.service:41–46` 返回 metricScope / missingMetricFields / notes，但诊断仍只代表正式来源，未被知识事实结果统一修正 |
| 非 Agent | `reference-query.service:66–68` 仅传附近项、同身份失败项、来源页，没有传 metricScope / missingMetricFields / notes |
| Thermal Tool | `thermal-calculate.tool:266–267` 同样漏传诊断；Normalizer 的 `found=false` 默认 instruction 仍是通用“没有完全满足条件的正式方案” |
| AnswerFacts | `thermal-answer-validation:202–218,287–290` 已有缺列与值概览分支，但依赖调用方提供；值概览模板又固定说“只限定指标、未限定构造或厚度”，对有其他条件的调用不成立；截断值没有显式完整性说明 |
| 主生成入口 | `ai-generation:506` 仅在澄清或候选/附近/同身份项非空时启用 referenceFacts；即使未来只补传零命中诊断，也可能在这里再次丢掉空结果事实合同 |
| 知识事实直出 | `knowledge-test-reference:116–117` 对读事实零命中统一话术；missingMetric、来源未发布/受限、身份未确认、条件冲突等不能由返回数组区分 |

真实案例的确切文案来自知识事实模板，而非 `thermal-answer-validation` 的“当前已发布参考表…正式方案”模板。两个分支都存在诊断问题，不能混淆直接根因。

资料未发布/无权限目前主要靠 SQL/访问守卫排除或抛错；从已授权范围的零行不能反推“存在某份无权限资料”。后续诊断应描述可读范围及覆盖限制，权限错误走实际访问结果，不能泄露不可见资料。

### 3.5 产品与工程事实合同

- `product-read.service:12–41,45–65`：可信目录查询、规格、关联资料过滤已存在；固定模板集中在 60–62 行；`ai-generation.service:720–723` 直出是产品咨询不自然的直接原因。产品目录自身采用 ACTIVE/DISABLED 状态，没有独立“发布”状态；规格和关联知识才有发布有效期门禁，不能误报目录字段都经过发布审核。
- `thermal-lookup-mode:104–121,198`：查询只分 K / TOTAL_R / PRODUCT_R，没有独立芯材热阻查询枚举。芯材可作为原页层证据读取，不能回填 PRODUCT_R。
- `knowledge-test-reference:132–135` 与 RenderModel：有源列头时保留名称、符号、单位；没有时 TOTAL_R 用“整构造传热阻（源文符号待核）”。这是现有可保留的正确行为。
- `THERMAL_METRIC_LABELS.TOTAL_R`、`thermal-answer-validation:151` 仍固定称总热阻 R₀；原始 R 被映射成 totalThermalResistance 后经通用 Candidate 文案可能被改称 R₀。旧报告所称“所有 TOTAL_R 都硬编码外墙主断面”不符合当前代码，当前通用标签已不含外墙，但 R/R₀ 来源语义仍未全程一致。
- `thermal-calculator:76–86,263–283` 已注释 LAYERED 的 productResistance 只累加 PRODUCT_LAYER；现有 fixture 的 4.8 与产品整体 5.0 不等同。本轮只重放纯函数，不调用落库计算服务。
- `thermal-calculate.tool:357–368` 把 `calcResult.productResistance` 直接写入 `calculationFacts.productThermalResistance` 和 CalculationFacts，未携带“当前仅产品层/芯材口径”的显式范围信息。Calculator 的注释未形成完整的运行时事实隔离；不应通过改名或改公式就地掩盖。
- 面向客户端的 `candidate-result.service.ts:8–16` DTO 仅透传 productThermalResistance / totalThermalResistance / K、来源页及 optionId，没有显式芯材/完整产品范围与可确认资格；完整页 RenderModel 另有 sourceColumns、schemaVersion、confirmedRevision。`thermal-calc-presentation.ts` 从冻结记录构造展示，不重算，但其概要也未表达独立芯材与产品整体 R。这是后端事实契约缺口，不等于本轮已验证 App 实际显示错误。
- `thermal-calculate.tool:317–318` 在正式计算时用 `/已选|选中的|保留的/` 重写已验证 referenceScope；`328` 还用自然语言词匹配决定是否尝试合规核验。这是现存下游语义判断，不是本轮新增；需阶段 3 以结构化 reference/合规目标处理，不能扩充关键词来修。

## 4. 本阶段修改及后续方案边界

本阶段没有源码修复、没有新增测试、没有新增字符串匹配/正则/兜底。只新增审计文档与结果摘要。执行 stdin 探针所用程序不进入产品调用链。

阶段 1 建议只做下列范围，须用户确认后开始：

1. 明确共同的授权资料范围，对正式数据与知识确认事实完整查询；先建立“只读事实 / 可进入正式方案”的资格与完整身份，再关联同构造来源，不能简单拼数组。
2. 跨来源同一构造必须有足够的体系、构造、型号/规格、基层、厚度、版本和屋面属性依据；依据不足保留独立事实，不判冲突。保留全部来源定位和 revision/optionId。
3. 统一服务诊断合同：查询范围、完整性、各来源参与数量、身份匹配数、指标缺失/值不匹配、字段拒绝、来源失效、条件矛盾和访问错误。查询失败不能从模型推测原因。
4. 取值概览应用当前全部非所解释指标条件，多指标时保留其余指标条件，记录值/行数和截断限制；不得把解释值提升成命中。缺列诊断也用相同身份范围。
5. 从 Service 一直贯通到 AnswerFacts、知识事实文案、Tool Normalizer 和空结果输出门禁；对只读事实查询单独记录前后条件变化，避免与 Candidate revision 混用。

阶段 1 每种根因独立回归，至少包括：正式已有命中仍读取知识事实；正式来源绑定后为空；完整身份不同不合并/不判冲突；同一身份多条来源冲突；只读缺产品 R 不伪造资格；无已发布集/缺指标/目标无值/条件矛盾/访问拒绝分别解释；III型 35mm 概览不引用 I型值；零候选诊断完整进入输出。产品文案、上下文语义与公式不在阶段 1 顺带修改。

## 5. 已执行测试、只读探针与未执行项

### 自动测试（本轮实跑）

命令：`pnpm exec vitest run`，后接以下 13 个现有测试文件：

```text
src/modules/ai/product-read.service.test.ts
src/modules/ai/reference-query.service.test.ts
src/modules/ai/reference-candidate-resolver.service.test.ts
src/modules/ai/query-clarification-context.test.ts
src/modules/ai/thermal-query-context-regression.test.ts
src/modules/ai/thermal-phase2-dialogue.test.ts
src/modules/ai/thermal-answer-validation.test.ts
src/modules/ai/tools/tool-result-normalizer.test.ts
src/modules/knowledge/knowledge-test-reference.test.ts
src/modules/knowledge/confirmed-page-facts.test.ts
src/modules/thermal/thermal-candidate.service.test.ts
src/modules/thermal/thermal-candidate-matcher.test.ts
src/modules/thermal/thermal-regression.test.ts
```

结果：13 文件通过；**264 passed / 1 expected fail（共 265）**，15.15 秒。expected fail 是分层产品整体 R 的已知口径差异，不能记成该问题已修复。没有新增、删除或改写失败记录。

这些测试包含 Mock 和纯函数验证，不是业务端到端验收。例如 reference-query.service 测试只验证只读候选比较，不能证明零命中诊断贯通；产品测试验证正式目录/别名/查询约束，没有证明普通用户解释质量。

### 本轮只读 Service 对照

资料范围：无项目的当前可读公共发布版本，生产查询使用的既有版本/有效期/AI_ENABLED 过滤；图片签名函数为空值桩，不调用 OSS，不核验图片可用性。没有调用会保存检索日志的 HTTP 搜索路由。

| 条件 | 正式表（过滤前→最终） | 知识确认事实 | 共享候选 | 诊断观察 |
|---|---:|---:|---:|---|
| K≈0.2，默认窗口 | 2→1 | 119 档 / 88 个构造，展示 3 页 / 引用 9 档 | 1 | 证明来源覆盖分叉；不证明 119 档全具备方案资格或都是去重后构造 |
| PRODUCT_R≈0.3 | 2→0，指标后 0 | 0 | 0 | 正式 metricScope=4、5；知识统一空文案 |
| PRODUCT_R≈0.3、III型、35mm | 2→0，身份过滤后 0 | 0 | 0 | 仍返回 metricScope=4、5，证明范围统计缺陷 |

另执行纯函数探针：不同完整构造同编号厚度被误判 K 冲突；给/不给 metricScope 时 AnswerFacts 文案不同；现有分层 fixture 的 productResistance=4.8、totalResistance=5.3068220978349885、K=0.18843669178357564，完整产品期望 5.0。

首次 stdin Service 探针因未先加载 dotenv，在环境校验阶段退出，**未连接数据库**；随后显式加载 dotenv，完成上述只读查询。此环境初始化失败不计作业务失败或业务通过。

### 本轮未执行

- 未调用真实模型；未重放三组消息的 HTTP/SSE；未重新评价模型提案稳定性。
- 未跑完整七轮连续对话；未进行隔离库 UAT、真实正式计算、Final/Confirm/Snapshot/PDF 回归。
- 未运行全量 `pnpm test`、lint、build、db:check；无代码/迁移修改，本阶段没有构建或改 dist。
- 未启动 B 端/App；未做图片、签名过期、浏览器或原生端显示验证。
- 未验证当前服务器部署哈希、API/Worker 健康状态。
- 本轮未读取原 Excel 附件；4.8/5.0 的预期来自任务给定事实及仓库现有 fixture，不能冒称本轮重新核验了附件。

## 6. 对业务与安全流程的影响

| 范围 | 当前审计结论与本轮影响 |
|---|---|
| 知识库 | 本轮只读。正式与知识路径覆盖不同，确认事实读取不能因缺整体产品 R 造字段；历史确认 JSON、引用和源文件未回填 |
| 热工计算 | 本轮仅重放 Calculator 纯函数；公式版本、已发布规则及计算历史未改。芯材/整体产品差异仍待独立版本方案 |
| 权限 | 读取公共可读范围；代码已有项目、本人/客户端、当前版本/有效期、AI_ENABLED 守卫。本轮没有负向身份真实 HTTP 验收，不能据读码宣称所有权限情形已通过 |
| 候选与来源 | `sourcePageId / optionId`、24h、revision、当前来源重验机制保留；统一检索改造必须保留，不能用旧序号或同值记录重新绑定身份 |
| Snapshot | 本轮没有新建或修改。Confirm 路径仍在会话锁/事务中核验来源；只读事实与正式候选资格差异需要阶段 1 明确表达，不能自动提升 |
| 报告/PDF | 本轮未运行、未改写；现有正式报告仍需本轮授权及已确认快照，不能通过介绍/查表/建议进入正式报告 |

## 7. 未解决事项与阶段安排

| 连续对话要求 | 阶段 0 证据状态 | 后续验收重点 |
|---|---|---|
| 模糊数值→产品热阻 | 原会话数值/指标继承已证实；当前只读零命中复核 | 保留范围、给真实失败诊断，不扩大容差 |
| 我说的是 K，不是产品 R | REPLACE 实现及现有单测存在；本轮未真实连续对话 | 验证指标替换，不将历史值无授权搬到新目标，必要时区分“纠正原指标”和“另问指标” |
| 只看Ⅲ型薄抹灰→改成35mm | 语义格式、局部厚度继承已有单测；错词/真实模型未复验 | 从真实前缀继续，核验体系、型号、指标、资料范围逐项保留，不能伪造前轮成功状态 |
| 刚才数据出自哪页 | 当前 Resolver 有归属、24h、revision、optionId 重验及无 Candidate 历史回溯分支 | 空结果没有实际引用页时不得编造；旧序号不能定位新列表 |
| 不计算，只查原表 | Domain/Tool 有读取与计算分支及授权限制 | 带否定/引用的真实 SSE 验证 thermal CALCULATE 未执行 |
| 通用建议，不生成正式报告 | Advice 只读及报告授权门禁存在 | 主题切换不得复活无关 Query Context；无正式确认快照不得生成 PDF |
| 普通/销售/工程产品咨询 | C 端固定模板问题已证实 | 阶段 2 分离事实与解释，使用可信资料、保留事实校验，不自造产品用途/优势 |

阶段 1 先整改来源、身份与诊断。阶段 2 再处理产品表达与上下文目标。阶段 3 处理指标标签/Tool 下游覆盖及运行时口径隔离；如需变更计算口径，先独立设计公式升级和历史可重放方案，不就地改 VICP-CALC-1。阶段 4 最后执行全链路自动及隔离真实对话，并保留每次失败及复测结果。

**阶段 0 到此停止，等待用户确认。**
