# 小格 AI 对话边界修复与真实 UAT（2026-10-21）

## 验收结论

**NOT_READY。** 本轮两个软件问题已修复并经真实 DeepSeek Chat HTTP/SSE 与 C 端 H5 复测：候选不可用时的泛化澄清，以及标准依据追问生成未经证实的适用条件。原始固定 35 问全部执行，结果 **25 PASS / 6 PARTIAL / 4 FAIL**；补充多轮 11 问为 **8 PASS / 3 PARTIAL / 0 FAIL**。不能用自动测试、单方案成功或直连下载成功替代整体上线验收。

本轮修改已按逐文件起始哈希核对合入 `D:/work/lg-vicp`，保留原工作区已有改动。**未部署生产、未修改正式工程数据或已发布规则、未执行生产迁移、未改历史快照，也未发布生产报告模板。** App 无新增源码修改。

## 根因和修复

### 1. 候选不可用被当成用户没说清楚

正式分层参考行是 35mm，但绑定的 `VICP-BOARD-25` 规格为 25mm，因而不能进入正式候选。原流程缺少可跨轮使用的类型化排除诊断，比较或组合操作失败后容易回到泛化澄清，甚至把解释中的冲突数值送入普通工程事实校验，记为 `INVALID_FACT`。

现在仅从同用户、客户端、项目、会话及当前 lookup Revision 的近期记录恢复候选可用性线索；24 小时过期、未来时间、换话题、无效查询或不匹配 Revision 不继承。历史线索只帮助理解。执行前 Backend 重新核验权限、项目、原查询、候选集合与来源版本，按原条件重查，并与原已授权 Candidate ID 相交；不扩大查询，也不生成新身份。

对比较失败和不可完整执行的组合操作，直接说明真实的 35mm/25mm 绑定冲突、当前仍可用的 25mm 候选及下一步。资料冲突不再保存为待用户补条件的澄清，不产生 `pendingQueryNeed`，采用 `CANDIDATE_AVAILABILITY_REVALIDATED` 的专用事实边界。组合操作仍整单不执行；不会偷偷只完成 Final、自动确认或生成报告。

真实复测后，用户明确单独选择有效的 25mm 候选，可以继续 SELECT、SET_FINAL；没有把“保留无效分层示例”的原始组合要求改写成成功。

### 2. 标准依据追问落入自由生成

此前标准核验缺少正式限值时，下一轮“为什么／缺什么”可能落入普通知识回答，模型补充资料中没有的 D 值、体形系数、气候区或适用条件。

现在 Semantic 仅提交带原话证据的 `complianceExplanation` 阅读意图，不提供标准事实、限值或正式身份。Policy 保留只读、置信度、原话证据、话题和字段互斥门禁。Backend 仅恢复紧邻上一条已完成回复的类型化核验上下文，校验同用户/客户端/项目/会话和 24 小时时效；延续解释不刷新原始期限，换话题即清除，不从自由文本挖事实。

专用 Service 重新检查权限、项目及当前发布标准依据。没有有效限值就简短说明缺少哪类可信依据，不推导适用条件。已有正式核验记录的解释只读取仍有效的同一依据；撤回或缺失时明确说明。正式实施日期只取标准文档的 `implementDate`，不把内部记录版本或发布时间说成实施日期。解释不重新计算合规，也不生成方案。

如果模型只给出泛化 CONTINUE 而未提交所需阅读目标，在现有预算内做一次有界纠正；仍缺失就安全澄清，不能静默回到自由生成。

**覆盖限制：** 当前真实数据没有已发布生效的标准限值，因此“缺依据”分支有真实 HTTP/SSE/H5 证据；“已有正式标准记录”的文档、日期、撤回等分支只有自动测试证据，不能宣称真实正向合规 UAT 已通过。

## 真实测试环境与证据边界

