# 跨页结构化热工查表与多基层比较修复（2026-10-13）

## 根因与证据

以工作目录最新源码为基线，保留其他未提交及并行改动。首次修复阶段未连接业务数据库；随后按用户要求追加真实只读验证，见末节。

| 入口 | 原调用链 | 静态确认的遗漏点 | 修复后 |
| --- | --- | --- | --- |
| C端非Agent | Domain Decision → resolveReferenceQueryWithoutAgent → 正式热工集；无正式事实时 loadPublishedKnowledgeReferences | 不同基层可能被判为概念/现有候选比较；没有指标目标时知识页只读取全文命中页 | 明确的结构化参数/比较规格直接读取本轮检索/所选已发布版本确认档位 |
| C端Agent | Domain Decision → REFERENCE_LOOKUP合同 → search_knowledge → 资料选择 → parseSemanticQuery → loadPublishedKnowledgeReferences | 无目标值可能被要求澄清；filters为空不扩页 | 共用结构化规格，限定此类请求使用search_knowledge；仍保留原资料选择等待 |
| B端test-qa | knowledge-workflow.service.streamVersionTestQa → streamConversationReply(loadPageReferences) → loadKnowledgeTestReferences | 无目标值只加载指定版本的全文命中页 | 共用相同规格/Matcher，仅在被授权的指定版本扩页 |

旧 `loadPublishedKnowledgeReferences` / `loadKnowledgeTestReferences` 都用 `filters.length > 0` 判断结构化扩页；旧 `formatConfirmedLookupAnswer` 的 `.slice(0, 3)` 另有回答截断。单页检索导致漏第6页属于源码可确认的失败条件；真实线上究竟选择哪个Tool/分支未观察，不能据此宣称线上Routing已经证实。

本轮模拟检索仅返回第5页的测试已运行证实：新查询读取两页，匹配4条；Agent工具、B端加载器、最近候选只读Resolver及HTTP/SSE协议夹具均验证相应行为。

## 改动

- `structured-reference-query.ts`：复用既有厚度/指标Parser及QueryState校验，形成 `REFERENCE_COMPARISON` / `REFERENCE_PARAMETERS` 规格。没有K/R目标值可以读列；有厚度但只是施工/概念区别不扩页。序号比较、原页、明确计算走原路径；不完整体系/厚度或关系歧义仍澄清。新话题清旧范围，相同厚度追问仅继承必要体系/厚度，解除旧单构造及旧指标目标。
- `ai-domain-turn-decision.ts` / `.service.ts`：在概念/候选比较分支前验证该规格，仍使用既有 `REFERENCE_QUERY` Intent和Answer Contract；开放分类提示补充语义区别。
- `semantic-query.service.ts`：确定性规格优先，避免无目标值读取参数调用模型后误判；不采纳Tool自由提供的正式ID、数值或旧目标。
- `ai-generation.service.ts`：此类非Agent请求直接走知识确认档位，Agent工具范围限定search_knowledge；保存本轮真实查询及实际展示候选，序号与文本顺序一致。普通数值候选查询继续原正式热工集路径。
- `ai-reference-pages.service.ts` / `knowledge-test-reference.ts`：按查询性质扩展已检索版本，C端逐页重验当前发布/有效期/项目/usageMode；B端由既有路由授权指定版本。来源限3页仍是展示预算，不是扫描范围。
- 共用 `matchConfirmedPageOptions` 适配器：编码全半角/大小写/空白/外墙前缀归一，精确厚度继续正式Matcher；同一个确认选项提供厚度、双R、K、基层。硬条件再用QueryState Validator核验，不补算缺值。型号优先确认字段与构造名称，不让页标题覆盖其他构造的明确型号。复合键包含版本、映射体系/名称、构造、基层/厚度、规格/产品和四项数值；完整事实重复时按物理页序及标识稳定选择证据，同编号不同基层不合并。
- 先统计全匹配数/基层数及缺核心字段/基层排除原因，再按页数、记录数和上下文预算展示。结构化比较最多12条；案例4条完整输出。截断明确说明总数和实际展示数，剩余项可按基层/构造查询。极值结论仅在本轮匹配全部展示时生成。
- 仍使用 `[[KP:optionId:fieldKeys]]` 和现有CitationStream生成高亮；不更改SSE字段、ReferencePage、快照、报告、原页签名或方案激活协议。

没有修改数据库/迁移/环境文件，没有同步或重新识别79页，没有改App/Admin、Vision、热工引擎或Parser/Matcher主结构，没有部署。

## 测试与运行验证

新增 `structured-reference.fixture.ts`（2页4基层，另含40/50mm及A3-2的18mm排除/回归档位），`structured-reference-query.test.ts`、`tools/search-knowledge-structured.test.ts`；扩展 `ai-reference-answer-stream.test.ts`。

覆盖：4条跨页、最低K限定范围、编码前缀及全半角、18mm单构造、同会话解除旧条件/新话题清理、第二个原页引用最近展示revision、概念/施工解释不扩页、序号比较只读、明确计算分类、C/B共同事实、错体系同编号、40/50mm排除、无效版本/usageMode/项目/换版、OCR无确认档位、缺字段诊断、相同K的optionId隔离、复合去重、22条全匹配与展示截断、Agent检索失败不发布候选、HTTP/SSE四条两页及模型错误复述阻断。

本轮执行：

