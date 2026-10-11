# AI 热工全条件约束与事实一致性收口（2026-10-10）

## 1. Root Cause

旧条件分布在 Tool 参数、兼容 K/R 摘要及会话历史中。模型能在无用户操作的追问中覆盖摘要值；体系名称提示存在具体体系分支和跨体系回退。规格切换后的继承会重新带回旧型号。撤销条件只清当前参数，没有跨轮删除标记。历史复用只检验部分条件，标准地区和建筑适用范围未形成统一证据链。

Matcher 返回的精确、相邻、缺数据候选没有最后一道通用硬约束门禁。页面已具备同构造同厚度双R/K确认绑定，但 LLM 的最终正文仍能自行重写数字、拼不同记录或从 top-N 宣称极值。原页结构保留物理定位字段，模型正文不能靠 Prompt 证明没有把它当印刷页码。

本轮保留 Parser/Matcher 主结构，仅补正式语言词典（保温板自身热阻、板自身R、整墙热阻及用户报告的模糊性能表达），以本轮用户报告的真实错误作为回归输入。没有任何按特定体系、目标数值或方案的业务分支。

## 2. QueryState 设计

`thermal-query-state.ts` 复用现有平铺字段和 `filters[]`，不虚构新的材料业务表。统一状态存储于现有 `ai_conversation_states.taskState.lastReferenceLookup.query` JSON：

- 指标 K / PRODUCT_R / TOTAL_R，mode 为 APPROX / EXACT / MAX_LIMIT / MIN_LIMIT；每项继续保存明确用户容差及有效容差信息。
- 体系ID/名称提示、方案ID/编码、产品目录、规格ID、规格分类、基层材料/厚度、保温精确/上下限厚度。
- 地区、标准限值ID、建筑类型、正式标准已有的结构类型；来源文档/版本范围与实体排除。
- preferences 为软排序条件；unresolved 阻止正式命中；conditionTrace 记录 HARD_CONSTRAINT / SOFT_PREFERENCE / AMBIGUOUS 及条件来源。
- removedFields / removedMetrics 为持久化删除标记，只有新的明确操作才能重新加入。

正式实体名称来自已发布生效目录，别名来自启用的 GLOBAL 词典。未知显式标注或多正式记录歧义进入 unresolved。已有结构化约束有确定性保证；任意未收录自然语言的解析完整性仍需真实 UAT 验证，不宣称穷尽自然语言。

## 3. Constraint Engine

`validateCandidateAgainstQueryState` 同时验证全部硬字段、热工指标、厚度、来源和排除。缺事实不能证明符合。`traceQueryState` 检查同指标及厚度不可能同时成立的边界，产生 unresolved。`rankByPreferences` 只在硬过滤后的候选中排序。

所有服务和 Tool 使用同一个状态与校验函数。标准范围通过正式 `standard_applicability`、当前发布标准文档及对应限值证明；未指定具体标准、建筑类型或所需结构类型时不授权合规结论。

## 4. Candidate Validation

Service 输出 `constraintMatch={passed,matched,failed}`。`candidates` 与新增 `matchedCandidates` 只包含 passed=true；`nearbyCandidates` 单独标记 NOT_FULLY_MATCHED。Tool 在过滤和排序后才截取12条，并记录全范围匹配数量，不用历史 top-N 判断新条件是否存在。

候选字段来自同一参考行业务记录；λ/α 只透传同页、同构造、同厚度且产品R/总R/K一致的人工确认快照。计算继承唯一或单选候选，选择前再查正式对象身份/材料关系，不默认拼第一条。已选候选对比只读取对应冻结记录，不重查全库。

## 5. Answer Fact Validation

`buildAllowedAnswerFacts` 先冻结合法候选，逐条渲染厚度、产品R、总R、K、方案、规格和来源。详细追问才附 λ/α，默认一个主方案。多方案展示最多三条，禁止模型自行输出全量最高/最低/唯一统计。

`validateAnswerFacts` 使用保守完整事实句契约：最终文本必须等于后端从原子记录生成的核验文本（只允许换行规范化和首尾空白）。不使用“任何数字都曾出现”作为证明，也不让另一个模型判断工程事实。自由改写即使数字看似正确，也会进入 INVALID_FACT。

`runAgentLoop` 在任何热工正文 SSE delta 之前缓冲并校验：失败用同一已配置模型重生成一次，仍不通过或重试失败则使用确定性模板。重试受停止信号与总超时控制，停止不发送未验证半成品。非 Agent 查表也调用相同约束服务并输出确定性答案。模型重试可能增加一次调用及延迟；严格契约限制了自由措辞，后续如扩大语言表达范围，应提供可验证的结构化分句契约。

