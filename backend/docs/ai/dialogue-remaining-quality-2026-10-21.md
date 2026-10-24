# 小格 AI：非下载问题修复与 UAT 收口（2026-10-21）

**结论：NOT_READY。** 已完成本轮可修复的软件问题及真实 DeepSeek Chat + H5 复测，代码已安全合并到本机 `D:/work/lg-vicp`，没有发布线上。原始 35 问最终为 **25 PASS / 6 PARTIAL / 4 FAIL**；4 项失败仍由正式分层参考数据 35mm 行绑定 25mm 规格引起，不能靠代码伪造规格或放宽门禁解决。有效单方案的查询、历史恢复、选择、Final、Confirm、Snapshot、PDF 生成与预览已另行通过。

文件下载按用户本轮要求 **EXCLUDED_BY_USER**：没有修复下载链路，没有点击文件下载，也不把本轮预览成功记作下载恢复。权限回归只核验下载 URL 接口授权，未跟随 URL 传输文件。

## 本轮根因与改动

1. **澄清状态混用。** 一般咨询、方案比较、概念解释的澄清曾被保存成待查条件，后续误入查询恢复并出现 `QUERY_CONTEXT_INVALID`。现在仅实际缺查询指标/条件或查询 Service 明确发出的缺项建立待查需求，写入 `pendingQueryContractVersion=1`。有该版本但无待查合同的回复不再被当成查询澄清；未知版本拒绝，旧无版本记录兼容保留。原始数值、比较符及体系条件的连续性检查不变。
2. **模型的等价比较表达与后端合同不一致。** 同一个当前集合极值目标可能写成 `REFERENCE_REFINE + QUERY + comparison`，被只允许只读比较的 Policy 拒绝；仅改 intent 又会因 relation=REFINE 无法回读原页。现在只将无新条件、当前可见来源、明确当前时间、无副作用的等价表达归一为只读比较与 CONTINUE。同一逐字证据、同指标方向的重复 preference 可无损去重；其他偏好、新来源、新条件或低置信均不归一。移除空查询表示之前仍执行原有 `applySemanticQuery` 字段覆盖检查，漏掉本轮厚度或数值限制仍拒绝。来源归属、有效期、Revision、候选绑定及正式操作权限继续执行。
3. **概念解释丢失阅读目标。** 以前解释 K 或 λ/K 差别可能退回完整 R 公式模板。Semantic 现在只提交解释目标与概念对象，Backend 按 MEANING / SCOPE / RELATIONSHIP 组织可信定义，保留产品层 R、产品整体与整构造口径。解释厚度关系保留 λ、α、其他构造层和表面热阻不变的前提，不生成缺参计算或合规结论。
4. **产品咨询的信息目标未传递。** 问优势/不足可能退回产品清单。现在将现有 PROS_CONS 目标传给事实回答层；资料不足时说明真实缺项和可查方向，不编造用途、组成、优点或竞品结论。普通介绍仍按现有知识库简短提供；产品身份、参数焦点、同值与低于条件分别延续。
5. **λ 回答堆叠内部诊断。** 单一材料或产品归属的查询改为直接给筛选条件、值和来源，取消默认“命中构成”“跨归属”等内部表述。多归属结果仍区分对象，来源未核实的记录不参与匹配；截断展示如实说明，未删后台事实、审计信息或筛选校验。
6. **H5 环境配置没有传入客户端。** Vite 只在配置函数中读取 envDir，客户端仍使用默认 API 地址，真实 H5 登录曾请求 localhost:3000。仅补 `envDir` 配置项，使客户端与既有代理读取同一环境目录，没有改地址、凭据或环境文件。

没有改正式公式、规则版本、已发布源数值、生产模板、历史 Snapshot 或生产业务记录；没有新增失败原句专用关键词、正则、语义匹配白名单，AST 仍为原 12 个关键文件 / 54 条精确白名单。

## 执行与判定方式

真实 H5 的输入、选择、Final、确认、报告预览经过正式页面与 HTTP/SSE，上游始终是已批准的 DeepSeek Chat，受支持的 JSON-object 输出继续经 Backend Zod、原话证据及业务权限校验。没有 Mock 模型、预设 Semantic JSON、模型替换、合成工程数据或改写原问。

来源连接强制只读；每个轮次复制现有业务资料到独立随机数据库/Redis/OSS 前缀，源工程 JSON 按哈希核验一致，生产写入为 0。测试账号与报告、快照只存在隔离环境。图片与预览使用独立 Edge 直连上下文，系统代理未改；这证明该测试网络路径可访问，不证明默认用户网络或文件下载问题已恢复。

