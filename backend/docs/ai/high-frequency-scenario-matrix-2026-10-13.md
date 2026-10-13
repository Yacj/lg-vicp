# 蓝格智配 · 高频用户问法与多轮场景回归矩阵

> 从销售、设计院、工程人员真实工作任务出发设计。以下“高频”是业务场景优先级判断，**不是基于真实用户日志统计的概率**。可作为测试/验收输入，不是期望模型背出固定答案。精确结果必须取当前已发布数据。

## A. 十类高频首轮问题（共 32 条）

| ID | 用户常见问法 | 意图 / 预期系统动作 | 核心断言 |
|---|---|---|---|
| P01 | 你们主要有哪些保温板？ | PRODUCT_DISCOVERY | 查正式产品，不猜ID；只展示已发布可用产品 |
| P02 | VICP板的 I 型、II 型、III 型有什么区别？ | PRODUCT/KNOWLEDGE | 比性能参数并引用正式来源；不拼接不同型数据 |
| P03 | 你们的板一般有哪些厚度？ | PRODUCT_DETAIL | 按产品/规格给离散厚度档，不编造连续区间 |
| P04 | VICP 能用于外墙吗？ | PRODUCT/KNOWLEDGE | 区分产品应用说明与具体项目合规结论 |
| P05 | 这个板和传统岩棉板相比有什么优势？ | MATERIAL_COMPARE | 有据对比条件/优势与限制，证据不足标明 |
| P06 | 外墙想做到 K 不超过0.3，有哪些做法？ | REFERENCE_QUERY | K/MAX_LIMIT 目标0.3，不当成法规“自动达标” |
| P07 | 有没有比较薄且保温效果好的方案？ | REFERENCE_QUERY | “薄”作排序偏好，缺定量硬约束可先返回候选再追问 |
| P08 | 18mm 的板用在外墙，K 大概多少？ | REFERENCE_QUERY 或 CLARIFY | K 依赖基层/构造；多行时不能只给一个无前提值 |
| P09 | A1-3 18mm 的传热系数是多少？ | REFERENCE_DETAIL/QUERY | 确认体系后精确读正式行，K=0.303（对应原资料版） |
| P10 | 30mm II型的板热阻多少？ | REFERENCE_QUERY 或 CLARIFY | 必须区分产品层R与整墙R₀（必要时一个短问句） |
| P11 | 帮我找产品层热阻 8 左右的档位。 | REFERENCE_QUERY | metric=PRODUCT_R；不能拿TOTAL_R代替 |
| P12 | 整墙总热阻3.3左右有没有？ | REFERENCE_QUERY | metric=TOTAL_R；不是查K=3.3 |
| P13 | K越小越好吗？ | GENERAL/KNOWLEDGE | 概念解释，不污染旧查询，不自动查表 |
| P14 | K、R、R0分别是什么意思？ | GENERAL/KNOWLEDGE | 含单位和工程区别；不强制thermal查档位 |
| P15 | 帮我算一下这个外墙构造的 K。 | THERMAL_CALCULATE | 缺明确构造/规格/厚度时询问，不能用任意历史候选授权 |
| P16 | 55mm II 型按分层法重新算一下。 | THERMAL_CALCULATE | 只用正式已发布数据与确定性Engine，保存计算记录 |
| P17 | 上海住宅项目外墙 K 0.3 符不符合标准？ | COMPLIANCE_CHECK | 查地区+建筑类型+标准版+有效期，不伪造达标 |
| P18 | 这个做法送审能不能过？ | COMPLIANCE_CHECK | 明确不等同仅K判断，缺规范证据谨慎说明 |
| P19 | 窗洞口保温怎么处理？ | KNOWLEDGE_EXPLAIN | 查已发布节点/原文，禁止误进K档位查表 |
| P20 | 图集里的阴阳角做法在哪页？ | KNOWLEDGE/REFERENCE_VIEW | 以印刷页码引用，返回可读原页，不造页码 |
| P21 | VICP外墙施工有什么注意事项？ | KNOWLEDGE_EXPLAIN | 查询文件/章节，引用出处，不给未经依据的结论 |
| P22 | 这种保温系统有无相关检测报告？ | KNOWLEDGE/PRODUCT_DETAIL | 若未上传/未发布，只告知找不到证据 |
| P23 | 混凝土基层和加气砌块基层用同一厚度，K一样吗？ | REFERENCE_QUERY/COMPARE_CANDIDATES | 两条真实构造分别显示，不能合并基层与热工数值 |
| P24 | 这个项目应该优先选哪种保温方式？ | PROJECT/REFERENCE_QUERY | 读取有权限项目事实，给候选和条件，不自动Final |
| P25 | 同样做到K≤0.3，哪个档位更薄？ | REFERENCE_QUERY | 必须先满足硬条件，再按厚度排序；不在topN里宣称全库最薄 |
| P26 | 甲方要控制成本，能对比两种材料吗？ | MATERIAL_COMPARE | 需要有效成本依据；没价格不编造性价比结论 |
| P27 | 能给我几个不同做法让我选吗？ | REFERENCE_QUERY | 候选只是候选，不自动创建SolutionState |
| P28 | 我们项目适合这种构造吗？ | PROJECT/COMPLIANCE_CHECK | 不猜“这种”指代及项目适用条件 |
| P29 | 我想出一份保温方案报告。 | REPORT_REQUEST | 指引明确最终方案与确认，不绕过Snapshot |
| P30 | 帮我把方案做成PDF。 | REPORT_REQUEST | 必须验证Confirmed Snapshot；未具备则解释所缺步骤 |
| P31 | 这个参数是从哪里来的？ | REFERENCE_DETAIL | 当前来源+页标+候选，不能重新猜值 |
| P32 | 你好，你能帮我做什么？ | GENERAL | 自然说明能力；不触发任何方案/热工状态写入 |

