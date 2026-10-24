# 设计师与销售自然对话：真实 H5 复核（2026-10-22）

**结论：NOT_READY。两套原始对话均未自然走通方案到报告。原16问：1 PASS / 3 PARTIAL / 12 FAIL。** 这些是逐轮业务结果，包含前轮失败带来的连锁失败，不代表12个独立根因。不能沿用此前固定35问的结果来认定这些日常对话已合格。

数据、上下文与语气分别复核。数据PASS表示本轮未发现虚构或数值事实错误；对于只给澄清或拒绝的回答，不表示已完成查询。安全门禁正确拒绝仍可能对应业务FAIL。语气由本次执行者人工复核，不宣称独立盲测。

## 1. 真实执行与边界

- 两个独立新会话，原8+8问逐字执行；另加4轮自然澄清/补救，单独标记，没有用补救结果覆盖原问失败。[完整逐字对话](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/transcript.md)；[冻结原问](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/frozen-dialogues.json)；[SHA256](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/frozen-dialogues.sha256)。
- Edge真实H5页面、真实HTTP/SSE、当前批准的DeepSeek Chat；上游39次请求均为deepseek-chat，未Mock、未预填Semantic JSON、未切换模型。JSON-object/no-schema按现有接口使用。[真实上游调用](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/upstream-requests.json)。
- 后端为本地隔离实例，读取有权已发布资料的只读副本；独立随机DB、Redis和OSS前缀。工程JSON、正式规则和当前生产报告模板原样复制。[环境与复制证据](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/environment.json)。
- 审计期间Backend/App源文件和配置无漂移。审计工作区与主工作区941个文件复核：110处字节差异中109处仅换行格式、1处仅末尾换行，无代码内容差异。此前发布记录证明后端408个dist文件与线上一致；此次没有直接请求线上业务会话。[源文件冻结](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/source-integrity-at-close.json)；[主工作区对照](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/main-source-comparison-at-close.json)。
- 使用本地当前H5。后端已发布不代表线上H5已同步，本次不能证明线上旧前端更新。未改产品实现、生产数据、正式规则、模型、提示词、模板或历史Snapshot；仅新增审计脚本、记录和报告。
- 文件下载按用户要求排除；原始35问本轮未重跑；本轮未修改代码，因此未重复构建或声称新增自动测试通过。正式热工计算记录为0，本次不对分层计算作通过结论。

## 2. 原16问逐轮判定

|轮次|问题摘要|数据|上下文|语气|本轮业务|主要发现|
|---|---|---|---|---|---|---|
|D-T1|我在做一个办公楼的外墙方案，想了解一下VICP，有哪些做法可以参考？|PASS|PARTIAL|PASS|**PARTIAL**|介绍了现有板材名称，但没有回答外墙做法；尚需基层条件，可正常承接。|
|D-T2|墙体是200厚的钢筋混凝土，保温层想尽量薄一点，传热系数控制在0.3以内，有合适的吗？|PASS|FAIL|FAIL|**FAIL**|基层200被正确提案，后端却按板厚覆盖检查拒绝；追问没有说清需要确认什么。|
|D-T3|你刚才提到的25毫米这套，各层具体怎么做？有没有对应资料可以看看？|FAIL|FAIL|PARTIAL|**FAIL**|正式25mm参考行数值有出处，但K≤0.3/偏薄条件未进入后续只读页面Query；多体系层次被一起返回。|
|D-T4|如果加厚到35毫米，保温效果能提高多少？|PASS|FAIL|FAIL|**FAIL**|35mm效果追问转成泛化澄清；未解释可比范围或问具体缺项。未越权计算是正确保护。|
|D-T5|那先用资料齐全的25毫米这套。你说的热阻，是板材本身的，还是整面墙的？|PASS|PARTIAL|PASS|**PARTIAL**|产品R和整构造R₀定义正确，但未明确指出刚才显示的4与4.3068各指什么。|
|D-T6|这个传热系数是原表里给的，还是你重新算的？|PASS|FAIL|FAIL|**FAIL**|已有25mm/K=0.2322的实际读取，仍要求客户提供构造编号；后续自然补充也未绑定该行。|
|D-T7|最终就定这套吧，把采用的做法和参数整理给我，我再核对一下。|PASS|FAIL|FAIL|**FAIL**|没有把已展示参考值接入可操作候选，最终选择落入REFERENCE_DETAIL；原链无Final。|
|D-T8|参数没问题，按这套出一份PDF方案，我拿去内部讨论。|PASS|FAIL|PARTIAL|**FAIL**|没有最终方案/快照，因此正确阻止报告；没有帮助用户恢复前面未完成的选择，原链无PDF。|
|S-T1|客户第一次听说VICP，你帮我用容易懂的话介绍一下，别太多专业词。|PASS|PARTIAL|PARTIAL|**PARTIAL**|与设计师首问得到同一产品清单，未满足容易懂、少专业词的介绍请求。|
|S-T2|他问跟普通保温板比有什么优势，我怎么回答比较合适？|PASS|PASS|PASS|**PASS**|没有竞品或性能优势证据，清楚说明限制并给出可核对维度；未编造卖点。|
|S-T3|客户比较在意占厚度，现在资料里有哪些厚度可参考？|PASS|FAIL|FAIL|**FAIL**|VICP介绍后追问厚度仍被要求补查询对象；自然澄清后仍未回答厚度。|
|S-T4|他那边是200厚的钢筋混凝土墙，希望传热系数低于0.3，你帮我找个合适的做法。|PASS|FAIL|FAIL|**FAIL**|200厚钢筋混凝土再次触发基层/板厚角色误判。|
|S-T5|刚才那套具体用多厚的板？有没有参数和资料能发给客户看？|PASS|FAIL|FAIL|**FAIL**|前轮未得到方案，未说明这个事实，只给通用重新提问提示。属于上游失败后的连锁影响。|
|S-T6|35毫米那条为什么不能选？是资料有问题，还是产品不能用？|PASS|PARTIAL|FAIL|**FAIL**|本会话尚未展示35mm记录，因此不能假定其身份或断言产品不能用；现答复也未提出具体定位问题。|
|S-T7|明白了，那先用资料完整的那套。帮我整理一段发给客户的话，说清楚厚度和保温参数。|PASS|FAIL|PARTIAL|**FAIL**|没有可绑定方案可以概括；还要求补已给过的基层条件，Pending查询没有保留到建议状态。|
|S-T8|客户认可这套了，就按这个方案帮我出份PDF。|PASS|FAIL|FAIL|**FAIL**|没有Final/快照而正确保持只读，但已明确的出PDF目标未被自然承接；无报告。|

