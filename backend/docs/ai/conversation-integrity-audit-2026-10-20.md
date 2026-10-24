# 小格四组真实对话只读审计（2026-10-20）

结论：**整体自然对话 NOT_READY；此前整体 READY 推荐撤回。** 四组人工问题中，第一组部分满足（参数有据、介绍不足），其余三组未完成用户目标。原35问执行记录及原始证据保留，但它们不足以支持自然对话整体上线合格。

用户确认还有其他任务正在修改 Backend，本轮仅做只读审计，未改任何运行代码、未新增测试场景、未调用模型或新建会话、未发布、未写生产数据。此报告可作为现有修复任务的交接依据，不代表其补丁已完成验收。

## 证据范围与版本

- 已在**生产服务器上**使用现有配置连接数据库，强制只读，找到了四组报告对应的消息。消息ID、正文及最终决策metadata与首次配置源读取逐项一致，见[生产会话](evidence/conversation-integrity-2026-10-20/production-original-cases.json)、[来源绑定](evidence/conversation-integrity-2026-10-20/database-binding-proof.json)。没有读取用户所提zip，也不依赖转述的源码行号。
- 香港时间 **2026-10-20 09:57:13** 读取了10个相关线上编译文件，均与2026-10-19已发布版本SHA256一致，API/Worker仍为该次重载PID。见[发布版本核验](evidence/conversation-integrity-2026-10-20/published-version-proof.json)及同目录published-code。
- 当前工作区已有另一任务的后续改动，另存[逐文件快照](evidence/conversation-integrity-2026-10-20/working-version-snapshot.json)。本报告区分线上缺陷与尚未发布/复测的本地补丁，未覆盖或回退任何改动。
- 取得的是最终backendDecision、原消息、当前会话状态，以及生产函数对历史记录的只读回放。没有取得当时完整模型请求、两次原始提案或逐行Service原始结果。四组没有ai_tool_calls记录；直接Backend路径的执行依据来自metadata。不能补造缺失Trace或把回放当作已重新执行DeepSeek/H5。

## 四组逐项结论

| 组别 | 结论 | 已证实的实际环节 | 影响 |
| --- | --- | --- | --- |
| G1 产品概览/参数 | PARTIAL | 目录仅匹配1款，summary为空，但已核验25mm规格、λ=.005、α=1.25；概览模式只允许SUMMARY/CATEGORY/DOCUMENTS，最后固定句式拼接 | 参数有事实依据；概览重复介绍简称/缺资料，未自然说明当前登记范围和已有规格 |
| G2 薄膜灰&lt;.35→导热系数 | FAIL | 首轮CLARIFY/QUERY被待澄清读取器拒绝；续问成为ANY/READ/target=null，subject/system均null | 原上限、体系线索和查方案目标没有约束实际查询；962条全命中，显示24条中18条违反λ&lt;.35 |
| G3 薄膜灰K&lt;.5 | FAIL | K=.5/MAX_LIMIT和systemHint=薄膜灰仍在，892条扫描但identityCount=0 | 名称未匹配被写成体系/型号/基层/厚度/来源通用无结果，掩盖真正缺项；不是已证明没有符合K的方案 |
| G4 保温.2→热阻 | FAIL | 原问符合待澄清读取条件；最终factRead.mode=DEFINE，Policy报QUERY_CONTEXT_INVALID | 没有保留.2后只澄清热阻口径，而是退回重新描述需求 |

[结构化审计结果](evidence/conversation-integrity-2026-10-20/audit-findings.json)保存具体会话ID、执行参数和边界，原话不改写。

## G2：已经定位的完整断点

1. 原问“薄膜灰 小于 0.35有哪些方案”的最终记录为`domainIntent=CLARIFY`、`requestedEffect=QUERY`。其pageQuery保留了原体系文字，但指标未明确；0.35仍只存在原话。
2. 线上`recentQueryClarification()`只接受`requestedEffect=READ_ONLY`。因此这条澄清被排除，后续模型输入中的pendingClarification不能从该原问恢复。对真实历史完成记录回放，结果确为null，见[历史回放](evidence/conversation-integrity-2026-10-20/historical-pending-replay.json)。有效期、归属、时间先后不是本组的主要原因。
3. 续问“导热系数”的实际记录为`relation=NEW`，`parameterQuery={subjectType:ANY,operator:READ,targetValue:null,subjectText:null,systemText:null}`。
4. Domain和Service仅在模型声明`CLARIFICATION_REPLY`时加载原问、校验旧目标；本次只核验“导热系数”本轮文字，因此READ能通过。**缺少独立于模型queryContext的“活动待澄清需求不能静默变宽”检查。**
5. `evaluateLambdaFacts()`收到READ就接受全部身份内数值；此时身份也是ANY、无名称及体系，所以诊断为`scannedCount=identityCount=matchedCount=962`、`excludedValueCount=0`。展示中.87、1.87、.93等越界值随之进入回答。

这里不能只归责于底层多来源读取，也不能只怪模型。对一个合法的独立全量READ，多来源查询可以成立；错误在于带条件的待澄清查询被放行为另一个无条件READ，查询前后都没有挡住这种变化。把24条改成12条或去重，只会改变展示，不会修复它。

