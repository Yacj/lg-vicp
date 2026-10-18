# 小格参数P0：阶段4真实隔离验收

按用户追加的“后面自动进入阶段，不需要询问”执行阶段2–4。当前工作区HEAD基线为5b217ed8c3a597b95f64d9472f839860beafb2b1，验收消费本地未提交修改，不假定等同backend(20261018-095029).zip。

**结论：本次已载入客户摘录范围内LIMITED_PASS；不能据此宣称全图集、生产资料或所有模型运行均通过。** 阶段2、3实现见[xiaoge-parameter-phase2-3-2026-10-18.md](xiaoge-parameter-phase2-3-2026-10-18.md)，阶段1见[独立λ查询](xiaoge-lambda-parameter-phase1-2026-10-18.md)。

## 环境、来源与数据影响

REPRODUCED_TEST：复用createUatEnvironment。配置源连接强制default_transaction_read_only，只复制模型、场景与已发布Prompt运行配置；所有用户/项目/资料/会话/审核模拟/查询状态/报告写入随机vicp_ai_uat_*数据库。独立Redis键/队列及OSS前缀，未启动默认Worker、MinIO或生产服务。临时库迁移与Fixture装载不属于业务库迁移。全部运行cleanup=COMPLETED。

正式Processor的PDF补测通过测试注入ObjectStorage边界，把每一次读写限定到随机前缀；不修改业务存储配置。报告新增对象逐一清理，再清理环境。没有部署、业务库写入、发布Prompt改写、旧确认页回填、VICP-CALC-1公式改动或历史Snapshot/PDF修改。

客户源文件作为数据处理，未把文内说明当作本任务指令：

| 资料 | 提取证据 | 本次实际装载 |
| --- | --- | --- |
| 知识库.docx | SHA256 c6da4d241fa819647f9fcdd3575909ddff39340ad8e839692ad84a4ad593a919 | 第一表/印刷页21：A1-1、A1-2各9档；第33表/页53：I型平屋面正置、倒置各6档 |
| VICP热工计算表格公式(1)(3).xls | SHA256 6d55edd9d179beff4c5c770e90b839435821d028722107b7879169392ee8f2a4 | Sheet1 D7产品λ=.005、M8芯材λ=.0025、α原值；O8缓存R=4.8仅保留证据，不导成产品R、不重算 |

Fixture位置：tests/fixtures/product-parameters/customer-{lambda,reference,roof}.json。模拟正式目录2条、已发布规格9条、首表正式参考行18条、确认页事实30档（其中屋面12档只读，未伪造构造/规格ID）。已禁用环境默认合成业务集，其命中不参与客户验收。这里只模拟发布状态，不冒充客户人工审核或给生产资料建立正式映射。

NEEDS_RUNTIME_EVIDENCE：DOCX的可抽取文本未见VLCP或薄膜灰，不足以证明所有图片无别名；不能据此创建别名。页53防水等级前字形在XML不可读，保留未知，不猜I/II。其他77张表、II/III型号、坡屋面和分层产品R完整覆盖尚未验收。末次复查原DOCX临时下载路径已不可读，之前的SHA与只读提取记录保留；后续全量重验需要持久源文件。XLS末次哈希复查仍一致。

## 逐轮Trace与失败保留

下列目录均在docs/ai/evidence/xiaoge-parameter-phase4/；trace.json为脱敏证据。UUID稳定替换；凭证、签名参数、配置密文与思考链不入报告。语义观察器只在隔离进程注册，不通过请求或环境变量开放生产原始提案记录。

