# 小格 AI 对话与报告收口 UAT（2026-10-21）

结论：**NOT_READY**。最终代码的原始固定35问：**24 PASS / 6 PARTIAL / 5 FAIL**。本轮代码已同步到主工作区，未部署生产。

## 验收方法与边界

使用已批准的 DeepSeek Chat、真实 HTTP/SSE、Microsoft Edge H5 页面。工程数据从配置的数据源只读复制到随机隔离库；未改工程数值、发布规则、生产资料、历史快照或生产模板。每轮原问逐字保留，固定题库 SHA256 为 `59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`。

逐轮核对 Semantic 提案、后端实际查询、检索事实、来源、页面和副作用。HTTP成功、安全拒绝、PDF存在均不单独算业务通过。算法校验与业务复核由同一执行者完成，不冒称独立人工盲测。

## 已修复的根因

1. **自然采用误入计算的校验顺序。** 过去宽口径Policy先拒绝时，独立的计算授权复核不可达。现在仅在高置信度、直接肯定请求、证据完整对应原文的前提下，允许原有独立操作复核；若确认是选择或查询，复用一次有界目标修正，再完整执行Policy及真实候选身份校验。没有放宽计算、确认、候选ID、来源或Revision权限。三次真实采用均成功；旧计算误判在本轮未复现，因此修正支路由自动测试验证，不能宣称被真实模型触发或所有问法均已覆盖。

2. **回答组织与事实分离。** 多条原表参数按同文档、版本、页面和构造分组为简短表格，明确数值比较条件；缺少字段、没有匹配值、一条记录无法比较时给出具体原因和下一步帮助。完整来源和原始警示继续保留，工程数值由Service提供。产品简介仅基于现有知识库，不补造用途、性能优势或组成。

3. **完整型号被通用名称吞掉。** 用户原文中的型号名称与通用产品名称同时命中时，旧逻辑认为不唯一并退回通用名称。现在只用当前有权、原文逐字出现的唯一完整名称收窄；保留参数口径、比较符与阈值，不凭前缀创造型号或把材料层λ当产品当量λ。真实390px页面复测“I型”已不再返回通用目录0.005。

4. **子属性重复字段门槛。** 模型提供“平屋面/坡屋面”却未重复“屋面”父字段时，旧覆盖检查误判条件丢失。现在利用既有封闭字典中同一已核验原文字形，补充更窄的父级部位约束；冲突、低置信度、缺原文或显式移除仍拒绝或保留移除语义。未增加专用问句正则。

5. **H5无法可靠显示实际PDF。** 新增有权PDF按页读取接口，复用已有产物读取权限，从存储中的冻结PDF字节渲染PNG。H5阅读器支持翻页、100–250%缩放和双轴滚动；原生平台保留系统阅读器。页面返回原PDF SHA256，跨页不一致、关闭后的迟到响应、报告/账号切换均受控。下载仍使用原始PDF。

预览预算：加载字节前限制并发2；PDF不超过40MB；单次渲染30秒；接口页码1–500；私有不缓存。既有批量PDF渲染默认预算不变。预览不创建快照、报告或OSS对象，不从最新参数重建正文。

## 自动检查

- Backend：**3022 passed**；另有1 expected fail及1 skipped，均未计为通过。
- App：**158 passed**；类型检查与H5构建通过。
- Backend数据库迁移一致性检查、语义AST检查、类型检查和构建通过；主工作区构建检查通过。
- 关键权限回归：**117项通过**；额外PDF页接口与原预览权限一致性检查通过。
- 本轮27个代码/文档文件的主工作区与隔离工作区哈希一致；比较全部932个src文件，除BOM、行尾及文件末换行归一外无差异。最终UAT期间源码无漂移。

日志：[后端测试](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/backend-tests-release-final.log)、[前端测试](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/app-tests.log)、[源码完整性](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/final-source-integrity.json)。

## 真实业务与PDF

固定35问、型号定向失败场景、屋面连续三轮、7轮产品参数追问以及用户8.3热阻问题均通过真实H5和上游执行。7轮检查包括保持材料层归属、相同λ续查、修改数值阈值、换话题及换题后不继承旧筛选；不据此保证任意自然问法。

成功的单方案按钮流程验证：查询候选→历史恢复→加入方案→Final待确认→本人点击Confirm→冻结Snapshot→本人点击生成PDF→实际页面预览。独立浏览器直连时实际下载通过；默认浏览器网络下载连接被关闭，保留PARTIAL。双方案比较未通过，不用单方案成功替代。