原始目标还是“有哪些方案”。就算材料λ满足上限，也只能说明对应属性事实，不能把砂浆、芯材或产品当量混作完整可选构造。应先保留查方案目标及体系线索，说明λ所属对象；身份无法可靠绑定时继续澄清，不能删除限制后宽查。

## G3与G4：避免把不同原因混在一起

G3的实际confirmedPageLookup.query仍有`systemHint=薄膜灰`、K=.5及MAX_LIMIT，没有型号、基层或厚度条件。`IDENTITY_NOT_FOUND`代表这些记录未通过名称范围，不代表K阈值筛选后确无结果。可以基于正式字典给近似名称建议，但要经用户确认或正式映射才能绑定；不能自动将“薄膜灰”改成“薄抹灰”。诊断应列出实际生效条件与未确认名称。

G4的历史回放返回包含0.2的原问，说明它与G2不是相同的入口过滤问题。最终metadata保留了DEFINE事实请求并被续问Policy拒绝；这能证明查询/概念合同发生冲突。由于原始模型提案未持久化，不能断言是哪次提案或重试造成。用户说“热阻”仍可能需要区分产品整体、材料/芯层与整构造，但应保留0.2，只问这个口径，不能猜口径或重算。

## 产品回答：事实正确与回答有帮助需分别验收

G1技术参数中的25mm、λ=.005和α=1.25均来自已核验目录/规格，本次没有证据表明这些参数是模型编造。缺陷在于：固定回答计划没有自由组织语言的字段，INTRODUCTION还过滤掉规格/厚度等事实，summary为空就落入固定“资料不完整”。“有哪些产品”也被附上固定的完整系列缺项说明。

应允许模型在Service给定的事实范围内自然表达，Backend继续约束产品身份、数值、单位、来源及未经证实的性能承诺。概览可明确“当前可核验目录查到这一款，已发布25mm规格”，但不能据此声称所有系列只有一款，或为丰满介绍补造用途/优势/认证。产品、规格、资料中的构造型号需要分别表述。

## 为什么原35问没有挡住

原矩阵的S2首轮恰好是CLARIFY/READ_ONLY，待澄清能被读回；新例首轮为CLARIFY/QUERY，落在被过滤的分支。原S3第二轮用户明确补了正式体系“薄抹灰外保温”，未覆盖未知名称仍未确认的后续路径。对照见[原矩阵分支](evidence/conversation-integrity-2026-10-20/fixed-matrix-coverage-comparison.json)。

原先对产品介绍主要核对“没有编造正式事实”，对能否直接帮助用户、是否机械重复的判定过宽。方案、计算、Snapshot和PDF通过，可以保留各自证据；它们不证明普通对话条件持续完整。原35问中S2 λ=.3精确查询通过，也不证明任意比较符、业务目标及未知名称都能跨指标澄清保持。

提示词已有“.3原问→导热系数”的示例，但示例不能替代服务端不变量。下一轮重点应是实际最终QuerySpec与原需求的约束对照、返回记录是否满足范围及归属、只问真正缺项和回答可用性，不能用更多固定原句或HTTP200替代。

## 当前工作区补丁的待核验点

以下是读取快照的静态风险，不是对另一任务最终实现的验收结论：

- 已放行CLARIFY/QUERY及补充`inheritParameterTarget()`，能覆盖G2的一个已知断点；但该继承仍依赖模型声明CLARIFICATION_REPLY。若模型仍给CURRENT_TURN/READ，旧约束仍可能不参与校验。应在执行前用服务端活动需求检查，而非只依赖该标志。
- `recentQueryClarification()`改为在若干历史消息中回找带数值用户文本，需要明确原问ID、澄清链及话题切换失效边界，不能把最近有数字等同于当前待澄清目标。
- `specificClarificationQuestion()`以原问唯一数字生成`λ=值`或`K=值`提示，没有保留原比较符；原来“小于”的问题不能被提示成等值。应复用已保存条件，而非再次从单个数字拼提问。
- λ按名称/数值去重并列12项、增加口径说明可以改善阅读，但不等于QuerySpec正确，也不能代替方案目标的约束。

## 交接优先级与恢复验收门槛

1. 先保留唯一的活动需求及待澄清链：原目标、原问ID/证据、数值、比较符、名称线索、缺失条件；模型只提交本轮变更。换话题/取消、权限及有效期仍需后端校验，不能借历史状态授权计算、确认或报告。
2. 在Domain后、Service前检查合并条件不比用户需求更宽；Service结果再检查范围、参数归属及来源。发现不一致停止执行并留痕，不能输出全库材料或用通用拒绝掩盖。
3. 返回结构化事实和实际缺项，概览/解释自然组织；不改工程值、发布规则及Snapshot/报告权限，不做无关重构。
4. 另一修改任务完成后，先在隔离环境用真实DeepSeek+H5复测这四组并采集Pending→QuerySpec→Service→Answer完整证据，再运行原始35问及现有关键方案/PDF/权限回归。本轮未执行这些复测，也没有判修复完成。

只读证据不足的字段应标未采集；原始模型上下文与逐次提案不能靠推测补造。**在这些缺陷完成修复和真实复测前，不恢复整体READY推荐。**