| 运行目录 | 已执行/通过/失败 | 说明 |
| --- | --- | --- |
| 2026-10-18T11-19-29-846Z | 52/37/15 | 首轮全保留；观察器未跨Fastify封装，原始提案缺失。含Q04身份字段断言过窄、Q05精确/近似断言错误，也含真实Q06/Q07失败 |
| 2026-10-18T11-22-59-503Z | 3/0/3 | Q06两次提案仍误称缺指标，原始结构化提案已完整取证 |
| 2026-10-18T11-23-59-074Z | 3/3/0 | 加入既有工程字段校核数据后的Q06独立重复 |
| 2026-10-18T11-24-14-225Z | 12/12/0 | 修复成功查询被误当pending后的Q07三次四轮 |
| 2026-10-18T11-26-29-862Z | 53/50/3 | 再现一次Q07低置信度误拒及后续断链，未以此前成功掩盖 |
| 2026-10-18T11-29-52-612Z | 12/12/0 | 有效pending唯一目标+本轮明确指标也可有限复核，Q07重新独立重复 |
| **2026-10-18T11-30-58-756Z** | **53/53/0** | Q01–Q18完整矩阵，Q01–Q07各3次独立会话，加正式名称介绍/名称歧义/屋面来源补测 |
| 2026-10-18T11-31-47-348Z | 1/1/0 | 产品回答计划补显式JSON Schema后实测，CATALOG_VERIFIED；此前安全回落未冒充模型成功 |
| 2026-10-18T11-35-34-828Z | 2/1/1 | 带实际上下文“不要算，只给原表”再现无Candidate原页断链 |
| 2026-10-18T11-38-08-844Z | 2/2/0 | 原页服务扩展紧邻实际引用后复测；没有计算或候选写入 |
| 2026-10-18T11-39-03-758Z | 0/0/0，BLOCKED | 权限哨兵Fixture缺必填title，装载失败，已清理；不计通过 |
| 2026-10-18T11-39-59-764Z | 1/0/1 | 模型把归属类别重复当成具体subjectText，未能验证预期数值分支；未出现越权命中 |
| 2026-10-18T11-41-48-774Z | 1/1/0 | 明确类别与具体名称的Semantic合同后，六种不可读λ=.3哨兵全部排除；真实跨用户/客户端拒绝 |
| confirm-2026-10-18T11-28-59-869Z | 8项断言通过 | HTTP选择/Final/Confirm、真实SSE报告授权、真实Processor/Chromium/PDF/OSS；不是Mock |

主矩阵53轮全部有原始结构化提案与验证决策，2轮发生有限复核；35个独立会话的跨用户访问均拒绝。每轮保存userMessage、pendingClarification、previousQuery、proposal、Domain intent/effect/queryContext/pageQuery、policyReason、查询/字段继承、实际toolRoute与Tool记录、来源范围、诊断计数、AnswerFacts/回答分支、最终文本、SSE、前后状态。复核每次提案分别保存，未只保留成功结果。

记录说明：部分历史trace顶层limits仍沿用早期“仅首表/屋面未验”文字；实际装载范围以同份trace的fixture.scope/roof/roofReadOnlyRows及逐页事件为准，主矩阵为首表18+平屋面12档。该报告文字缺陷已修复，历史原始记录未覆盖。

## 六组真实问题的结果

以下均为REPRODUCED_TEST，具体数值是本次有限授权Fixture的结果，不描述生产库现状。

| 问题/轮次 | 语义、继承与Service | 来源、匹配/排除与回答 |
| --- | --- | --- |
| 介绍VLCP一系列 | PRODUCT_DISCOVERY/READ_ONLY，productQuery保留VLCP/IDENTITY/SERIES | 正式名称和启用GLOBAL别名未匹配；indexCount=2、returned=0，NAME_UNRESOLVED。未改为VICP、未虚构完整系列 |
| 保温0.3→导热系数 | 首轮只澄清指标；次轮PRODUCT_PARAMETER_QUERY、CLARIFICATION_REPLY、LAMBDA/EXACT .3/W/(m·K) | backend:product_parameter_query读取目录/发布规格材料/当前有权事实与层λ，0命中，VALUE_NO_MATCH；不问基层、不调用图集K/R、不刷新候选 |
| 薄膜灰0.3系数 | CLARIFY，保留原字，不猜指标和体系 | 只问实际歧义；没有更正术语或借已知薄抹灰放宽查询 |
| 薄膜灰导热系数0.3 | 独立λ目标，薄膜灰保留在subjectText或systemText（均为合法原名保留） | NAME_UNRESOLVED；λ不再澄清为K/R，没有强行关联产品 |
| 保温薄抹灰0.3传热系数方案 | REFERENCE_QUERY/QUERY，K .3/APPROX，置信度.8–.9时仍为FACTS_ONLY | JOINT扫描48行：18正式行+30页事实；体系筛后36条，去重后3档命中。保留页21、A1-1/A1-2与厚度身份；不要求基层、不计算/确认方案 |
| 保温0.3→产品热阻 | 继承PRODUCT_R=.3，图集只读查询，不生成CORE_R或TOTAL_R条件 | 身份范围有独立产品R，但目标无匹配；未把芯材4.8或K反推值当产品R |

