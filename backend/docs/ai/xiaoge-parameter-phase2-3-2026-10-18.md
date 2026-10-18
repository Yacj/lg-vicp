# 小格参数P0：阶段2、3

本次按用户“后面自动进入阶段，不需要询问”继续。当前工作区为基准，阶段1修改保留。仅Backend本地代码与隔离验收；不部署、不迁移业务库、不改已发布Prompt/公式、历史Snapshot/PDF或前端。

## 阶段2：跨轮条件与有限复核

CONFIRMED_FROM_CODE：Domain的applySemanticQuery已传currentMessage，只允许本轮指标纠正旧指标；semantic-query.service.ts的proposed分支未传该作用域，下游再检验合并文本中的旧指标，可能以“部分明确指标条件未被完整解析”拒绝合法PRODUCT_R替换。

修复：两处复用同一currentMessage合同。保留指标完整性、逐字段证据、REPLACE/SET、来源与置信度门禁，不补METRIC或把λ塞入图集指标。

CONFIRMED_FROM_CODE：SEMANTIC_AMBIGUOUS原来直接结束，即使模型把明确K/λ误称为缺指标也不复核。现在只对READ_ONLY/QUERY且无合规/factRead、已有封闭指标与数字证据的提案复核一次；仍走同一Policy、同一AbortSignal、maxRetries=0。已有字段解析器仅触发复核，不选择目标、补值、提高置信度或授权副作用。复核仍失败则保留拒绝。

通用失败文案去掉强制基层，询问本轮目标；Service的真实缺条件诊断仍优先。

REPRODUCED_TEST：semantic-query.service.test.ts新增“旧K0.3→产品热阻”重复校验用例，得到唯一PRODUCT_R=.3；ai-domain-turn-decision.service.test.ts验证明确K只复核一次且不绕过Policy、副作用歧义不进入该复核。两文件17测试通过。

## 阶段3：产品身份与受约束回答组织

CONFIRMED_FROM_CODE：resolveProductConsultation在PRODUCT_DISCOVERY名称未命中时会使用整个目录。目录仅一款时，未知VLCP可能被回答为VICP。新增可选productQuery{scope,entityText,granularity,evidence}：Semantic保留原名及系列/单品目标，Policy校验原话，Service使用正式名称/启用GLOBAL别名精确绑定；未知名称不退回全目录。缺新字段的旧模型提案不会宽查未知身份。服务给出目录数量、匹配身份数、返回数及NAME_UNRESOLVED诊断，seriesCoverageVerified=false，不能从目录记录推断完整系列。

CONFIRMED_FROM_CODE：旧validateProductAnswer把用户问题数字与全部字段混入同一白名单，λ=.3（用户目标）或λ=25（板厚）可能放行，中文参数和宣传事实也不完整。正式产品回答改为模型JSON事实引用计划：只允许产品ID及SUMMARY/CATEGORY/THICKNESS/LAMBDA/CORRECTION/SPECS/DOCUMENTS，后端按同一产品取原值渲染，禁止自由文字和数字。未知ID、漏产品、重复产品或新增自由字段回落。空summary明确缺已审核介绍，不造用途或优势。GENERAL/SALES优先介绍，ENGINEER可展开技术字段。兼容工程校验也移除用户数字白名单并按字段核对；不再把它当自由文本的真实性证明。

API兼容：无请求DTO、响应外层协议或数据库变更。新增字段仅内部Semantic可选字段与backendDecision诊断；旧提案缺范围时保守澄清，不需前端改造。product_cards与sources事件保持。模型只能组织事实块的顺序和展开深度，语言多样性受限，优先事实可靠。

REPRODUCED_TEST：product-read.service.test.ts验证未知系列不回退唯一产品，正式别名仍可读；product-answer-plan.test.ts验证未知事实、身份、漏项、重复拒绝；product-answer.test.ts验证用户.3、板厚25不能成为λ、中文导热系数同样拒绝。相关5文件43测试通过。

## 验证、规则与下一阶段

本轮阶段2、3全量：pnpm test -- --maxWorkers=2：235文件通过/1跳过，2721通过/1 expected fail/1跳过（总2723），86.76秒。pnpm lint通过，AST12文件48节点。无新增开放语义关键词/正则规则或灰区快路径；有限复核复用已登记工程字段提取。产品回答的兼容数值验证只作用输出，不参与路由。

新增进程内observeDomainSemantic测试观察器，绑定Fastify共享server以跨路由封装取证；默认无观察器，不由请求/环境变量开启，不记录生产原话或模型输出。阶段4隔离脚本注册并脱敏保存结构化提案/Policy，不包含思考链、凭证、签名参数。

阶段4真实模型/HTTP/SSE单列报告，不以以上Mock通过替代真实UAT。正向Confirm/PDF、全量屋面资料、模型波动与真实字段覆盖须以该阶段实际记录为准。

阶段4真实失败后的补充：有限复核提供现有工程字段解析与pending唯一数字作为校核数据，不直接替模型写约束；QUERY_CONTEXT_EXPIRED可复核一次，SEMANTIC_AMBIGUOUS在本轮明确指标+有效pending唯一目标时也可复核。CLARIFY可保留productQuery身份供澄清，不进入产品Service、不提升权限。产品回答计划显式附完整JSON Schema兼容json_object网关；目录未知/无匹配的factValidationCode分别标记，不冒称工程事实已验证。

补充原表读取：readHistoricalConfirmedPage允许items=[]，但仅在CONTINUE/CURRENT/LAST_VISIBLE_CANDIDATES且currentConfirmedPageLookup有效时读取紧邻一条助手的实际引用，并限定同document/version。原权限、24h、revision、optionId、单页唯一和禁序号条件保持，不查新候选。真实失败及修复复测见阶段4记录；新增正例与5个反例通过。