最终轮在独立浏览器直连条件下核验2份实际PDF：逐页显示原PDF渲染图，桌面及390px缩放检查；浏览器实际下载文件的SHA256与各预览页绑定的PDF SHA256一致。抽取正文核对Snapshot、VICP-BOARD-25、R₀=4.3068、K=0.2322和Sheet1来源；没有“待甲方确认”占位说明。

模板变更只在隔离库走正式新版本、修改、校验、提交、审核、发布流程：3个模板、15个HTTP操作；C端无模板管理权限，旧版sections JSON保留。实际报告冻结v2和已批准文案：“本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。” **生产模板尚未发布新版本**，准备稿与证据已交付。

证据：[最终业务复核](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/fixed35-business-review.json)、[PDF内容及下载](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/pdf-business-review.json)、[单方案按钮流程](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/single-flow.json)、[模板准备稿](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/approved-production-template-draft.json)。

## 固定35问逐轮结果

每行链接包含原始提问、完整回答、SSE、后端决策和页面截图；PASS由业务内容判定。

| 轮次 | 结果 | 说明 | 证据 |
|---|---|---|---|
| S1-T1 | PASS | 从已确认知识库列出产品名称和可查参数，没有补造用途或完整产品系列。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S1-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S1-T1.backend.json) |
| S1-T2 | PASS | 延续产品上下文，以简短语句介绍现有资料，未生成方案或报告。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S1-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S1-T2.backend.json) |
| S2-T1 | PASS | 保留0.3并只澄清指标，没有把未明指标当作K或扫描全部材料。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T1.backend.json) |
| S2-T2 | PASS | 实际查询λ EXACT 0.3；无命中，不返回大于目标的泛化材料列表。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T2.backend.json) |
| S2-T3 | PASS | 解释上一轮λ=0.3的匹配与资料范围，没有将无命中说成市场上不存在。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S2-T3.backend.json) |
| S3-T1 | PASS | 保留数值线索并澄清指标、体系名称，不擅自归一未知体系。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T1.backend.json) |
| S3-T2 | PASS | 补充K和薄抹灰体系后继续查询，保留0.3目标、参考来源及只读状态。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T2.backend.json) |
| S3-T3 | PASS | 只收窄为Ⅲ型，保留K=0.3的既有匹配口径；实际4档均有来源。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S3-T3.backend.json) |
| S4-T1 | PARTIAL | 缺少正式产品优缺点正文，当前只提供核对维度。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S4-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S4-T1.backend.json) |
| S4-T2 | PARTIAL | 缺同条件竞品资料，未形成完整比较。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S4-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S4-T2.backend.json) |
| S5-T1 | PASS | 给出参考选型所需信息与可提供的帮助，未替用户选Final或承诺达标。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T1.backend.json) |
| S5-T2 | PASS | 列出合法25mm正式参考行，明确排除35mm/25mm绑定冲突，未创造候选。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T2.backend.json) |
| S5-T3 | FAIL | 双方案比较缺合格35mm身份；本轮泛化澄清也未明确指出该前置缺项。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T3.backend.json) |
| S5-T4 | PASS | 真实自然语言选择整体法25mm成功，当前仅选1个，没有自动确认。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T4.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T4.backend.json) |
| S5-T5 | PASS | 进入Final待确认，未因“设最终”产生Snapshot或报告。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T5.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T5.backend.json) |
| S5-T6 | PASS | 展示确认入口，由真实H5按钮触发确认，冻结本人会话的单方案Snapshot。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T6.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T6.backend.json) |
| S5-T7 | PASS | 展示PDF入口，由真实H5操作生成READY报告；另行下载网络问题单独列PARTIAL。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T7.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/S5-T7.backend.json) |
| R1-T1 | PASS | Ⅲ型45mm四种基层及K、两种R口径与确认页25/26一致，未跨层补算。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T1.backend.json) |
| R1-T2 | PASS | 比较此前4档，最低K=0.248对应外墙A3-4；未替换项目基层或选择方案。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T2.backend.json) |
| R1-T3 | PASS | 继续引用页25/26和45mm档，没有重新检索后替换所比较记录。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R1-T3.backend.json) |
| R2-T1 | PASS | 保留I型、平屋面、正置/倒置和20mm两组；R=3.2与整构造R=3.569分列。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T1.backend.json) |
| R2-T2 | PASS | 继续并列两组K=0.280及原表R口径；产品整体R缺失时明确保留缺失。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T2.backend.json) |
| R2-T3 | PASS | 真实页面引用原页53和20mm两档，未误用正式可选候选或改变热阻口径。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R2-T3.backend.json) |
| R3-T1 | PASS | 15mm芯材按冻结正式分层参数计算，R总=5.306822098，独立公式核对一致。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T1.backend.json) |
| R3-T2 | PASS | 仅芯材改20mm，其余层保持；R总=6.906822098，独立公式核对一致。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T2.backend.json) |
| R3-T3 | PASS | 读取既有20mm计算，保留规则/公式版本和来源，没有新增第三次计算。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R3-T3.backend.json) |
| R4-T1 | PASS | 没有正式适用标准限值，明确无法判定浙江住宅外墙K=0.3达标。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R4-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R4-T1.backend.json) |
| R4-T2 | PARTIAL | 缺正式标准版本、条文与日期；解释中引入未经当前资料支撑的适用维度，本轮不能确认完整通过。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R4-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R4-T2.backend.json) |
| R5-T1 | PARTIAL | 35mm分层行绑定25mm规格，当前只保留一条合格正式候选。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T1.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T1.backend.json) |
| R5-T2 | FAIL | 不足两条合格正式候选，未完成比较。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T2.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T2.backend.json) |
| R5-T3 | FAIL | 复合选择包含不可用分层候选，原子操作拒绝，未形成Final。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T3.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T3.backend.json) |
| R5-T4 | PARTIAL | 未形成Final，只能核对当前参考事实。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T4.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T4.backend.json) |
| R5-T5 | PARTIAL | 未自动建快照/报告，但所要求的Final待确认状态尚未形成。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T5.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T5.backend.json) |
| R5-T6 | FAIL | 无Final，未完成该会话确认闭环。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T6.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T6.backend.json) |
| R5-T7 | FAIL | 无Final/Snapshot，没有该会话的正式PDF。 | [页面](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T7.png) · [决策](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/round-05-release-final/R5-T7.backend.json) |

