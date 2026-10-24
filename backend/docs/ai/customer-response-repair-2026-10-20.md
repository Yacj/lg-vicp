# 小格查询客服回复修复与真实 UAT（2026-10-20，交付核验至 10-21）

结论：**NOT_READY**。本轮修复已合回本地 Backend，未部署线上。原始35问最新执行为 **22 PASS / 8 PARTIAL / 5 FAIL**；不将缺资料、查询合同遗漏或PDF文件存在当作业务通过。

## 本轮直接问题与修复

用户问“保温板自身热阻 有传热8.3的保温板么”。修复前实际查询已是 PRODUCT_R、近似8.3，零命中；并非这一次丢了8.3，而是把内部诊断、前8个档位、覆盖和权限模板整段当作客服回复。

1. 将内部完整诊断与客户回复分开。Backend根据实际查询给出失败原因、原条件和可做的帮助；客户不再收到前8个最低值、后台术语或重复权限说明。存在具体规格冲突时继续如实说明，不隐藏冲突。
2. 表达层只消费执行后的可信事实，使用当前批准的DeepSeek Chat、受支持的JSON object方式；不能重新解释原问题、补工程值、改Query或操作方案。Backend校验结构、数值、指标/比较关系、作用范围及副作用声明，拒绝后使用简短真实回复。完整proposal/review仍在审计数据。
3. 真实回归定位并修复基层200mm被完整性检查重复当成保温板厚度的问题：只对已经通过原话证据校验的唯一基层毫米标量扣除覆盖要求，其余板厚、范围和否定仍独立校验。
4. 修复备用解析遗漏发布来源上下文、模型遗漏来源限制的问题：同一预算的一次语义复核只提出当前来源显示名称，Backend唯一绑定正式集合；显式文件类型仅用于否定“用户没提来源”的不完整证据，不能用它路由意图、挑来源或猜ID。建议服务消费真实查询结果，不再用通用建议覆盖失败查询，或重放已消费的条件变更。
5. 修复“正式发布参考行存在，但未关联原图”时建议服务读取空page造成HTTP500。采用已有完整发布来源证明展示参考集版本与Sheet1，不伪造页码或图片，缺少有效证明仍拒绝。
6. 服务实际要求澄清时，保存原问及同归属上下文供续问使用，不依赖Domain必须分类为CLARIFY。保留同会话、本人、端、项目、24h及版本边界。

## 用户示例真实复测

在独立浏览器上下文重复执行两次，均由真实H5发到真实DeepSeek HTTP/SSE。两次实际Query都保留 PRODUCT_R / APPROX / 8.3，零命中，没有选择、计算或报告副作用。第一次通过表达审核；第二次表达审核返回不一致的layerScopePreserved而被拒绝，使用Backend简短真实回复，未把它计作模型自由表达成功。

> 目前资料里没有保温板自身热阻接近8.3 m²·K/W的记录，部分资料也没单独列出这项参数。你可以提供具体产品名称、型号或厚度，我再帮你核对；或者告诉我是否想调整条件。

证据：[两次业务核对](evidence/customer-response-repair-2026-10-20/round-13-final/latest-question-review.json)、[第一次SSE](evidence/customer-response-repair-2026-10-20/round-13-final/latest-question/C1-T1.sse.txt)、[重复SSE](evidence/customer-response-repair-2026-10-20/round-13-final/repeat-latest/C1-T1.sse.txt)。仍有可精简空间：第一次模型给了两个帮助选项；第二次是三句，均未堆内部模板。

## 测试与证据

| 检查 | 结果 |
| --- | --- |
| Backend全量自动测试 | 2963 passed、1 expected fail、1 skipped；未将后两项计作通过 |
| Backend lint/typecheck与构建 | 隔离工作树、合回主工作区均exit 0；主工作区src逐文件与实测代码一致 |
| App自动测试 / 类型检查 / H5构建 | 155通过 / exit 0 / exit 0；本轮没有修改App源码 |
| 原始35问 | 22 PASS、8 PARTIAL、5 FAIL；原问题逐字不变 |
| 权限、身份、Revision、快照/报告回归 | 最新109项通过；Snapshot数量不变 |
| 分层计算独立复核 | 15mm、20mm的分层R、总R和K两次复核通过；公式/规则版本未改 |
| λ追问与查询条件 | 当前实际参数查询值0.3保留；数值匹配独立核对通过 |
| 单有效候选H5闭环 | 查询卡片→历史恢复→加入→Final→Confirm→Snapshot→PDF READY通过 |
| PDF事实、来源与下载 | 两页PDF的Snapshot ID、25mm、R=4、R₀=4.3068、K=0.2322及Sheet1一致；真实下载字节SHA一致 |
| PDF原生预览 / 模板 | PARTIAL / PARTIAL；弹窗灰底未证实可读，模板仍有内部占位 |