Q02没有体系条件时，首表3档与屋面页53的2个只读档位共同命中，共5条；没有因正式少量命中屏蔽知识来源。Q05的K=0.3被既有封闭比较政策归为EXACT，±.0005内0条是正确无匹配，不能为了出结果改成APPROX。Q06裸K目标默认APPROX±.02，3档分别为A1-2/18mm/.305、A1-1/18mm/.313、A1-1/20mm/.285。

Q07：K=.3→改.28保留体系/来源，命中2档；35mm继承K=.28且只更新厚度，0匹配是正确结果，不复活旧序号。λ=.3且目录只有.005时正确零命中。SOURCE-ROOF得到页53正置/倒置各一条20mm、K=.280，保留两构造身份，不从型号猜防水等级，不把源R强改为R₀。正式参考行的TOTAL_R业务摘要仍沿用既有符号合同，不据此证明原列包含表面热阻；全量源符号/口径审核未在本轮补齐。

Q11仅给VICP短称而无正式别名，当前Fixture保守说明无法证明身份；并非已完成所有品牌介绍。给完整正式名称的SOURCE-INTRO会通俗介绍已知内容；空summary明确未提供已审核介绍，不编造用途/优势，不强制堆λ/α。

Q13/Q14/Q17作为无上下文独立会话，缺具体构造时作必要澄清，不计算/宣称达标/猜原表。补测SOURCE-RAW证明有有效上下文时能返回原表。Q15只给一般只读参考；Q16保留REPORT_REQUEST，由Snapshot门禁拒绝；Q18未来假设只解释，未授权报告或Confirm。

## P0/P1根因、实现与依赖

路径根为E:/code/lg/backend；行号以本次工作区为准，矩阵不是对旧压缩包的定位。

| 优先级 | 文件/函数/行号 | 触发与根因证据 | 最小实现/状态 |
| --- | --- | --- | --- |
| P0 | src/modules/ai/product-parameter-read.service.ts:107 readProductParameters；product-parameter-query.ts | λ原来无独立领域读取；误入图集或通用澄清 | 阶段1独立只读参数合同/联合可信源/归属与失败诊断，未加入THERMAL_LOOKUP_METRICS。CONFIRMED_FROM_CODE+REPRODUCED_TEST |
| P0 | src/modules/ai/semantic-query.service.ts:67 parseSemanticQuery | Domain已按本轮纠正，重复校验未传currentMessage，重新要求旧指标完整性 | 同作用域复用，保留逐字段守卫。CONFIRMED_FROM_CODE+REPRODUCED_TEST |
| P0 | src/modules/ai/ai-domain-turn-decision.service.ts:107 resolveDomainTurn | 显式K或pending补指标仍被模型称缺单位/指标；QUERY_CONTEXT_EXPIRED不复核 | 提供封闭字段校核、一次同预算结构化复核；不代填值/提高Policy门槛，低置信度仍拒绝。REPRODUCED_TEST |
| P0 | src/modules/ai/ai-domain-policy.ts:9 targetedDomainFallback | 无法解析时默认要求体系/基层，掩盖真实缺项 | 只问当前目标；完整参数目标交独立Service，名称歧义保留原名。CONFIRMED_FROM_CODE |
| P0 | src/modules/ai/product-read.service.ts:46 resolveProductConsultation | 未知名称的DISCOVERY退回全目录，唯一产品冒充所问系列 | productQuery原名/粒度+正式名称/别名核验，未知不宽查。REPRODUCED_TEST |
| P0 | src/modules/ai/product-answer.ts:89 validateProductAnswer；product-answer-plan.ts:10 renderProductAnswerPlan | 用户目标与全部字段数字混合白名单，λ可借用厚度/用户.3，宣传事实没有可靠守卫 | 正式回答使用严格引用计划，后端同产品字段输出；兼容字段校验移除用户目标。CONFIRMED_FROM_CODE+REPRODUCED_TEST |
| P1 | src/modules/ai/confirmed-page-reference-read.ts:10 readHistoricalConfirmedPage | 原页已显示但无Candidate，items=[]省略读取被拒 | 仅有效当前查询+紧邻实际引用可读，重验源版本/revision/optionId，不允许序号绕过。REPRODUCED_TEST |
| P1 | Semantic参数归属/产品介绍资料 | 类别可能误填subjectText；短称、介绍文案、系列覆盖缺正式字段/证据 | 类别/名称合同澄清已实测；正式别名与介绍不能由代码创建。后续依赖资料审核。NEEDS_RUNTIME_EVIDENCE |