- 沿用正式批准的 DeepSeek Chat，没有切换模型。通过真实上游 HTTP/SSE 和真实 H5 发问，不使用预设 Semantic JSON 作为业务通过证据。
- 两轮数据库隔离复制，源业务数据只读，工程 JSON 原样复制，`sourceBusinessWrites=0`、`syntheticEngineeringData=false`。测试账号、会话、Snapshot 和报告只在隔离环境产生。
- 第一轮只做 11 问定向复测，未运行固定 35 问。回复已改善，但仍发现错误的待澄清/INVALID_FACT 元数据；保留该轮原始证据，修复后另建最终环境完整重跑。
- 最终 Backend/App 运行源清单与验收结束时一致，无运行代码漂移。16 个修改文件与主工作区哈希一致；936 个源码文件按 BOM、CRLF 和末尾换行规范化比较无差异，二进制按字节比较。
- 原始题库文件 SHA-256 为 `59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`。原问全部保持不变，逐轮保留问题、答案、SSE、Backend metadata、页面截图、Semantic 和上游请求记录。
- 评审由本轮执行者依据原始需求与来源完成，**不宣称经过独立人工盲测**。业务判断没有以 HTTP 200、没有异常或文件存在代替正确性。

## 验证结果

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| Backend 全量自动测试 | 3041 passed / 1 expected fail / 1 skipped；264 文件通过、1 文件跳过 | [日志](evidence/dialogue-context-boundaries-2026-10-21/backend-tests-verified.log) |
| Backend lint/typecheck、构建、db:check | 全部退出码 0 | [完整性记录](evidence/dialogue-context-boundaries-2026-10-21/final-source-integrity.json) |
| App 自动测试 | 158 passed，0 failed | [日志](evidence/dialogue-context-boundaries-2026-10-21/app-tests.log) |
| App typecheck、H5 build | 退出码 0 | [typecheck](evidence/dialogue-context-boundaries-2026-10-21/app-typecheck.log)、[build](evidence/dialogue-context-boundaries-2026-10-21/app-build.log) |
| 合入主工作区后的 Backend lint/build | 退出码 0 | [lint](evidence/dialogue-context-boundaries-2026-10-21/main-lint.log)、[build](evidence/dialogue-context-boundaries-2026-10-21/main-build.log) |
| 原始固定 35 问 | 25 PASS / 6 PARTIAL / 4 FAIL | [逐轮业务评审](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/fixed35-business-review.json) |
| 补充 6 轮候选、5 轮标准/话题切换 | 8 PASS / 3 PARTIAL / 0 FAIL | [逐轮评审](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/extra-business-review.json) |
| 独立数值/副作用审计 | 2 项分层公式、1 项参数继承；只产生预期的 2 Snapshot/2 报告 | [审计](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/independent-audit.json) |
| 权限与冻结回归 | 109 检查通过 | [权限证据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/security-acceptance.json) |
| 原有预览授权兼容 | 11 检查通过，无额外 Snapshot/报告 | [预览权限](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/preview-access.json) |
| 单一有效候选真实按钮闭环 | 查询卡片→历史恢复→选择→Final→人工确认→Snapshot→PDF 成功 | [7 步证据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/single-flow.json) |
| 两份实际 PDF | 内容、Snapshot、2 页布局、直连预览和真实浏览器下载 SHA 核对通过 | [PDF 评审](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/pdf-business-review.json) |
| 原始页图片 | H5 实际打开印刷页 25、26、53，原图显示且尺寸有效；直连环境 | [原图证据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/source-ui/source-image-review.json) |

补充测试中，候选比较和原组合操作仍因真实数据冲突记 PARTIAL；通用 K 概念解释虽正确切断旧合规上下文，但过长且偏重 R，表达质量记 PARTIAL。没有把“安全拒绝”算成所需业务已经完成。

两份 PDF 分别来自原始 S5 会话和另一个单有效候选按钮会话。已独立提取正文核对 25mm、产品层 R=4、R₀=4.3068、K=0.2322、Sheet1、冻结 Snapshot ID 及已确认免责声明，没有内部占位文案。隔离环境通过正常模板版本 2 的创建、预览、发布流程验证，3 模板合计 15 个 HTTP 流程检查通过，C 端无管理权限；生产模板仍仅有[变更草稿](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/approved-production-template-draft.json)。

**网络限制：** 上述原图和 PDF 是独立浏览器 `--direct-network` 下的结果，未改系统代理。此前默认浏览器路径的 `ERR_CONNECTION_CLOSED` 本轮未重测、未修复，因此默认网络下载不能判 PASS，也不能用直连结果关闭 OSS/网络问题。

## 仍未解决与上线门槛