- `pnpm exec vitest run src/modules/ai/ai-domain-turn-decision.test.ts src/modules/ai/ai-reference-pages.test.ts src/modules/knowledge/knowledge-test-reference.test.ts src/modules/ai/ai-reference-answer-stream.test.ts`：初次相关回归61通过。
- `pnpm exec vitest run src/modules/ai/structured-reference-query.test.ts src/modules/ai/tools/search-knowledge-structured.test.ts src/modules/ai/ai-reference-answer-stream.test.ts`：新增/扩展回归30通过。
- `pnpm test`：2061通过，1跳过；187个测试文件通过，1个跳过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
- `pnpm db:check`：迁移文件静态检查通过，未执行迁移或数据库写入。

以上均为本轮真实命令输出；HTTP/SSE为Fastify inject + 模拟模型/资料夹具，未运行真实模型网关、数据库、对象存储或生产会话UAT。全量测试有已有AI SDK image内容类型弃用提示，不影响通过。

## 关键案例输出（模拟数据验证）

共4条、4种基层，当前展示4条。每条的实际optionId由对应页确认快照生成，以下省略具体哈希。

| 构造原始编码 | 基层 | 保温厚度 | R₀ | K | pageLabel | optionId对应关系 |
| --- | --- | --- | --- | --- | --- | --- |
| A3-1 | 钢筋混凝土 | 45mm | 3.313 | 0.302 | 5 | 第5页A3-1的45mm确认选项 |
| A3-2 | 混凝土空心砌块 | 45mm | 3.398 | 0.294 | 5 | 第5页A3-2的45mm确认选项 |
| 外墙A3-3 | 蒸压灰砂砖 | 45mm | 3.416 | 0.293 | 6 | 第6页A3-3的45mm确认选项 |
| 外墙A3-4 | 加气混凝土砌块 | 45mm | 4.040 | 0.248 | 6 | 第6页A3-4的45mm确认选项 |

该范围最低K为外墙A3-4的0.248，不泛化为其他工程场景最佳材料。A3-2的18mm回归为R₀=1.598、K=0.626。任务未提供产品层R，夹具使用显式模拟值保证四项完整；不会将该值写入任何业务资料或当作线上事实。

## 剩余风险

真实业务资料中名称、型号、基层和核心字段仍须已确认且一致；缺字段项排除，不将剩余60项统一认定为识别错误。极大结果集仍受3页/12条/上下文预算限制，已保留正确总数并明确截断；本轮未增加前端分页协议。跨版本事实故意不合并；pageLabel仍使用现有可见页签，不用物理页序伪装印刷页码。线上模型Routing、实际资料名称及授权、真实页图签名仍需后续隔离环境UAT核对。

## 追加真实数据库只读验证（用户明确授权）

命令：`pnpm exec tsx scripts/verify-cross-page-reference-readonly.ts`。脚本读取现有`.env`，连接参数不打印、不改写；每个连接设置`default_transaction_read_only=on`，所有业务查询包在`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`事务中，前后均核验`transaction_read_only=on`，并设置本事务的statement/lock timeout。未创建会话、消息、候选状态、报告、审计、测试用户或业务fixture，未修改数据库或对象存储。报告只有本地文件。

实际资料：当前平台发布、AI_ENABLED、生效中版本《测试知识库》，79页、890个选项，830个四项完整；正式热工参考行仍为2条且都未关联来源页，未执行同步。

首轮真实查询发现模拟夹具遗漏：确认数据的`systemName`为“外墙A3-1”等构造名，体系来自同页确认标题。原适配器二次Validator据此返回0条。已补充`confirmedSystemName`：仅当systemName与完整构造编号等价时使用同页确认标题；明确的另一体系名不能被标题覆盖。快照和optionId不改变，并新增对应回归。

同时发现真实资料含多个Ⅲ型体系，无上下文的“Ⅲ型45mm最低K”会包含16条；在当前薄抹灰范围内的省略追问应保留该体系。已修复同型号、未指定新体系、未切新话题的比较追问仅继承体系范围，旧单构造/旧目标仍解除。真实内存上下文串联验证结果为4条中的A3-4、K=0.248。

真实通过的事实链：

- 直接从数据库读取的A3-1～A3-4四条45mm档位与任务数值一致，产品层R实际均为3.000。
- C端单页来源输入扩展为4条/2页；逐项核验基层、厚度、双R/K、当前页ID、确认optionId及引用匹配。
- 实际`searchProjectKnowledge`前5条仅命中页27/24/23/41，同一资料版本扩页后仍正确返回页5/6的四条。
- 当前薄抹灰体系下的最低K=0.248；A3-4总R₀=4.040；A3-2的18mm为R₀=1.598、K=0.626。
- A3-2单构造→相同厚度不同基层比较（仅内存上下文）扩展为四条；概念/序号路由不误入数据查询。
- B端真实`searchWikiHierarchy(versionId)`与`loadKnowledgeTestReferences`输出4条/2页，citationOptionIds与C端完全一致。

原页图HEAD的两个检查均为`BLOCKED`，错误为`ECONNREFUSED`；现有`.env`对象存储服务不可连接，签名生成成功数为0。表格/来源页标识/optionId仍可核验，不能宣称图片签名与下载通过。未运行真实会话HTTP/SSE或LLM Gateway；这些入口会写消息/审计/状态，本次保持只读范围。

追加补修后再次执行`pnpm test`：2062通过、1跳过；`pnpm lint`、`pnpm build`、`pnpm db:check`均通过。完整本轮真实检查状态、实际四项参数、引用ID、确定性回答保存在`cross-page-reference-db-2026-10-13.json`，不包含密码、密钥或签名URL。