## 剩余阻塞与风险

- 默认浏览器网络下，两份PDF多次下载均遇到OSS连接关闭（ERR_CONNECTION_CLOSED），虽同一签名地址的独立HTTP读取及独立浏览器直连下载成功，仍保留PDF链路PARTIAL。未更改系统代理，须排查实际使用网络后再验收。

- R4-T2未能提供正式标准依据，且自然解释引入当前资料未支撑的标准适用维度，本轮降为PARTIAL。需要补正式标准来源，并收紧此类解释的事实边界，不能全归因于资料缺失。

- 正式35mm分层参考行绑定VICP-BOARD-25（25mm），用户已确认暂无修订依据。继续排除该身份，不能修改原值、伪造35mm规格或放宽校验。S5/R5双方案比较及依赖该候选的复合Final、确认、PDF流程仍未完成。
- S5-T3仍出现泛化澄清，未准确解释缺少有效35mm候选；这是回答衔接缺陷，保留FAIL，不能全部归因于资料。R5复合选择的缺失候选提示也仍需更具体。
- 产品优缺点/竞品比较缺正式正文与同条件资料，仍为PARTIAL。产品用途、组成、优点等不得自行补造；本轮按用户确认只作简短介绍。
- A2-2基层15mm/190mm档位、A3-3 λ=0.0012的原始疑点继续保留标注；没有正式勘误，不能改成猜测值。
- I型产品当量λ缺独立正式字段时，只能解释缺项，不能借材料层同名记录制造整体参数。模型自然表达仍有波动，重复执行的失败均保留。
- 生产新模板须通过已有管理员版本流程发布；本轮未发布生产Backend/App。Windows Edge真实H5已测，Android/iOS真机不在本轮证据范围。

## 失败与重复运行记录

round-01因验收环境重复路由在提问前失败，NOT_RUN；round-02完整35问25/5/5。round-03完整35问22 PASS / 5 PARTIAL / 8 FAIL，屋面三轮因父字段重复要求失败，不能选用前轮成功覆盖；另保留型号丢失修复前后记录。单方案历史恢复脚本曾按第一条历史记录进入，改为当前会话标记并验证候选请求所属会话，旧失败保留。round-04提问前中断，环境已回收；父字段实现的中间类型错误、编译器资源失败及测试进程关闭超时日志保留，不计通过。最终轮以round-05为准。开发服务器首次编译阶段的连接拒绝/超时未计为问答执行。

未变更正确的原问、工程预期或既有权限预期。新测试编写期间的可选字段null/缺省断言差异、LEFT JOIN删除项目夹具错误均保留原日志，修正测试夹具后通过。