新增productQuery是内部可选语义字段；无公开DTO、路由或DB变化。无需前端改造。stage2/3未新增自然语言匹配规则；复核复用现有登记工程字段。阶段1封闭λ/单位规则ID、语法边界/正反/否定与跨轮例见阶段1文档和AST登记；登记不等于owner代码审核。

## 正式闭环、权限与验证命令

REPRODUCED_TEST：补测在隔离库用正式HTTP开始方案、Query、SELECT、SET_FINAL、CONFIRM。无Final确认被拒；有Final后形成不可变Snapshot；他人无法读Snapshot。真实SSE“生成这份已确认方案的正式技术方案PDF”产生report_queued。生产createReportProcessor消费冻结报告快照，用本机已安装Chromium与中文字体生成真实PDF、HTML，上传仅隔离OSS。READY，PDF181803字节、4页；抽取含中文、A1构造、K=.305。生成前后SolutionSnapshot JSON逐字相同。本地PDF副本为report.pdf，仅隔离测试产物。

REPRODUCED_TEST：权限专项装载6种人工λ=.3负向哨兵：其他私有项目、DRAFT、BROWSE_ONLY、过期、非当前旧版本、已删除。它们不是客户事实。服务最终scannedCount=18（仅可读λ）、MATERIAL_LAYER identityCount=6、matchedCount=0、VALUE_NO_MATCH，6条哨兵均未进入扫描事实；真实他人/跨客户端访问拒绝。不能将这组与业务数据缺失混同。

最终执行：

- pnpm db:check：通过，静态迁移检查。
- pnpm lint：通过，12关键文件48个精确AST节点与TypeScript。
- pnpm build：本地clean+tsc通过。
- pnpm test -- --maxWorkers=2：2730通过、1 expected fail、1跳过（总2732），235文件通过/1跳过；最终复跑98.00秒。expected fail仍为既有甲方Excel产品R known gap，未改为通过；跳过为本机缺部署脚本测试所需Bash。
- pnpm uat:check：TypeScript与45场景138轮定义检查通过，只是离线结构检查，不冒充138轮真实验收。
- pnpm exec tsx scripts/run-xiaoge-parameter-uat.ts：真实矩阵；--case=SOURCE-INTRO/SOURCE-RAW/SOURCE-SCOPE为影响分支的追加实测，全部失败目录保留。
- pnpm exec tsx scripts/run-xiaoge-confirm-uat.ts：真实闭环通过；未启动生产Worker、修改已发布模板或公式。

模型网关持续提示不支持responseFormat schema；Domain和产品计划都显式提供JSON Schema并经Zod校验，未降低JSON/字段门禁。旧image content part有SDK弃用警告。PDF文字复查时本机Node22/unpdf有Math.sumPrecise/字体替换警告，但文字提取与真实PDF生成成功；第一次复查的多余destroy调用失败已纠正，不算业务通过依据。

## 尚未证明的能力

NEEDS_RUNTIME_EVIDENCE：完整79表、真实人工审核/正式关联与全量I/II/III屋面/防水等级覆盖；大规模参数扫描延迟；全部可用上游模型与推理开关组合；App/B端视觉与生产版本运行；真实正式别名/产品介绍文案。未补齐这些证据，不声称完整系列、生产λ=.3存在、所有屋面可用或工程达标。

4.8/5.0未决口径保持known gap。当前只支持明确λ比较合同，近似须用户±容差；SPEC_NOMINAL没有正式映射，返回缺字段，不从lambda_eq或K/R反算。只读页面仍不等于可Confirm的正式候选。生产上线未执行，下一步依赖正式资料审核与代码评审；本次授权阶段已结束，不自动部署。