最终先在同一冻结源码下执行原始 R1 三轮，核验后执行其余独立会话的原始 32 问；组内顺序与问题逐字不变，报告按原组序排列。两个原始执行矩阵均保留。没有重复挑选一次成功来覆盖失败记录。

原始 35 问文件 SHA256：`59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`。

最终原始证据：[35 问矩阵](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/matrix.json), [先执行 R1 三轮](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/matrix-targeted-r1.json), [其余 32 问](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/matrix-remaining32.json), [逐轮业务复核](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/fixed35-business-review.json), [Semantic 跟踪](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/semantic.ndjson), [上游 HTTP 请求记录](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/upstream-requests.json), [HTTP/SSE 总记录](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/http-sse.ndjson)。

## 固定 35 问逐轮结果

每行链接包含原始 SSE；完整回复、实际决策、来源和本轮理由见上述逐轮复核与同名 `.backend.json`，PASS 不仅依据 HTTP 200。

| 轮次 | 原问 | 结果 | 业务判定 / 证据 |
| --- | --- | --- | --- |
| S1-T1 | 介绍下VICP产品。 | **PASS** | 从已确认知识库列出产品名称和可查参数，没有补造用途或完整产品系列。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S1-T1.sse.txt) |
| S1-T2 | 我不是工程师，简单说就行。 | **PASS** | 延续产品上下文，以简短语句介绍现有资料，未生成方案或报告。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S1-T2.sse.txt) |
| S2-T1 | 有保温0.3的材料吗？ | **PASS** | 保留0.3并只澄清指标，没有把未明指标当作K或扫描全部材料。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S2-T1.sse.txt) |
| S2-T2 | 导热系数。 | **PASS** | 实际查询λ EXACT 0.3；无命中，不返回大于目标的泛化材料列表。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S2-T2.sse.txt) |
| S2-T3 | 如果没命中，是没有这个数值，还是缺资料？这次查了哪些？ | **PASS** | 解释上一轮λ=0.3的匹配与资料范围，没有将无命中说成市场上不存在。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S2-T3.sse.txt) |
| S3-T1 | 薄膜灰0.3的有吗？ | **PASS** | 保留数值线索并澄清指标、体系名称，不擅自归一未知体系。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S3-T1.sse.txt) |
| S3-T2 | 我说的是传热系数K，体系是薄抹灰外保温。 | **PASS** | 补充K和薄抹灰体系后继续查询，保留0.3目标、参考来源及只读状态。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S3-T2.sse.txt) |
| S3-T3 | 只看Ⅲ型。 | **PASS** | 只收窄为Ⅲ型，保留K=0.3的既有匹配口径；实际4档均有来源。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S3-T3.sse.txt) |
| S4-T1 | 你们产品有什么优势和不足？ | **PARTIAL** | 已按优劣目标说明现有资料限制并提供核对方向；缺正式正文，不能给完整优缺点结论。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S4-T1.sse.txt) |
| S4-T2 | 和其他保温材料比呢？ | **PARTIAL** | 缺同条件竞品资料，未形成完整比较。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S4-T2.sse.txt) |
| S5-T1 | 客户要做外墙保温，我想先选个VICP参考方案。 | **PASS** | 给出参考选型所需信息与可提供的帮助，未替用户选Final或承诺达标。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T1.sse.txt) |
| S5-T2 | 先用已发布的200mm钢筋混凝土基层Excel示例，不判断达标。 | **PASS** | 列出合法25mm正式参考行，明确排除35mm/25mm绑定冲突，未创造候选。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T2.sse.txt) |
| S5-T3 | 把整体法25mm和分层法35mm的输入、K和限制放一起比较，不当作同厚度对比。 | **PARTIAL** | 正确说明35mm/25mm绑定冲突及可用候选，不再泛化澄清；所需双方案比较仍受正式资料阻塞。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T3.sse.txt) |
| S5-T4 | 先选择整体法25mm这套。 | **PASS** | 真实自然语言选择整体法25mm成功，当前仅选1个，没有自动确认。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T4.sse.txt) |
| S5-T5 | 把这套设为最终方案，参数先让我核对，不要确认。 | **PASS** | 进入Final待确认，未因“设最终”产生Snapshot或报告。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T5.sse.txt) |
| S5-T6 | 我核对好了，请显示确认入口，我自己点按钮。 | **PASS** | 展示确认入口，由真实H5按钮触发确认，冻结本人会话的单方案Snapshot。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T6.sse.txt) |
| S5-T7 | 我要导出PDF，请显示生成入口，我自己操作。 | **PASS** | 展示PDF入口，由真实H5操作生成READY报告；另行下载网络问题单独列PARTIAL。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/S5-T7.sse.txt) |
| R1-T1 | Ⅲ型VICP薄抹灰外保温，45mm，有哪些基层做法？ | **PASS** | Ⅲ型45mm四种基层及K、两种R口径与确认页25/26一致，未跨层补算。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R1-T1.sse.txt) |
| R1-T2 | 把四种基层的K放在一张表里，哪个最低？ | **PASS** | 四种基层45mm的K并列，明确最低/最小0.248；未据此改变实际基层或自动选型。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R1-T2.sse.txt) |
| R1-T3 | 给我看对应原页，定位45mm那档。 | **PASS** | 继续引用页25/26和45mm档，没有重新检索后替换所比较记录。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R1-T3.sse.txt) |
| R2-T1 | I型VICP平屋面，正置和倒置的20mm档分别怎么样？ | **PASS** | 保留I型、平屋面、正置/倒置和20mm两组；R=3.2与整构造R=3.569分列。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R2-T1.sse.txt) |
| R2-T2 | 把两组的R和K列在一起，R是哪一层或哪一列也写清楚。 | **PASS** | 继续并列两组K=0.280及原表R口径；产品整体R缺失时明确保留缺失。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R2-T2.sse.txt) |
| R2-T3 | 打开原图，定位20mm这档。 | **PASS** | 真实页面引用原页53和20mm两档，未误用正式可选候选或改变热阻口径。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R2-T3.sse.txt) |
| R3-T1 | 按Excel右侧分层构造，芯材15mm，给我分层热工计算过程，先不判断达标。 | **PASS** | 15mm芯材按冻结正式分层参数计算，R总=5.306822098，独立公式核对一致。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R3-T1.sse.txt) |
| R3-T2 | 把芯材改成20mm，其他层不变。 | **PASS** | 仅芯材改20mm，其余层保持；R总=6.906822098，独立公式核对一致。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R3-T2.sse.txt) |
| R3-T3 | 列出公式版本、参数来源和缺项；缺了关键参数就不要硬算。 | **PASS** | 读取既有20mm计算，保留规则/公式版本和来源，没有新增第三次计算。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R3-T3.sse.txt) |
| R4-T1 | 浙江省住宅外墙，传热系数K为0.3，能达标吗？ | **PASS** | 没有正式适用标准限值，明确无法判定浙江住宅外墙K=0.3达标。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R4-T1.sse.txt) |
| R4-T2 | 依据哪份正式标准、哪条限值，什么时候生效？ | **PASS** | 解释紧邻真实核验的依据缺项；不自由补适用维度、标准号、限值或日期。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R4-T2.sse.txt) |
| R5-T1 | 查询已发布的VICP-OVERALL和VICP-LAYERED参考行，分别保留输入条件及来源。 | **PARTIAL** | 35mm分层行绑定25mm规格，当前只保留一条合格正式候选。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T1.sse.txt) |
| R5-T2 | 并排比较K、各R的范围和厚度，不按K替我选最终方案。 | **FAIL** | 已明确说明排除原因及可用25mm候选，但不足两条合格正式候选，所需比较未完成。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T2.sse.txt) |
| R5-T3 | 选整体法25mm作为Final，保留分层示例作参考，先不要确认。 | **FAIL** | 正确说明整单未执行；保留无效分层参考的组合请求仍未形成Final，不部分执行或放宽身份。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T3.sse.txt) |
| R5-T4 | 核对最终方案的参数、规则版本和Sheet1来源。 | **PARTIAL** | 未形成Final，只能核对当前参考事实。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T4.sse.txt) |
| R5-T5 | 先停在待确认状态，别生成快照或报告。 | **PARTIAL** | 未自动建快照/报告，但所要求的Final待确认状态尚未形成。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T5.sse.txt) |
| R5-T6 | 确认入口给我，我来点击；不要根据这句聊天自动确认。 | **FAIL** | 无Final，未完成该会话确认闭环。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T6.sse.txt) |
| R5-T7 | 显示PDF生成入口，我自己点击后再打开看。 | **FAIL** | 无Final/Snapshot，没有该会话的正式PDF。 [SSE](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/R5-T7.sse.txt) |

