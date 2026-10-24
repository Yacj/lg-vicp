# 小格产品咨询、参数续问与真实 UAT（2026-10-21）

结论：**NOT_READY**。本轮修复已合回本地 Backend，未发布线上。最终冻结代码真实执行原始35问：**23 PASS / 7 PARTIAL / 5 FAIL**。自动测试通过不代表自然语言业务已经稳定。

## 用户确认的资料范围

用户已确认暂无产品手册，按现有知识库作简短介绍。因此只介绍已发布资料中的名称、类型与可查参数，不从名称括注、材料层表或模型常识补写用途、特点、组成和优势。现有158个有效正文块经核对仍主要是热工表格片段，不能作为正式产品说明正文。

35mm分层参考行绑定25mm规格，以及A2-2、A3-3等原表疑点没有正式勘误；原值、来源和冲突继续保留，不能修改工程资料来使测试通过。

## 根因与修改

1. 产品介绍与数值参数共用表达路径，模型可能省略已被上下文记作“展示”的字段，也可能把名称括注扩写成组成。现在技术参数由Backend按对象、字段及来源展示；离散厚度不改成连续供货范围。没有正式介绍正文时直接给简短事实，不依赖另一模型的“已证实”自评。真实中间轮曾出现无依据的“采用真空绝热板”，原始失败与审核漏判已保留。
2. 产品反查与独立λ查询分属不同上下文。模型将“调整筛选”标成REFINE或CURRENT_TURN时，旧代码无法接续，随后裸数值也丢失目标。现在从同用户、客户端、项目且24h有效的实际查询恢复parameterFilter，只合并当前有原话证据的修改；未改比较符时沿用旧比较符。换话题、新对象、计算、方案操作和不一致来源不走此合并。
3. 比较符存在两份提取逻辑，等值/不等值可能混淆。统一封闭标量比较提取器，明确等于、=；不等于、!=、≠保持未决，不能转成等值或单侧范围。仅更新原有AST白名单中的明确节点，检查器和业务门禁没有关闭。
4. λ参数服务把“该口径无数据”与“名称不存在”混为一谈。现在分开核验名称与subjectType；同名材料层不能成为产品当量命中。模型只截取型号时，仅用当前原话中明确出现且在已授权集合中唯一的完整名称补足；多名称、未知名称或未写完整名称时不猜。执行后的完整Query保留用于审计和续问。

本轮没有为失败原句新增意图关键词/专用正则，没有修改正式数据、公式、候选身份、Revision、Confirm、Snapshot或报告授权；没有切换正式模型。

## 真实复测与限制

真实Edge H5连接隔离资料副本与当前批准的DeepSeek Chat HTTP/SSE；工程JSON按原值复制，源库只读，无合成工程数据。模型使用受支持的JSON object。不是Mock或预设Semantic JSON。

- 最终新增问法7轮：5 PASS / 2 PARTIAL。实际λ依次保留=0.005、<0.021、<0.026，返回值逐项满足；换话题后没有复活旧查询。多结果列表仍偏长，未当作完整体验通过。
- 产品9轮完整链在round-06执行并逐轮审阅：7 PASS / 2 PARTIAL。后续修改只涉及独立λ服务的名称/口径诊断，最终代码另跑新增7轮及原35问。
- 390px移动端的完整产品名不再误报未知；独立产品当量λ缺资料时保留缺失，不借用材料层值。回答仍有覆盖和口径尾注，体验记PARTIAL。
- 本轮同一自然选择原句曾先成功、后被模型误判为计算。两次错误提案均被门禁拒绝；后续偶然成功不能证明稳定。保留round-07的S5-T4失败，本项未完成稳定性验收，不能归咎为仅缺正式资料。
- 单有效候选真实按钮7步通过：查询卡片、历史恢复、加入、Final、显式点击Confirm、冻结Snapshot、显式点击PDF后READY。共2个快照、2份报告，均来自S5及单方案测试的显式确认；查询不自动建快照或报告。
- 实际两页PDF与Snapshot、25mm、产品层R=4、总R₀=4.3068、K=0.2322及Sheet1一致，下载字节SHA一致。本地两页渲染可读；原生预览截图仍为灰底，故PARTIAL。发布模板仍含“免责声明正式措辞待甲方确认”，已批准文案提案尚未发布，故PARTIAL。

独立核对指以实际数据另行复算和校验，由同一执行者完成；新增问法也由同一执行者编写，不冒称客户人工盲测。

## 自动检查与权限

| 检查 | 结果 |
| --- | --- |
| Backend全量 | 2997 passed，1 expected fail，1 skipped；未把后两项计作通过 |
| Backend迁移检查、lint、构建 | exit 0；主工作区合回后的lint/构建亦exit 0 |
| App测试、type-check、H5构建 | 155通过 / exit 0 / exit 0；本轮未修改App业务源码 |
| 真实权限回归 | 113项通过；其他用户、跨客户端、未认证、重复确认及报告门禁，快照数量不变 |
| 分层公式独立复算 | 15mm与20mm的逐层R、总R和K通过；计算规则版本未改 |
| 查询不变量 | 冻结原问SHA不变、执行期源码无漂移、λ筛选无越界、S3保留K=0.3及III型 |

一次中间全量测试出现report-context-snapshot冷加载30秒超时，失败日志保留；未修改超时或预期，最终完整重跑通过。误用命令、停止的运行和中间失败版本均保留，不将它们改写为通过。App构建原有Browserslist/icon警告保留。

## 固定35问逐轮