计算结果只来自原有冻结 presentation 和标准快照。不能证明满足原筛选条件时明确提示，合规事实仅在正式适用范围验证成功后输出，并引用所选限值/标准条款。

## 6. Source Page 修复

回答模板只使用 sourcePageLabel/pageLabel；缺失时显示“可查看原始来源页面（未记录印刷页码）”。禁止 fallback 到 physicalPageNumber、pageNumber、atlasPage 或 evidenceRef。原页 API 继续保留内部定位字段以兼容客户端，正文门禁不会把定位字段解释成用户页码。过期、非当前或不可消费页面不补充 λ/α 和页面标签。

## 7. Multi-turn 条件继承

默认按指标 UPDATE，其余条件保留；只有明确再加范围才追加同指标边界。取消用删除标记阻止模型/旧摘要复活。厚度修改沿用原边界含义；新单边厚度替换旧边界，不把20以内与30以上同时留下。不同指标持续 AND。实体切换按正式依赖清除旧方案/规格/目录；偏好、排除及歧义在无操作轮次持续存在。

所有查询条件及来源范围进入复用签名，只有纯参数/原页指代可复用。损坏历史 JSON 保留可验证的字段，同时把损坏字段标为 unresolved，禁止静默放宽。Intent 切为 THERMAL/COMPLIANCE 时保留查询条件。

## 8. 自动测试

新增参数化维度、1/2/3/5/全条件组合、多轮增改删与冲突、删除后模型重复参数、规格依赖、未知实体、历史损坏测试。生成式不变量覆盖3指标 × 4模式 × 50随机目标 × 5边界偏移，共3000次判断。新增候选冻结/跨行拼值/页码/统计/合规拒绝测试，以及真实 `runAgentLoop` 控制流的 SSE 首包门禁和停止测试（模型与数据库由测试替身提供）。计算继承和已选候选对比补充针对性测试。

本轮检查：`pnpm db:check`、`pnpm lint`、`pnpm uat:check`、`pnpm build` 通过；完整 `pnpm test --maxWorkers=2 --testTimeout=15000` 为150个测试文件通过、1文件跳过，1476测试通过、1测试跳过。跳过的是依赖本地原始图集PDF的既有回归。首次完整测试的滚动摘要动态导入超过默认5秒；单独复跑通过，完整套件在15秒测试预算下通过。本轮真实 `pnpm uat:ai --out logs/ai-uat/constraint-closeout-2026-10-10`：42场景 / 128轮，执行0、通过0、BLOCKED128。只读加载数据库模型/提示词配置时 ECONNREFUSED，未发模型请求，未写生产数据；环境失败不算通过。报告位于本地忽略目录，不纳入Git。

## 9. 修改文件

新增核心：

- `src/modules/thermal/thermal-query-state.ts`
- `src/modules/thermal/thermal-entity-resolver.ts`
- `src/modules/thermal/thermal-query-dictionary.service.ts`
- `src/modules/thermal/thermal-standard-scope.service.ts`
- `src/modules/ai/thermal-answer-validation.ts`
- `src/modules/ai/reference-query.service.ts`

接入点：

- `src/modules/thermal/{thermal-candidate.service,thermal-candidate.schemas,thermal-candidate-matcher,thermal-lookup-mode,thermal-calc.service}.ts`
- `src/modules/ai/{ai-agent.service,ai-generation.service,conversation-task,thermal-answer-facts}.ts`
- `src/modules/ai/tools/{thermal-lookup,thermal-calculate.tool,compare-products.tool,compare-solutions.tool,tool-result-normalizer,tool-runtime}.ts`

新增测试：`thermal-query-state.test.ts`、`thermal-standard-scope.test.ts`、`thermal-answer-validation.test.ts`、`thermal-answer-sse.test.ts`、`tools/thermal-constraint-flow.test.ts`。同步既有候选、Tool和查表测试。UAT修改：`scripts/run-ai-uat.ts`、`tests/uat/assertions/index.ts`、`tests/uat/cases/sales/index.ts`、`tests/uat/uat-harness.test.ts`。

规则文档：本文件、`docs/ai/business-uat.md`、`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`。

## 10. API / DB Breaking Change

无DB schema修改、无migration、无新增必填API字段、无删除字段；追加约束输入和候选验证/来源元信息，沿用现有会话JSON。身份、项目权限、审计和已发布数据边界不变。没有修改 Knowledge 上传/Recognition/Version Index、前端、PDF方案或热工公式。

存在有意的行为收紧：原 candidates 可能包含邻近/数据缺失项，现在这些不再属于正式候选，客户端需使用 nearbyCandidates 展示不完全匹配项。标准不能证明适用范围时 compliant=null，需要补条件。该行为不能声称完全无 Breaking Change，应在接口联调时确认。