## 修改文件清单

本轮修改范围以[哈希清单](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/change-manifest.json)与[可复核补丁](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/repair.patch)为准；保留此前已有未提交改动。

- [backend/src/modules/ai/ai-domain-turn-decision.service.test.ts](D:/work/lg-vicp/backend/src/modules/ai/ai-domain-turn-decision.service.test.ts)
- [backend/src/modules/ai/ai-domain-turn-decision.service.ts](D:/work/lg-vicp/backend/src/modules/ai/ai-domain-turn-decision.service.ts)
- [backend/src/modules/ai/product-parameter-presentation.ts](D:/work/lg-vicp/backend/src/modules/ai/product-parameter-presentation.ts)
- [backend/src/modules/ai/product-parameter-read.service.ts](D:/work/lg-vicp/backend/src/modules/ai/product-parameter-read.service.ts)
- [backend/src/modules/ai/product-presentation.test.ts](D:/work/lg-vicp/backend/src/modules/ai/product-presentation.test.ts)
- [backend/src/modules/ai/reference-candidate-resolver.service.ts](D:/work/lg-vicp/backend/src/modules/ai/reference-candidate-resolver.service.ts)
- [backend/src/modules/reports/report-pdf-preview.routes.test.ts](D:/work/lg-vicp/backend/src/modules/reports/report-pdf-preview.routes.test.ts)
- [backend/src/modules/reports/report-pdf-preview.test.ts](D:/work/lg-vicp/backend/src/modules/reports/report-pdf-preview.test.ts)
- [backend/src/modules/reports/report-pdf-preview.ts](D:/work/lg-vicp/backend/src/modules/reports/report-pdf-preview.ts)
- [backend/src/modules/reports/reports.routes.ts](D:/work/lg-vicp/backend/src/modules/reports/reports.routes.ts)
- [backend/src/workers/pdf-page-renderer.ts](D:/work/lg-vicp/backend/src/workers/pdf-page-renderer.ts)
- [app/src/auto-imports.d.ts](D:/work/lg-vicp/app/src/auto-imports.d.ts)
- [app/src/components.d.ts](D:/work/lg-vicp/app/src/components.d.ts)
- [app/src/api/modules/reports.ts](D:/work/lg-vicp/app/src/api/modules/reports.ts)
- [app/src/components/report/ReportPdfReader.vue](D:/work/lg-vicp/app/src/components/report/ReportPdfReader.vue)
- [app/src/composables/useReportPdfPages.test.ts](D:/work/lg-vicp/app/src/composables/useReportPdfPages.test.ts)
- [app/src/composables/useReportPdfPages.ts](D:/work/lg-vicp/app/src/composables/useReportPdfPages.ts)
- [app/src/pages/report-detail/index.test.ts](D:/work/lg-vicp/app/src/pages/report-detail/index.test.ts)
- [app/src/pages/report-detail/index.vue](D:/work/lg-vicp/app/src/pages/report-detail/index.vue)
- [backend/AGENTS.md](D:/work/lg-vicp/backend/AGENTS.md)
- [backend/README.md](D:/work/lg-vicp/backend/README.md)
- [backend/.cursor/rules/30-ai-and-reports.mdc](D:/work/lg-vicp/backend/.cursor/rules/30-ai-and-reports.mdc)
- [backend/.agents/skills/lg-backend/references/ai-and-reports.md](D:/work/lg-vicp/backend/.agents/skills/lg-backend/references/ai-and-reports.md)
- [app/README.md](D:/work/lg-vicp/app/README.md)
- [backend/src/modules/ai/product-parameter-read.service.test.ts](D:/work/lg-vicp/backend/src/modules/ai/product-parameter-read.service.test.ts)
- [backend/src/modules/thermal/semantic-query.ts](D:/work/lg-vicp/backend/src/modules/thermal/semantic-query.ts)
- [backend/src/modules/thermal/semantic-query.test.ts](D:/work/lg-vicp/backend/src/modules/thermal/semantic-query.test.ts)

## 环境清理

独立只读复核5个隔离环境：数据库与Redis键均无遗留；各轮写入的隔离OSS对象已清理，失败列表为空。临时凭据文件已删除；本轮浏览器及开发服务已关闭。未删除用户工作区或其他任务进程。

[独立清理核对](D:/work/lg-vicp/backend/docs/ai/evidence/dialogue-release-closure-2026-10-21/cleanup-independent-check.json)。