原始问题和工程预期不改；S1按用户确认的“现有知识库简短介绍”验收。每轮完整问答、SSE、Backend状态和截图见最终证据目录。

| 轮次 | 结论 | 说明 |
| --- | --- | --- |
| S1-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S1-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S2-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S2-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S2-T3 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S3-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S3-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S3-T3 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S4-T1 | PARTIAL | 缺少正式优缺点正文，只能提供核对维度；未杜撰，但咨询帮助仍有限。 |
| S4-T2 | PARTIAL | 缺同条件竞品对比资料，未形成所要求的完整比较。 |
| S5-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S5-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S5-T3 | FAIL | 双方案比较未完成；35mm参考行绑定冲突缺正式修订依据，且本轮只收到泛化澄清。 |
| S5-T4 | PARTIAL | 本轮选择结果另见实际决策；上一冻结版本同问被模型误判为计算且两次提案均失败，稳定性未完成验收，不以偶然成功判整体通过。 |
| S5-T5 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S5-T6 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| S5-T7 | PARTIAL | 真实单方案报告已创建；模板内部占位及原生PDF预览尚未完成验收。 |
| R1-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R1-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R1-T3 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R2-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R2-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R2-T3 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R3-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R3-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R3-T3 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R4-T1 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R4-T2 | PASS | 逐轮核对真实查询、数值/口径、来源、状态及页面；原问所需行为在可核验资料范围内完成。 |
| R5-T1 | PARTIAL | 仅25mm正式参考行可用；35mm绑定25mm规格的冲突继续保留。 |
| R5-T2 | FAIL | 不足两条有合格正式身份的候选，未完成比较。 |
| R5-T3 | FAIL | 复合选择包含不可用分层候选，未完成要求的Final操作；保留原子校验。 |
| R5-T4 | PARTIAL | 前置复合选择未成立，不能完成最终方案核对。 |
| R5-T5 | PARTIAL | 正确未建快照/报告，但所要求的Final待确认状态尚未形成。 |
| R5-T6 | FAIL | 前置Final未形成，本会话没有可执行的正式确认闭环。 |
| R5-T7 | FAIL | 本会话没有Final/Snapshot，未生成该会话的正式PDF。 |

## 修改文件

本轮运行代码、测试及约束共21个文件，另有本报告与证据。已核对主工作区与实测源码等价（仅既有CRLF及生成pages.json末尾换行差异），其他任务改动保留。

- `src/modules/ai/ai-domain-turn-decision.service.test.ts`
- `src/modules/ai/ai-domain-turn-decision.service.ts`
- `src/modules/ai/ai-generation.service.ts`
- `src/modules/ai/parameter-continuation.ts`
- `src/modules/ai/product-answer.ts`
- `src/modules/ai/product-consultation-context.ts`
- `src/modules/ai/product-filter-continuation.test.ts`
- `src/modules/ai/product-narrative.ts`
- `src/modules/ai/product-parameter-focus.ts`
- `src/modules/ai/product-parameter-presentation.ts`
- `src/modules/ai/product-parameter-query.ts`
- `src/modules/ai/product-parameter-read.service.test.ts`
- `src/modules/ai/product-parameter-read.service.ts`
- `src/modules/ai/product-presentation.test.ts`
- `src/modules/ai/product-read.service.ts`
- `AGENTS.md`
- `README.md`
- `.cursor/rules/30-ai-and-reports.mdc`
- `.agents/skills/lg-backend/references/ai-and-reports.md`
- `scripts/semantic-matching-exemptions.json`
- `docs/ai/semantic-matching-policy.md`

## 未解决事项与上线门槛

1. 正式35mm规格/参考行绑定缺甲方修订，双候选比较与R5闭环未通过；继续保留冲突，不伪造绑定。
2. 当前DeepSeek的自然操作分类仍偶发错误。需要对选择/计算目标进行更稳定的合同核对与真实多轮复测，不能关闭门禁或用单次成功替代。
3. 多结果参数回答、独立λ口径缺失提示和S4比较咨询仍有机械/冗长表达；不是所有自然问法均已通过。
4. 发布模板的内部占位需按已批准提案走模板版本发布；不能改历史快照。原生PDF预览仍需证明可读。
5. 缺正式产品说明及同条件竞品/标准资料的项目继续如实说明；产品用途、优势、达标结论不能由模型补造。

当前不满足全部35问、稳定自然操作及完整预览验收门槛，不能给READY；本轮也不能声明“没有新增回归”。

## 证据入口

- [最终逐轮35问及评级](evidence/product-consultation-repair-2026-10-21/round-08-final/fixed35-business-review.json)
- [原始执行矩阵](evidence/product-consultation-repair-2026-10-21/round-08-final/matrix.json)
- [新增问法与查询条件核对](evidence/product-consultation-repair-2026-10-21/round-08-final/new-phrasing/business-review.json)
- [公式、查询和快照独立核对](evidence/product-consultation-repair-2026-10-21/round-08-final/independent-audit.json)
- [PDF事实、下载及预览审阅](evidence/product-consultation-repair-2026-10-21/round-08-final/pdf-business-review.json)
- [真实权限检查](evidence/product-consultation-repair-2026-10-21/round-08-final/security-acceptance.json)
- [完整补丁及文件SHA](evidence/product-consultation-repair-2026-10-21/change-manifest.json)
- [各中间轮次索引](evidence/product-consultation-repair-2026-10-21/execution-index.json)
- [隔离资源独立清理检查](evidence/product-consultation-repair-2026-10-21/cleanup-independent-check.json)
- [已批准免责声明变更提案](report-disclaimer-proposal-2026-10-19.md)
