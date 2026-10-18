# 小格导热系数参数查询阶段1记录

本阶段承接2026-10-18阶段0及用户“继续”授权，仅实施阶段1。基线工作区HEAD为5b217ed8c3a597b95f64d9472f839860beafb2b1；阶段2–4未执行。修改为本地Backend代码、测试与必要规则文档，没有迁移、业务数据写入、发布知识页清洗、公式变更、Snapshot/PDF修改或部署。

## 根因与实现选择

- CONFIRMED_FROM_CODE：目录已有thermalConductivity，但原ProductSearchInput/Tool/Semantic没有独立λ值查询合同；CLARIFICATION_REPLY限定图集QUERY，λ回复进入QUERY_CONTEXT_INVALID和无关基层兜底。
- CONFIRMED_FROM_CODE：图集旧“系数”解析可把“导热系数0.3”当K；数值证据不足以验证工程属性身份。单位内部K也可能被误提取成指标。
- REPRODUCED_TEST：原问唯一0.3传入新独立属性合同后，经Domain→Policy→Service正确查询λ；当前回归Fixture只有0.005时不命中0.3。未知术语和缺字段不再使用基层作为查询前置。

采用新增PRODUCT_PARAMETER_QUERY/READ_ONLY，而非扩充THERMAL_LOOKUP_METRICS。原因是产品属性不应改变图集QueryState、Candidate或计算状态，原PRODUCT_DISCOVERY也没有表达参数归属/比较/单位的合同。复用get_product_data，新增PARAMETER_QUERY操作；参数只能消费服务器本轮Domain结果，Tool模型不能替换目标值或对象。

没有新公开API；前端现有delta/sources即可阅读。Semantic新字段parameterQuery为可选，旧提案兼容；消息backendDecision增加parameterQuery、parameterQueryDiagnostics。无既有响应必填字段变更，不需要App/B端改造。后续如需专门的参数卡，另行定义DTO，不把本轮事实当方案卡。

## 合同与工程边界

parameterQuery包含parameter=LAMBDA、subjectType、subjectText、systemText、operator、targetValue、tolerance、unit和连续evidence。

| 字段 | 本阶段合同 |
| --- | --- |
| subjectType | PRODUCT_EQUIVALENT、SPEC_EQUIVALENT、SPEC_NOMINAL、MATERIAL、MATERIAL_LAYER、ANY；ANY仅分别展示各归属，不宣称相互可比 |
| unit | 标准W/(m·K)，无单位时使用标准单位；拒绝面积单位。单位字形可归一，不作数值换算 |
| operator | READ读取、EXACT裸目标、LT/LTE/GT/GTE严格或包含边界、APPROX近似 |
| EXACT | 仅1e-9浮点精度吸收，不扩大业务匹配窗口；0.005不匹配0.3 |
| APPROX | 没有默认业务窗口。只采纳原话明确±数值；“左右”缺容差返回FILTER_CONFLICT并可承接后续±回复。未实现双端区间表达，用户需给明确±容差 |
| 名称 | 用户原文+启用GLOBAL正式别名；不把薄膜灰改薄抹灰，不把体系推成产品目录，不添加后台别名 |
| 数值 | 来自当前原话；无本轮数值时可来自服务器核验的紧邻待澄清原问。型号/页码/厚度等不当目标；本轮明确改值优先 |
| 副作用 | mutation=NONE，无Candidate发布、Selected/Final修改、计算、Confirm、Snapshot或报告授权 |

澄清沿用本人、同客户端、同会话、同项目、active与24h条件。执行Service再次重验会话及pending，并通过服务器queryCurrentMessageId排除本轮已写入的USER消息，避免取到错误问答对。成功参数读取/单纯零命中不恢复为pending；缺容差或名称未解析结果可以继续只读澄清。

新增属性证据错误可在原超时预算内重提案一次，不提高置信度、不降低阈值；其他K查询/泛化澄清的阶段2修复未实施。λ-only被提成图集K的情况在工程字段校验中拒绝，LAMBDA没有进入图集METRIC枚举。

## 来源、权限与诊断

readProductParameters执行assertSolutionAccess并检查项目未变，重新校验Domain Policy、原话证据与Schema，再联合读取所有来源，不在少量命中后短路。

