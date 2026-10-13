# Domain Turn 最后收口实施与复测

日期：2026-10-13。事实依据为当前工作树及本轮实际执行的命令，不以旧覆盖报告的 PASS 或附件名代替复测。保留上轮修改及已有安全门禁；没有修改 B/C 端、数据库数据、schema、迁移、Matcher 或计算公式。

## 根因与最小范围

| 阶段 | 当前代码根因 | 修复文件/行为 | 迁移 |
| --- | --- | --- | --- |
| 1 / P0 | reference-query 把 COMPLIANCE_CHECK 与 CLARIFY 合并，generation 始终短路成澄清 | 新增 `compliance-read.service.ts`，接入 `reference-query.service.ts`、`ai-generation.service.ts`；当前有权项目/显式范围/已知范围→正式有效标准→适用范围→待核验 K。不执行热工计算或发布候选 | 无 |
| 2 / P0 | generate-report 仅有 description 约束；旧快照/历史产品选择即可走创建、排队，旧产品快照也能替代方案报告 | 新增 `report-authorization.ts`、`solution-report.service.ts`；修改 `generate-report.tool.ts`、generation/Agent/runtime，入口先授权。方案只读取当前 CONFIRMED 的不可变 SolutionSnapshot，转换既有 DocumentModel，再进入模板报告冻结及 Worker 渲染 | 无 |
| 3 / P0 | 缺目标值指标仍被判为查询；概念比较落入热工分支；同厚度比较没有多候选目标，基层 Resolver 抢成单条详情 | 修改 `ai-domain-turn-decision.ts/.service.ts`、`reference-candidate-selection.ts`、generation；概念关系优先解释，裸指标先明确查看/新目标，同厚度候选比较需唯一对象。24h/revision/当前来源拒绝规则沿用 | 无 |
| 4 / P1 | get_product_data 是 ID 阅读器，分类标签没有业务搜索；产品字段未传至模型/比较维度；同一后台别名映射多个体系被当成歧义ID | 新增 `product-read.service.ts`，get_product_data 增加 SEARCH/READ；修改 normalizer、compare-product/service、比较 Tools、generation；正式产品字段/规格/来源同源，后台显式别名可签发 systemIds 集合硬条件 | 无 |

必要报告接口仅新增内部 `TemplateReportInput.solutionDocumentModel`。`report-snapshot.service.ts` 的专用分支只读取模板，工程值、项目、选用、构造、备选和参考页来自 DocumentModel，不读现行产品参数、不重查 Candidate、不重算。其他报告流程继续使用原路径。没有用普通产品报告替代方案 PDF，也没有生成实际 PDF 文件冒充验收。

## 阶段测试与边界

阶段 1：`compliance-read.service.test.ts` 8 条，加既有 `thermal-standard-scope.test.ts`。覆盖参数满足/不满足正式限值、只问缺失地区、无有效标准、多标准选择、适用范围不覆盖、撤回引用、明确本轮参数。不把 lastReferenceLookup 的 K≈0.3 筛选条件当工程实测值；本轮用户输入只作条件核验并明确标注。K 限值不使用查表容差，不硬编码城市阈值。结果只证明该标准 K 指标，不等于整个工程验收合格。

阶段 2：`generate-report.authorization.test.ts` 覆盖所有非 REPORT_REQUEST 类别、历史确认不能授权、同用户/同会话本轮服务端 UI 确认、外用户授权标识、跨会话快照、旧产品快照不能替代方案；首入口拒绝时未运行 Tool wrapper，未创建快照/报告/任务或发送 report_queued。`solution-report.service.test.ts` 覆盖缺状态、未确认、跨项目与确认后 DocumentModel 路径，以及Snapshot objectKey→Worker pageImageObjectKey适配：只有来源重验可用的图片提供加载键，失效页保留冻结表模型，签名URL不入报告快照。`solution-report-snapshot.test.ts` 执行真实组装和 HTML 渲染，核验深复制及冻结数值，不调用工程事实查询。队列与持久化使用明确替身，并非实际 PDF/OSS 验收。

阶段 3：先扩展 domain、Agent prepareStep、Resolver 测试，实际出现 12 个失败，再修复。覆盖“总热阻”“那整墙热阻呢”“看看产品热阻”、双 R 区别/不同、同一/相同板厚比较、指定当前项参数、新目标查询。裸指标追问不调用目录或候选查询、不复制 K 目标；同厚度比较只有最近恰好两条且板厚相等时直接引用，数量/厚度不匹配要求指定对象。纯概念解释不恢复旧方案或报告等待任务，走知识/普通解释路径；不写原 QueryState/Candidate/SolutionState。

