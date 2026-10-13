# 高频场景矩阵覆盖与补测报告

日期：2026-10-13。本次收到的原矩阵已保存为 [高频场景原矩阵](high-frequency-scenario-matrix-2026-10-13.md)。其中“高频”是业务优先级，不是用户日志概率。测试 fixture 只用于关联断言，不作为当前生产数据。

后续最后收口已新增只读合规、报告硬授权/确认快照报告路径、三类域意图纠正及正式产品搜索/后台别名集合约束，详见 [本轮实施与复测](domain-turn-closeout-2026-10-13.md)。本文件下面的“尚缺能力”与1976条统计保留为上一轮记录，不代表当前代码未实现；真实HTTP/SSE仍需依赖恢复后验收。

## 本轮发现并修复

首次新增路由合同 46 条实际出现 11 个失败。修复的是目标与引用边界，没有按“薄抹灰0.3”添加特判，也没有改 Parser/Matcher 主结构、公式、数据库、Snapshot、报告生成或前端。

| 问题 | 根因与修复 |
| --- | --- |
| P06/S2.1 带 K 条件的“有哪些做法”被当成知识解释 | 领域名词早于明确目标。已解析指标 + 明确请求候选优先，独立施工/节点解释才走知识路径 |
| P13/S5.2 “K越小越好吗/一定省钱吗”被误查表 | 指标词被当作数值目标。概念问句保持解释，无 QUERY/SOLUTION/CALCULATE 授权 |
| P19 窗洞口处理被误解为查档位 | 独立节点/施工处理目标走知识解释，不因“保温”抢入 thermal |
| S3.2/P31 “这个数值哪一页/从哪里来”未稳定绑定来源 | 补齐来源目标表达；只读使用当前候选、当前确认档位与真实页标 |
| S5.4 “完整热工表”未进入只读原页 | 完整参数表/热工表/原表共用只读 Resolver；不重查、重排、刷新 revision |
| S6 基层追问可能把基层 200mm 当作板厚 | 只读引用基于当前候选中的真实基层；基层厚度与板厚分别核验，不设新查询硬条件 |
| 多基层引用的一个厚度约束被全局套到另一基层 | 多项引用逐个片段分别 Grounding，各自唯一对应后合并 ID；无法分配时澄清 |
| “两个结果”可能用单个候选代替，或猜前三项中的两项 | 当前恰好两项才可直接读取；数量不符要求明确序号/基层，不补旧列表 |
| S4 省略澄清的分类器只收到“是否有候选” | 增加 previousQuery 权威上下文供受控分类理解省略追问，不授予历史计算/选择权限 |

## 首轮 P01–P32

`high-frequency-domain-matrix.test.ts` 覆盖全部 32 个设计题，验证 Fast Path 不作错误的高置信路由。开放表达可以明确委托受控语义模型；这类测试只证明“没有错误短路”，不证明远程模型已经正确分类，也不证明产品/标准/知识业务已经完成。

| 类别/ID | 本地证据 | 尚缺证据/能力 |
| --- | --- | --- |
| 产品 P01–P04、P22 | 目标分类或委托边界；不授权方案状态写入 | P01 搜索产品 Tool 仍未实现；其余正式产品/规格/知识来源的完整业务输出 NOT RUN |
| 材料比较 P05、P26 | 不把普通比较/新主题当 Selection；允许委托语义分类 | 真实已审核材料规则、成本证据及模型输出 NOT RUN；无价格不能宣称性价比 |
| 查表 P06–P12、P23–P25、P27 | 查询目标/指标合同、只读对比与原 Query Service/硬条件回归 | 实际库存、正式族映射及现场命中数 NOT RUN；不能据 fixture 宣称生产有方案 |
| 概念/知识 P13–P14、P19–P21、P32 | 不抢入动作/计算；独立施工和节点不改查询 | 解释质量、真实知识出处、印刷页阅读体验 NOT RUN |
| 计算 P15–P16 | 本轮授权 + 唯一正式对象 + 既有计算守卫/引擎测试 | 当前发布配置及真实生成计算记录的 HTTP/SSE NOT RUN |
| 合规 P17–P18、P28 | COMPLIANCE_CHECK 与 CALCULATE 分离；不凭 K 自动达标 | 完整自然语言标准发现/选择/适用范围交互仍属后续能力，真实标准数据 NOT RUN |
| 报告 P29–P30 | 分类或委托边界；既有确认/快照门禁测试继续通过 | 本轮未改报告/PDF；真实报告生成 NOT RUN |
| 来源 P31 | REFERENCE_VIEW/DETAIL 只读目标，允许来源表达而不发新候选 | 当前真实资料、撤回与签名服务的完整 HTTP/SSE NOT RUN |

## 多轮 S1–S7

