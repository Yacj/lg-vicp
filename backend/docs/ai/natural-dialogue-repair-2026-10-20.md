# 小格 AI 自然对话修复与最终 UAT（2026-10-20）

**结论：NOT_READY。** 本轮代码修复已合入原工作区，未再次部署线上。原始35问全部执行，最终 **23 PASS / 7 PARTIAL / 5 FAIL**；仍有资料、正式报告模板及咨询质量缺项，不能据自动测试或单方案闭环给出 READY。

## 修复范围与根因

产品咨询以当前有权、已发布知识库为主要依据，正式目录为补充；目录只有一个SKU不代表产品全集。知识库原表中的板材/材料层、正式供货规格、整构造参数分别保留身份和来源。

| 根因 | 本轮处理 |
| --- | --- |
| 模型重建请求，澄清轮丢失数值、比较符、名称或查询目标 | Backend按同会话/用户/客户端/项目和24小时有效期串联原问与补充；执行前后检查条件不扩大；服务独立重验 |
| 未知名称被删除后重查，λ只读变成全库混合列表 | 保留原名称及范围；无法可靠绑定则说明缺项，不转成无条件全库READ |
| 多套语义字段冲突，来源校验错误污染其他字段；重试未经过相同来源校验 | 字段校验隔离；原提案与修正提案统一进入来源绑定。模型只提来源显示名，Backend唯一绑定已发布来源；不改变原查询条件或降低门槛 |
| 产品追问范围、参数参照值和结果列表混在一起 | 参数焦点绑定实际展示值与来源/Revision；其他产品列表不覆盖原焦点。单值、同值、更低、修改目标和换话题分别处理 |
| 介绍、参数定义和改写表达混为一类 | 区分REPHRASE、PARAMETERS、EXPLAIN_PARAMETER、FIND_OTHERS；只读复核不能补名称、数值、ID或操作授权；解释λ不再落入只支持K/R的热工DEFINE |
| 同名对象命中一个值后携带其他未命中属性；原页多轮比较重复 | 按满足条件的属性与对应来源过滤；按文档/版本/页面/Revision/构造/档位去重，不按相同数值合并不同来源 |
| 为避免编数值而固定拼模板；自由表达又把隐藏值说成缺资料 | Backend提供对象/属性/来源事实；模型自然组织后逐对象数值核验，并核验别名、派生结论、参数存在声明及没有审核简介支持的内部构造/芯材/机制/优势推断。概览明确“本轮不展开数值”，不能声称资料缺参；失败回落仅事实回答 |

保留正式候选身份、权限、来源、Revision、计算版本、Final/Confirm、不可变Snapshot与报告授权保护。没有修改生产数据、原表疑点、历史快照或已发布计算规则；没有更换DeepSeek模型，没有添加失败原句专用正则。

动作Parser返回NONE时，生成编排直接读取真实方案状态回答，不再落入自由生成；未形成Final就明确说明前置缺失，不声称已保持待确认。

## 真实验收环境与证据

运行工作区：`C:/Users/admin/.codex/worktrees/natural-dialogue-repair/lg-vicp`；最终源码已按SHA256核对合入`D:/work/lg-vicp`。本轮开始时原工作区224份已有修改/新增文件的快照已保留；仅合入本轮清单，未回退并行任务工作。

- 实际Edge H5页面，真实HTTP/SSE，当前批准模型DeepSeek Chat；最终轮实际记录150次上游模型HTTP请求，未使用严格JSON Schema接口或Mock。
- 来源连接强制只读，复制当前资料到随机独立数据库；测试账号、Redis队列和生成报告OSS前缀隔离。测试数据没有伪造工程参数。
- 固定35问原文件SHA256：`59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`，原问逐字保留。
- 最终轮执行四组人工失败原问7轮、产品链5轮、参数修改/换话题5轮、原35问、补充自然追问7轮，另有单方案H5按钮流程，并在独立新会话重复7轮产品追问（共67次实际用户输入）。[附加31轮判定](evidence/natural-dialogue-repair-2026-10-20/round-22-final/extra-business-review.json)为26 PASS / 5 PARTIAL。补充样本由同一执行者审阅，**不冒充独立人工盲测**。
- [原始35问运行记录](evidence/natural-dialogue-repair-2026-10-20/round-22-final/matrix.json)、[逐轮判定](evidence/natural-dialogue-repair-2026-10-20/round-22-final/business-review.json)、[真实Semantic轨迹](evidence/natural-dialogue-repair-2026-10-20/round-22-final/semantic.ndjson)、[查询条件核验](evidence/natural-dialogue-repair-2026-10-20/round-22-final/independent-condition-audit.json)。原始执行状态保留，不把EXECUTED_REVIEW_REQUIRED改成自动PASS。