阶段 4：`product-read.service.test.ts`、`product-search.tool.test.ts`、`compare-product.test.ts` 和既有 schema/normalizer 回归，验证无 ID 搜索、正式别名、字段/规格来源、猜 ID 的读取/比较拒绝、概念解释不能产生产品选择等待、缺成本不编造价格。目录仅 ACTIVE，规格仅 PUBLISHED/有效，关联资料重验当前发布版本及项目范围；没有签名 URL 或内部密钥输出。初次非 Agent 产品咨询也有后端正式搜索结果，不只是 PRODUCT_DISCOVERY 标签。

familyCode 仍没有新建；复用后台 `knowledgeAliases` 的启用 GLOBAL 配置，term 必须精确对应正式体系全名/编码。同一 alias 显式绑定多个正式体系才成为集合硬条件。未配置/不可靠映射继续澄清；没有批量回填、名称 LIKE 推导族成员或无约束宽查询。客户可以使用后台维护的简称，资料缺失时仍需业务维护正式映射。

## 实际路径与状态记录

| 场景 | 允许路径 | Candidate revision / SolutionState | report_queued |
| --- | --- | --- | --- |
| 合规资料齐全或缺失 | backend:compliance_read；正式标准只读、来源/范围输出 | 不变 / 不写 | false |
| 裸指标或引用歧义 | backend:clarify | 不变 / 不写 | false |
| 指标概念解释 | backend:knowledge 或普通解释；不强制 Thermal，不恢复旧 Report 等待 | 不变 / 不写 | false |
| 当前候选比较 | compare_solutions / Reference Resolver；参数事实同候选 | 不变 / 不写 Selected | false |
| 产品咨询/材料比较 | backend:product_search；正式产品字段/有效知识/已审核比较规则；比较只使用本轮明确对象 | 不变 / 不写 | false |
| 无报告授权的模型调用 | execute 入口结构化 REPORT_AUTHORIZATION_REQUIRED | 不变 / 不写 | false；零快照/报告/队列副作用 |
| 已授权且已确认的方案报告 | SolutionSnapshot→DocumentModel→report_snapshot→既有 Worker | 不变 / 不写 SolutionState | 队列成功后 true；本轮只有服务替身验证 |

消息 backendDecision 增加 toolUsage（thermal/knowledge/report）、reportQueued、compliance（状态/标准/适用范围/参数来源），沿用 toolRoute、queryChangedFields、revision 起止值、candidateIdList、referencePageIds、solutionStateMutated。Agent SDK 返回的被拒绝 Tool 调用也记录尝试路径；排队成功和调用尝试分别记录。正式合规结果标 COMPLIANCE_VERIFIED，未判定不伪称事实校验成功；产品确定性读取标 CATALOG_VERIFIED。

## 实跑检查

| 命令/依赖 | 结果 |
| --- | --- |
| `pnpm lint` | PASS，诊断联合类型修复后重跑 |
| 定向 `pnpm vitest run`（15 文件） | PASS，174 条；图片适配后另跑3文件26条通过（重叠用例不累计） |
| 最终 `pnpm test --maxWorkers=4` | PASS，185 文件/2034 条通过，1 文件/1 条原有跳过；总2035条，108.15秒 |
| `pnpm build` | PASS，退出码0 |
| `pnpm db:check` | PASS，Everything's fine；静态检查，不写数据 |
| `git diff --check` | PASS |
| PostgreSQL只读连接（后续.env复测） | PASS；当前账号没有CREATEDB权限 |
| Redis CONNECT/PING（后续.env复测） | PASS；未写业务键 |
| OSS（后续.env复测） | 签名HEAD与当前公共原页实际下载PASS；写入NOT RUN |
| 当前正式远程模型（后续.env复测） | 单次JSON连接请求PASS；多轮业务模型验收NOT RUN |
| 隔离真实 HTTP/SSE 多轮 UAT（最新复测） | 138/138轮已执行：18通过、12警告、108失败、0阻塞；业务验收未通过；独立清理核验PASS |

没有新增 it.fails、跳过失败用例或迁移；全量原有的一条跳过单独计数。旧 S4“保温板热阻8.3”术语口径未在本轮改 Parser；本轮修复的是已复现的无数值指标切换、概念解释及多候选比较。

下一步在隔离 PostgreSQL/Redis/已准入模型/OSS 环境执行：合规有/无/多标准、地区/结构缺项、候选撤回/旧 revision；Agent 开关下三类误判；普通问答诱导报告零副作用；明确产品对比报告兼容；确认快照后的方案 PDF（与快照数值、来源页、对象权限逐项比对）。本轮未部署，未修改生产/测试数据库数据。

后续读取更新后的.env进行了真实线上只读复测，见 [连接与数据核验](online-readonly-recheck-2026-10-13.md)。原ECONNREFUSED、CREATEDB权限42501及新库连接28000均已解除。最新真实HTTP/SSE完整矩阵已执行但未通过，见 [完整复测与失败归因](uat-access-recheck-2026-10-13.md)；不能将本地2034条通过或真实调用完成写成业务验收通过。