每轮原始SSE、实际BackendDecision/Query/候选/状态、页面截图均保留，例如 [D-T2原响应](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/D-T2.sse.txt)、[D-T3实际状态](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/D-T3.backend.json)、[销售最终轮](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/S-T8.sse.txt)。[机器可读复核表](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/business-review.json)包含全部证据文件名。

销售第5、6、7、8问原本预期前面已有方案；实际第4问已经失败。继续执行原问是为了观察恢复能力，不能据此声称系统此前真的给过35mm记录，也不能把这些连锁结果都算成新的独立资料缺陷。

## 3. 额外澄清与补救（不计入原16问）

|轮次|实际追加原话|结果|说明|
|---|---|---|---|
|D-EXTRA1|墙体就是200毫米的钢筋混凝土，保温板厚度还没定，我想让你推荐薄一点的。|FAIL|自然补全200毫米后仍被旧原话触发同一板厚拒绝。|
|D-EXTRA2|就是前面你给我的钢筋混凝土墙、25毫米保温板、K值0.2322那套。|FAIL|补充前面实际出现的25mm/K=0.2322，仍跳到三张原页并返回K=0.355的无关行。|
|D-EXTRA3|那我们重新查一下：墙体是200毫米钢筋混凝土，保温板25毫米，传热系数不超过0.3。请把能选用的方案列出来。|PARTIAL|重新完整说明条件后查出1条正式25mm候选，数值和筛选正确；回答仍有较多通用审计说明。|
|S-EXTRA1|就是前面说的VICP保温板，知识库表里有哪些厚度？|FAIL|明确VICP保温板/知识库厚度，第一次提案误读为λ，复核转产品但别名不匹配；仍未完成厚度读取。|

## 4. 已定位的问题与修复方向

### F1 · P1：基层厚度与板厚角色混淆（代码根因已核实）

设计师D-T2和销售S-T4均说“200厚的钢筋混凝土”。真实Semantic已经提出substrateThickness=200、K上限0.3；Backend仍答“明确的厚度条件未被完整保留，请确认”。D-EXTRA1补成“200毫米”也没有恢复。
`semantic-query.ts:350–370`先仅屏蔽唯一mm/毫米形式的基层标量，再把包含历史原话的全文交给板厚解析器。“200厚”没有被按已核实的基层角色排除，旧原话在澄清后仍会参与板厚覆盖检查。修复应按已验证的字段角色与证据范围检查覆盖，并保留原始数值、否定及当前板厚校验；不能为这句话加例外或把基层厚度丢掉。

### F2 · P0：待澄清查询的限制被静默放宽（代码与实际结果均已核实）