## 自动检查与真实业务链

| 检查 | 结果与边界 |
| --- | --- |
| Backend全量 | 2933通过，1个既有预期失败，1跳过；构建、类型及语义AST检查通过 |
| 既有预期失败 | 客户分层例完整产品R=5.0，当前规则只累加PRODUCT_LAYER芯材R=4.8；已标口径，不混称。正式修正须产品组/子层定义与新公式版本，未修改原规则 |
| PDF依赖跳过 | 实际图集PDF的CAD/目录回归缺少该用例依赖源文件；与本轮实际生成的报告PDF是不同检查 |
| App | 155测试通过，类型检查及H5构建通过；本轮未修改App运行代码。构建仍有原有Browserslist/图标告警 |
| 查询条件与数据 | λ执行5次、产品条件5组，返回值越界0；S3保留III型+K=0.3+体系；冻结源码漂移0。另核对S5的Excel来源、200mm钢筋混凝土范围 |
| 分层计算 | 独立按客户公式核对15mm芯材R=4.8、总R=5.3068220978、K=0.1884366918；改20mm后芯材R=6.4、总R=6.9068220978、K=0.1447843865。固定层和表面热阻保留，未作规范达标结论 |
| 单方案真实闭环 | 以唯一合格25mm候选执行查询卡片→历史恢复→选用→Final→手动Confirm→Snapshot→真实PDF；不代替双候选比较验收 |
| 权限与冻结回归 | 129项通过，含真实存在的私有项目、其他用户/客户端/未登录访问、候选成员、旧Revision、重复确认、Snapshot会话/项目绑定和报告访问；快照数量不被负向检查改变 |
| 原页/表格 | 实际图片加载、全屏表格、高亮切换/清除与390px窄屏核验。表头继续按客户原表显示投影；缺已核验坐标时明确说明未做像素框选 |
| PDF | 实际下载2页PDF，Snapshot/规格/来源/K/R文字核对及逐页独立渲染；预览接口取得文件与实际浏览器下载文件SHA256一致。**下载通过；浏览器预览截图为空白，不能判直接阅读体验通过；预览PARTIAL。** 内部免责声明占位仍在，内容验收PARTIAL；无原生手机及所有浏览器PDF阅读器兼容性结论 |

[权限原始结果](evidence/natural-dialogue-repair-2026-10-20/round-22-final/security-acceptance.json)、[单方案按钮记录](evidence/natural-dialogue-repair-2026-10-20/round-22-final/single-flow.json)、[PDF入口及真实文件响应](evidence/natural-dialogue-repair-2026-10-20/round-22-final/pdf-ui-audit-02.json)、[独立公式/PDF内容核验](evidence/natural-dialogue-repair-2026-10-20/round-22-final/independent-artifact-audit.json)。浏览器下载转交时出现的ERR_ABORTED与实际下载事件及完整字节一并核对，没有将网络码单独作为业务结论。

## 原始35问逐轮判定