| 问题 | 当前真实状态 | 所需处理 |
| --- | --- | --- |
| 35mm 分层参考行绑定 25mm 规格 | 没有正式勘误；原值保留，排除正式选择。双候选比较及原 R5 组合→确认→PDF 未完成 | 资料负责人提供正式有效的规格/绑定修订，经正常版本流程发布后复测；软件不能代改 |
| 地区合规限值 | 当前没有已发布生效依据，只能解释不能判断 | 补齐并审核发布正式标准及适用范围，再做真实正向合规验收 |
| 默认网络下原图/PDF 下载 | 前轮失败仍未关闭；本轮只证明直连路径可用 | 恢复默认访问链路后在同网络配置下复测预览和下载 |
| 产品优缺点、同条件竞品比较 | 缺正式正文/竞品证据，未编造 | 按用户确认先基于现有 KB 简短介绍；完整比较需正式资料 |
| 通用概念解释 | 换话题正确，但 K 回答偏长、焦点偏 R | 作为表达质量改进项保留，不能声称所有自然回答已收口 |
| 生产免责声明模板 | 文案已确认，隔离版本流程和实际 PDF 通过，生产未发布 | 在正式发布流程中审核并发布已备好的版本变更 |

原始 35 问的 4 个 FAIL 均保留：R5-T2 双方案比较、R5-T3 包含无效分层参考的组合操作、R5-T6 无 Final 的确认、R5-T7 无 Snapshot 的报告。R4-T2 从前轮 FAIL 改为 PASS，S5-T3 仍为 PARTIAL；前轮 24/6/5 的记录没有覆盖或删除。

## 原始 35 问逐轮结果

以下保持原问题文本；完整回答和最终 QuerySpec/工具参数、候选 Revision 等在各轮 SSE/Backend 文件及原始运行矩阵中。