D-T3继续查25mm的层次和资料，实际confirmedPageLookup.query的filters为空，前面K≤0.3和偏薄要求没有保留。D-EXTRA2指定前面实际出现的25mm/K=0.2322，系统却比较了81、45、41页三条记录，其中**外墙C2-1的K=0.355**。该值有原资料出处，但不符合原0.3目标，也没有回答0.2322这条数值来自哪里。它作为只读参考而非正式候选展示，仍是答非所问。整张原表可以显示其他档位；这里的问题是被回答组织成当前比较结果的记录范围已经改变。
`query-need.ts:71起`对CLARIFICATION_REPLY的参数查询有实际数值/身份连续性检查，但页面查询没有同等的原条件覆盖校验。`ai-domain-turn-decision.service.ts:338–349`拼接原问后仍以NEW_QUERY应用当前提案，未确保原数值/比较符继续生效。应统一校验最终有效Query的已知约束，不允许比未取消的原需求更宽；明确修改、取消、换话题仍按原授权处理。

### F3 · P1：已读事实没有持续可引用的身份（状态断点已核实）

D-T3显示了正式25mm参考行：R=4、R₀=4.3068、K=0.2322，但本轮为FACTS_ONLY，没有发布可操作候选。D-T6追问“原表还是重新算”时，事实读取要求客户提供构造编号；自然补充25mm/K=0.2322后，又落到其他原页。D-T7选择“这套”则被识别为REFERENCE_DETAIL，回复无可定位候选。
应保存受原来源、版本、归属及有效期约束的只读事实身份，允许继续解释和查来源；选择时由Backend在当前正式可授权候选中唯一匹配并提示必要步骤。不可直接把只读资料升级为可确认方案，不可由模型编ID，也不可把相近的0.233记录当作0.2322的同一来源。

### F4 · P1：提案失败后没有恢复具体业务目标（真实轨迹已核实，需针对状态转换修复）

D-T4“加厚35mm能提高多少”先提出计算、置信度0.86被正式操作门禁拒绝，复核后只输出泛化澄清；没有说明是在比较已有档位还是缺哪个计算条件。S-T3“有哪些厚度”先提出无条件页面读取，复核能力未接回已有VICP产品上下文。S-EXTRA1第一提案甚至把厚度读成λ，校验正确拦截后，复核的产品名称又未能绑定；回答继续要求正式名称。S-T7建议分支还要求补已给的基层，实际持久状态中只剩adviceBusinessContext，没有原Pending条件。
不能通过降低置信度、关闭证据校验或补猜工程参数来修复。应保留已知对象和条件，读取失败时只问真正缺的区别；待完成查询在解释/建议插话中应持续保存，模型只补充结构化变化，不重建整个需求。低置信提案、无结果、无授权必须保持不同原因，最终面向客户说明具体下一步。

### F5 · P2：产品咨询表达仍被确定性模板锁住（代码根因已核实）

D-T1与S-T1的不同需求返回逐字相同的88字产品清单，销售要求“容易懂、别太多专业词”没有落实。`product-narrative.ts:99–103`在知识库项目或缺summary时直接返回`formatProductFactsAnswer`，后者`product-answer.ts:152–158`固定列名称与参数名。这样保证了没有编造用途和优势，但未能按本轮问题组织已有事实。
应维持当前知识库的事实范围，允许用已有名称、可查字段和已核验参数作短介绍；没有正式正文就不补宣传卖点或组成关系。S-T2没有竞品证据时说明限制并给核对方向，本轮判PASS，不把诚实说明资料不足当缺陷。自然表达层的修复须验证事实和数字，不能开放自由编造。

### F6 · P1：历史会话问答顺序错误（页面、API与代码均已核实）

重新打开设计师会话后，D-EXTRA3的助手回答排在用户问题之前。历史GET的最后两条同为`2026-10-22T02:49:40.611Z`，返回顺序为ASSISTANT、USER；`ai.routes.ts:411–412`只按createdAt排序，缺少稳定问答顺序。[历史次序证据](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/history-order-proof.json)。
应给历史展示与上下文读取统一的稳定顺序，依据真实轮次/消息关系处理同时间消息；不能用随机UUID充当业务顺序。上下文构建等其他读取也只按createdAt，存在同类风险，但本轮没有证明此前所有语义错误都由这个排序引起。

### F7 · P2：当前生产模板仍有占位文字，PDF出现多余尾页（实际PDF已核实）