| 来源 | 读取与身份 |
| --- | --- |
| catalog_products | ACTIVE目录，已有计算合同将thermalConductivity解释为产品当量λ；目录ID作为产品身份 |
| product_specs/product_parameters | 已发布生效规格及已发布生效lambda_eq参数；按显式catalogProductId关联产品，规格当量单列，不冒充标称λ |
| materials/material_parameter_versions | 材料和参数均已发布生效；材料ID作为独立属性身份 |
| knowledge_facts | VERIFIED且必须关联当前PUBLISHED/AI_ENABLED、未删除、生效中、平台或当前项目文档版本；只读明确材料ID或规格ID及正式lambda_eq映射，不直接暴露旧resolver的宽范围结果 |
| knowledge_pages | 同上发布/项目范围，只取confirmedStructuredData；v2有证据矛盾则排除；材料层保留document/version/page/construction/layer身份，不把该λ提升为产品整体值，不读取简图字段冒充参数 |

各来源同一正式参数身份、同值可合并，sources保留全部证据；同值不同对象或不同材料层不合并。同一身份来源值冲突则排除并诊断。缺少正式规格标称λ代码映射时，SPEC_NOMINAL返回PARAMETER_NOT_INDEXED，不把lambda_eq重命名成标称字段。没有更改既有计算resolver的优先级或VICP-CALC-1。

| 诊断 | 含义 |
| --- | --- |
| PARAMETER_NOT_INDEXED | 已知身份没有所问归属的独立λ字段；或可读范围未索引该属性 |
| VALUE_NO_MATCH | 有该属性，但不满足所述数值条件 |
| NAME_UNRESOLVED | 不能用正式名称/已启用别名证明身份或体系归属 |
| SOURCE_SCOPE_LIMITED | 部分有权来源的参数/归属/证据不足，未参与匹配；不推断不可访问资料的内容 |
| FILTER_CONFLICT | 同身份来源值冲突，或近似缺明确容差 |

诊断保存scannedCount、identityCount、matchedCount、matchedSourceCount、数值排除及冲突计数，覆盖仅AUTHORIZED_PUBLISHED_ONLY。字段缺失与名称未解析分别判断；不会因字段为空误称已知产品名称不存在。事实核验和去重先于展示截断，最多展示24个参数身份，同时说明总命中数。

参数分支使用Service确定性事实回答，完全跳过自由回答模型、通用知识召回和Agent循环；保留参数归属、范围、来源和结构化原因。阶段0发现的通用product-answer数字白名单问题仍属后续阶段3，本阶段没有假称已修复该通用校验器。

## 关键受影响文件

- src/modules/ai/product-parameter-query.ts：独立Schema、数值/原话/单位/运算验证。
- src/modules/ai/product-parameter-read.service.ts：发布/项目范围、各源合并、身份/冲突/无匹配诊断和确定性回答。
- src/shared/lambda-field.ts：封闭工程属性与单位验证。
- ai-domain-semantic.ts、ai-domain-turn-decision.ts、ai-domain-policy.ts、ai-domain-turn-decision.service.ts：目标、只读Policy、澄清证据、有限复核及模型结构化合同。
- query-clarification-context.ts：仅对Service缺容差/未知名称的只读结果支持续接；原有本人/同端/项目/24h边界保持。
- ai-generation.service.ts、ai-capability-router.ts、shared/ai-answer-contract.ts：参数分支、来源事件、事实直出及诊断留痕。
- tools/get-product-data.tool.ts：新增参数操作，不信任Tool输入的目标/来源。
- thermal-lookup-mode.ts、semantic-query.ts：仅修λ字段/单位K被混用的边界；未修改K/R容差、公式或阶段2的重复校验问题。
- scripts/check-semantic-matching.mjs、semantic-matching-exemptions.json：新增两个字段文件的精确AST治理。
- 测试及客户参数Fixture；AGENTS.md、README.md、.cursor/rules/30-ai-and-reports.mdc、技能references/ai-and-reports.md和语义匹配政策同步。

## 匹配规则登记

新增的是封闭参数验证规则，不是按测试句路由的自然语言快路径：SM-PARAMETER-FIELD-01、SM-PARAMETER-UNIT-01、SM-PARAMETER-COMPARISON-01、SM-PARAMETER-EVIDENCE-01。明确字段、单位、有限标量运算词及±数值仅用于拒绝不一致的已提案字段；意图仍由现有Semantic Parser提出。5个字段正例、5个相似反例、面积单位反例、比较反例、否定/引用/假设及跨轮修正/失效/切话题测试见product-parameter-query.test.ts与product-parameter-continuity.test.ts。

AST范围只增加两个新验证文件，不扩大为全项目禁正则。现有31个节点加新17个节点，共12文件48个精确白名单表达式。该登记不被表述为开放语义规则的owner批准。

## 脱敏Mock链路记录

以下均REPRODUCED_TEST，不是实际模型理解或真实HTTP/SSE验收。当前用户原话与fixture身份之外没有生产会话、令牌或密钥。