| 回合 | 原始问题 | 判定 | 依据 |
| --- | --- | --- | --- |
| [S1-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S1-T1.sse.txt) | 介绍下VICP产品。 | **PASS** | 概览来自已发布知识库与目录，未补造用途、认证或性能。 |
| [S1-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S1-T2.sse.txt) | 我不是工程师，简单说就行。 | **PARTIAL** | 保留产品范围且未再谈后台流程，但通俗追问仍偏长清单，“配套”等关联用语缺独立证据，质量未完全通过。 |
| [S2-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S2-T1.sse.txt) | 有保温0.3的材料吗？ | **PASS** | 只澄清未确定的指标。 |
| [S2-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S2-T2.sse.txt) | 导热系数。 | **PASS** | 沿用0.3读取λ；未命中未伪称全市场不存在。 |
| [S2-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S2-T3.sse.txt) | 如果没命中，是没有这个数值，还是缺资料？这次查了哪些？ | **PASS** | 说明当次范围、独立λ及未命中原因；未重新筛选或计算。 |
| [S3-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S3-T1.sse.txt) | 薄膜灰0.3的有吗？ | **PASS** | 薄膜灰不自动改名，先明确指标。 |
| [S3-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S3-T2.sse.txt) | 我说的是传热系数K，体系是薄抹灰外保温。 | **PASS** | 用户明确K和薄抹灰后保留0.3，按已有近似口径查确认页。 |
| [S3-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S3-T3.sse.txt) | 只看Ⅲ型。 | **PASS** | 在原体系及K目标内收窄III型，仍有来源。 |
| [S4-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S4-T1.sse.txt) | 你们产品有什么优势和不足？ | **PARTIAL** | 给出厚度、基层、防火固定、施工与成本核对维度；未直接提供有资料支持的产品优缺点。 |
| [S4-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S4-T2.sse.txt) | 和其他保温材料比呢？ | **PARTIAL** | 仍主要要求明确比较对象，未提供新的同条件比较内容；不能判为完整咨询通过。 |
| [S5-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T1.sse.txt) | 客户要做外墙保温，我想先选个VICP参考方案。 | **PASS** | 建议补现场条件以查参考，不给无据合规结论。 |
| [S5-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T2.sse.txt) | 先用已发布的200mm钢筋混凝土基层Excel示例，不判断达标。 | **PASS** | 统一来源复核后返回唯一合格25mm正式行，保留200mm钢筋混凝土与Excel来源；35/25mm冲突行明确排除。 |
| [S5-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T3.sse.txt) | 把整体法25mm和分层法35mm的输入、K和限制放一起比较，不当作同厚度对比。 | **FAIL** | 只有一条合格正式候选，无法完成整体25mm与分层35mm双方案比较；未伪造缺失候选。 |
| [S5-T4](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T4.sse.txt) | 先选择整体法25mm这套。 | **PASS** | 自然称呼由Backend绑定当前唯一整体法25mm候选，实际更新选用状态。 |
| [S5-T5](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T5.sse.txt) | 把这套设为最终方案，参数先让我核对，不要确认。 | **PASS** | 实际指定Final并展示核对参数，未自动确认。 |
| [S5-T6](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T6.sse.txt) | 我核对好了，请显示确认入口，我自己点按钮。 | **PASS** | 真实H5确认按钮执行成功，实际形成不可变Snapshot；非仅文字提示。 |
| [S5-T7](evidence/natural-dialogue-repair-2026-10-20/round-22-final/S5-T7.sse.txt) | 我要导出PDF，请显示生成入口，我自己操作。 | **PARTIAL** | 真实H5生成入口已点击，报告可由后台继续生成；正式模板仍含内部免责声明占位，内容验收未通过。 |
| [R1-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R1-T1.sse.txt) | Ⅲ型VICP薄抹灰外保温，45mm，有哪些基层做法？ | **PASS** | III型薄抹灰45mm各基层只读结果有据。 |
| [R1-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R1-T2.sse.txt) | 把四种基层的K放在一张表里，哪个最低？ | **PASS** | 在原集合中比较K最小项，未用全库值代替。 |
| [R1-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R1-T3.sse.txt) | 给我看对应原页，定位45mm那档。 | **PASS** | 回看当轮实际来源及档位。 |
| [R2-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R2-T1.sse.txt) | I型VICP平屋面，正置和倒置的20mm档分别怎么样？ | **PASS** | 正倒置20mm同值记录保留独立构造。 |
| [R2-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R2-T2.sse.txt) | 把两组的R和K列在一起，R是哪一层或哪一列也写清楚。 | **PASS** | R口径区分原表层热阻、构造传热阻与缺失产品整体R。 |
| [R2-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R2-T3.sse.txt) | 打开原图，定位20mm这档。 | **PASS** | 实际屋面原页20mm档可打开，比较表保持两构造，重复来源已去重。 |
| [R3-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R3-T1.sse.txt) | 按Excel右侧分层构造，芯材15mm，给我分层热工计算过程，先不判断达标。 | **PASS** | 15mm作用于芯层；逐层参数/公式/来源及规则版本保留。 |
| [R3-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R3-T2.sse.txt) | 把芯材改成20mm，其他层不变。 | **PASS** | 改芯材20mm，其他层不变；K与R按同一正式规则生成。 |
| [R3-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R3-T3.sse.txt) | 列出公式版本、参数来源和缺项；缺了关键参数就不要硬算。 | **PASS** | 读取上次计算版本/来源/缺项，不重算或升级合规结论。 |
| [R4-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R4-T1.sse.txt) | 浙江省住宅外墙，传热系数K为0.3，能达标吗？ | **PASS** | 正式标准限值库为空，未给达标结论。 |
| [R4-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R4-T2.sse.txt) | 依据哪份正式标准、哪条限值，什么时候生效？ | **PASS** | 未编造标准号、条款、生效时间。 |
| [R5-T1](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T1.sse.txt) | 查询已发布的VICP-OVERALL和VICP-LAYERED参考行，分别保留输入条件及来源。 | **PARTIAL** | 35mm参考行误绑25mm规格被排除；只有整体法可确认候选，双方案未齐。 |
| [R5-T2](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T2.sse.txt) | 并排比较K、各R的范围和厚度，不按K替我选最终方案。 | **FAIL** | 缺第二条有效候选，未完成比较。 |
| [R5-T3](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T3.sse.txt) | 选整体法25mm作为Final，保留分层示例作参考，先不要确认。 | **FAIL** | 包含保留分层参考的复合自然指令未成功形成Final。 |
| [R5-T4](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T4.sse.txt) | 核对最终方案的参数、规则版本和Sheet1来源。 | **PARTIAL** | 缺少实际已选/Final前置，未能完成最终方案核对；未虚构正式方案。 |
| [R5-T5](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T5.sse.txt) | 先停在待确认状态，别生成快照或报告。 | **PARTIAL** | 按真实方案状态说明尚未形成待确认Final，未生成快照或报告；目标状态受前置阻塞。 |
| [R5-T6](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T6.sse.txt) | 确认入口给我，我来点击；不要根据这句聊天自动确认。 | **FAIL** | 没有Final，确认入口未完成。 |
| [R5-T7](evidence/natural-dialogue-repair-2026-10-20/round-22-final/R5-T7.sse.txt) | 显示PDF生成入口，我自己点击后再打开看。 | **FAIL** | 没有Final/快照，PDF入口未完成。 |