## B. 多轮用户故事（回归真正重点）

### S1 销售咨询 → 找方案 → 看资料（4轮）

1. `我做外墙保温的，VICP有哪些类型？` → 查产品/资料（不创建SolutionState）。
2. `那同样是K不超过0.3，有哪些现成做法？` → 新的/继续参考查询由上下文判定，metric=K, MAX_LIMIT，真实查询。
3. `第二个基层是什么，厚度多少？` → 当前可见候选只读详情，不刷新revision。
4. `第二个原页给我看` → 原页同ID、同印刷页、同confirm档位；不能重查。

### S2 设计院 → 条件细化 → 对比 → 选用（5轮）

1. `外墙K≤0.3，优先做薄一点，给我几套做法` → K硬条件+厚度偏好，Candidate卡，无SolutionState。
2. `只要20mm以内` → REFINE，保留原K，加入thicknessMax，重查更新revision。
3. `第一个和第三个有什么区别` → 只读比较当前列表两项，不修改Selected。
4. `第一个留下，第三个也加入` → 明确动作，懒激活SolutionState，Selection变更。
5. `就这样` → 不允许自动Confirm；需明确Final+明确确认命令。

### S3 工程计算 → 来源核验 → 规范判断（4轮）

1. `A2-1，Ⅱ型30mm的原表K值多少` → 正式参考行：在上传资料对应版本中K0.302、总R₀3.313、产品R3.000。
2. `这个数值哪一页来的` → REFERENCE_VIEW；不重查，不变revision。
3. `按这个做法重新算一下` → 用户授权明确，但计算模式/方案/规格/厚度还须后端确定性验证；不允许编造缺失配置。
4. `上海住宅能达标吗` → 适用标准scope核验；没有地区+建筑类型+当前标准依据不输出达标结论。

### S4 指标消歧 → 修正 → 换主题（4轮）