| 轮次 | 提案/证据与Policy | Service/结果/回答 |
| --- | --- | --- |
| 有保温0.3的材料么 | Mock CLARIFY/READ_ONLY；唯一0.3/UNKNOWN，无单位 | 只问指标，不发布候选 |
| 导热系数 | Mock PRODUCT_PARAMETER_QUERY/READ_ONLY/CLARIFICATION_REPLY，parameter=LAMBDA、EXACT .3、W/(m·K)，evidence=本轮原文；pending原问ID重验，READ_ONLY_SEMANTIC、mutation=NONE | 连续性Fixture目录只有λ=.005，扫描1、命中0、VALUE_NO_MATCH；无基层提问、不查thermal_reference_rows、taskState无写入 |
| 薄膜灰导热系数0.3的产品有么 | Mock parameterQuery保留systemText=薄膜灰，不自动更正 | NAME_UNRESOLVED；不能从体系生成产品关联，也不将指标改为K |
| λ0.3左右→±0.01 | Service先返回缺容差；下一轮仍取原问.3并核验当前±.01 | APPROX目标.3、容差.01；不采用K默认窗口 |
| 已知VICP复合保温板λ多少 | READ；subjectText保留正式产品名 | 同时返回目录产品当量与显式关联规格当量；若两者缺λ则PARAMETER_NOT_INDEXED，不误称名称未知 |
| 参数生成编排Mock | PRODUCT_PARAMETER_QUERY直达backend:product_parameter_query，answerContract=PRODUCT | 保存parameterQuery/diagnostics及PARAMETER_SERVICE_FACTS_ONLY；delta来自Service，模型streamText与正式方案函数均未调用；旧K查询revision=7与过滤器保留，queryChanged=false |

新tests/fixtures/product-parameters/customer-lambda.json只读摘录客户Excel Sheet1：D7产品当量λ=.005、M8芯材λ=.0025、O8芯材R缓存=4.8；保留原文件完整SHA256与单元格。没有重新计算缓存、把芯材R当整体R、修改历史Fixture或裁定4.8/5.0未决语义。

## 验证与未执行

已执行并通过：pnpm db:check（静态迁移检查）、pnpm lint（12文件48个精确AST节点+tsc --noEmit）、pnpm build（本地clean+tsc）。最终代码的pnpm test -- --maxWorkers=2结果：234文件通过、1文件跳过；2712 passed、1 expected fail、1 skipped，共2714项，耗时95.32秒。另执行独立参数/Service/Tool/编排/澄清定向测试；最后一轮六文件69项通过。未将expected fail和skip计为普通通过。

新增测试涵盖：真实客户字段归属、0.005不匹配0.3、显式容差与严格边界、已知身份缺字段、未审核别名、同身份来源去重/冲突、不同材料层同值不合并；草稿/撤回/换版/过期/BROWSE_ONLY/跨项目来源拒绝；执行时权限失败/项目变化/pending失效拒绝；两轮数值继承/本轮纠正/切话题/±容差续接；Tool不能覆盖服务器条件；生成编排不调用回答模型/热工/正式方案且保存诊断。权限测试为Mock与现有访问服务合同回归，不冒充真实JWT/数据库负向验收。

开发测试过程中一次编排测试因Redis桩缺get方法失败，补齐测试桩后通过；没有为通过测试放松业务门禁。全量运行出现AI SDK旧image content part弃用警告，非本阶段新增失败。

NEEDS_RUNTIME_EVIDENCE：未授权隔离模型、数据库、Redis/OSS/真实HTTP/SSE环境，因此没有运行这些环境或读写生产。未运行阶段4 Q01–Q18真实模型矩阵与波动重复试验；不把Mock或单次成功宣称UAT通过。

## 阶段边界与下一阶段前置

1. 本阶段完成后停止，阶段2需人工确认。K完整性误判/二次校验作用域、一般澄清容错、产品系列介绍、通用回答校验等未越阶段整改。
2. 实际模型仍需证明能稳定提出新目标并完整保留原问范围；如Semantic漏掉未知体系文本，不靠新增关键词补猜。无正式别名时不建立映射。
3. 当前SPEC_NOMINAL无正式字段映射，按缺索引说明。没有从lambda_eq、材料层λ或热阻推算标称λ。
4. 近似无容差时先询问±数值；没有双端λ区间合同。若后续要求新增比较语法，先定义闭合合同和证据测试。
5. 独立属性读取会扫描当前有权发布参数/确认页，规模与实际延迟需隔离环境验证；本阶段未添加索引或迁移。
6. Confirm/Final/版本/revision/来源/报告权限继续走既有门禁；无生产部署，无对外消息发送。