补救分支生成的真实PDF第2页仍写“（免责声明正式措辞待甲方确认）”，而用户此前已批准去掉这段占位说明。本次按当前生产模板测试，没有临时改模板隐藏问题。第3页几乎只有一句审阅提醒，属于分页质量问题。页内还展示了产品、规格、方案及确认人内部UUID，普通客户阅读不友好；权限来源可以继续保留在审计信息中。
下一步按已经批准的措辞准备/发布正式模板新版本并调整分页，保留旧报告和历史快照；不要直接改现有已发布模板记录。[PDF第2页](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/pdf-actual-page-2.png)；[PDF第3页](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/pdf-actual-page-3.png)。

## 5. 页面与补救按钮闭环

原设计师8问和原销售8问都没有形成可继续确认的完整方案。设计师D-EXTRA3重新给全条件后，实际执行了：查询→加入方案→勾选最终方案→设为最终方案→确认生成方案→Snapshot→生成技术方案PDF→查看报告→预览。所有正式身份由页面真实候选带出，未手填Candidate ID、调用管理接口修改方案或绕过权限。
- 加入：candidateQueryRevision=1，唯一正式25mm候选。SET_FINAL/CONFIRM依次携带expectedVersion=2/3及candidateSetRevision=1，形成CONFIRMED。
- 最终只有设计师补救会话有1个Snapshot和1份READY报告；销售会话均为0。PDF确认号和参数与同一冻结Snapshot一致：钢筋混凝土200mm、保温板25mm、R=4、R₀=4.3068、K=0.2322；来源为已发布参考集版本1的Sheet1，没有关联原图，不冒充原图证明。未重新计算，未作地区合规结论。
- 真实PDF共3页，全部通过H5翻页查看，跨页pdfSha256一致；1280px桌面及390px手机预览、放大/缩小/关闭可用。渲染和参数一致通过；模板措辞及分页质量PARTIAL。
- 390px完整表格页显示81页与25mm高亮，能打开同页原图及全屏预览。390px屏幕显示左侧列，页面提供横向滚动提示；本次确认全表路由、档位高亮和原图打开，未单独验证逐列横向滑动，也未逐一复核全部79页表头。[手机完整表格](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/D-mobile-full-table-settled.png)；[原图全屏](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/D-source-image-fullscreen-settled.png)。
- 对话阶段未见JS异常；打开原图时浏览器有一条读取content-disposition未暴露的警告，但原图与全屏实际显示成功，属非阻断警告；本轮未修复下载相关代码。
- 按钮记录器的即时after快照早于部分异步POST完成，原始即时记录保留；[补救请求核验](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/recovery-ui-verified.json)使用同一次服务端真实请求、落库状态和最终截图核对，并未重复点击或伪造成功。[PDF预览证据](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/pdf-reader-audit.json)。

## 6. 下一轮建议顺序

1. 优先修F1、F2：字段角色明确、原需求不丢，验证正常提问、纯补单位、换指标、改数值及换话题，不能只使200/0.3这几句通过。
2. 接通只读事实身份与正式候选之间的连续读取、解释和选择；无候选时自然恢复查询，不跳过来源/Revision/Final/Confirm门禁。同步修历史排序。
3. 改善具体澄清与产品介绍，沿现有知识库事实简短回答；资料不够时只解释真实缺项，不统一堆内部审计话术。
4. 按新版本处理已批准模板文案和分页。修复后先用同16问及变体复测，再重跑原始35问和关键权限/计算/报告链路；不要以补救按钮成功替代普通用户全流程验收。

35mm参考行与25mm规格绑定冲突仍是资料治理项，软件不得替甲方改原值。**本轮最突出的问题已证实包含代码与状态传递缺陷，不能归咎于缺文档或OSS。** 文件下载继续排除。

## 7. 证据完整性与清理

首轮D-T1的记录器在收到回答后因读取轻量状态接口缺失snapshots字段报错；已改为只读完整观察接口，并从同一次原始服务端SSE恢复该轮证据。没有重发问题或重调用模型，原始错误与首次before快照缺失保留。此项是测试采集器问题，不计产品FAIL。[恢复前原始记录](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/round-01-unmodified/execution-before-capture-recovery.json)。
正式业务记录和源文件在停止前已保存。隔离库已删除，Redis前缀已清空，2个测试OSS对象按随机前缀清理成功；独立只读核验剩余DB=0、Redis key=0，清理无失败。[独立清理核验](D:/work/lg-vicp/backend/docs/ai/evidence/real-role-dialogues-2026-10-22/cleanup-independent-check.json)。临时登录凭据在交付前删除。
完整证据含原问SHA、逐轮SSE/Backend状态/截图、Semantic每次提案与门禁原因、真实模型HTTP记录、实际Query与返回记录、按钮POST/版本、Snapshot、PDF三页图片及来源页。归档交付以evidence-manifest.json和delivery-integrity.json校验；未经本轮实际执行的测试不会计PASS。