## 核心链路与事实核验

- R1 四个 45mm 构造严格保留：A3-1 K=0.302、A3-2 K=0.294、外墙 A3-3 K=0.293、外墙 A3-4 K=0.248，最低为 0.248。继续比较保留 III 型、薄抹灰、45mm、文档与版本限制；回读印刷页 25/26。最终模型采用保留条件的查询排序路径，实值、来源与无正式副作用核验通过；另有跨模块自动测试验证等价只读归一路径。未将路由名称当成业务预期。
- R2 屋面保留芯层热阻 3.2、整构造总热阻 3.569、K=0.28；没有把未单独给出的产品整体热阻补成芯层热阻，原图印刷页 53 实际打开。
- S2 指标澄清后保留原数值 0.3 与 EXACT，S3 保留体系、型号与 K 目标 0.3；普通咨询 S4 不再留下待查合同。
- 15mm / 20mm 芯材两次真实计算与独立公式复核一致，总热阻分别约 5.306822098 与 6.906822098，K 取相应倒数。无第三次未授权计算；概念追问不恢复旧计算。
- λ 真实查询逐条对照比较符及目标值，材料范围连续修改 `<0.01 → <0.02 → >0.2`，换话题后不恢复旧 λ 查询；新缺指标问题只澄清，不带旧数值查询。
- 有效 25mm 单方案实际完成查询卡片、历史恢复、加入、Final、Confirm、Snapshot、PDF READY 共 7 步；双方案比较在该补测中明确 NOT_RUN，不能替代原 R5 的失败。最终环境共有 2 份 CONFIRMED Snapshot / 2 份 READY 报告，报告仅来自明确授权会话与冻结快照。
- PDF 为真实生成文件的受控页面预览，两页指向同一个 PDF SHA256；桌面、390px 移动端、翻页和缩放通过，已目视检查实际第二页的 25mm、R=4、R₀=4.3068、K=0.2322、来源、未做合规声明和已批准免责声明，未点击下载。
- 原始页 25、26、53 的图片均实际加载，宽度 2723px；未以签名 URL 或 HTTP 200 代替原图展示。
- 105 项权限与幂等回归通过，涵盖本人、其他用户、跨端、未登录、候选、Solution、Snapshot、报告及预览/下载 URL 授权；重复 Confirm 不增加快照。下载 URL 检查不包含文件传输。