| 故事 | 本地实际执行 | 状态 |
| --- | --- | --- |
| S1 产品→查表→详情→原页 | 从已呈现 Candidate Result 实际执行非 Agent 服务的详情→原页；同 ID/optionId、整页模型、revision 不变 | SERVICE PASS（产品发现和真实首轮仍未验收） |
| S2 查表→20mm细化→1/3比较→选用→就这样 | 实际 Query Service + Candidate Result + Grounding + 懒激活/既有 mutation；内存事务使用真实 Drizzle WHERE 编译进行隔离。查表无 state，细化 revision+1，比较不写 Selected，选择才激活，“就这样”不 Confirm/不 Snapshot | SERVICE PASS；外部模型/DB/来源读取为明确替身，不是 UAT |
| S3 参考值→原页→重新算→上海住宅合规 | 来源目标、执行计算授权和合规类别分离；原计算与标准范围守卫继续通过 | PARTIAL；该故事完整真实四轮 NOT RUN |
| S4 指标澄清→80mm→换材料主题 | 已补分类器 previousQuery 协议；既有指标、局部厚度和新主题回归继续执行 | PARTIAL，存在下述口径差异；远程语义与完整四轮 NOT RUN |
| S5 有候选→概念解释→节点→第三个完整表 | 实际动作 Parser 对两种非动作返回 null；实际只读服务恢复第三项，lookup 不变。Agent prepareStep 也验证不强制 thermal | SERVICE PASS；真实知识答案 NOT RUN |
| S6 45mm不同基层→空心砌块→加气混凝土→两项原表 | 实际 Resolver/完整 renderModel/optionId 绑定：A3-2 为190mm、K0.294/R₀3.398；A3-4为200mm、K0.248/R₀4.040。各自绑定，revision 不变，拒绝数量歧义 | SERVICE PASS（关联 fixture；productR=1.5 是明确的合成绑定字段，不宣称原资料值） |
| S7 换版/旧revision/跨用户项目/模型故障 | 复用并扩展旧 option、版本/发布撤回、过期、权限拒绝、动作模型故障合同；原权限服务与 activation 事务测试继续通过 | SERVICE PASS；真实数据撤回、权限事务及 HTTP/SSE 四组合 NOT RUN |

S6 原句“把两个结果都给我看原表”在最近列表有三项时不会猜哪两项。用户明确两种基层后逐项绑定；若两条来自不同历史查询且已不在最近可见集合，则说明限制，不能重新绑定旧 ID。这保留原实施 Prompt 的 LATEST_VISIBLE 冻结边界。

### S4 口径差异

本地实际调用 `normalizeConversationLookupQuery`：`保温板热阻8.3有么` 当前被视为明确 PRODUCT_R≈8.3，不强制指标澄清；后续 `是板自身的` 仍保留 PRODUCT_R、8.3 与原容差，未观察到目标丢失。矩阵 S4.1 要求先区分产品 R/整墙 R₀，属于未关闭的验收差异。

本轮补充了领域分类器所需的历史权威条件，没有用模型替身宣称这四轮已完成，也没有修改冻结 Parser 的术语合同。[AGENTS.md](../../AGENTS.md) 的现有约束是“Parser/Matcher主结构冻结，后续修改必须先有真实失败UAT Case。”隔离真实环境恢复后应验证该业务歧义，再收口口径；本轮不得计作 S4 UAT PASS。

## 脱敏诊断字段

在现有消息 backendDecision 内补充，不新增 REST/数据库结构：

- domainIntent、answerContract、mutation、parserSource、queryParserSource。
- toolRoute：实际 Agent 工具结果事件，以及已执行的 backend reference_read/reference_query/clarify/solution_action 路径。
- queryLifecycle、queryChangedFields、referenceQueryRevisionBefore/After。
- candidateIdList、candidateSnapshotSource、referencePageIds。
- solutionStateMutated：有写入意图且起止状态 ID/version 变化；只读意图固定不归因状态写入。事务审计仍为写入事实源。
- factValidationCode：VALID_FACTS、CANONICAL_FALLBACK、CONFIRMED_SOURCE 或 NOT_EVALUATED；未执行门禁不冒充通过。

字段只含枚举、标识、字段名与校验状态，不记录大段原话、密钥或签名 URL。真实运营日志和全部 generation 分支的 HTTP/SSE 观测仍需隔离环境验收。

## 本次文件

新增原矩阵与本覆盖报告，新增 `high-frequency-domain-matrix.test.ts`。修改 DomainTurnDecision/分类器上下文、只读引用选择、基层简称归一、Agent/generation 脱敏诊断；扩展既有 Resolver、Agent 首步、SolutionState 事务、分类器和事实测试。没有新增 expected-fail 或跳过失败合同，没有删除旧测试。旧工作区和 admin-web 未修改。

## 实跑结果

| 检查 | 结果 |
| --- | --- |
| 新矩阵及相关集中回归 | PASS：6 文件、142 条（外部传输/部分依赖使用替身） |
| 全量 `pnpm test --maxWorkers=4` | PASS：179 文件、1976 条通过，1 文件/1 条原有跳过；无新增 expected-fail |
| `pnpm lint` | PASS（诊断 union 类型错误已修复后重跑） |
| 本轮新/相关测试独立 tsc | PASS；临时配置已删除 |
| `pnpm build` | PASS（诊断类型修复后重跑，退出码 0） |
| `pnpm db:check` | PASS：Everything’s fine，只有静态元数据检查 |
| PostgreSQL 只读连接 | BLOCKED：最新 `select 1` 探测返回 ECONNREFUSED；未写数据库 |
| 隔离真实 HTTP/SSE UAT | BLOCKED：PostgreSQL 连接拒绝，未计作验收通过 |
| 真实远程模型/对象存储/当前产品标准与命中数 | NOT RUN |

全量 PASS 不等于 32 条业务题、7 个故事或 Agent开关×模型正常/超时×候选0/1/N×权限/撤回组合已完成真实验收。下一步仍是恢复隔离依赖，优先实跑 S1/S2/S5/S6/S7，再验证 S4 口径，并单独补正式产品发现与完整规范咨询。