| 轮次 | 原问题 | 结果 | 判定依据 | 证据 |
| --- | --- | --- | --- | --- |
| S1-T1 | 介绍下VICP产品。 | PASS | 从已确认知识库列出产品名称和可查参数，没有补造用途或完整产品系列。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T1.png) |
| S1-T2 | 我不是工程师，简单说就行。 | PASS | 延续产品上下文，以简短语句介绍现有资料，未生成方案或报告。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S1-T2.png) |
| S2-T1 | 有保温0.3的材料吗？ | PASS | 保留0.3并只澄清指标，没有把未明指标当作K或扫描全部材料。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T1.png) |
| S2-T2 | 导热系数。 | PASS | 实际查询λ EXACT 0.3；无命中，不返回大于目标的泛化材料列表。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T2.png) |
| S2-T3 | 如果没命中，是没有这个数值，还是缺资料？这次查了哪些？ | PASS | 解释上一轮λ=0.3的匹配与资料范围，没有将无命中说成市场上不存在。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S2-T3.png) |
| S3-T1 | 薄膜灰0.3的有吗？ | PASS | 保留数值线索并澄清指标、体系名称，不擅自归一未知体系。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T1.png) |
| S3-T2 | 我说的是传热系数K，体系是薄抹灰外保温。 | PASS | 补充K和薄抹灰体系后继续查询，保留0.3目标、参考来源及只读状态。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T2.png) |
| S3-T3 | 只看Ⅲ型。 | PASS | 只收窄为Ⅲ型，保留K=0.3的既有匹配口径；实际4档均有来源。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S3-T3.png) |
| S4-T1 | 你们产品有什么优势和不足？ | PARTIAL | 缺少正式产品优缺点正文，当前只提供核对维度。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T1.png) |
| S4-T2 | 和其他保温材料比呢？ | PARTIAL | 缺同条件竞品资料，未形成完整比较。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S4-T2.png) |
| S5-T1 | 客户要做外墙保温，我想先选个VICP参考方案。 | PASS | 给出参考选型所需信息与可提供的帮助，未替用户选Final或承诺达标。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T1.png) |
| S5-T2 | 先用已发布的200mm钢筋混凝土基层Excel示例，不判断达标。 | PASS | 列出合法25mm正式参考行，明确排除35mm/25mm绑定冲突，未创造候选。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T2.png) |
| S5-T3 | 把整体法25mm和分层法35mm的输入、K和限制放一起比较，不当作同厚度对比。 | PARTIAL | 正确说明35mm/25mm绑定冲突及可用候选，不再泛化澄清；所需双方案比较仍受正式资料阻塞。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T3.png) |
| S5-T4 | 先选择整体法25mm这套。 | PASS | 真实自然语言选择整体法25mm成功，当前仅选1个，没有自动确认。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T4.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T4.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T4.png) |
| S5-T5 | 把这套设为最终方案，参数先让我核对，不要确认。 | PASS | 进入Final待确认，未因“设最终”产生Snapshot或报告。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T5.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T5.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T5.png) |
| S5-T6 | 我核对好了，请显示确认入口，我自己点按钮。 | PASS | 展示确认入口，由真实H5按钮触发确认，冻结本人会话的单方案Snapshot。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T6.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T6.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T6.png) |
| S5-T7 | 我要导出PDF，请显示生成入口，我自己操作。 | PASS | 展示PDF入口，由真实H5操作生成READY报告；另行下载网络问题单独列PARTIAL。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T7.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T7.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/S5-T7.png) |
| R1-T1 | Ⅲ型VICP薄抹灰外保温，45mm，有哪些基层做法？ | PASS | Ⅲ型45mm四种基层及K、两种R口径与确认页25/26一致，未跨层补算。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T1.png) |
| R1-T2 | 把四种基层的K放在一张表里，哪个最低？ | PASS | 四种基层45mm的K并列，明确最低/最小0.248；未据此改变实际基层或自动选型。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T2.png) |
| R1-T3 | 给我看对应原页，定位45mm那档。 | PASS | 继续引用页25/26和45mm档，没有重新检索后替换所比较记录。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R1-T3.png) |
| R2-T1 | I型VICP平屋面，正置和倒置的20mm档分别怎么样？ | PASS | 保留I型、平屋面、正置/倒置和20mm两组；R=3.2与整构造R=3.569分列。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T1.png) |
| R2-T2 | 把两组的R和K列在一起，R是哪一层或哪一列也写清楚。 | PASS | 继续并列两组K=0.280及原表R口径；产品整体R缺失时明确保留缺失。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T2.png) |
| R2-T3 | 打开原图，定位20mm这档。 | PASS | 真实页面引用原页53和20mm两档，未误用正式可选候选或改变热阻口径。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R2-T3.png) |
| R3-T1 | 按Excel右侧分层构造，芯材15mm，给我分层热工计算过程，先不判断达标。 | PASS | 15mm芯材按冻结正式分层参数计算，R总=5.306822098，独立公式核对一致。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T1.png) |
| R3-T2 | 把芯材改成20mm，其他层不变。 | PASS | 仅芯材改20mm，其余层保持；R总=6.906822098，独立公式核对一致。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T2.png) |
| R3-T3 | 列出公式版本、参数来源和缺项；缺了关键参数就不要硬算。 | PASS | 读取既有20mm计算，保留规则/公式版本和来源，没有新增第三次计算。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R3-T3.png) |
| R4-T1 | 浙江省住宅外墙，传热系数K为0.3，能达标吗？ | PASS | 没有正式适用标准限值，明确无法判定浙江住宅外墙K=0.3达标。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T1.png) |
| R4-T2 | 依据哪份正式标准、哪条限值，什么时候生效？ | PASS | 解释紧邻真实核验的依据缺项；不自由补适用维度、标准号、限值或日期。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R4-T2.png) |
| R5-T1 | 查询已发布的VICP-OVERALL和VICP-LAYERED参考行，分别保留输入条件及来源。 | PARTIAL | 35mm分层行绑定25mm规格，当前只保留一条合格正式候选。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T1.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T1.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T1.png) |
| R5-T2 | 并排比较K、各R的范围和厚度，不按K替我选最终方案。 | FAIL | 已明确说明排除原因及可用25mm候选，但不足两条合格正式候选，所需比较未完成。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T2.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T2.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T2.png) |
| R5-T3 | 选整体法25mm作为Final，保留分层示例作参考，先不要确认。 | FAIL | 正确说明整单未执行；保留无效分层参考的组合请求仍未形成Final，不部分执行或放宽身份。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T3.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T3.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T3.png) |
| R5-T4 | 核对最终方案的参数、规则版本和Sheet1来源。 | PARTIAL | 未形成Final，只能核对当前参考事实。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T4.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T4.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T4.png) |
| R5-T5 | 先停在待确认状态，别生成快照或报告。 | PARTIAL | 未自动建快照/报告，但所要求的Final待确认状态尚未形成。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T5.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T5.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T5.png) |
| R5-T6 | 确认入口给我，我来点击；不要根据这句聊天自动确认。 | FAIL | 无Final，未完成该会话确认闭环。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T6.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T6.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T6.png) |
| R5-T7 | 显示PDF生成入口，我自己点击后再打开看。 | FAIL | 无Final/Snapshot，没有该会话的正式PDF。 | [SSE](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T7.sse.txt) / [数据](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T7.backend.json) / [截图](evidence/dialogue-context-boundaries-2026-10-21/round-02-final/R5-T7.png) |