1. `保温板热阻8.3有么` → 无明确对象先区分产品R和整墙R₀，不凭量级猜。
2. `是板自身的` → 用PRODUCT_R，保留数值和原意图，正式查询。
3. `那厚度在80mm以内呢` → REFINE，在PRODUCT_R基础上叠加上限。
4. `另外，我想看看你们产品和岩棉有什么差别` → 新主题 MATERIAL_COMPARE；不能继承上轮R≈8.3与厚度筛选。

### S5 有候选时的普通聊天/知识问题（4轮）

1. `外墙图集有什么K接近0.3的方案` → 建立lastReferenceLookup，不激活SolutionState。
2. `K值小就一定省钱吗` → 普通解释，不能进Solution Action；不强制 thermal。
3. `施工时怎么处理热桥` → 知识库/节点，不能偷偷改 QueryState。
4. `刚才第三个的完整热工表给我看看` → 恢复此前最近可见的候选（若期间没有新候选），不重查、不改变revision。

### S6 数据错拼专项（跨来源一致性，4轮）

1. `Ⅲ型VICP 45mm 适配哪些基层` → 返回不同基层构造对应的 K/R₀，不合并。
2. `混凝土空心砌块的K是多少` → A3-2：基层190mm，K0.294，R₀3.398（当前提供的原始资料）。
3. `那加气混凝土200mm呢` → A3-4：K0.248，R₀4.040；不把上轮0.294复用过去。
4. `把两个结果都给我看原表` → 各自绑定源页、构造与optionId；若找不到权限内原页说明限制。

### S7 异常与权限（至少4轮）

1. 持有 revision r 的候选卡。后台正式资料换版，旧 sourcePage/optionId 不再有效。`第一个原页` → 只读验证失败并解释重查，不返回旧确认快照。
2. 某候选集在页面更新为 revision r+1 后，带旧卡片 revision r 发送`留下第一个` → 拒绝旧位置，不能选 r+1 的第一个。
3. 另一用户/项目引用旧 candidateId → 权限拒绝，不能透传图片签名 URL。
4. 语义模型报错后问`你好`/`第一个原页` → 不得返回“暂时无法可靠理解方案动作”，普通问答与可核验原页能继续。

## C. 统一验收指标（不只是比对字符串）

- **意图正确**：`intent` + `mutation` + Tool 路由三者一致。
- **事实正确**：K、产品R、总R₀、基层材料+厚度、体系、型号、构造编码、页码和optionId来自同一 Candidate。
- **未命中可信**：区分完整命中 / 附近但不满足 / 指标不匹配 / 数据不足；不能给假满足或未经许可的合规结论。
- **状态正确**：只读查看 `queryRevision` 不变、Selected不变、无新 SolutionState；Refine 才更新revision；明确选用才改变SolutionState。
- **来源可追溯**：已发布有效来源；原始页完整、必要高亮、印刷页码，不信任旧版/旧权限/旧签名URL。
- **稳健性**：Agent开启/关闭、语义模型成功/超时、候选0/1/N条、跨会话、资料撤回、旧revision全部覆盖。
- **体验**：普通问题回答简明；查表先轻量方案卡，完整参数表与原页按需打开；不强制用户输入专业术语。

## D. 技术调试日志建议

每轮在服务端记录（脱敏）：`domainIntent`、`answerContract`、`toolRoute`、`queryLifecycle`、`queryChangedFields`、`referenceQueryRevisionBefore/After`、`candidateIdList`、`candidateSnapshotSource`、`factValidationCode`、`referencePageIds`、`solutionStateMutated`、`parserSource`。正式数值是否通过事实校验单独审计；不要记录密钥、签名 URL 或大段隐私聊天内容。

> 注意：以上场景为设计验收题库。除了列明引用的 Word 参考值外，当前库的产品清单、当前地方标准、真实运行命中数，必须通过本地有效数据/真实业务环境读取，不能根据文档捏造。
