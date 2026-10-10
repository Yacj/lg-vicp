# 热工自然对话与事实约束最终优化（2026-10-10）

本报告描述当前实现；旧`thermal-natural-language-closeout-2026-10-10.md`的全文匹配快路径、回答相对数值容差及仅凭合规授权放行说明，以本报告为准。

## 1. Root Cause

模板直接作为查表回答、全文相等校验拒绝自然改写；指标与目标绑定缺失及历史条件先行影响新问题；族名被要求唯一ID造成False Negative。现有改动虽已恢复部分自然表达，仍存在查询目标/厚度边界冒充候选实值、来源页串用、换行解除归属、相邻冒充命中，以及候选指代/对比路由混淆。新增回归最初复现10个失败。

## 2. Query Lifecycle

用户原话 → 指标/数值角色及实体归一 → 生命周期 → QueryState → Constraint Engine → 正式/相邻集合 → Allowed Facts → LLM自然生成 → 回答事实抽取 → 同记录核验 → 首个SSE delta。

NEW_QUERY清历史；CONTINUE_QUERY继承并增量更新；REFINE_QUERY局部增改删及偏好变化；COMPARE_SELECTED只读用户所选冻结记录。追问取消条件的tombstone继续有效，独立新问题重新开始。

## 3. NEW / CONTINUE判定

综合本轮明确指标与目标、正式实体主题、完整提问、候选指代和修改信号；预判不借历史补指标。“以内”“呢”不能单独阻止完整新问题重置。只在对比意图加候选指代时进入COMPARE_SELECTED。

- PRODUCT_R≈8.3 → “保温薄抹灰传热系数0.3方案有么”：新建查询，只保留K。
- K≈0.3且已展示正式候选 → “那20以内呢”：保留K，归一厚度上限20mm；候选厚度仅供省略语义焦点，不写成硬条件。
- “这个再薄一点”：细化查询，在硬条件通过后按薄排序。
- “第一个和第三个哪个好”：复用已有序号/多选解析，只比较冻结列表第1、3条；不重查全库，多选协议不变。

NEW_QUERY清掉模型重复传入且等于旧状态的实体、指标摘要、厚度、偏好和移除标记，再由本轮原话/正式词典恢复。

## 4. Entity Family / Exact

完整正式名称/精确别名解析唯一ID；名称派生族、类别及族别名解析ID集合。单ID使用systemId，多ID使用systemIds；均为Constraint Engine硬条件。族排除覆盖各ID，取消族条件清集合。长名称覆盖内部短名，避免II型误判I型。未知明确实体仍进入unresolved，不由模型猜ID。

## 5. Semantic Normalizer

`normalizeConversationLookupQuery`组合既有指标词典、Number Role Classification、指标/比較/厚度Parser和正式Entity Resolver，产出统一QueryState。明确“保温板自身热阻”加同句合理目标8.3归一PRODUCT_R；明确“传热系数0.3”不重复追问指标。裸“有传热8.3的保温板么”仍需确认R/K，不能凭大小猜指标。自然查找默认APPROX，明确正好/等于/就是使用EXACT。未改Parser/Matcher主结构或公式。

## 6. Fact Validator

删除全文相等快路径；fallback不是生成草稿的授权。只核验出现的K、双R、λ、α、厚度、印刷页码、方案/规格编码、体系、标准限值和合规断言，不强制输出所有字段。

同段事实必须由同一冻结记录同时证明。方案绑定跨换行保留，规格编码不另开候选段。目标说明段可复述查询条件，但不能把目标当候选实值。数值只忽略1e-9浮点误差：8和8.000相同，0.303变0.300或18变18.4必须失败。页码只认该候选pageLabel，不从其他候选/物理页序借用。

相邻项必须说明未满足条件，不能冒充命中；无候选不能编造存在匹配。标准限值核验冻结值，合规授权还须匹配冻结compliant，不能反转结果或引用其他标准。“满足全部条件”是AND筛选，不当作全量统计；“暂不能确认合规”可作为不确定说明。

## 7. REFERENCE_LOOKUP LLM恢复

非Agent服务返回facts/sources；生成服务调用场景已准入模型自然作答、核验、重生成一次，仍失败才fallback。Agent成功查询携带Allowed Facts，重试也只使用事实清单。计算事实清单包含冻结值、逐层参数、标准限值及判定。

正式/相邻候选分别冻结，λ/α沿用同页同构造同档人工确认绑定。默认3～8行，一个主方案，可补充最多两条相关项；不强制复述全部字段。正文验证结束前不发delta，停止不会发送未核验半成品。

## 8. 自动测试与真实UAT

回归覆盖自然表达、数值/指标修改、目标冒充实值、跨候选/跨行拼字段、来源编造、相邻冒充命中、合规反转、族别名/取消、新问题重置、省略厚度、冻结对比和首个delta之前校验。

`pnpm uat:check`通过：43场景、132轮，仅类型和结构检查。新增SALES-023为4轮真实HTTP/SSE自然对话验收。

真实UAT尝试：SALES-022（改前）和SALES-023（改后）均在只读加载模型配置时ECONNREFUSED，实际业务轮次0，标记BLOCKED。报告：`logs/ai-uat/natural-dialogue-before/report.md`、`logs/ai-uat/natural-dialogue-after/report.md`。没有写既有业务会话或修改正式发布资料。

最终全量`pnpm test`通过：157个测试文件、1635个用例通过，1个文件/用例跳过；后续相邻状态门禁补充又通过88个针对性用例。`pnpm lint`、`pnpm build`、`pnpm db:check`及`node scripts/verify-migrations.mjs --static`通过。最终事实字段补齐后复核类型/构建及相关用例。不能用单元测试替代真实模型业务验收。

## 9. 修改文件

- 生命周期/归一：`thermal-query-lifecycle.ts`、`thermal-entity-resolver.ts`、`tools/thermal-lookup.ts`。
- 正式规格事实：`thermal-query-dictionary.service.ts`透传正式specCode，计算事实不再把specClass当规格编码。
- 事实：`thermal-answer-semantics.ts`、`thermal-answer-validation.ts`。
- 生成/工具：`ai-generation.service.ts`、`ai-agent.service.ts`、`reference-query.service.ts`、`reference-candidate-selection.ts`、`thermal-calculate.tool.ts`、`compare-solutions.tool.ts`、`tool-result-normalizer.ts`。
- 测试：自然回答、生命周期、非Agent冻结对比、SSE、计算/冻结对比、lookup Tool、normalizer及SALES-023。
- 规则：AGENTS.md、README.md、`.cursor/rules/30-ai-and-reports.mdc`、lg-backend AI参考。

本轮基于已有未提交实现补齐漏洞，其他知识库、识别及客户端改动保持原样。

## 10. Breaking Change

无DB Migration；未改热工公式、知识库上传/Recognition/Index、客户端页面、PDF及多选协议。HTTP/SSE结构兼容，内部Tool增量传递Allowed Facts。新问题重置、族查询、自然回答、对比范围和更严格回答事实核验是预期行为变化。内部仅传canonicalAnswers而不提供事实集的旧调用直接返回可信fallback；成功查询、计算及冻结对比路径均传递事实集。

真实模型自然度与HTTP/SSE业务验收待数据库/运行配置环境恢复后重跑，尚不能宣称生产UAT完成。