关键证据：[R1 条件及数值核验](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/targeted-r1-review.json), [单方案闭环](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/single-flow.json), [独立数值和状态校验 27 项](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/independent-audit.json), [权限 105 项](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/security-acceptance.json), [真实 PDF 页面预览](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/pdf-reader-audit.json), [PDF 实际第二页](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/pdf-actual-page-2.png), [原图实际展示](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/source-ui/source-image-review.json), [报告快照模板审计](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/report-snapshot-audit.json)。

## 关联场景及历次真实失败记录

原 35 问外，概念 6 问、产品连续咨询 5 问、参数连续筛选 5 问共 16 个额外场景；其中参数 5 问在多个版本复测，共保留 36 次逐轮 PASS 记录。它们不计入原 35 问通过数，也不是独立人工盲测。最终参数复测通过；概念、产品场景在未再变更相应实现后保留关联实测和最终全量测试。

[36 次逐轮额外复核](evidence/dialogue-remaining-quality-2026-10-21/business-rounds-summary.json)。

| 轮次 | 原 35 问执行情况 | 主要发现 |
| --- | --- | --- |
| round-01 | NOT_RUN（仅额外场景） | 概念目标和 H5 客户端 envDir 问题；初始记录保留。 |
| round-02-final | 25 PASS / 5 PARTIAL / 5 FAIL | 普通咨询澄清误存为查询条件；后续上下文拒绝。 |
| round-03-verified | 25 PASS / 4 PARTIAL / 6 FAIL | 产品优劣目标未传达，通用缺项标记仍污染待查状态。 |
| round-04-acceptance | 25 PASS / 6 PARTIAL / 4 FAIL | 当轮恢复到资料阻塞状态，关联16问通过。 |
| round-05-delivery | 24 PASS / 6 PARTIAL / 5 FAIL | 真实模型 REFINE+comparison 被 Policy 拒绝，R1 比较失败。 |
| round-06-final-uat | 24 PASS / 6 PARTIAL / 5 FAIL | 只改 intent 仍未同步 relation，原页读取失去续读入口。 |
| round-08-final-acceptance | 25 PASS / 6 PARTIAL / 4 FAIL | 所有本轮修复定向通过；4项资料阻塞仍保留 FAIL。 |
| round-07-final-verification | 原始 R1 三轮：2 PASS / 1 FAIL；其余32问 NOT_RUN | 等价极值同时带重复排序偏好仍被拒绝；未伪称完整35问通过。 |