## 修复过程中的完整35问复测

以下仅统计真正执行完整35问且有逐轮判定的轮次。其他编号为定向、环境检查或无效中断，不称为完整UAT。round-14因工作区源码意外回退而作废，保留证据；未把它计入通过记录，恢复后重测。未确定回退来源，不归因于其他任务。

| 完整轮次 | PASS | PARTIAL | FAIL |
| --- | --- | --- | --- |
| [round-10](evidence/natural-dialogue-repair-2026-10-20/round-10/business-review.json) | 23 | 5 | 7 |
| [round-11](evidence/natural-dialogue-repair-2026-10-20/round-11/business-review.json) | 20 | 5 | 10 |
| [round-12](evidence/natural-dialogue-repair-2026-10-20/round-12/business-review.json) | 21 | 4 | 10 |
| [round-13](evidence/natural-dialogue-repair-2026-10-20/round-13/business-review.json) | 23 | 6 | 6 |
| [round-15](evidence/natural-dialogue-repair-2026-10-20/round-15/business-review.json) | 21 | 4 | 10 |
| [round-17-final](evidence/natural-dialogue-repair-2026-10-20/round-17-final/business-review.json) | 18 | 7 | 10 |
| [round-18-final](evidence/natural-dialogue-repair-2026-10-20/round-18-final/business-review.json) | 22 | 8 | 5 |
| [round-19-final](evidence/natural-dialogue-repair-2026-10-20/round-19-final/business-review.json) | 24 | 5 | 6 |
| [round-21-final](evidence/natural-dialogue-repair-2026-10-20/round-21-final/business-review.json) | 23 | 7 | 5 |
| [round-22-final](evidence/natural-dialogue-repair-2026-10-20/round-22-final/business-review.json) | 23 | 7 | 5 |