自动测试日志见同目录证据中的backend-tests-final-scope.log、main-backend-lint.log、main-backend-build.log、app-tests-final.log、app-typecheck.log、app-build.log。App构建原有Browserslist/icon警告保留。中间失败/中断日志、错误夹具日志及早期运行缺陷均保留，未改写为通过。

独立核对指算法与实际数据复算，由同一执行者完成，不冒称另一名审计员或独立人工盲测。真实模型与H5自动操作亦不等同于客户人工体验验收。

### 固定35问逐轮结论

[原始执行矩阵](evidence/customer-response-repair-2026-10-20/round-13-final/matrix.json)；[每轮完整问答、结论及证据索引](evidence/customer-response-repair-2026-10-20/round-13-final/business-review.json)。同目录保留逐轮SSE、Backend决策、截图及状态。

| 轮次 | 结论 | 核对说明 |
| --- | --- | --- |
| S1-T1 | PARTIAL | 只列名称及可查参数，未形成通俗产品概览；事实安全通过，客服体验部分通过。 |
| S1-T2 | PARTIAL | 简化追问仍是型号清单，客服表达未完全达到要求。 |
| S2-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S2-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S2-T3 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S3-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S3-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S3-T3 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S4-T1 | PARTIAL | 未取得可支持产品优缺点的正式事实，只能给核对维度。 |
| S4-T2 | PARTIAL | 缺少具体比较对象及正式同条件比较资料。 |
| S5-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S5-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S5-T3 | FAIL | 双方案比较未完成，35mm规格绑定缺正式修订依据。 |
| S5-T4 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S5-T5 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S5-T6 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| S5-T7 | PARTIAL | 已确认单方案可入队生成PDF，但正式模板占位和预览验收未解决。 |
| R1-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R1-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R1-T3 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R2-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R2-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R2-T3 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R3-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R3-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R3-T3 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R4-T1 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R4-T2 | PASS | 已逐轮核对实际查询条件、来源、返回记录/状态与页面证据，目标在本轮可核验范围内完成。 |
| R5-T1 | PARTIAL | 只有25mm行可作为正式候选；35mm/25mm规格绑定冲突保留。 |
| R5-T2 | FAIL | 不足两个合格正式候选，比较未完成。 |
| R5-T3 | FAIL | 复合选择含无效分层候选，按身份门禁整体拒绝。 |
| R5-T4 | PARTIAL | 给出了当前候选事实，前置复合操作失败，尚无Final。 |
| R5-T5 | PARTIAL | 如实说明没有Final及新快照/报告，原要求的待确认状态未形成。 |
| R5-T6 | FAIL | 未形成Final，没有可执行的确认闭环。 |
| R5-T7 | FAIL | 前置Final/Snapshot缺失，没有生成该会话的正式报告。 |

### 运行历史与失败保留

目录round编号是执行批次，不表示每批都运行35问。全35问批次为round-04、05、12、13；round-07只运行S5的7问；round-06、08仅初始化而没有业务提问，记NOT_RUN。其他批次为定向复测。详细次数见[执行索引](evidence/customer-response-repair-2026-10-20/execution-index.json)。

在round-05中，基层/来源问题引发S5连锁失败，保留18 PASS / 7 PARTIAL / 10 FAIL。round-10/11真实复现HTTP500及栈证据，随后修复。round-12重复建议会话虽返回同一25mm行，但实际漏了Excel来源范围，另判FAIL并保存；不能以显示结果巧合相同认定通过。最终来源范围补测和原35问已再执行。

当前产品概览按“对客户通俗有帮助”审阅，S1-T1只列名称/参数记PARTIAL。之前仅按功能与事实安全审阅的23/7/5文件单独保留为business-review-functional-v1.json，当前口径为22/8/5。原始问题、工程预期及门禁没有修改或放宽。

## 未解决事项和上线门槛