### 评审过程保留的问题

本轮审计脚本最初把 R1-T1“查基层”的回答也要求复述未询问的 K/R 值，过于依赖答案形式。修正为：四种基层检查实际第一轮答案；原题要求的四组 K、两种 R 口径与 45mm 档位，逐条对照实际已授权来源页的结构化记录，再核对第二轮 K 排序/最小值和最终实际原图 25/26/53。未改原始 35 问、原始工程数值或题库验收要求，也未伪造未显示的正文数字。

开发中的失败日志全部保留：首次 lint 暴露正式日期字段错误，改读标准文档的真实 `implementDate`；新增测试夹具缺少 `.orderBy` 的一次失败，修正夹具后通过，原断言未弱化。另一次全量运行的既有 `report-runtime.test.ts` Windows Bash 子进程返回 `status=null`，其完整根因未确认；未修改该实现、断言或超时，单独重跑 14 项通过，随后 `--maxWorkers=2` 全量 3041 项通过。保留早期全量、定向及最终成功日志，不把 `status=null` 武断归因为确定超时，也不隐藏失败。

## 修改文件

共 16 个代码、测试与治理文件，具体前后 SHA 见[修改清单](evidence/dialogue-context-boundaries-2026-10-21/change-manifest.json)，可审阅[本轮补丁](evidence/dialogue-context-boundaries-2026-10-21/repair.patch)。4 个治理文件更新了上述状态边界和测试要求，未进行无关架构重构。

- `backend/src/modules/ai/ai-domain-policy.ts`（MODIFIED）
- `backend/src/modules/ai/ai-domain-semantic.ts`（MODIFIED）
- `backend/src/modules/ai/ai-domain-turn-decision.service.test.ts`（MODIFIED）
- `backend/src/modules/ai/ai-domain-turn-decision.service.ts`（MODIFIED）
- `backend/src/modules/ai/ai-generation.service.ts`（MODIFIED）
- `backend/src/modules/ai/candidate-availability.service.test.ts`（ADDED）
- `backend/src/modules/ai/candidate-availability.service.ts`（ADDED）
- `backend/src/modules/ai/compliance-explanation.service.test.ts`（ADDED）
- `backend/src/modules/ai/compliance-explanation.service.ts`（ADDED）
- `backend/src/modules/ai/product-parameter-generation.test.ts`（MODIFIED）
- `backend/src/modules/ai/reference-candidate-resolver.service.ts`（MODIFIED）
- `backend/src/modules/ai/reference-query.service.ts`（MODIFIED）
- `backend/AGENTS.md`（MODIFIED）
- `backend/README.md`（MODIFIED）
- `backend/.cursor/rules/30-ai-and-reports.mdc`（MODIFIED）
- `backend/.agents/skills/lg-backend/references/ai-and-reports.md`（MODIFIED）

## 完整性与环境清理

[合入核验](evidence/dialogue-context-boundaries-2026-10-21/merge-verification.json)记录 16 个文件的起始哈希全部吻合，仅合入本轮文件；[最终完整性核验](evidence/dialogue-context-boundaries-2026-10-21/final-source-integrity.json)确认主工作区/工作树内容、真实 UAT 源清单和检查退出码一致。原先工作区未提交改动全部保留，没有提交、推送或重置。

两轮隔离环境均正常停止，数据库已删除；第一轮 0 个、最终轮 4 个跟踪 OSS 对象清理完成，清理失败列表为空；独立只读检查两轮数据库与 Redis 前缀均无残留。相关结果保存在各轮 `environment.json` 的 `cleanup` 和[独立清理检查](evidence/dialogue-context-boundaries-2026-10-21/cleanup-independent-check.json)。本轮浏览器、API、H5 进程已退出，临时登录凭据文件已删除。没有清理其他任务环境或删除工作树。

证据归档的逐文件 SHA 见 `evidence-manifest.json`，复制后核对结果见 `delivery-integrity.json`。最终结论保持 **NOT_READY**，需要关闭上述正式资料、默认网络与验收事项后再作上线判断。