## 尚未解决及上线门槛

1. **35mm分层正式候选资料冲突。** VICP-LAYERED的35mm参考行绑定VICP-BOARD-25（25mm）。用户确认暂无正式规格/绑定修订依据，因此保留原值并排除。S5/R5要求的双候选比较及保留分层参考的完整链路未通过；不能造35mm规格或把原页材料层升级为正式候选。需要资料负责人发布可验证的新规格/绑定版本后重新执行双方案及报告验收。
2. **正式报告模板仍有内部占位。** 用户已批准正文“本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。”；[版本变更准备](approved-report-template-change-2026-10-19.json)已保留，尚未改生产模板。需要按现有新版本审核/发布流程处理，再重生成并验收，历史报告保持。
3. **咨询质量与软件表达仍有PARTIAL。** S1-T2仍偏长清单，“配套”等关联词缺独立证据；部分单产品介绍/改写仍退成资料清单。这不是全部由外部数据造成，尚未达到完整客服表达要求，后续需要完善通俗概览组织、限定定性关联、以及KB原文证据的安全接入。优势/竞品比较暂无可用审核比较事实；不能把目录summary空直接当作知识库绝无介绍。当前候选不等于Final，前置失败后的说明仍可更具体。
4. **原始资料与正式口径缺项。** A2-2基层15mm/档位190mm、A3-3 λ=0.0012和部分页码/标题疑点原值保留并提示；暂无正式勘误。正式分层产品整体R口径需新计算版本治理；当前没有已发布适用标准数据，不能给规范达标结论。
5. **知识索引质量。** [只读资料审计](evidence/natural-dialogue-repair-2026-10-20/round-22-final/knowledge-scope-audit.json)显示当前全局发布范围有158个有效切片，类型为39段落/18标题/101章节，但抽读实际多为热工表文本；13个章节标题含纯数值、表格残片等污染。不能按切片类型断言没有表或没有产品，后续需审核原文证据与索引治理方案，不直接改已发布工程记录。

6. **人工最终验收未替代。** 同执行者的补充问法、Edge H5和文件检查不代表独立人工盲测、生产部署验收或原生手机全机型验证。修复代码未再次发布线上；完成资料/模板前置后应使用同一原35问及双方案链路复验。

7. **浏览器内PDF阅读未通过最终验收。** 真实H5预览按钮已打开文件地址并收到PDF字节，但本次浏览器预览截图为空白。独立PDF渲染正常不等于浏览器内阅读正常；需在有界面的真实浏览器/手机中复核后才能判断环境限制或软件问题，本轮保留PARTIAL，不归因为已解决。

浏览器还保留两条读取未暴露content-disposition的非阻断警告；实际下载事件、文件名及完整字节已核对通过，本轮没有修改该跨域头配置。

## 交付文件与资源清理

本轮50份实现/测试/治理文件见[修改清单](evidence/natural-dialogue-repair-2026-10-20/modified-files.md)、[前后SHA256](evidence/natural-dialogue-repair-2026-10-20/change-manifest.json)及[基于本轮初始工作区的补丁](evidence/natural-dialogue-repair-2026-10-20/repair.patch)。新增复测脚本在`scripts/natural-dialogue-uat/`；完整原始证据保存在上述目录。未提交或推送Git，未部署、迁移、seed或改写生产资料/快照。

独立数据库、队列与本轮生成OSS对象按各轮environment.json的cleanup记录核验；汇总见[清理与合入核验](evidence/natural-dialogue-repair-2026-10-20/delivery-integrity.json)。源码工作区保留供审阅和复现。