所有轮次的失败 SSE、Semantic、模型原始输出、源码哈希和实际查询条件均保留。测试工具自身的问题也单列：

- 初始 pnpm 自动依赖检查与非交互安装冲突，后续使用 `--config.verify-deps-before-run=false` 执行已有依赖；没有以更换依赖修复产品。
- 新测试曾把布尔值传进 aliases 位置，修正为原 API 参数后断言不变；首次失败日志保留，真实轮次开始前冻结相应修正。
- round-04 的单方案补测与其他对话并行造成 429，原请求及失败结果保留；改为串行操作后闭环通过，未调整限流。
- round-08 初次登录发生在隔离 API 未就绪时；重开干净浏览器后正常登录，没有改登录权限或绕过真实页面。
- 预检曾误要求 R1 必须命名为 COMPARE 且 queryChanged=false；实际排序查询的 III型/体系/45mm/来源及四组数值完整保持。保留失败预检，改用实际业务条件和逐值核验，不改原问、工程值或原35问业务预期。
- 数值复核曾把 3.200 与 3.2 当成不同输出，改为数值等价判断；工程预期仍为 3.2。咨询审计曾硬要求连续字串“优势和不足”，自然答复为“优势和短板”；失败审计保留，改核实际 PROS_CONS 目标、资料不足事实与只读边界，人工逐轮判定仍为 PARTIAL。
- 最终交付检查脚本最初将 PNG 当 UTF-8、混淆 Vitest JSON 对 expected-fail 的计数、以及图片审计的 PASS_DIRECT_NETWORK 状态名称；均修正工具读取方式，原测试结果、状态与业务预期没有改变。

## 自动检查与源代码一致性

| 检查 | 最终结果 | 证据 |
| --- | --- | --- |
| 后端定向回归 | 151 PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/targeted-equivalent-preference.log) |
| 后端全量测试 | 3083 PASS / 1 expected fail / 1 skipped；0非预期失败 | [日志](evidence/dialogue-remaining-quality-2026-10-21/backend-tests-acceptance.log) |
| 后端 lint / AST / TypeScript | PASS；原12文件54条白名单 | [日志](evidence/dialogue-remaining-quality-2026-10-21/lint-equivalent-preference.log) |
| 后端 build | PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/backend-build-acceptance.log) |
| 主工作区 lint / build | PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/main-lint-acceptance.log) |
| App 自动测试 | 158 PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/app-tests.log) |
| App type-check | PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/app-typecheck-final.log) |
| App H5 build（uatrepair） | PASS | [日志](evidence/dialogue-remaining-quality-2026-10-21/app-build.log) |
| 数据库迁移检查 | PASS；无迁移改动 | [日志](evidence/dialogue-remaining-quality-2026-10-21/db-check.log) |

Vitest JSON 将 1 项 expected-fail 计入 passed，JSON numPassedTests=3084；控制台按 3083 passed + 1 expected fail 单列。本报告采用后者，没有隐藏额外失败。所有命令退出码为 0。

主工作区与受测工作树的 26 个归属文件逐字节哈希一致；全部 938 个 Backend/App src 文件经文本 BOM/换行归一或二进制逐字节对照，没有语义差异。最终运行 Backend/App/config 哈希无漂移；未覆盖其他任务的改动。合并前逐一核对主目录原值或上次本任务写入哈希，冲突即停止。

[源码、检查退出码与清理一致性](evidence/dialogue-remaining-quality-2026-10-21/source-delivery-integrity.json)，[仅归属文件合并证明](evidence/dialogue-remaining-quality-2026-10-21/merge-verification.json)，[完整补丁](evidence/dialogue-remaining-quality-2026-10-21/repair.patch)。

## 修改文件清单

实现、测试与治理文件共 26 个；本报告和 evidence 为另行交付的验收产物。