- 产品介绍、简化追问和部分选型建议仍过长，通用无结果表达本轮改善不代表所有客服回复已自然。需继续在知识库事实范围内做概览、参数追问和按参数找产品的连贯体验；不能用空缺的用途/防火/对比资料编宣传语。
- 35mm分层原表仍绑定25mm规格，用户确认没有正式修订依据。该行按原值保留并排除正式选择，S5/R5双方案比较不能完成。需要资料负责人正式修订和版本方案，不能开发代改。
- A2-2基层15mm/保温190mm、A3-3 λ=0.0012原资料疑点继续保留标注，没有正式勘误。
- 当前正式来源没有标准限值、适用性或同条件比较事实，相关咨询只能解释资料限制，不能补出合规或优缺点结论。
- 已批准免责声明的[模板变更提案](approved-report-template-change-2026-10-19.json)已存在，但未发布到生产模板；真实PDF仍有“免责声明正式措辞待甲方确认”。本轮没有直接修改生产模板或历史报告。
- 原生浏览器PDF预览仅确认取文件成功，截图灰底，未达到阅读验收；本地两页渲染无裁切不能替代实际预览。仍需定位实际浏览器行为并完成可读验收，手机与人工盲测未执行。
- 服务澄清flag保存/恢复有正负单元覆盖，但最终补测第二轮已成功执行，没有触发该flag，不能据此声称其全部多轮真实路径都通过。

## 修改文件清单与交付

本轮新增/修改24个自有文件，SHA与补丁见[变更清单](evidence/customer-response-repair-2026-10-20/change-manifest.json)、[修复补丁](evidence/customer-response-repair-2026-10-20/repair.patch)。合回前校验目标仍是原始SHA，只复制自有改动；其他任务已有改动全部保留。主工作区Backend src与实测代码逐文件一致。

| 文件 | 类型 |
| --- | --- |
| `src/modules/ai/ai-generation.service.ts` | MODIFIED |
| `src/modules/ai/solution-candidate-query.service.ts` | MODIFIED |
| `src/modules/ai/thermal-answer-validation.ts` | MODIFIED |
| `src/modules/thermal/reference-query-diagnostics.ts` | MODIFIED |
| `src/modules/thermal/reference-query-response.ts` | ADDED |
| `src/modules/ai/reference-query-narrative.ts` | ADDED |
| `src/modules/ai/reference-query-narrative.test.ts` | ADDED |
| `src/modules/ai/tools/thermal-lookup.tool.test.ts` | MODIFIED |
| `AGENTS.md` | MODIFIED |
| `README.md` | MODIFIED |
| `.cursor/rules/30-ai-and-reports.mdc` | MODIFIED |
| `.agents/skills/lg-backend/references/ai-and-reports.md` | MODIFIED |
| `scripts/natural-dialogue-uat/matrix.mjs` | MODIFIED |
| `scripts/natural-dialogue-uat/customer-query.mjs` | ADDED |
| `src/modules/thermal/semantic-query.ts` | MODIFIED |
| `src/modules/thermal/semantic-query.test.ts` | MODIFIED |
| `src/modules/ai/semantic-query.service.ts` | MODIFIED |
| `src/modules/ai/product-parameter-generation.test.ts` | MODIFIED |
| `src/modules/ai/source-query-review.ts` | MODIFIED |
| `src/modules/ai/missing-source-query.test.ts` | ADDED |
| `src/modules/ai/solution-advice.service.ts` | MODIFIED |
| `src/modules/ai/solution-advice.service.test.ts` | MODIFIED |
| `src/modules/ai/query-clarification-context.ts` | MODIFIED |
| `src/modules/ai/query-clarification-context.test.ts` | MODIFIED |

工程公式、已发布计算规则、生产知识资料、历史Snapshot均未改。没有切换正式模型，没有关闭身份、来源、权限、确认或报告门禁，没有生产发布。测试读取只读来源副本，在随机独立数据库、Redis/队列和OSS前缀运行，sourceBusinessWrites=0、syntheticEngineeringData=false；清理及独立核验结果见cleanup-independent-check.json。

后续优先顺序：继续收短产品概览/参数续问和建议回复，定位PDF实际预览；按甲方批准文案走正式模板版本发布流程；取得35mm正式规格修订依据后重跑双方案闭环，最终再完整执行35问及人工验收。未满足这些门槛，保持NOT_READY。