| 文件 | 类型 |
| --- | --- |
| `backend/src/modules/ai/ai-domain-policy.ts` | MODIFIED |
| `backend/src/modules/ai/ai-domain-semantic.ts` | MODIFIED |
| `backend/src/modules/ai/ai-domain-turn-decision.service.ts` | MODIFIED |
| `backend/src/modules/ai/reference-fact-read.service.ts` | MODIFIED |
| `backend/src/modules/ai/reference-fact-read.service.test.ts` | MODIFIED |
| `backend/src/modules/ai/thermal-metric-explanation.ts` | ADDED |
| `backend/src/modules/ai/thermal-metric-explanation.test.ts` | ADDED |
| `backend/src/modules/ai/query-need.ts` | MODIFIED |
| `backend/src/modules/ai/query-need.test.ts` | MODIFIED |
| `backend/src/modules/ai/query-clarification-context.ts` | MODIFIED |
| `backend/src/modules/ai/query-clarification-context.test.ts` | MODIFIED |
| `backend/src/modules/ai/ai-generation.service.ts` | MODIFIED |
| `backend/AGENTS.md` | MODIFIED |
| `backend/README.md` | MODIFIED |
| `backend/.cursor/rules/30-ai-and-reports.mdc` | MODIFIED |
| `backend/.agents/skills/lg-backend/references/ai-and-reports.md` | MODIFIED |
| `app/vite.config.ts` | MODIFIED |
| `backend/src/modules/ai/reference-query.service.ts` | MODIFIED |
| `backend/src/modules/ai/product-answer.ts` | MODIFIED |
| `backend/src/modules/ai/product-presentation.test.ts` | MODIFIED |
| `backend/src/modules/ai/product-parameter-generation.test.ts` | MODIFIED |
| `backend/src/modules/ai/product-parameter-read.service.ts` | MODIFIED |
| `backend/src/modules/ai/product-parameter-read.service.test.ts` | MODIFIED |
| `backend/src/modules/ai/ai-domain-policy.test.ts` | MODIFIED |
| `backend/src/modules/ai/ai-domain-turn-decision.service.test.ts` | MODIFIED |
| `backend/src/modules/ai/confirmed-page-reference-read.test.ts` | MODIFIED |

[逐文件改前/改后 SHA256](evidence/dialogue-remaining-quality-2026-10-21/change-manifest.json)。

## 未解决事项与上线边界

1. **正式 35mm 分层记录仍绑定 25mm 规格。** 用户已确认无正式修订依据。本轮保留原值、冲突说明和候选排除；R5 的双候选比较、复合操作、Final、确认和 PDF 因而未完成。不能自动补建产品规格或拆分本应原子执行的复合请求来把它标 PASS。待甲方提供正式修订和版本后，正常修订发布，再重跑 S5/R5 及完整35问。
2. **产品介绍/优缺点及竞品资料有限。** 用户确认暂无产品手册，按现有知识库做简短介绍；可说明可信热工参数和核对方向，完整卖点/竞品结论仍 PARTIAL。不能把材料层参数当作产品目录，或把一般知识写成该产品已证实特点。
3. **正式地区标准/限值数据未发布。** 隔离副本中相关正式标准表为 0，缺依据的真实分支已验证，不编造限值或合规结论；有正式标准的正向合规真实 UAT 本轮 NOT_RUN。
4. **原资料疑点保留。** A2-2 的基层15mm/保温190mm、A3-3 λ=0.0012 无正式勘误，按用户要求保留并标疑，不静默改值。不能将来源可读等同于工程合理性已获甲方复核。
5. **免责声明仅准备变更。** 已批准句子为“本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。”隔离环境经正常 B 端模板版本流程验证，旧模板内容未改、C 端无模板修改权；生产版本尚未发布。上线时仍应按正式版本流程发布该模板变更。
6. **文件下载不在本轮范围。** 未修复或复测默认网络路径的文件下载，不给出下载已恢复结论。

因此现在不能给 READY。软件修复已合并到本机，资料阻塞和生产模板版本准备状态保持真实；没有执行线上发布。

## 测试资源清理与交付

8 个隔离环境的随机数据库已删除，Redis 前缀剩余键为 0，最终环境追踪的4个测试对象已清理，所有环境 cleanup.failures 为空。API/H5/测试浏览器已停止，临时测试登录文件已删除。生产源只读、没有迁移或业务写入；管理工作树保留供继续审阅。

[独立只读清理复核](evidence/dialogue-remaining-quality-2026-10-21/cleanup-independent-check.json)，[最终环境与逐表指纹](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/environment.json)，[最终源码冻结复核](evidence/dialogue-remaining-quality-2026-10-21/round-08-final-acceptance/source-integrity-at-close.json)。
