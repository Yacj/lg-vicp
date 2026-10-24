# 蓝格 VICP 后端 AI 开发规则

2026-10-19 全链路修复合同：Semantic 显式使用受支持的 JSON-object 输出（SDK no-schema），Backend Zod、原话证据、权限与业务状态校验继续执行。目标分类与候选身份绑定分别验证；自然称呼只提出当前发布名称与原话厚度，Backend 在当前授权候选及 Revision 中唯一绑定，歧义不猜。Final 与明确保留的参考候选分开，Confirm 冻结后报告只用 Snapshot；正式参考行可用完整发布来源证明，不虚构文件/页图/公式版本。JSONB 来源证明按全部合同字段比较，不依赖属性顺序。原表头及79页页签按客户DOCX和已确认内容指纹作显示投影，源数值/Revision/规则/历史快照不回填。真实UAT使用只读来源副本与独立随机库/Redis/OSS前缀，保持 DeepSeek Chat；最终结果和缺项见 docs/ai/full-chain-uat-2026-10-19.md。无生产部署或业务数据迁移。

2026-10-19 C端表头按客户知识库79张原表核对：显示投影按完整确认内容SHA256绑定，sourceDisplayColumns/sourceTableLayout仅供原表头与单列热阻显示；sourceColumns原语义、数值、revision、候选资格与工程计算不变。缺失/冲突表头用中性名称并在表外提示。屋面原稿的“外墙主断面”保留，77–79为“板材主断面”；11页识别标题疑点单列。旧35问验收FAIL保留，后续按资料治理→S2→R1比较→S5/R5正式确认/PDF→R3计算→完整35问修复复测。见 docs/ai/table-header-repair-2026-10-19.md。

2026-10-19 阶段04固定场景真实H5复测：10组35轮原问逐字执行，1 PASS/1 PARTIAL/8 FAIL，总验收FAIL；另有VLCP/换话题/缺模型3次输入补测，22次越权拒绝及2次本人列表成功。R1多页原引用和R2屋面命中改善，但S2证据换行拼接拒绝、R1比较、S5/R5正式闭环和R3计算续问未通过；页码/原值资料疑点保留。Snapshot/报告/计算均0，Confirm/PDF及其幂等/权限NOT_RUN；后端2796和App150测试/H5构建通过，App依赖按钮类型检查失败。只操作独立随机库/队列/OSS前缀，已独立核验清理；无产品实现改动、生产迁移或部署。见docs/ai/phase04-retest-2026-10-19.md。

2026-10-19 交接阶段03：基层厚度只对封闭毫米标量归一，板厚与基层分别覆盖校验；正式编码集合按已发布字典核验，低置信仍拒绝，复核最多一次同预算。确认页型号可从单一正式表标题只读定位，不补写源JSON或正式候选字段；同次回答的多页原引用成组回读，部分失效拒绝。产品续问/参数诊断仅绑定本人同端同项目24h内紧邻实际读取，服务重验。用户本轮确认VICP为VICP复合保温板简称，受控名称映射仅连接唯一当前目录项；近似拼写只提示确认，不自动绑定。介绍不默认堆参数、不编宣传事实。资料页码与15/190异常、分层计算任务和R口径仍需治理；真实H5阶段04未执行，无部署/迁移/资料改写。见docs/ai/phase03-repair-2026-10-19.md。

2026-10-18 小格参数阶段2–4（用户授权自动续阶段）：重复Query校验共用currentMessage；显式工程字段/有效pending只触发一次同预算语义复核，不补字段或降阈值。产品介绍productQuery逐字保留身份/系列目标，正式名称与启用别名未匹配不退回全目录；模型只组织产品事实引用计划，后端绑定同产品字段输出。当前原表省略追问只读紧邻实际引用，须有效同会话同端同项目24h上下文及版本/revision/optionId，序号仍拒绝。真实隔离HTTP/SSE的Q01–Q18与重复会话、显式Confirm→Snapshot→真实PDF/OSS均有脱敏证据；有限Fixture覆盖不代表全图集/生产资料已修复。无业务库迁移、发布Prompt/公式/历史快照修改或部署，见docs/ai/xiaoge-parameter-phase2-3-2026-10-18.md与docs/ai/xiaoge-parameter-phase4-2026-10-18.md。

2026-10-18 小格参数阶段1：独立 PRODUCT_PARAMETER_QUERY/READ_ONLY + parameterQuery 读取λ，不并入图集K/R。紧邻本人同端同项目24h待澄清原问可绑定唯一数值，Service排除当前USER并再次重验。目录/发布规格lambda_eq/材料参数/当前发布有权Fact与确认材料层联合读取，区分产品当量/规格当量/材料层；缺正式规格标称映射报未索引。裸目标EXACT，近似须用户明确±容差；未知名称不自动纠错或关联产品。确定性事实回答，不生成候选或正式方案；无迁移、生产数据/旧页/Formula/Snapshot/PDF改写或部署，完成阶段1停止。见docs/ai/xiaoge-lambda-parameter-phase1-2026-10-18.md。

2026-10-17 发布：按用户明确授权执行 pnpm run deploy --skip-db --skip-build（本地已 tsc 构建；沙箱批量删除限制导致内建 clean 失败，故给 deploy.local.mjs 增加可选 --skip-build，默认仍构建）。发布到 8.153.150.87:/www/wwwroot/lgapi.zblack.cn，跳过备份/迁移/seed，.env 未改写（mtime 仍为 2026-10-13）。PM2 lg-vicp-api/lg-vicp-worker 重载 online；内外网 /health/live 与 /health/ready 均 200；6 个关键文件（server.js、worker.js、reference-query.service.js、semantic-query.js、product-answer.js、ai-generation.service.js）与本地 dist 哈希逐一一致。上线范围＝阶段2~修复轮；已知未修：序号追问、方案选择/Confirm/报告（来源绑定阻断）、λ 字段投影。

2026-10-17 小格修复轮：隔离库实测定位F2根因——字典把「A1-3」解析成schemeId，模型按合同输出schemeCode，逐字段复核把同身份另一种表示判成「未完整保留」，导致任何按编号查表被拒；修为仅对该字段互认（经字典names校验，缺任何表示仍拒绝），DESIGN-012 T1已能正确返回18mm/2.880/3.297/0.303/页22。F1-B部分修：省略身份继承从VERIFY扩到EXPLAIN且仅取最近一次助手回答唯一编号，历史范围须有原页定位，SALES-014 T2已能定位A1-3并给来源页（仍缺λ字段投影）。F1-A序号回溯实现因与既有安全边界用例「position不能借原页回溯绕过边界」冲突而整体回退，未改该测试；正解是只读结果「可引用不可确认」的revision绑定上下文，待下轮。全量2652 passed/1 failed(report-runtime环境项)/1 expected fail。见 docs/ai/xiaoge-business-chain-phase5-fixes-2026-10-17.md。

2026-10-17 小格专项阶段4：新增跨阶段矩阵用例（产品介绍/查表诊断/多轮/计算授权/方案门禁共16例，未改产品代码）。隔离环境真实SSE复跑SALES-017、SALES-014、DESIGN-012与方案UAT：确认两项P0——①只读确认页/知识事实「不可确认」被误当「不可引用」，导致「刚才第一个哪一页」「导热系数λ是多少」断链（基线ReferencePage由1/1退化为0/1）；②「A1-3 I型18mm图集参数」被逐字段复核拒绝（PAGE_QUERY_CONSTRAINTS_INVALID），被拒字段未定位，未凭猜测放宽。UAT检查器intent读taskType、合规词误判否定句属断言层噪声。失败记录全部保留，report-runtime环境项连续三阶段复现未改。清理遗留临时库1个。PDF/Confirm真实闭环与权限负向未执行。见 docs/ai/xiaoge-business-chain-phase4-2026-10-17.md。

2026-10-17 小格专项阶段3：计算结果的productResistance按Calculator口径标记PRODUCT_EQUIVALENT_TOTAL/PRODUCT_LAYER_ROWS_ONLY（新增纯元数据，公式/系数/取整/判定/VICP-CALC-1与历史记录均不变，旧记录缺字段按缺失处理），口径随resultJson冻结并贯通Tool facts、模型事实清单与回答约束，LAYERED不得表述为产品整体热阻；事实标签「整墙总热阻」改「整构造总热阻」，屋面/装饰板不再误称整墙，Clarify俗称文案暂不改。Thermal Tool的referenceScope与达标核验改为消费Semantic结构化决策（新增complianceCheck{required,evidence}并校验原话证据），仅在无Semantic时保留原封闭词表兜底，禁止下游关键词覆盖已验证决策。未改前端DTO与页面；芯材4.8/产品整体5.0差异仍为known gap，升级须新formulaVersion并双版本只读重放后由甲方确认。未迁移、未部署、未生成Snapshot/PDF。见 docs/ai/xiaoge-business-chain-phase3-2026-10-17.md。

2026-10-17 小格专项阶段2：产品咨询事实与解释分离，正式目录/已发布规格/有权资料的facts由Service产出，模型只按Semantic的intent与audience（GENERAL/SALES/ENGINEER/UNSPECIFIED，仅表达不授权）组织表达，回答中板厚/λ/α须出自已核验事实或用户原话，越界回落确定性仅事实回答；澄清、无结果、模型不可用一律不走自由生成；不得补写资料未支持的用途/优势/认证/竞品。无法映射的体系/型号/构造名称必须逐字保留为entityText/systemHint并靠正式目录与knowledgeAliases归一，不得静默丢弃后放宽查询；归一不到由诊断说明身份不匹配。澄清轮不改候选、不产生副作用授权，正式方案/Confirm/报告仍需显式授权。新增数值校验正则仅作用于已生成回答，不参与意图或路由；未迁移、未部署、未改Formula/Snapshot/报告。见 docs/ai/xiaoge-business-chain-phase2-2026-10-17.md。

2026-10-17 小格专项阶段1：结构化查表统一读取授权已发布正式参考行和确认页事实，正式命中不短路知识来源；确认页不伪造方案/规格ID、不升级为正式候选。来源关联必须同文档/版本/页及可验证档位或明确正式映射，编号/数值不作身份证据；来源核验先于展示截断。查询诊断逐项保留型号/基层/厚度/其他指标，缺列、无值、范围不足及来源失效分别说明，空候选仍传递诊断；不猜测不可见资料。无新增自然语言匹配、迁移、业务数据回填或部署，阶段1结束停止。见 docs/ai/xiaoge-business-chain-phase1-2026-10-17.md。

2026-10-17 查询上下文修复：缺指标只澄清指标；澄清回复仅绑定紧邻、24h内、本人同端同项目原话，不生成候选或授权正式操作。查表数值条件不能丢入通用建议；数字+型不作K/R目标。QUERY已明确部位若漏字段则拒绝宽查并有限复核，仅校验正式枚举、不据词路由或补条件。0.8至0.9查询必须有完整pageQuery并经逐字段校验，仅FACTS_ONLY展示与成功只读查询上下文，禁止覆盖Candidate；低于0.8、结构歧义及副作用仍拒绝，正式动作/计算/报告保持0.9与原完整授权。近似/上限/精确由原话及有效历史核验；旧确认表仅按封闭正式表名只读兼容部位，不回填源JSON。factRead≥0.8仅进受控只读事实服务、不发布Candidate；型号比较大小由代码确定。无Candidate原页回溯仅消费本人同端同项目24h内实际引用，重验版本/revision/optionId，不接受旧序号。优缺点只读确认构造；澄清诊断不标工程事实错误。修复验收后按用户追加授权执行pnpm run deploy --skip-db发布后端；API/Worker在线、live/ready均200、5个关键文件哈希一致，跳过迁移/seed并保留.env。见docs/ai/thermal-query-context-fix-2026-10-17.md。

复杂图集表格与A3查询修复（2026-10-17）：热工表行使用可选sourceRegion，简图文字独立diagramNotes，原非数值列头由sourceTableHeaders透传；编号格不混入型号/基层，B/App保留原层号和分组。读取问句不以“是/为”推成实体赋值，I/II正式名称不能截获III后缀；完整体系名与只读追问走Domain→语义约束，不增加样本关键词路由。旧确认JSON/引用/快照/PDF不回填，无业务迁移。验收后按用户追加指令运行pnpm run deploy --skip-db发布后端，API/Worker及健康检查通过，此次未重跑测试；B/App仅提交代码。证据见docs/ai/atlas-source-layout-and-a3-2026-10-17.md。

2026-10-16 审计后修复：无编号v2确认页的VERIFY只读绑定最近实际引用及本人同端24h状态，重验版本/revision/权限，不按数值反选或创建Candidate；裸R仅由确认来源列解释，明确产品R不改义。B端签名失败保留确认表格。真实OSS/模型/SSE复测12行通过，后端2377测试通过1跳过；阶段5仍PARTIAL（Vision细节审核、T10报告前置解释、精确屏宽/原生端/签名过期/A3有效发布查询未全验）。仅随机测试库初始化与清理，无业务库迁移/回填/部署，见docs/ai/complex-atlas-repair-2026-10-16.md。

2026-10-16 用户明确：实际开发、隔离验收及生产对象存储统一使用阿里云 OSS，没有 MinIO 服务；不要启动、恢复或依赖 MinIO。复杂图集修复已获继续授权，真实测试仍使用隔离数据库/Redis队列/OSS前缀，不修改旧确认资料或部署生产。密钥仅放本机忽略的.env，不进入日志/报告。

2026-10-16 复杂图集阶段5真实联合UAT：验收FAIL。隔离库共享服务及H5来源详情12行通过，真实自然SSE未形成引用闭环，芯层R误称产品R、浏览器原图加载仍失败；旧890确认档不回填，A3原值正确但查询回归未过。测试配置源强制只读、全部对象操作统一隔离前缀，派生副本遗漏已精确清理并重跑验证。未部署/迁移业务库/改写旧PDF，见docs/ai/complex-atlas-phase5-2026-10-16.md。

2026-10-16 复杂图集阶段3：v2确认页走共享只读事实查询，缺产品整体R/印刷编号不伪造Candidate或产品ID；正式热工同步和方案准入保持。屋面属性/页码经既有Domain→语义条件合同逐字段grounding，不增关键词路由；同值构造独立。引用携带可选confirmedRevision/版本/页码核验信息，持久化重读确认模型、历史重验权限及重签。只读追问状态独立于Candidate，绑定本人同端会话/项目/24h；无迁移/业务数据回填/部署。见docs/ai/complex-atlas-phase3-2026-10-16.md。

2026-10-15 复杂图集阶段1：新Vision草稿使用可选schemaVersion=2，保留构造原标签/屋面属性/源列头与逐档层证据，芯层R不得当产品整体R。无印刷编号允许单页人工确认资料，不放松热工映射/四字段准入；旧编辑器不得整体覆盖v2。旧JSON不补字段、不回填；快照内容变化使旧引用失效。真实识别仍需逐页审核，未部署/迁移，见docs/ai/complex-atlas-phase1-2026-10-15.md。

2026-10-15 真实C端UAT修复：查表使用共享后端查询服务，明确指标纠正REPLACE旧指标，范围厚度独立grounding；已授权的构造/厚度读取不强求目标值。歧义查询不覆盖有效候选，无命中保留已消费资料范围。只读比较完整集合，极值由后端按语义字段计算；旧序号时间歧义拒绝，明确编码来源可在同一有权资料范围只读定位且不刷新候选。已确认读取冻结最终/备选；查询与Domain提案复核最多一次、共用原超时预算，不降低副作用门槛。无迁移、源库/源资料只读，见docs/ai/c-uat-fixes-2026-10-15.md。

2026-10-14 PM2报告运行环境：部署在数据库步骤/重载前检查Chromium+中文字体+真实PDF；默认复用，--install-report-runtime显式安装受支持Linux依赖（含线上Alibaba Cloud Linux3/x64）。国内镜像保留锁文件下载目录，固定缓存/核验路径传给Worker，不覆盖.env/系统软件源；失败不迁移/seed/重载。线上发布用pnpm run deploy，--skip-db跳过数据库；已获用户授权发布，依赖自检与API/Worker重载成功，未运行测试套件，见docs/reports/pm2-report-runtime-2026-10-14.md。

2026-10-14 报告设置驱动PDF：封面/Logo/页眉页脚/免责声明与内容开关复用现有设置；创建冻结企业展示配置和Logo文件身份，Worker不读最新企业信息。关闭来源只隐藏附录，不删基本引用/指标/未核验提示；计算过程只展示冻结步骤且不复活judgment合规断言。无迁移/前端/业务数据改写，见docs/reports/report-settings-pdf-2026-10-14.md。

2026-10-14 正式方案PDF：新 technical_scheme/project_brief 必须本轮Domain Policy/UI授权 + 本人同端同会话同项目CONFIRMED Snapshot；创建服务在会话锁内重验Final/冻结事实并按Snapshot/类型/创建者复用任务。DocumentModel仅纯转换，中文工程章节/完整原表/高亮只读冻结事实，无合规证据标未核验。新正式报告优先PDF/HTML，旧Word/图片兼容；取消/审核/发布保护、attempt/最新任务写回门禁、失败对账、受控预览下载保持。无迁移/依赖/业务数据改写；Fixture与真实UAT分开，当前库只读，详见docs/reports/solution-pdf-2026-10-14.md。

2026-10-13 语义匹配强制治理：开放自然语言只走现有resolveDomainTurn→结构化目标/关系/patch/reference/effect→Backend Policy；禁止方案/确认/加入等开放子串、删除否定、参数变化排斥Advice、pending boolean授权或泛化故障澄清。只允许工程格式提取、正式枚举/ID、无损归一、封闭完整命令/问候；副作用仍经权限/revision/来源/状态机。新增灰区快路径必须Rule ID+封闭语法/职责+5正5反3否定引用多轮+无副作用证明+冲突核验+owner批准与CI，缺一禁止。AST精确指纹白名单见docs/ai/semantic-matching-policy.md；不得全项目禁正则，不改资料、Thermal Engine、迁移或业务数据。

2026-10-13 参考方案建议：SOLUTION_ADVICE 为 mutation=NONE，只读最近实际可见候选并重验归属、24h、revision及确认optionId。一般选型不强制地区/建筑、不判断合规、不重查/计算或激活方案。最近两轮业务目标及pendingAdviceGoal仅存会话任务JSON，绑定会话/项目/候选revision/有效期；换话题即失效，不入正式QueryState。正式选择/Final/Confirm/报告仍显式授权并走原生命周期。见 docs/ai/solution-advice-2026-10-13.md。

2026-10-13 Domain收口：合规独立只读服务核验正式地区/建筑/结构范围与限值，不重算或刷新候选。报告execute先验证本轮领域或服务端UI授权；正式方案报告只消费CONFIRMED不可变SolutionSnapshot→DocumentModel，禁止旧产品报告替代，签名URL不入快照。裸指标先澄清查看/新目标，概念解释不恢复旧任务，同厚度多候选比较只读。产品SEARCH/READ只用正式目录/发布规格，比较ID来自搜索或UI；族简称可由启用GLOBAL后台别名显式绑定集合，缺映射拒绝宽查。无迁移/数据改写，见docs/ai/domain-turn-closeout-2026-10-13.md。

2026-10-13 矩阵补测：带明确指标的候选请求不被“做法”抢入知识；K概念问句不查表；当前可见基层参数与完整热工原表只读，基层/板厚分开且多项逐个绑定，数量歧义不补旧列表。分类上下文含previousQuery，诊断只记意图/实际路径/字段差异/revision/标识/校验状态。S4术语口径待真实UAT，冻结Parser/Matcher不改。见docs/ai/high-frequency-matrix-coverage-2026-10-13.md。

2026-10-13 高频意图P0：每轮DomainTurnDecision先于动作解析，Agent/非Agent/回答合同共享；原页/参数与普通候选比较走只读Resolver，校验最近可见revision、24h、归属和当前确认来源，不重查或刷新Candidate/Selected。计算需本轮明确授权及核验对象，不信任旧lookup.Selected。基层材料/厚度/型号与双R/K同候选校验；无可靠正式族映射时澄清，禁止名称推导族ID。无迁移/部署，详见docs/ai/backend-p0-routing-fixes-2026-10-13.md。

2026-10-12 普通问答回归修复：无可定位候选时不调用 Solution Action 模型，交还正常问答；lastReferenceLookup 候选仍支持首次懒激活。动作分类提示词必须包含 JSON 与从正式 Zod schema 派生的完整字段合同，兼容只支持 json_object 的模型网关；失败日志只记录错误类型/HTTP码。

Candidate 生命周期（2026-10-12）：查到候选不等于开始方案。普通查表/知识回退/计算仅保存 lastReferenceLookup（query、candidates、createdAt、candidateQueryRevision、projectId）并发 reference_candidates；只有已有 editable active state 才刷新方案池。Confirmed 后普通查询不创建新 state。显式选择/加入/开始/修订才激活；首次选择事务核验权限、24h 有效期、revision、当前来源，seed 后执行既有 mutation。/solution/activate 单请求 ADD/SELECT/SET_FINAL；序号基于最近可见查询 revision，旧列表拒绝。无新迁移，不改 Matcher/QueryState/快照/报告或前端。

会话来源校验（2026-10-12）：JWT `clientType` 使用 `C_APP/PC_AI/B_ADMIN`，会话 `clientApp` 使用 `c_app/pc_ai/b_admin`；创建和方案访问共用 `clientAppForClient` 显式映射后比较，不直接比较两种枚举。测试会话必须使用真实小写存储值，仍校验本人归属、有效状态、软删除与项目权限。

统一错误序列化（2026-10-12）：错误处理器独立序列化 `{ success:false, error, requestId }`，不得套用路由的成功响应 schema。业务错误继续 HTTP 200 + 数值语义码，未登录/无效/过期令牌为 401；正常成功响应仍按路由 schema 校验。

Solution Loop Contract 冻结（2026-10-12）：开放动作走 Solution Action Semantic Parser→原话/候选引用/revision Grounding→既有 mutation；LLM不输出正式ID或Confirm，确认仅明确命令。Hard Constraints有效指纹变化清旧keep确认；Chat/REST/Agent/refine/refresh共用候选Query Service/Policy（邻档1、正式/nearby各12，偏好排序、来源校验同源）。本轮无新迁移，不改Snapshot/DocumentModel/报告流程。详见 `docs/ai/solution-workflow-2026-10-12.md` 的冻结补充。

智配方案闭环（2026-10-12）：`solution_states` 是方案流程 SSOT，重查保留已选并标记硬冲突，偏好只排序，序号绑定候选 revision。明确 Final 后仍需显式 CONFIRM，同事务来源验证/不可变值快照/状态/审计；已确认后修改创建新 state。Snapshot 禁止 UPDATE/DELETE、不存签名URL；后续方案文档只消费 Snapshot→DocumentModel，不重查或重算候选。本轮不生成PDF/Word。详见 `docs/ai/solution-workflow-2026-10-12.md`。

语义查询（2026-10-12）：查表走格式归一→符号 Fast Path→目录/别名/Fuzzy 建议→受控 LLM 分类→确定性验证→QueryState→正式候选；模型仅理解语言，不计算或选择事实。NEW_QUERY清旧条件，追问按metric/厚度局部更新。构造编号不全局唯一，先用体系上下文消歧；EXACT指标失败保留同身份同厚度记录，和命中/相邻结果分开。确认页与热工同步状态独立，已确认DRAFT页可显式补同步到DRAFT参考集，发布readiness观察四项一致性。上传推导页码为FALLBACK未核验，视觉沿用VISUAL_MATCH未核验，人工确认才MANUAL已核验。来源渲染与候选optionId来自同一确认快照。详见 `docs/ai/semantic-query-refactor-2026-10-12.md`。

C端阅读（2026-10-11）：正式查表摘要使用简洁销售/设计院文案，所问指标由 filters 投影到 primaryFieldKeys。仅 answerStyle=THERMAL_SOLUTIONS 且正式模型ID/answerOffset可定位时允许客户端以方案卡替换摘要；普通解释及限制条件保留。完整页不裁剪，前端默认两方案、其他展开；B端文案保持兼容。详见 docs/ai/c-reference-pages.md。

C端完整参考页（2026-10-11）：正式查表候选唯一绑定同页同构造四项一致的确认档位；知识回退仅在已选且有权访问的当前发布版本读取确认快照，复用既有Parser/Matcher，不并入B端草稿范围。确认查表正文、卡片、完整renderModel、optionId/fieldKeys/answerOffset同源；Agent最终输出不采纳模型错误数值复述，保留原人工选择等待。消息不存签名URL，历史重验发布/项目权限并重签；换版/撤回/旧快照ID失效不复活缓存。来源详情返回完整模型，图片失败保留表格。详见 `docs/ai/c-reference-pages.md`。

完整原页引用（2026-10-11）：B端版本 test-qa 普通问答只消费同版本检索确认快照；明确数值查表读取同版本全部确认档位并复用现有Parser/Matcher，以匹配记录确定性生成回答，不回退旧文本拼数字。确认上下文按完整记录优先预算，仅已发送ID可引用；renderModel保留所有构造/档位，快照变化使旧ID失效。内部引用标记在发delta前隐藏，matches只接受当前快照optionId/fieldKeys；禁止按回答数字猜测高亮。表格/原图二选一，缺坐标不伪造框选。详见 `docs/knowledge/answer-page-references.md`。

热工回答质量（2026-10-09）：热工数值关系以同一正式Candidate为原子事实，不跨候选/Chunk拼字段，不以top-N宣称全量极值。模糊「传热8.3的保温板」先区分产品层R/整墙总R；「就是」按EXACT。默认3～8行、一个主方案，详细追问才展开。印刷页码仅pageLabel，禁止物理页序fallback。λ/α仅从同页同构造同厚度且双R/K一致的人工确认快照透传，冲突记录warning。详见`docs/ai/thermal-answer-quality-2026-10-09.md`。

最终交互与真实业务UAT（2026-10-07）：方案查询不因「限值/这个墙体」抢入计算，明确重新算进入热工，合规判断仍走正式标准链。活跃厚度条件下无metric词的25以内/以上/改成/放宽/调到更新厚度，取消厚度同时清除三字段和preferThinner（明确只取消某端则保留其他限制）。省略控制/做到连接词照常解析。Parser/Matcher主结构冻结，后续修改必须先有真实失败UAT Case。`pnpm uat:ai`为销售20+设计院20、123轮真实HTTP/SSE会话验收；工程数值/条件/来源由程序断言，AI Judge仅评体验。随机隔离库、Redis/队列/对象命名空间，独立测试用户，不写生产会话或发布资料。环境失败记录BLOCKED，不算通过。详见`docs/ai/business-uat.md`。

日常表达与局部条件收口（2026-10-07）：指标定位、数字抽取、比较语义分开；在/控制在/要求/达到/做到/目标等连接词不决定模式。多轮 filters 按 metric 增改删，未提及条件保留，同 metric 默认替换（含 mode），仅明确再加范围条件可追加同指标边界；取消条件不得由旧摘要或模型重复参数复活。厚度精确档 thicknessMm、单边/双边 thicknessMin/thicknessMax 独立解析与持久化，签名覆盖三字段；放宽单边厚度继承原边界含义，取消厚度清除三字段。尽量薄只在满足硬条件后按厚度升序展示，不编造范围。所有条件变化重查正式已发布数据，纯参数/原页指代可复用。无数据库结构变化，Thermal Engine 与 Knowledge 流程不变。

自然语言与多条件最终收口（2026-10-07）：规范否定比较词先匹配完整短语，不应/不得大于或超过为 MAX_LIMIT，不应/不得小于或低于为 MIN_LIMIT，以上/以下分别为下限/上限。普通大于/小于及 >/< 按工程筛选包含边界（≥/≤）。API、Tool、会话统一归一到 `filters[]`，多指标默认 AND；提供 filters 时其为权威条件，旧单指标字段保留摘要兼容。任一指标无法解析或表达 OR 时澄清，不丢条件。切 productSpec 清继承 catalogProduct/型号，切 specClass 清规格/目录，切 catalogProduct 清规格，切方案清继承规格/目录后查正式发布关系。missingConditions 按归一条件判断，双 R 不要求 targetK。容差返回 requestedTolerance/effectiveTolerance/toleranceAdjusted（逐条件保存），调整时返回中文 note；AI 仍仅接受用户明确容差。

热工查询语义收口（2026-10-07）：查表内部统一 `metric=K|TOTAL_R|PRODUCT_R` + `targetValue` + `mode=APPROX|MAX_LIMIT|MIN_LIMIT|EXACT`。旧 API `targetK/kMode/kTolerance` 和 `targetResistance` 保留兼容（裸 K 默认上限、裸总 R 默认下限）；AI 缺省 APPROX。容差集中在 `thermal-lookup-mode.ts`：K 默认 0.02/上限 0.05，双 R 默认 0.05/上限 0.2；EXACT 固定 0.0005。AI 只接受用户原话明确容差，不接受模型自由放大；已确认容差来源保存在会话 JSON。切体系清旧方案及依赖规格/产品，切型号/产品清旧规格，切方案清继承规格后重查正式关系。查询关键条件变化或普通新查询均重查完整已发布有效数据，仅纯参数/原页指代可复用历史。跨体系回退的 Answer Contract 与 Tool 统一要求首句说明指定体系未命中；近似/上下限筛选不得冒充法规合规。计算引擎及公式不改。

生产收口约束（2026-10-07）：参考候选精确/相邻厚度均不得绕过其他硬条件；AI K 模式按用户明确语义 → Tool 参数 → 历史 → 默认 APPROX。历史候选只供参数/原页指代，条件变化必须重新查询完整已发布数据，候选状态共用 Zod schema 保留双 R、原页来源与完整正式字段；未命中仍保存查询条件。STRICT 发布检查与 BROWSE_ONLY 空页 blocker 必须进入统一 readiness。迁移 SQL/journal/snapshot 一致性先静态检查；历史漏迁移使用前向修复，禁止对生产直接试跑，验证库必须隔离并清理。

## 项目定位

本仓库是“蓝格智配 VICP 建筑节能 AI 智配系统”统一后端，服务于 PC AI 对话端、B 端管理后台和 C 端 App/小程序。核心业务包括项目管理、VICP 资料知识库、AI 辅助问答、工程报告生成和全流程审计。

当前不使用租户模型。平台数据统一存储，以项目作为业务访问边界。

## 固定技术栈

- Node.js LTS、TypeScript、pnpm。
- Fastify、Zod、Swagger。
- PostgreSQL、Drizzle ORM、postgres.js。
- Redis、BullMQ。
- AI SDK、OpenAI-compatible 模型服务商。
- 阿里云 OSS（开发、隔离测试和生产）。
- Docker Compose、Nginx；生产可选 PM2 托管 API/Worker。

普通 CRUD 使用 Drizzle 查询构建器。全文检索、`pg_trgm`、未来 `pgvector` 及复杂排序可以使用参数化原生 SQL。禁止拼接用户输入生成 SQL。

## 常用命令

- 安装依赖：`pnpm install --frozen-lockfile`
- 启动 API：`pnpm dev`
- 启动 Worker：`pnpm dev:worker`
- 类型检查：`pnpm lint`
- 构建：`pnpm build`
- 测试：`pnpm test`
- 生成迁移：`pnpm db:generate`
- 执行迁移：`pnpm db:migrate`
- 初始化数据：`pnpm db:seed`
- 启动完整环境：`docker compose up --build`
- 生产部署默认本地打包 + SSH：`pnpm deploy`（不走 git；服务器 `.env` 不被覆盖；迁移失败不重载进程）

## 架构约束

- 在 `src/plugins` 注册 Fastify 基础设施。
- 在 `src/modules/<模块>` 内维护业务路由、schema 和服务。
- 在 `src/db/schema.ts` 定义持久化模型；修改后必须生成并检查 migration。
- API 与 Worker 共用数据库、存储和业务服务，不复制业务规则。
- 请求输入和 AI 结构化输出使用 Zod 校验。
- 成功响应保持 `{ success, data, requestId }`；失败响应保持 `{ success, error, requestId }`。
- 业务错误统一返回 HTTP `200`，`error.code` 使用数值型 HTTP 语义码：访问令牌、刷新令牌和当前登录态无效使用 `401`；权限不足使用 `403`；参数错误使用 `400`；其他业务处理失败使用 `500`；未捕获的服务器异常返回 HTTP `500` 且 `error.code` 为 `500`。
- 面向用户、管理员和开发人员的提示、Swagger 描述、日志与 AI 提示词使用中文。
- API 路径、JSON 字段、错误码、数据库字段、枚举和代码标识符保持英文。
- 跨域对任意 Origin 放行（回显请求 Origin，含局域网 IP）；鉴权仍走 JWT / 客户端隔离 / 权限码，不依赖浏览器同源。

路由边界：

- `/api/v1/platform/*`：B 端平台管理，先校验 `B_ADMIN`，再按具体权限码授权；超级管理员全量放行。例外：当前账号可见范围内的只读项目统计 `GET /platform/projects/statistics` 与工作台「我的项目」相同，不要求按钮权限码；平台项目列表 `GET /platform/projects` 仍需 `system:project:list`。
- `/api/v1/platform/knowledge/*`：B 端平台知识库管理（分类/文档/版本/解析/审核/发布/检索日志/别名词典/批量导入/抓取源/排序规则/检索评测/版本 Wiki 章节树/公开文库只读列表），按 `system:knowledge:*` 权限码授权；批量导入返回预签名地址，直传后走 upload-complete 确认；知识库创建与文件上传解耦：`POST /documents` 只收知识库基本信息，同事务建 Document + 首个 DRAFT Version（不建 ParsingJob、不投递队列，空 DRAFT 合法），返回 `documentId/versionId/versionStatus/currentVersionId`；`POST /documents/create-with-file` 保留兼容，`originalFileId` 改为可选（传了才绑定 ORIGINAL 并自动 PARSE）；原始资料附件与完整页面 PNG/ZIP 在详情中各自独立上传；发布门禁拒绝空版本（`KNOWLEDGE_VERSION_EMPTY`）与未确认页面（`KNOWLEDGE_VERSION_PAGES_UNCONFIRMED`），详情摘要 `GET /documents/:id/workspace`（workingVersion + userStatus + lastJob），更换文件 `POST /documents/:id/replace-file`（新建下一版本并自动解析），草稿 AI 测试 `POST /versions/:versionId/test-qa`（SSE，检索入口限定 versionId，允许 DRAFT/APPROVED/PUBLISHED，权限 `system:knowledge:doc:test`，不对 C_APP 开放）；`GET /versions/:versionId/chapter-tree` 为用户可读章节树（已确认 TOC 优先，否则语义 Section）；`GET /versions/:versionId/sections` 与 C 端公开文库/AI 来源详情共用 knowledge-wiki-read 服务（DRAFT 审核与已发布阅读共用），`GET /public/documents` 与 `/client/knowledge/documents` 同一读取口径（PUBLIC + PUBLISHED + 生效中）。生产 `/api/v1/ai/knowledge-qa` 仍只检索 PUBLISHED + AI_ENABLED + 当前受控版本，不传 versionId。
- `/api/v1/platform/collection/*`：B 端独立采集管理（手动 URL / 自动 Source+Skill+AI SDK Agent / 结构化记录 / 看板趋势），按 `system:collection:*` 权限码授权；手动完成后进入 `WAITING_CONFIRM`，确认后导入 Knowledge 为 DRAFT，禁止自动发布。自动采集不向管理员暴露 XPath/Cookie/Proxy；模型只调用 `browse_page`/`save_record`/`finish_collection`，同域/去重/上限由 Backend 强制。详见 `docs/collection/README.md`。
- `/api/v1/platform/products/*`：B 端产品最小骨架 CRUD + 2~N 字段对比（`catalog_products`，可关联 Knowledge Document）；完整参数体系待确认。详见产品模块。
- `/api/v1/platform/ai/business-prompts*`：B 端业务提示词（BASE_CHAT/KNOWLEDGE_SEARCH/PROJECT_ANALYSIS/PRODUCT_CONSULTATION/THERMAL_CALCULATION/PRODUCT_COMPARE/REPORT_GENERATION/VISION_UNDERSTANDING），内部仍写 `prompt_versions`，普通管理员不接触 version/diff。Prompt 不能覆盖知识权限、data scope、热工引擎、Project Memory 隔离、Tool 权限或报告归属。不保留 PRODUCT_COMPARE_AGENT / THERMAL_AGENT / REPORT_AGENT。
- `/api/v1/platform/masterdata/*`：Legacy 产品系列/规格/参数审核 API 保留兼容，普通菜单隐藏；P0 普通产品入口走 `/platform/products`。企业内容/证书旧审核 API 仅兼容保留。
- `/api/v1/platform/company/*`：B 端普通企业信息（名称/简称/Logo/简介/官网 + 资质轻量 CRUD），复用 `system:md:enterprise:{list,edit,add,remove}`；保存后即可用于 About 与报告，不走审核/年审。详见 `docs/company/README.md`。
- `/api/v1/platform/construction/*`：B 端平台构造方案管理（保温系统、构造方案/构造层/产品选项/方案文档），按 `system:construction:*` 权限码授权；版本化状态机复用 masterdata `md-workflow.service.ts`（`registerVersionedEntity` 注册 + 共用工作流工厂），new-version 同事务复制子表；submit/publish 前强制结构校验（层序连续、基层/产品层唯一、产品层厚度落在选项区间、引用规格/材料已发布生效）；已发布读取接口 `/published/*` 只返回 PUBLISHED 且生效中的数据，供未来图集热工查表模块取数。详见 `docs/construction/README.md`。
- `/api/v1/platform/thermal/*`：B 端平台图集热工参考选用表管理（参考集/参考行 + Excel 导入作业 + 确定性热工计算引擎 + 候选方案查询与确认），按 `system:thermal:*` 权限码授权；导入走预签名直传 + BullMQ 解析（`thermal-import` 队列），apply 单事务建/复用 DRAFT 集，错误行默认拒绝、`ignoreErrors` 显式确认才跳过，DB 唯一冲突整体回滚；参考集版本化状态机复用 masterdata，new-version 同事务完整复制参考行业务字段（含产品目录、来源文档/页、页签和排序）；submit/publish 前强制结构校验（行引用方案已发布生效、厚度在选项区间、数值>0、证据必填，存在 sourcePageId 时必须属于当前、有效的 PUBLISHED Knowledge Version）；已发布读取接口 `/published/sets` 只返回 PUBLISHED 且生效中的集，供方案筛选查 K 值；计算引擎（`POST /calc` 三模式 REFERENCE_TABLE/EQUIVALENT/LAYERED）只接受标识入参、数值全部从已发布数据加载，结果与全过程快照落 `thermal_calc_records`（历史不随后台参数漂移）；人读计算步骤由 `thermal-calc-presentation.ts` 从冻结快照派生（AI `/calc` 响应 `presentation` 字段与 `GET /api/v1/ai/thermal/calc-records/:id`），AI 端入口 `/api/v1/ai/thermal/calc`（C_APP/PC_AI + 项目可见性守卫）；候选方案查询（`POST /candidates/query`）按条件（地区/建筑类型/系统/基层/厚度区间/目标K/目标热阻/标准ID/项目日期 asOfDate）匹配已发布图集参考行，命中/未命中/数据缺失三态标注、相邻已发布规格（neighborTolerance）、排序只按后台规则（命中数 → K 模式距离升序：APPROX/EXACT 为 abs(K-target)，MAX_LIMIT 为 target-K，MIN_LIMIT 为 K-target → 标准厚度 → 集 priority → 版本，候选附 ranking.kGap/isClosestToTarget）、不宣称唯一最优、图集无结果不自动批量计算；地区限值多标准并存时返回 `limitCandidates` 由用户选择（不隐式选最严格）；用户确认的最终候选与选择理由快照落 `thermal_candidate_selections`（查询+候选全快照，历史不漂移），AI 端入口 `/api/v1/ai/thermal/candidates`、`/candidate-selections`。详见 `docs/thermal/README.md`。
- `/api/v1/platform/standard/*`：B 端平台地方标准采集（标准来源配置/抓取作业 + 爬虫 CRAWL 与人工 MANUAL 双通道汇入 + 轻量审核流转 + 指标发布转换落库 + 版本替代/过渡期），按 `system:standard:*` 权限码授权；定时抓取复用 `cron_jobs`（jobType `standard_crawl`，`maintenance` 队列分发，worker.ts 已有 `knowledge_crawler` 同款先例），手动触发 `POST /sources/:id/crawl`；通用解析器按站点配置（栏目 URL/url-scroll-none 三种分页/关键字过滤/提取正则），先存详情页原文（对象存储 + SHA-256 幂等/变更检测）后按规则提取，规则调整可重跑不重抓网页；人工录入 `POST /documents` 组合提交（文档+适用范围+指标，指标证据条款引用必填），与爬虫文档同表同身份空间防重复；审核流转 DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED（可驳回 REJECTED，发布同编号旧版自动 DISABLED）；指标 publish 同事务生成 `thermal_standard_limits` 消费行（basisCode=documentNo、standard_document_id 溯源，同 regionCode 不同 basisCode 天然并存）；替代关系 confirm 设置旧文档过渡期 `expiresAt`，过渡期结束由每日抓取 job 顺带扫描失效；AI 对话只消费已发布限值，不直接读抓取库。详见 `docs/standard/README.md`。
- `/api/v1/platform/comparison/*`：B 端平台材料对比规则管理（版本/材料/规则/证据/维度 + 批量导入 + 已发布读取），按 `system:comparison:*` 权限码授权；版本化状态机复用 masterdata，new-version 同事务复制材料/规则/证据并重映射内部 FK；submit/publish 前强制结构校验（规则至少一条、双方材料同版本且类别正确、每条规则至少一条 VICP 侧证据、竞品数值必带竞品侧证据、优势文案/适用条件/必要披露非空）；规则引用同一版本内双方材料（VICP 侧类别为 VICP、竞品侧非 VICP），防不同型号/密度混比；已发布读取 `/published/rules` 只返回 PUBLISHED 且生效中的数据；AI 端 `/api/v1/ai/comparison/rules`（C_APP/PC_AI + 项目可见性守卫）；`material_compare` 场景对话以 prompt 注入消费已审核规则（`prompt-assembly.ts` ruleContext），回答完成后按引用规则写 `ai_rule_usage_logs`（含快照）。详见 `docs/comparison/README.md`。
- `/api/v1/platform/nodes/*`：B 端平台节点图库管理（节点大样图 + 节点-方案关联），按 `system:node:*` 权限码授权；版本化状态机复用 masterdata，new-version 同事务复制关联子表；submit/publish 前强制结构校验（部位必填、高清图/CAD 至少一个、引用保温系统与关联方案已发布生效）；已发布读取 `/nodes/published` 只返回 PUBLISHED 且生效中的节点（关联只保留已发布方案）。详见 `docs/nodes/README.md`。
- `/api/v1/platform/report-templates/*` 与 `/api/v1/platform/reports/*`：B 端平台报告。普通业务按系统预置 `reportType` + 报告设置生成/列表/审核，不传 templateId；内部 `report_templates` 作为渲染配置保留，模板管理菜单隐藏，仅 SUPER_ADMIN / `system:report:template:*` 高级接口可访问。模板类报告生成时快照冻结章节数据，Worker 确定性渲染；需审核类型 READY → PENDING_REVIEW → APPROVED 可发布。详见 `docs/reports/README.md`。
- `/api/v1/platform/review-center/*`：B 端平台统一审核中心（产品/构造/热工/标准/比较/节点/模板/模板报告），按 `system:review:{list,approve}` 权限码授权；`professional_reviews` 为单一数据源，各域 transition（md-workflow/standard/报告审核）在状态变更同一事务内 upsert，审核中心只做队列读取与决议委托（无审核分叉），不替代各模块原审核端点。详见 `docs/reports/README.md`。
- `/api/v1/internal/knowledge/*`：服务间受控接口（静态密钥 `x-internal-key` = `env.INTERNAL_API_KEY`，未配置则整体禁用）；服务端直写对象存储并投递解析，产物为 DRAFT 待审核，不自动发布；不校验 B_ADMIN 客户端。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- `/api/v1/workspace/*`：B 端工作台，先校验 `B_ADMIN` + `SUPER_ADMIN`；P0 不能新增项目。
- `/api/v1/platform/projects`：B 端全平台项目列表/详情/删除（`system:project:list|remove`），不能新增；列表含创建用户与所属部门。
- `/api/v1/platform/users`：B 端统一用户列表（`SUPER_ADMIN` + `NORMAL_USER`，可按 role/status/keyword/departmentId 筛选）。B 端新增/导入只能创建超级管理员（User + PHONE + ADMIN/SUPER_ADMIN access，默认不主动开 CLIENT）；`PATCH /users/:id` 禁止改普通用户姓名/手机/邮箱/角色/账号类型，部门归属走部门成员接口。用户详情返回 `appAccess`。
- `/api/v1/platform/departments/:id/members`：部门成员查看/添加/移除（`system:dept:list` / `system:user:dept`），只允许 `SUPER_ADMIN` 或 `NORMAL_USER` 进入部门。
- `/api/v1/projects/*` 与 `/api/v1/client/projects/*`：C 端普通用户创建/编辑/删除自己的项目；`GET /projects/public` 返回当前用户按部门范围可查看的共享项目（含本人、历史 PUBLIC、DEPARTMENT）。
- `GET /api/v1/client/me/departments`：C 端当前用户可用于项目可见范围的所属部门（不暴露整棵组织树）。
- `POST /api/v1/auth/register` 与 `POST /api/v1/auth/client/register/password`：C 端手机号密码注册，固定 `users.role=NORMAL_USER`、`adminLoginEnabled=false`，并写入 `user_app_access` 的 CLIENT / NORMAL_USER；不能由前端传 role。
- `POST /api/v1/auth/client/wechat-phone-login`：C 端微信手机号快捷登录（`loginCode`=`wx.login()`，`phoneCode`=`getPhoneNumber`，两者不是同一个 code）。沿用 `users` / `user_identities`：先查 `WECHAT_OPENID(openid)`，未命中再查 `PHONE(phone)` 并绑定微信，两者都没有则自动注册 `NORMAL_USER`（无密码、无部门、`adminLoginEnabled=false` + CLIENT access）。同一手机号只对应一个 User；已有 ADMIN / SUPER_ADMIN 的账号第一次进 C 端自动创建 CLIENT / NORMAL_USER，不新建第二个 User，也不再拒绝超级管理员。C 端令牌 `{ aud: 'client', role: 'NORMAL_USER' }`，不继承后台权限，首次开通写审计 `auth.c_access_opened`。openid 已绑定但微信手机号与系统手机号不同时不静默覆盖，返回 `phoneMismatch`。密码在 `user_identities.password_hash`；未设置时手机号密码登录返回 `PASSWORD_NOT_SET`。设置/重置密码：`POST /api/v1/auth/client/password/set` 与 `/reset`，必须先短信验证手机号归属。微信配置 `WECHAT_MINI_APP_ID` / `WECHAT_MINI_APP_SECRET` 仅服务端，access_token 缓存 Redis 键 `wechat:mini:access_token`。错误码见 `src/shared/auth-errors.ts`（含 `APP_ACCESS_DISABLED` / `PHONE_IDENTITY_CONFLICT` / `WECHAT_IDENTITY_CONFLICT`）。
- `/api/v1/files/*`：统一文件资产中心 + 源文件上传、状态和受控下载。`files` 表是唯一文件资产表（storageProvider/bucket/objectKey 唯一、sha256 索引、软删除/回收站），业务表一律只存 `fileId`；`POST /upload-intent`（`/upload-intents` 别名）按 SHA-256 返回 `mode=REUSE`（复用已有 READY 文件）或预签名直传，`/:id/complete` 发现重复内容时兜底合并并返回 `duplicateOfFileId`；`GET /` 对 B_ADMIN 是 FilePicker/中心列表（全平台 READY 文件 + 引用计数轻字段，`includeRecycled=1` 需 `file:center:view`），对 C 端/PC AI 端保持"我的源文件"口径；`/recent`、`/:id`、`/:id/preview` 面向 B_ADMIN（预览用 `createPreviewUrl` 短期内联签名 URL，绝不返回永久 URL）；`/:id/references` 走 `file-reference.service` 只读 UNION 聚合各业务关系表（业务表是唯一事实源，不建统一引用表）；`/:id/recycle|restore|DELETE /:id/permanent` 需 `file:center:manage`，引用数 > 0 时返回 `error.details.errorCode = "FILE_IN_USE"` + 引用摘要。详见 `docs/files/README.md`。
- `/api/v1/ai/*`：AI 会话与流式对话。
- `/api/v1/client/*`：C 端/PC AI 端只读内容接口（`/client/content/enterprise-profile` 为企业介绍兼容入口、`/client/knowledge/*` 公开文库），JWT + `requireClient(C_APP, PC_AI)`，不依赖后台 RBAC 权限码。公开文库只返回 PUBLISHED + 生效中数据；企业介绍与 `GET /api/v1/company/about` 同源，只返回名称/简称/Logo/简介/官网/资质。
- 知识库的 ORIGINAL 是原文浏览唯一载体，SEARCH_SOURCE 仅用于 AI 索引；未映射检索页不得伪造 ORIGINAL 页。CHUNK_REBUILD 只能重建 Section/Block/Chunk，不得删除预览、人工页签、已确认 TOC 或人工页面映射；AI 只召回当前、已发布、未过期、AI_ENABLED 的版本。
- `/api/v1/reports/*`：报告生成、发布和下载。
- `/api/v1/shares/*`：登录用户创建和禁用公开分享链接。
- `/api/v1/public/shares/*`：匿名访问公开分享快照或报告文件。

## Swagger 文档规范

- 所有新增或修改的 Fastify 路由必须在 `schema.tags` 中声明标签。
- 标签统一使用“客户端边界 / 业务模块”格式，客户端边界只能是 `B端`、`C端`、`PC AI端`、`共用` 或 `公共`。
- B 端平台管理使用 `B端 / 平台 / <模块>`，B 端工作台使用 `B端 / 工作台 / <模块>`；认证、AI、文件、报告和分享等能力必须根据真实访问边界选择标签。
- 标签只用于 Swagger 文档分类，不替代 JWT、客户端类型、精确权限码、项目权限或文件/会话归属校验。
- 不得新增没有客户端前缀的旧式标签，例如 `用户管理`、`AI 对话`、`文件` 或 `报告`；新增标签应同时登记到 `src/plugins/swagger.ts` 的 OpenAPI 标签目录。

## 权限与审计

- 固定业务身份为 `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER`（`users.role` 兼容保留）。分端访问真源是 `user_app_access`：`UNIQUE(user_id, app)`，`app=ADMIN|CLIENT`。登录方式只识别同一个 User；B 端 Token `{ aud: 'admin', role: 'SUPER_ADMIN' }` 需 ACTIVE ADMIN access；C / PC AI 端 Token `{ aud: 'client', role: 'NORMAL_USER' }` 需 ACTIVE CLIENT access。超级管理员第一次用同一手机号登录 C 端时自动开通 CLIENT，不新建用户、不继承后台权限。渠道用户表/角色保留兼容，B 端注册、登录、菜单和 API 入口隐藏。CLIENT access 不等于部门归属；无部门也可登录、使用 AI、创建 PRIVATE 项目。项目 / Conversation / Memory 继续归属同一个 `users.id`。
- 经销商和业务员统一为 `CHANNEL_USER`，通过 `channelType` 标签区分（当前入口隐藏）。
- 普通用户可在 C / PC AI 端创建、编辑、删除自己的项目；B 端超级管理员可查看/删除全平台项目，不能新增。
- B 端用户管理为统一 `/platform/users`：可创建/编辑/启停/删除/重置密码超级管理员；普通用户只允许查看、启停、删除，资料与部门不走用户编辑接口。
- 项目可见范围 P0：`PRIVATE` | `DEPARTMENT`（`visibleDepartmentId` + `includeChildDepartments`）；历史 `PUBLIC` 只读兼容。部门可见性由 Backend 按部门树过滤，不能把全量项目下发给 C 端。
- 私有项目仅创建者可访问；B 端超级管理员可查看/删除但不能用 C 端令牌绕过归属。
- 历史公开项目允许所有登录用户只读；只开放已发布报告，不开放源文件和原始 AI 会话。
- 动态 RBAC 控制后台菜单和功能，不能覆盖项目访问规则。
- `ProjectMember` 只作为扩展点，第一期不开放协作接口。
- 项目变更、权限变更、AI 配置、AI 调用、文件和报告操作必须记录审计。
- 业务写入和对应审计应处于同一个数据库事务。

## AI、文件与报告边界

- AI 不能执行任意 SQL、Shell、服务器文件操作或绕过权限读取数据。
- AI 只能调用具有 Zod 输入、权限检查和审计的后端工具。
- 工程计算由确定性代码完成；AI 负责参数提取、检索、解释和结构化报告草稿。
- 标准条文和技术结论必须引用检索来源；资料不足时明确说明不确定，禁止编造。
- 模型按业务场景从数据库解析，禁止在业务代码写死 DeepSeek 或模型 ID。正式 Runtime 只选择 `enabled=true` 且 `lastTestStatus=PASSED` 的模型；图片请求额外要求 `supportsVision=true`。模型配置不开放 temperature / topP / maxTokens / 回答风格 / supportsTools / supportsAgent；回答风格归 Global Response Policy，业务 Prompt 只写该场景关注点，运行时参数归 `AiTaskRuntimePolicy`。推理强度业务层只使用 `LOW` / `HIGH` / `MAX`，由 Adapter 映射，禁止静默降级。启用或设默认前必须通过真实 Agent 准入测试（文本/工具回环/推理，声明视觉时再测图片）。
- API Key 必须 AES-256-GCM 加密保存，任何响应都不得返回密钥。
- AI 回答点赞、反馈和重新生成都必须保留原始消息，不覆盖历史回答。
- AI 流式回答支持停止：停止只结束当前生成，必须保存已生成内容并将消息标记为 `STOPPED`；会话保持可继续发送新消息。
- 深度思考是会话级设置，默认 `OFF`；每条消息保存实际 `reasoningMode`，不能用全局开关覆盖用户会话。
- 业务 Prompt 只写该场景要关注什么。怎么说由代码层 `GLOBAL_RESPONSE_POLICY`（约 11 条）和 Answer Contract（DIRECT/KNOWLEDGE/PRODUCT/COMPARISON/REFERENCE_LOOKUP/THERMAL/CLARIFY）统一负责；怎么做由 `EXECUTION_POLICY` 负责。Prompt 不能覆盖知识权限、热工引擎、data scope、Project Memory、Tool 权限、报告归属，也不能覆盖“不得暴露内部 Tool/Agent、不得暴露思考链、不得伪造来源”。项目上下文/记忆/摘要继续完整注入供判断，默认不复述。
- AI 对话敏感词围栏：发送消息前对 `ai_content_filters` 启用的词条做确定性校验（CONTAINS/REGEX，可指定生效场景），命中即拦截且不发模型请求；用户消息以 `BLOCKED` 状态落库并记录命中词条、写审计，返回 `AI_CONTENT_BLOCKED` 错误（400 语义码 + 可配置中文提示）。B 端通过 `/api/v1/platform/ai/filters` 管理词条，按 `system:ai:filter:*` 权限码授权。
- AI 会话自动标题：会话首条用户消息回答完成后投递 `ai-title-generation` BullMQ 队列异步生成标题，模型与提示词走 `conversation_title` 场景解析；仅当会话标题仍为空（未手动重命名）时写入，生成失败保持“未知对话”不阻塞主对话。
- 仅 `general_chat` 作为 C 端默认入口；用户不选择场景、系统指令或 Agent 类型。统一 Conversation Runtime 按 UI 动作 → ConversationTaskState → 项目/会话上下文 → 最后才是 intent 判定任务（GENERAL / PRODUCT_CONSULTATION / COMPARISON / REPORT_PREPARATION / REPORT_GENERATION）。Chat 领域 Tools 为 `search_knowledge` / `get_project_state` / `get_product_data` / `thermal`（`LOOKUP_CANDIDATES` 查已发布参考档位 / `CALCULATE` 正式计算） / `compare_products` / `compare_solutions`（兼容） / `generate_report`。寒暄走普通 `streamText`；产品对比走 Compare Service，热工为可选能力，不作为对比前置。查已有图集/参考方案走 `REFERENCE_LOOKUP`（先查已发布选用表，未命中再检索知识库图集原文），不得仅因「传热系数 / K值」进入 `THERMAL`；正式计算或限值判断才进 `THERMAL`。人机选择统一 `USER_SELECTION`（图集/知识来源可多选，单来源自动选中不打断；报告类型不明确时结构化选择，禁止模型把类型写成 Markdown 编号）。`insulationSystemId` 只表示保温体系，不是图集来源。确认后固化 Report Context Snapshot，再走统一 `createReport` → Snapshot → `queueReportGeneration`；`report_completed` 只在 READY 后由客户端轮询确认，SSE 在入队时发 `report_queued`。BullMQ 中间重试对用户保持 `GENERATING`。`resolveAiCapabilities` 只做预路由与安全限制，不得用 regex 卡死 Tool 选择。知识检索只覆盖 PUBLISHED + AI_ENABLED + 当前用户有权访问的资料。快捷提问见 `docs/ai/quick-prompt.md`；`content` 必须是用户自然问题，seed 只覆盖仍带系统味的旧文案。其他场景 `visibility=INTERNAL`，Prompt 版本化保留给技术管理员。
- 会话滚动摘要（`ai_conversation_states`）与项目长期记忆（`project_ai_memories`）分别承担短期压缩和跨会话项目事实；ASSUMPTION / 未核实记录不得当事实注入。Agent Run 使用 `streamText` + `tool()` + `stepCountIs`。`fullStream` 按 Step 缓冲：有 Tool Call 的 Step 文本只进 `internalStepText`，无 Tool Call 的最终 Step 才写入 `userVisibleText` 并按段发送 SSE `delta`。WAITING_USER_INPUT 必须持久化 AI SDK `responseMessages`（assistant tool-call / tool result / assistant text），Resume 不得只追加 `fullText`。`ai_tool_calls` 真实落库；热工计算必须走确定性引擎。Tool `inputSchema` 必须是单一 `z.object`（可用 `enum` + `superRefine`），禁止 `z.discriminatedUnion` / JSON Schema `oneOf`/`anyOf`，避免 OpenAI 兼容网关卡住不吐流。停止必须立刻 `CANCELLED` 对应 Agent Run 并释放会话生成锁；`RUNNING` 超过 `AI_AGENT_OVERALL_TIMEOUT_MS` 在 GET 时标失败，避免 C 端无限轮询。LLM 不得决定权限、项目范围、热工公式、跨域合法性、去重或事务。
- AI 配额：并发生成（Redis 计数）+ 每日请求数双重限制，`SUPER_ADMIN` 豁免；错误使用统一 `AI_*` 错误码（`src/shared/ai-errors.ts`）。
- AI 配置、运营、反馈处理与调试使用独立 `system:ai:*` 权限码并写审计，详见 `docs/ai/`。
- AI 会话历史支持分页、搜索、来源筛选、项目筛选、重命名、按用户置顶、移动项目、软删除和恢复；删除会话必须禁用由该会话产生的有效 AI 分享链接。
- 聊天图片属于 Message 附件（`ai_message_attachments`），不落 projectId；上传 `purpose=CHAT_IMAGE` 完成后直接 READY，不进文档解析。Vision 只产出观察上下文再进入现有编排，模型必须 `supportsVision=true` 且已通过准入测试，未配置返回 `VISION_MODEL_NOT_CONFIGURED`。
- 页面图片结构化识别调用 AI SDK 时，识别规则放在 `instructions`，`messages` 仅包含带图片的用户消息；不得在 `messages` 中传 `system` 角色。
- 页面图集结构化识别使用独立 `PAGE_RECOGNITION` 运行时预算（8192 输出 token、120 秒），不复用聊天图片观察的 1200 token 上限，以免多构造/多厚度 JSON 被截断。
- 多厚度合并单元格按构造及同行拆分选项；可变产品层的层级厚度/热阻留空是正常结构，档位数值进 `options[]`。未选可编辑热工参考集时确认页只进入知识问答，不进入正式方案查询。
- 页面识别模型 JSON 与 schema 不符时，仅确定性修复数字字符串、空数组和规格等级等明确的表示差异，最终仍须通过 Zod；不猜测双 R 或补算 K。失败日志只记字段路径和结束原因，不记录原页全文。
- 页面识别服务商余额不足须返回独立、通俗的中文错误码与提示，不把服务商原始响应或请求标识展示给用户。
- 页面识别的模型解释性备注与真实任务失败分开展示；批量核对只自动确认通过字段、厚度异常、参考集和已发布方案/规格映射校验的页面，逐页返回跳过原因。查看内容优先已确认目录，再用正文章节，页面导航始终可用。
- 图集识别提示词显式列出 `pageRecognitionResultSchema` 的字段层级；兼容网关若忽略 responseFormat，模型仍须输出 `thicknessMm`/`constructionCode`/`layers`/`options` 等正式键名，不得用 `thickness`/`systemCode`/`constructionLayers` 别名。
- 会话 `projectId` 可空：有项目才注入项目结构化上下文；无项目仍可发图片、检索知识和生成报告。
- `reports.projectId` 可空（继承会话项目，无项目则为 null）；`GET /api/v1/reports/my` 返回当前用户报告，无项目时 `project=null`。预置业务类型（含综合技术方案/项目简报）默认 `requiresProject=false`，只有未来确实要求项目字段的类型才拦截。
- 公开分享只暴露分享快照或已生成报告文件，不开放源文件、知识库原文或原始 AI 会话。
- `PROJECT` 分享只暴露项目摘要和已发布报告快照；不得返回项目源文件、知识库原文、未发布报告、原始会话或后台权限信息。
- 源文件使用预签名直传；解析、OCR、索引和报告导出必须通过 BullMQ Worker。
- DOCX 双通道（正式改离线页图）：Mammoth → 文本/Chunk/RAG；页面图默认 **离线 PNG/ZIP 上传** + 视觉识别候选 + 人工确认（`docs/knowledge/page-offline-recognition.md`）。LibreOffice Headless（`DOCX_RENDER_ENABLED` 默认 false）仅 fallback，不要求生产装 soffice。详见 `docs/knowledge/docx-page-render.md`。
- Knowledge Version 只有 `DRAFT` 可写页面、页图、TOC、文件资产、解析/分块和识别内容；`PENDING_REVIEW`、`APPROVED`、`PUBLISHED`、`DISABLED` 均只读。已审核内容需创建/克隆新 DRAFT 再修改；发布/停用走既有 workflow。AI_ENABLED 离线页图版本发布前必须每页有原页图且识别已 CONFIRMED。同一页面识别使用稳定 jobId + `recognitionRunId` 单飞，PENDING/PROCESSING 有有效 run 时拒绝重复入队，Worker 只允许当前 run 写回；Confirm 事务锁页且仅 `REVIEW_REQUIRED` 可执行。识别候选严格区分产品层热阻 `productThermalResistance` 与外墙主断面总传热阻 `totalThermalResistance`；语义不明的旧 `rValue` 不自动映射；方案/产品规格映射遵循 0=NOT_FOUND、1=自动绑定、多个=AMBIGUOUS 并要求管理员显式选择。确认只消费 `draftStructuredData`，并在同一事务重建当前页 chunks、同步当前 pageId 热工行、固化 confirmed snapshot 和页面权威字段。batch/ZIP 全量 preflight 后写对象与数据库，失败回滚数据库并清理新对象；新对象与数据库提交成功后才删旧对象。ZIP 导入解压前校验条目路径、类型、数量、单图/总解压大小与 manifest 上限。
- OCR 未配置时将文件标记为 `OCR_REQUIRED`，不得把空解析结果当成功。
- 知识库文档版本化：版本状态机 DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED -> DISABLED，内容写入统一由 `knowledge-version-guard.ts` 限定为 DRAFT；只有 PUBLISHED 版本参与生产检索。已审核内容通过克隆/创建新草稿修改，不原地修改；解析任务走 `parsing_jobs` 领域表，与通用 `async_tasks` 职责分离；知识库多来源（B 端上传/批量导入/爬虫/内部 API）统一走 `knowledge-ingest.service` 入库链路，插入 `files` 前按 SHA-256 查重（已发布版本冲突抛 409，仅草稿提示先处理），爬虫与内部 API 产物默认 DRAFT/REVIEW_PENDING 待审核；知识版本支持从文件中心按 fileId 复用已有文件：版本创建可直接带 `originalFileId`/`searchSourceFileId`（可同一 fileId，禁止复制 OSS 对象），`versions/:id/upload-intent` 支持 `existingFileId`（REUSE 不重新上传），`upload-complete` 对 READY 文件直接绑定、对未就绪文件保持完整校验与本人限制；更换正式/AI 识别文件只收新 fileId，旧文件不删除、历史版本引用可追溯。检索权重来自 `knowledge_ranking_rules` 可配置，检索评测存 `knowledge_search_evaluations`。详见 `docs/knowledge/README.md`。
- 知识库为"原文档导航 + 原始页面 + AI 检索索引"模型（2026-08 二次优化）：Original File = 对外展示的正式原文件，Search File = 机器检索文本源（双源资产表 `knowledge_document_assets`，role=ORIGINAL/SEARCH_SOURCE/OCR_SOURCE/PREVIEW）；TOC（`knowledge_toc_items`）= 原文件目录（可信 PDF 书签或目录页解析为 PENDING_REVIEW 初稿，CAD「图纸和视图/模型」导航树必须拒绝；B 端人工 CONFIRMED；不由 detectHeading 替代）；Page = 物理页序号（physical_page_number）+ 印刷页码标签（page_label，可为 A1/A5/D16 等非整数，禁止 Number()，禁止把物理页号当成印刷页码）；Section = AI 语义章节（≠ TOC）；Block = 页面内标题/段落/表格块（Block 级 sectionId 归属，同页多小节各归各）；`knowledge_chunks` 仅作辅助检索索引。PDF 正文按分栏几何重建阅读顺序。转曲/无文本层 PDF 判定 `NO_TEXT_LAYER`（不是解析失败）：绑定 SEARCH_SOURCE 后经 `knowledge_page_mappings`（禁止物理页硬对齐与线性插值）建立检索页→原文页映射；无检索源则 `SEARCH_SOURCE_REQUIRED`，只能以 BROWSE_ONLY 发布。用户看到的"原文"必须是 ORIGINAL PDF 页面/预览图（`pageImageObjectKey` 逐页渲染，concurrency=1，`PDF_PREVIEW_DPI` 默认 130），parsedText 一律称"机器提取文本"（`extractedText`）。发布门禁：AI_ENABLED 必须有可搜索文本源（硬拦截），TOC 未确认/映射未核验为软提示；历史资料用 UPGRADE_PARSE 逐步升级（`pnpm backfill:knowledge-wiki` 或 B 端「升级解析」）。重新解析覆盖自动 TOC/Section/Page/Block/Chunk，保留 CONFIRMED TOC、MANUAL 页签与 verified 映射。
- AI 来源契约统一走 `src/modules/ai/ai-source.mapper.ts`（AiSourceRef：含 tocPath/pageLabel/physicalPageNumber/originalFileId 等；用户展示用 pageLabel，physicalPageNumber 只用于程序打开页面），正常生成与 regenerate 复用同一 mapper，无证据时 sources 为空数组；来源详情（TOC 路径 + ORIGINAL 页面预览 + 机器提取内容 + 高亮）走 `GET /api/v1/ai/knowledge/source-detail`，与公开文库共用 `knowledge-wiki-read.service`（只读 PUBLISHED+生效中，私有项目越权返回 404；公开文库按 pageLabel 定位走 `GET /api/v1/client/knowledge/documents/:id/pages/by-label/:pageLabel`）。
- 专业 AI 会话必须选择保温体系：会话级 `ai_conversations.insulationSystemId`（nullable，可切换写审计），非 general_chat 场景创建/发送前强制校验（`AI_INSULATION_SYSTEM_REQUIRED`）；体系影响 Prompt 上下文、知识检索加权（`knowledge_documents.insulation_system_id` 标注列 + INSULATION_SYSTEM_MATCH 权重）与候选查询 systemId 注入；体系列表 `GET /api/v1/ai/context/insulation-systems`。
- 公开文库只暴露 `knowledge_documents.visibility=PUBLIC` + PUBLISHED + 生效中文档（默认 PRIVATE）；C 端企业介绍 `GET /api/v1/company/about`（登录可读），旧路径 `/api/v1/client/content/enterprise-profile` 兼容保留。
- B 端消息通知（提醒闭环）：`notifications` + `notification_reads`（广播行 + 按用户已读差集），`/api/v1/platform/notifications` 系列端点按 `system:notification:*` 授权，轮询无 WebSocket；埋点：AI 点踩/文字反馈、标准待审核、知识解析失败、报告生成失败；`createNotification` 尽力写入不阻塞主流程。
- 渠道数据隔离预留：`data_scope` 枚举新增 CHANNEL/CHANNEL_AND_CHILDREN，`users.channelId/parentChannelId`（nullable），解析器 `src/shared/data-scope.ts`；第一期不改变任何现有查询语义。
- 报告以结构化 JSON 为事实源，模板生成 HTML、图片、Word 和 PDF。

## 需求变更定位

- 数据模型或索引：`src/db/schema.ts` 和 `drizzle/`。
- B 端菜单信息架构/菜单种子：`src/db/menu-seed-tree.ts`（纯数据，一级仅项目/产品/知识/报告/AI 配置/AI 运营/系统 7 个 + Admin-Web 静态工作台；叶子 routePath 不变即 menuId 不变，隐藏路由 visible=false）；菜单树过滤与空壳目录裁剪 `src/modules/menus/menu.service.ts`（`buildMenuTreeForPermissions` + `pruneMenuTree` 子树递归）。详见 `docs/menus/README.md`。
- 项目可见性：`src/shared/permissions.ts` 与项目模块。
- 用户、角色、部门、字典：用户、权限和系统管理模块。部门成员查看/添加/移除在 `system-management.routes.ts` + `department-members.service.ts`；C 端可选部门 `GET /client/me/departments` 在 `client-profile`。C 端微信手机号快捷登录 / 密码设置在 `src/modules/auth/`。
- 文件上传、解析、OCR：文件模块、存储适配器和文档 Worker。文件资产中心（列表/详情/引用/预览/回收站/SHA-256 复用）：`src/modules/files/`（`file-center.service.ts` + `file-reference.service.ts` 引用聚合 + `files.routes.ts`），权限码见 `src/shared/file-permissions.ts`（`file:center:*`），FilePicker 知识接入见 knowledge 模块 `createDocumentVersion`/`createVersionUploadIntent`。详见 `docs/files/README.md`。
- 知识库文档、版本、解析、检索：知识库模块（`src/modules/knowledge/`，含编排层 `knowledge-workflow.service.ts` / 用户态 `knowledge-user-status.ts`、层级检索 `searchWikiHierarchy`、统一 Wiki 读取 `knowledge-wiki-read.service.ts`、原文导航服务 `knowledge-original.service.ts`（资产/TOC/页面/映射/门禁）、页面映射纯函数 `knowledge-page-mapping.ts`、块化管线 `knowledge-chunking.ts`（parsePageToBlocks/buildSectionDrafts/buildChunksFromBlocks）、C 端公开文库 `knowledge-client.routes.ts`）、`knowledge_*`/`parsing_jobs` 表及 `drizzle/` 最新迁移（0028：assets/toc_items/page_mappings/页码拆分/usageMode）；历史资料升级 `pnpm backfill:knowledge-wiki`（UPGRADE_PARSE）；后台知识库接口按 `system:knowledge:*` 权限码授权。
- 企业信息（普通名称/简称/Logo/简介/官网/资质）：`src/modules/company/`，表仍为 `enterprise_profiles`/`enterprise_certificates`（历史字段保留不删）；B 端 `/api/v1/platform/company`，C 端 `/api/v1/company/about`；权限复用 `system:md:enterprise:*`。详见 `docs/company/README.md`。
- 产品管理最小骨架：`src/modules/products/`、`catalog_products`/`product_knowledge_links`，路由 `/api/v1/platform/products`。Legacy 系列/规格/参数仍在 `src/modules/masterdata/`，菜单隐藏。确定性参数走 `knowledge-fact-resolver.ts`（优先 VERIFIED Fact）。详见 `docs/masterdata/README.md`。
- 采集管理（独立 Domain）：`src/modules/collection/`、`collection_sources`/`collection_skills`/`collection_runs`/`collection_records`/`collection_tasks` 表，队列 `collection-fetch`。自动采集 Agent 使用 AI SDK `generateText` + `tool()` + `stepCountIs`，模型只见 `browse_page` / `save_record` / `finish_collection`；sameOrigin、visited、maxPages、maxSteps、timeout、rate limit、retry、fingerprint 去重由 Backend 强制。权限码 `src/shared/collection-permissions.ts`。确认入库复用知识库 create-with-file，产物 DRAFT。详见 `docs/collection/README.md`。
- 内部 Structured Knowledge：`knowledge_facts` 表、`knowledge-fact.service.ts`；不是新的 B 端产品中心。
- 保温系统/构造方案/构造层/产品选项/方案文档：构造模块（`src/modules/construction/`，服务层 + 结构校验器 `construction-structure.service.ts` + 已发布读取 `construction-read.service.ts` + `construction.schemas.ts` DTO + `construction.routes.ts`）、`insulation_systems`/`construction_schemes`/`construction_layers`/`scheme_product_options`/`scheme_documents` 表；版本化状态机与工作流工厂复用 masterdata（`registerVersionedEntity`/`registerVersionedWorkflow`，见 `src/modules/masterdata/md-workflow.service.ts` 与 `workflow-routes.ts`）；权限码见 `src/shared/construction-permissions.ts`；导入示例 `pnpm construction:import-example`。详见 `docs/construction/README.md`。
- 图集热工参考选用表与确定性热工计算引擎：thermal 模块（`src/modules/thermal/`，服务层 `thermal.service.ts` + Excel 解析匹配 `thermal-import.service.ts` + 已发布读取 `thermal-read.service.ts` + `thermal.schemas.ts` DTO + 计算引擎 `thermal-calculator.ts`（纯函数）/`thermal-calc.service.ts`/`thermal-calc.schemas.ts`/`thermal.routes.ts`/`ai-thermal.routes.ts` + 候选匹配 `thermal-candidate-matcher.ts`（纯函数）/`thermal-candidate.service.ts`/`thermal-candidate.schemas.ts`）、`thermal_reference_sets`/`thermal_reference_rows`/`thermal_import_jobs`/`thermal_import_errors`/`thermal_calc_rules`/`thermal_standard_limits`/`thermal_calc_records`/`thermal_candidate_selections` 表；版本化状态机复用 masterdata；导入队列 `thermal-import`（`src/queues/queues.ts` + `src/workers/thermal-import.worker.ts`）；权限码见 `src/shared/thermal-permissions.ts`（计算与候选查询复用同一组，不新增权限码）；模板生成 `pnpm thermal:template`；计算引擎公式族由 `thermal_calc_rules.formula_version` 标识（当前 VICP-CALC-1），甲方样例回归放 `fixtures/thermal-regression/`。详见 `docs/thermal/README.md`。客户热工表不自动解析：Ri=0.11、Re=0.04 与示例构造由 `src/db/thermal-default-data.ts` 写入同一套已发布表。参考行可空 `sourcePageId` 绑定人工维护或离线页图导入的 `knowledge_pages`；有页图时 AI 发 `reference_pages`，没有页图只返回参数。LibreOffice 仅作默认关闭的 DOCX fallback，不作为生产依赖。
- 地方标准采集（爬虫/人工双通道、审核与消费转换）：standard 模块（`src/modules/standard/`，服务层 `standard.service.ts` + 通用站点抓取 `standard-crawl.service.ts` + `standard.schemas.ts` DTO + `standard.routes.ts`）、`standard_sources`/`crawl_jobs`/`standard_documents`/`standard_applicability`/`standard_indicators`/`standard_replacements` 表（迁移 0019_tough_harpoon + 0020）+ `thermal_standard_limits.standard_document_id` 溯源列；定时抓取复用 cron_jobs（jobType `standard_crawl`，`maintenance` 队列，`src/worker.ts` 分发到 `runStandardCrawl`）；权限码见 `src/shared/standard-permissions.ts`（`system:standard:*`），错误码见 `src/shared/standard-errors.ts`；指标 publish 同事务转换落库 `thermal_standard_limits`（消费模型，候选查询/计算引擎零改造），同地区多 basisCode 天然并存、同键新版本发布自动停用旧版。详见 `docs/standard/README.md`。
- 材料对比规则引擎（VICP vs 竞品对比的审核化结构化规则）：comparison 模块（`src/modules/comparison/`，服务层 `comparison.service.ts` + 已发布读取 `comparison-read.service.ts` + prompt 上下文与使用日志 `material-compare.service.ts` + `comparison.schemas.ts` DTO + `comparison.routes.ts`/`ai-comparison.routes.ts`）、`comparison_versions`/`comparison_materials`/`comparison_dimensions`/`comparison_rules`/`comparison_evidence`/`ai_rule_usage_logs` 表；版本化状态机复用 masterdata，new-version 同事务复制子表并重映射 FK；五维固定维度（thermal/fire/durability/construction/approval）seed 预置、禁止删除/禁用；权限码见 `src/shared/comparison-permissions.ts`（`system:comparison:*`），错误码见 `src/shared/comparison-errors.ts`；AI 集成：`material_compare` 场景 prompt 注入（`prompt-assembly.ts` ruleContext + `ai.routes.ts` 发送/regenerate 两处），使用日志 `ai_rule_usage_logs` 含规则快照；导入示例 `pnpm comparison:import-example`。详见 `docs/comparison/README.md`。
- 节点图库（节点大样图 + 节点-方案关联）：nodes 模块（`src/modules/nodes/`，服务层 `node.service.ts` + 已发布读取 `listPublishedNodesWithLinks` + `node.schemas.ts` DTO + `node.routes.ts`）、`node_drawings`/`node_scheme_links` 表；版本化状态机复用 masterdata，new-version 同事务复制关联子表；submit/publish 前结构校验（部位必填、图/CAD 至少一个、引用系统与方案已发布生效）；权限码见 `src/shared/node-permissions.ts`（`system:node:*`），错误码见 `src/shared/node-errors.ts`；节点图/CAD 文件 MIME 白名单（png/jpeg/svg/dwg/dxf）见 `src/modules/files/file.schemas.ts`。详见 `docs/nodes/README.md`。
- 报告类型/设置/生成/内部模板/统一审核中心：reports 模块 + 对话侧 `report_context_snapshots`（用户多选确认后固化，产品对比报告不再倾倒整段聊天）。模板渲染仍用 `report_snapshots.dataJson`。详见 `docs/reports/README.md`。
- AI 模型配置、围栏、对话、Agent Tools：AI 配置模块（`ai-config.service.ts` / `ai-provider-adapter.ts` / `ai-reasoning.ts` / `ai-task-runtime-policy.ts` / `ai-model-test.service.ts`）、AI 模块（含 `src/modules/ai/tools/`）、`ai-agent.service.ts`、`ai-capability-router.ts` 和知识检索模块；后台 AI 配置与运营接口按 `system:ai:*` 权限码授权，模型新增/编辑/测试/启停/设默认仅超级管理员。
- B 端消息通知/提醒闭环：notifications 模块（`src/modules/notifications/`），`notifications`/`notification_reads` 表；AI 反馈埋点在 `ai.routes.ts`、标准待审在 `standard.service.ts`、解析失败在 `document.worker.ts`、报告失败在 `report.worker.ts`；权限码见 `src/shared/notification-permissions.ts`。
- 会话保温体系：`ai_conversations.insulation_system_id`、`ai.routes.ts`（创建/发送守卫/切换/体系列表）、`ai-source.mapper.ts`（统一 sources）、错误码 `AI_INSULATION_SYSTEM_REQUIRED`。
- 渠道权限预留：`users.channel_id/parent_channel_id`、`data_scope` 新枚举值、`src/shared/data-scope.ts` 解析器（第一期不做业务过滤）。
- AI 停止生成和会话深度思考：`src/modules/ai/ai.routes.ts`、`ai_messages`/`ai_conversations` 状态字段及 `drizzle/` 最新迁移。
- AI 回答点赞、反馈和重新生成：AI 模块、平台 AI 反馈模块、`ai_message_feedbacks`、`ai_message_regenerations`。
- 报告来源和报告输出：报告模块、报告 Worker、`report_sources`。
- 公开分享：分享模块、`share_links`、`share_views`。
- Redis/BullMQ：队列定义、插件和 Worker 入口。
- C 端认证：`src/modules/auth/`（密码注册/登录、短信登录、微信手机号快捷登录 `wechat-phone-login.service.ts` / `WechatMiniProgramService`，分端访问 `user-app-access.service.ts` + `user_app_access`，错误码 `src/shared/auth-errors.ts`）。
- 全局错误、响应和中文提示：共享错误、响应及错误处理插件。

修改长期约束时，同步更新本文件、`README.md`、`.agents/skills/lg-backend` 和 `.cursor/rules`。
- 客户端固定为 `B_ADMIN`、`C_APP`、`PC_AI`。所有 `/api/v1/platform/*` 和 `/api/v1/workspace/*` 接口必须先通过 JWT、`aud=admin`、`B_ADMIN` 与 ACTIVE ADMIN access；C 端和 PC AI 端不得调用后台管理接口。`/api/v1/client/*` 要求 `aud=client`，ADMIN Token 不得冒充。
- B 端后台接口必须同时具备认证和接口级权限码校验。超级管理员可以直通；其他 B 端账号必须拥有对应按钮权限，例如 `system:user:list`、`system:user:add`、`system:menu:edit`、`system:ai:model:test`。例外：统计当前账号可见/自有业务数据的只读接口（如 `GET /platform/projects/statistics`）只要求 JWT + `B_ADMIN` + 数据范围，不要求按钮权限码。
- 不允许使用“拥有任意 `system:*` 权限即可访问整个模块”的宽权限判断。新增、修改、删除、导出、分配和查看必须使用不同权限码。
- 角色权限查询必须过滤 `roles.enabled = true`。禁用角色不能继续授予菜单或接口权限。
- C 端和 PC AI 端虽然不能访问后台管理接口，但可以访问明确开放的业务接口（AI、公开项目、本人项目、受控文件、报告和分享）；这些接口必须继续执行项目所有者、项目可见性、会话归属和文件归属校验。
- 项目业务权限独立于后台 RBAC。RBAC 只控制后台菜单和按钮，不能替代 `canViewProject`、`canManageProject` 等项目级校验。
- 动态路由只返回当前 B 端账号拥有权限的目录、页面和按钮；目录下没有任何可见子菜单时整体隐藏（不返回空壳目录）；Vue 端只能从组件白名单加载组件，不能执行数据库任意路径。

### 权限变更验收

- 用 C_APP 和 PC_AI 令牌请求任意 `/platform`、`/workspace` 接口必须返回 `FORBIDDEN`。B 端 Token 请求 `/client` 同样拒绝。
- 普通用户不能登录 B 端。超级管理员和已有渠道账号可以用同一手机号登录 C / PC AI 端（自动补 CLIENT access），该令牌有效身份为普通用户，不能访问 `/platform`、`/workspace`，也不能豁免 AI 配额或查看他人文件和报告。渠道账号不能登录 B 端。`users.status=DISABLED` 后两端都失效。
- B 端当前仅 `SUPER_ADMIN` 可进入 `/platform` 与 `/workspace`。`GET /platform/projects` 需 `system:project:list`；`GET /platform/projects/statistics` 不要求按钮权限码。
- B_ADMIN 无权限时，查看、新增、修改、删除、导出和分配接口分别返回 `FORBIDDEN`。
- 禁用角色后重新请求接口，原角色权限立即失效。
- B 端仍可访问 AI 业务接口，但必须通过场景、客户端来源、项目和会话权限校验。

页面识别备注（2026-10-09）：notes 仅逐条抄录原图明确出现的注/备注，无原文备注返回空数组；禁止混入字段映射、null 原因与多厚度拆分解释。正常多厚度留空说明不再从 warnings 移入 notes；真实歧义/数值冲突保留 warnings。存量识别结果需在可编辑草稿重新识别或人工修订，不自动改写已确认数据。

2026-10-19 最终收口补充：普通比较与极值比较、完整副作用证据共用语义字段合同；受限复核后仍执行完整Policy/来源/身份/Revision门禁。原图详情location与page DTO同用印刷页码核验投影，指纹变化时保持未知，物理定位不改。报告模板工作流复用业务DTO映射sectionsJson→sections，6个状态操作不再因响应序列化返回500，权限与审核转换不变。用户已确认免责声明正文，默认文案和基于正式版本指纹的变更请求已准备，只在隔离库验证新版本流程，未改生产模板、历史报告或计算规则。最新证据与验收结论以docs/ai/full-chain-uat-2026-10-19.md为准。

2026-10-19 定性热工解释补充：DEFINE只读合同同时说明层热阻R=δ/(λ×α)及条件相同下厚度/R/K的关系，保留芯层、完整产品、整构造三种口径。解释不写候选、计算、快照或报告，不生成具体工程数值，也不以问句关键词新增路由。见docs/ai/full-chain-uat-2026-10-19.md。

2026-10-19 后端生产发布：按用户明确指令执行pnpm run deploy --skip-db，未重跑单测/UAT。API/Worker于香港时间2026-10-19 21:34:37重载online；内外网live/ready均200且依赖就绪，390个dist文件与本地SHA256一致，原站点.htaccess及.env内容/mtime不变。发布前回滚包已保留；无migration/seed、模型/规则/模板记录或历史快照改写。仅后端，App/H5及模板新版本未发布；部署前UAT结论与本次健康检查分开。见docs/deploy/backend-release-2026-10-19.md。

## 2026-10-20 自然对话与知识库产品咨询

按用户最新确认，以当前有权、已发布知识资料作为产品咨询主要只读依据，目录为补充；区分产品、原表材料层与整构造，禁止自动升级候选身份。Backend按消息身份保存澄清链，按已有字段合并数值/比较符/名称，不依赖模型单一续问标签。PREVIOUS_PARAMETER仅绑定已执行且同用户/客户端/项目、24h内的参数读取，服务重验状态；产品参数焦点独立于结果列表，新名称以本轮明确原话为准。未知名称不得删除后宽查；同名多值仅展示满足条件的属性及其来源。自然概览与技术参数分开，回答按对象/属性/来源核验；正式身份、Revision、计算规则、Snapshot与报告门禁保持。2026-10-19整体READY已撤回，本轮最终状态见docs/ai/natural-dialogue-repair-2026-10-20.md；冻结代码真实复测已完成：原35问23 PASS/7 PARTIAL/5 FAIL，结论NOT_READY。参数定义与介绍改写分开，空动作按真实方案状态回答；原始条件、来源及候选门禁保持。35mm/25mm绑定冲突、正式模板占位、咨询长清单/定性关联词和知识索引污染仍有未解决事项，不因单方案PDF或自动测试通过而恢复READY。详见本轮报告与逐轮证据；无生产部署/迁移/资料或历史快照改写。


2026-10-20 查询客服回复补充：只读查询的客户表达与完整诊断分开，数值/比较符/身份及指标口径来自Backend已执行查询，表达层不重读原问推断指标。无命中、未记录指标、名称未对应及来源待核对分别说明；不向客户默认枚举最小档位或权限清单。自然表达使用当前批准模型支持的JSON-object，Backend核验数值白名单、字段、失败原因、资料范围及副作用声明，失败返回简短真实结论。未知或不完整来源不补值，正式候选/Revision/Snapshot/报告保护保持。未指定规格的泛查询只在审计中保留无关规格排除项；明确规格冲突继续显示具体核对说明。已核验基层字段的唯一毫米标量不再被重复要求为板厚，其他厚度仍单独核验；建议触发的备用解析同样读取当前发布来源；查询完成后建议视图只消费实际SSOT，不重放原始SET/CLEAR提案，未决查询不清空既有有效候选。备用解析缺来源限制时，只复核同一查询并由Backend唯一绑定发布来源标签，复核占用原一次修正机会及原超时预算；失败保持来源未决，不退回宽查。有发布来源证明但没有原图的正式行可作只读建议，不再强取页对象，也不伪造原页。对当前发布来源名称及封闭文件格式线索，只作NONE提案的反证校验，不据此选来源ID或改变意图；无法核验时保持来源未决。实际查询服务的澄清同样保存原问，按消息身份、用户/客户端/项目及24h有效期回链，不依赖上游CLARIFY标签。本轮仍为NOT_READY，最新复测和限制见docs/ai/customer-response-repair-2026-10-20.md；没有生产部署或业务资料改写。

2026-10-21 产品咨询连续对话与表达：概览以主要对象、可查内容和相关帮助为主，最多两段260字、简短改写140字；内部对象类型及隐藏值标记不进入介绍生成；工程参数由Backend按同一对象/字段/来源成组展示，保证会话参数焦点对应实际展示，原表材料层、构造档位和目录当量不混用。概览支持审核的参数存在性容量按24对象×3字段设置，逐项真实性、批准别名和来源门禁保持。已执行的产品反查保留parameterFilter；纯数值修改绑定同用户/客户端/项目、24h有效产品上下文，继续原比较符及口径，新比较符仍需本轮工程字段证据，换话题/新名称/计算/方案操作不走此合并。封闭标量比较统一一份提取器，等于/=与不等于/!=/≠分别处理，后者保持未决，禁止改成等值或单边。没有开放话语关键词路由、模型切换、生产部署或工程资料/规则/历史快照改写。本轮真实验收及未解决事项见docs/ai/product-consultation-repair-2026-10-21.md，整体未达到READY。

没有正式介绍正文时，名称括注和热工层表不能作为组成/用途/优势的描述依据；独立模型审核不能补足缺失证据，因此这类介绍由Backend直接给出简短名称与可查字段。仅有正式介绍正文的范围才允许模型组织介绍。

产品参数查询的名称识别与参数口径匹配分开：当前有权来源证明同名材料层时，不能因缺产品当量λ误报名称不存在；原查询口径、命中和数值均不放宽。产品反查的CONTINUE/REFINE只在已有同归属有效状态上归一，不能复活换话题前的旧目标。

参数名补足只能使用本轮原话明确出现、在当前有权来源集合中唯一的完整名称；不得按型号前缀猜产品，或据此放宽subjectType、数值/比较符和来源条件。

2026-10-21 对话与PDF收口：计算的独立纯目标核验同样覆盖QUERY_CONTEXT_INVALID，发现选择/读取/比较目标后仅使用剩余一次窄目标复核，重走完整Policy与身份Parser；不复用错误计算ID或输入，预算/证据/权限不放宽。多产品参数按同一来源成行，筛选值与比较符显示来自Backend，缺参数/无命中简短说明，完整诊断保留。H5报告预览与下载复用相同归属/项目/发布/工件校验，每页从实际冻结PDF渲染，文件SHA绑定跨页，关闭/换报告/换用户使迟到响应失效；系统阅读器保留于原生端。交互渲染限2并发、40MB、30秒和页码1–500，批处理默认预算不变；不写报告正文或Snapshot。已确认免责声明只在隔离验收库按新版本工作流验证，生产模板不直接改写。完整真实UAT和剩余资料阻塞见backend文档docs/ai/dialogue-release-closure-2026-10-21.md。


2026-10-21 标准依据追问与不可用候选解释：Semantic只提complianceExplanation目标，Backend绑定紧邻本人同客户端同项目24h核验记录，并重新读取当前正式标准及适用范围；实施日期只取正式文档implementDate，不拿后台版本号/发布时间冒充法规版本或日期。缺依据直接说明缺项，不自由补适用维度；连续解释不刷新原始有效期，换话题停止继承。有效核验后的普通连续解释若漏专用读取目标，原一次同预算修正后仍未满足合同则澄清，不回落自由生成。候选排除诊断仅作语义线索，按当前Query Revision、来源与同一筛选条件重验后才解释；不发布新候选、不把不一致参考行升级为正式身份、不部分执行组合操作。仍保留原选择/确认/Snapshot/报告门禁及资料原值；本轮验收见docs/ai/dialogue-context-boundaries-2026-10-21.md，未部署生产。


2026-10-21 剩余非下载问题修复：热工概念解释按Semantic的DEFINE阅读目标区分MEANING/SCOPE/RELATIONSHIP及主要K/产品R/总R指标，Backend说明稳定概念，不由模型补参数、算例、合规结论或读取旧任务。definitionSubjects逐项保留本轮明确概念，多概念不能压成null后丢失；新字段只允许用于DEFINE，旧缺字段记录兼容原合同；不靠原句关键词路由。App的envDir同时配置给Vite前端构建，避免只给代理加载环境文件、客户端却退回localhost；未改环境文件或生产地址。文件下载按用户要求排除本轮修复；35mm/25mm资料冲突与缺正式标准依据保留，不改源数据、规则、Snapshot或报告授权。最新真实验收见docs/ai/dialogue-remaining-quality-2026-10-21.md，未部署生产。

查询澄清状态补充：普通建议/比较/概念或操作的澄清不能建立待查询条件；实际查询Service的缺项仍保留原条件，已有有效查询的解释插话不丢原链。新回复写pendingQueryContractVersion=1，未保存pending时不再走旧CLARIFY恢复；旧无版本记录保留原兼容，未知版本拒绝。语义CLARIFICATION_REPLY只指Backend提供的有效待查询状态，不因上一轮问过问题就推断查询任务。无开放问句正则或权限放宽。

实际查询缺项由queryClarification显式标记，仅通用needsClarification不能创建PendingQueryNeed；新元数据的queryNeedsClarification随实际查询状态保存。产品adviceFocus=PROS_CONS保留到ProductAnswerFacts的信息目标，没有介绍正文时说明本次资料不足及已有可查字段，不以产品清单替代优劣问题，不推断优势或竞品结论。

λ查询展示补充：单一参数归属直接展示值与来源，不默认显示混合归属统计及通用审计清单；多归属仍明确区分，构造材料层不能冒充独立产品。截断显示保留真实去重总数及全部Backend事实，来源未核实的排除说明简短保留；完整诊断和用户追问来源的解释合同不变。

当前集合极值读取补充：高置信REFERENCE_REFINE+comparison只有在本轮CURRENT_TURN、当前引用、无新条件/来源/偏好/副作用，且列请求属于标准比较范围时，才归一为COMPARE_CANDIDATES/READ_ONLY。只移除空查询外壳，保留原话证据、指标方向和Revision并重走完整Policy与来源重验；不扩大查询、不发布候选。其他复合查询或缺参仍拒绝，不按问句关键词路由，也不放宽证据检查。

纯当前集合比较同时归一relation=CONTINUE，确保无Candidate的原页读取仍只绑定紧邻实际引用；不把仅意图归一视为链路通过。新增跨模块回归验证规范提案→来源读取→实际参数/极值与原页，不更新查询、候选或原来源有效期；原24h、归属和版本门禁不变。

当前集合极值比较允许同一逐字证据、同一指标及方向的重复排序偏好作无损归一；新增筛选/来源、相反偏好或其他证据不清除。归一前继续调用既有applySemanticQuery字段覆盖校验，模型遗漏本轮厚度或数值限制仍拒绝，不新增关键词路由，不放松来源、Revision、24h或正式操作权限。真实复测记录所有失败轮次，文件下载按用户要求排除。

2026-10-22 资料冲突只读展示：厚度/规格不一致与已识别的同构造同厚度跨来源指标差异统一保留两处原值、单位、来源位置及可得版本，先展示核对表，再用简短说明解释原因和下一步。仅展示当前授权发布范围并重新读取来源，不用历史诊断充当事实；无具体来源时如实标缺，不伪造原图/页码/链接。冲突对象usage固定READ_ONLY，无Candidate身份/执行字段，不改变原数值、查询筛选、正式候选准入、计算、确认或报告权限，也不回写生产资料或历史快照。客户表达与完整审计均保留；不是针对35/25的数值特例。文件下载继续排除。


2026-10-22 自然对话连续性：Semantic仅提出目标与变更，Backend保留待澄清查询的数值/比较符/体系，并在实际执行前重验；建议插话不重置产品参数焦点。当前指代按实际阅读历史、授权候选及Revision唯一绑定，新只读查询不得复活旧候选。改当前做法的查询基准由Backend绑定，模型不补正式ID；目标从计算改为资料查询时迁移已提取输入并重走Query校验。正式构造层只从同一发布版本、规格范围及来源读取，附带候选层信息在读取/Confirm前逐项重验，报告仅消费冻结层信息。选定Final后同时展示真实参数与R口径，仍须显式确认生成Snapshot。无新工程规则、生产数据或历史快照变更。复测失败轮次和最终状态见 docs/ai/natural-role-repair-2026-10-22.md；文件下载按用户要求排除。


自然对话补充：confirmedPageLookup.requestQuery保留用户有效条件，query保留实际原页绑定范围；自动检索得到的documentIds不升级为用户来源限制，显式来源及旧会话范围仍保留。正式目录systemType仅按已定义类别精确投影部位，未知值不猜；附带的新类别/版本在读取与Confirm前重验。solutionOperation与候选引用分开校验：目标层持有完整原话授权、具体动作及其置信度，引用层不重写动作、置信度或范围；Backend按实际pool/selected与Revision绑定身份，仍无模型CONFIRM。已核验的只读字段可与选择动作并存，回复读取执行后的真实参数与层次，不追加未经授权的操作。


当前来源解释通过实际焦点、会话和Revision关联后继续保留建议范围，来源撤回/过期/换题仍拒绝。单条参数整理仅展示当前重新核验的事实，并提供真实页面选用入口；不足授权置信时不执行选择。原表疑点在对应参数行标记，保留原值及完整诊断。报告详情及PDF预览身份来自uni-app本页onLoad参数，避免同一路径打开新报告时全局路由旧query串到上一份；切换与缺ID清理仍执行，后台报告权限不变。


持续查询与读取投影补充：有效查询任务的NEW分类不单独清空用户条件，明确SWITCH_TOPIC/取消仍重建范围；当前集合只改变读取列时转换为只读比较，清除空pageQuery前仍完整校验原提案字段覆盖。产品咨询转参考查询保留已验证产品名称线索，不自动签发正式ID；同产品参数续问允许一次窄目标复核，不能删去新数值、对象、来源或操作限制。操作授权不足时仅可承接已明确的读取字段并重走只读Policy，绝不执行选择或提高置信度。部位、原表编号、型号集合、正倒置均纳入方案硬条件指纹，条件变更后重新处理冲突。


补充：当前集合只读比较中的重复queryBasis仅作无损归一，不转为单候选查询；已有字段/来源/指标条件不清除。经过归属、项目与时效校验的待澄清任务，若本轮只补一个封闭R指标名，Backend直接保留原数值并追问R口径，不让模型重猜λ或执行查询。单候选建议始终显示可核验厚度及K/R；缺计算绑定时可先解释重新核验的参考做法，不替填模型、规则或厚度作用层。


厚度字段角色复核：当提案同时包含基层材料、尚未标注基层角色的厚度且没有已明确基层厚度时，仅用独立窄语义核对原数值归属。复核不能生成数值、运算符或身份；低置信、未知、证据不符、索引重复均澄清。Backend只重绑字段，再完整验证Query；相同证据与提案的局部缓存不跨请求、会话或项目。


所有实际语义查询入口（包括无pageQuery的备用Parser与复核结果）在执行前共用厚度归属校核；校核失败不能退回错误板厚的兼容查询。当前完整集合读取的referenceTime可省略，仍阻止EARLIER/UNCERTAIN及旧序号；不能把冗余时间标签当成丢失业务条件的理由。

自然对话续问补充约束（2026-10-23）：后端的只读澄清同样持久化 CONTINUE/READ_ONLY 与原问消息链，不能因缺少模型 Semantic 丢弃有效条件。DEFINE 的 λ 重复指标表示只归一到 definitionSubjects，不能成为 K/R 查表或工程核数指标。产品介绍目标与构造核数冲突时，只复核无数值、无构造编号的只读目标，名称须来自原话，服务端重新检索发布资料。产品参数原页只从实际读取结果中按文档/页/版本重新授权取得；不创建正式候选。audience 只调表达，不能将 PARAMETERS 退回概览。

自然对话状态补充（2026-10-23）：新查询进入R口径澄清后可只复核新增口径，原数值、比较符和已有条件由Backend保持并完整重验；不因字段复核授予方案/确认/报告权限，身份仍由正式来源核验。产品名称同样进入待澄清身份条件，不能删名后扩大查询。“谢谢”等封闭礼貌回执及模型暂不可用时，保留已经核验的只读需求和产品上下文，原有效期不刷新，显式换话题/取消仍按原合同处理。

2026-10-23 自然对话连接层：待澄清任务保留原数值/比较符/名称/来源；窄字段复核只处理原字段与Backend校验缺项，不把背景信息新增为硬筛选。纯动作复核不输出身份歧义或改写已验证引用范围，真实身份仍由独立Parser与Backend授权池、来源和Revision核验；只读明确编号保持。已核验同构造改厚零命中说明资料不足，不生成虚假pending，不替换其他构造或推算工程值。分层V1口径和35/25mm资料冲突保持原值及正式权限。

2026-10-23 用户确认：保留作参考默认仅留在当前对话，不进入正式备选、Snapshot或PDF。SET_FINAL与聊天资料分别绑定；模型只提交资料人类名称和原话证据，Backend按当前有权来源、版本/Revision和内容指纹绑定，并在模型返回后再核验。资料失效或有多个指代则整次操作不执行；明确要求正式备选仍执行原门禁，不能降格后声称完成。正式Confirm与报告仍只消费正式有效候选冻结数据。H5报告详情同路径只改query时也同步真实地址，清空旧资源并重新授权，不复用旧PDF。

2026-10-23 查询合同V2：真实H5边界补测发现V1方案B将严格小于/大于执行为包含边界。新AI查询由Backend设置queryContractVersion=2，LT/GT严格排除等值，MAX_LIMIT/MIN_LIMIT及旧记录语义不变；板厚范围以显式开边界元数据随查询追溯。封闭数学比较/否定词法只核验既有数值字段，不新增开放意图路由，不让模型选择旧版本放宽条件。正式查询零命中仍保存本人同端同项目24h最新requestQuery；沿用当前构造只绑定当前来源身份，不以旧候选查询覆盖最新条件。公开公式、数据、权限、Revision、Confirm与历史Snapshot不变，无生产迁移/部署。版本影响、独立边界及回归证据见docs/thermal/query-contract-v2-2026-10-23.md及docs/ai/natural-role-repair-2026-10-22.md。

2026-10-23 自然追问收口：正式命中与零命中都保存有效requestQuery；板厚REPLACE清除被替换边界，追加仍校验冲突。来源复核读取Backend已验证历史字段，新合格复核仅撤销该门禁旧诊断，不降置信度或清除其他缺项。pageQuery.readFields只决定查询输出列，不能单独把重新查询改为比较旧集合；需要独立referenceReadFields证据。目录简称与知识库名称概览分别保留；未知名称类别沿用Backend字段角色，表达层不得另猜。候选历史与当前查询匹配情况经现有SSE及历史恢复同步，H5明确标注，不改变正式资格和操作授权。最终证据和数据限制见docs/ai/natural-role-repair-2026-10-22.md；下载排除，无生产部署。


2026-10-23 热阻口径增量：待澄清需求的 goal 是可选展示分类，不能作为保留既定指标/数值的前提。已证实的 R 续问仅补 PRODUCT_R/TOTAL_R 口径，仍须完整历史证据、单一原始数值及置信门禁；新 AI QueryContract V2 的严格比较传入增量绑定，旧 V1 调用语义不变。唯一未定角色数字的默认澄清直接引用原数值，已有明确指标目标/数量不再猜测字段。


2026-10-24 当前对象读取：已有独立referenceReadFields且无新条件的重复空REFINE表示可归一为只读；带具体引用时读取该对象，无引用时读取当前集合。引用厚度只进入覆盖核验副本，真实候选身份、来源、Revision继续重验；其他新厚度/指标不得被引用掩盖。非语义歧义的合同校验错误保留原澄清，不得用其他记录的可用性诊断替换为双方案比较失败。


2026-10-24 当前读取的重复条件：独立读取字段与当前引用同时存在时，精确厚度只有与Backend核验的当前查询/焦点候选相等才能转作引用；新厚度、范围、指标、来源与未明确读取目标仍保留查询校验。原页请求走当前实际确认页引用恢复，不让来源复核另猜参考集。新增AST精确登记仅为读取字段枚举、授权ID集合和数值集合成员检查，不增加自然语言匹配规则；逐项审计见current-reference-projection-audit.md。


2026-10-24 查询展示字段归一：明确QUERY且含真实条件时，重复referenceReadFields只并入pageQuery.readFields并清除重复字段；所有原约束、来源、引用、请求效果及证据保持。空查询不能以此扩大检索；当前对象读取仍先按核验上下文独立处理，方案/确认/报告授权不受影响。


2026-10-24 诊断与组合目标：模型pageQuery.unresolved仅作审计依据，客户提示按已确认的字段与目标生成，不展示模型关于执行范围的内部说明。当前候选的采用/解释同句复核可接收Backend核验的集合规模与阶段（不含ID/工程值），同时审查全部诉求；DEFINE不直接排除采用目标。候选身份仍独立绑定，原置信度、否定/引用/假设及确认/报告门禁不变；不因单一候选推定授权。


2026-10-24 窄操作复核职责：操作授权分类不再同时识别读取字段，后者沿用已验证合同；DEFINE类知识解释也可包含待独立核验的采用目标。模型输出的操作置信度仍原样通过原0.9门禁，不取最大值、不提高分数；身份/来源/Revision继续后端绑定。动作本身有歧义时，只问加入方案还是先看参数，不自动选择；后续明确回复仍重新执行完整授权与绑定校验。


2026-10-24 操作授权最小合同：模型仅输出intent/operation/confidence/evidence/effectRequest五字段，READ_ONLY映射为原只读目标。读取字段与范围沿用Backend已有合同，旧窄合同仍严格兼容；旧输出也不能覆盖Backend已有范围。新旧合同都不允许携带身份或工程值，0.9授权门槛及后续候选/来源/Revision/确认/报告保护不变。

2026-10-24 复合采用与阅读：操作授权、候选引用、参数解释分别校验。引用层只处理对象身份，已验证的independentReadFields单独传递；解释口径不属于身份缺参，未提供的价格/性能/新筛选条件仍保留未解决。每个对象一个有原话证据的引用，禁止根据池位置补序号。Backend证据、来源、Revision、权限及正式确认门禁不变。

2026-10-24 来源范围证据修复：所有主/备用QUERY来源提案均经独立复核，不能因已填有效来源ID或高置信度跳过。复核只读当前发布名称，不向模型传上游来源ID；Backend绑定真实来源。确认用户未限定来源才撤销模型自加sourceScope，其余条件逐字段保持；续问仍继承后台有效原范围。含糊、低置信度或无法核验保持未决，不退回宽查。沿用原已指定来源独立复核的实际置信度合同，不降低门禁。

2026-10-24 客户澄清按结构化冲突解释：查询服务收到THERMAL计算合同，应明确询问查已有档位还是按当前构造重算，不依赖模型自由unresolved字段名，不展示内部诊断；已有条件和全部计算/确认门禁保持。不凭厚度推算改善量。

2026-10-24 来源复核保持职责独立：输入不再包含上游sourceScope（含证据），避免把提案当作用户已限定来源；只见原话、后台有效历史和其余条件。没有正式名称/文件格式证据时，整句工程查询或同一工程字段不能充当来源限定，失败保留未决，不执行错误来源查询。来源未决向客户只问资料名称，已有工程条件保留；原权限、Revision、公式和授权阈值不变。

2026-10-24 来源变更分两步：第一步仅见本轮原话，输出KEEP/SET/CURRENT/UNCERTAIN、原话证据和置信度；不接收后台状态、来源目录、上游scope或工程条件。KEEP仅表示本轮没有新来源变更，完整查询续问不需要模型重建旧条件；后台原范围保持。确认有来源要求后，第二步核对当前发布名称及查询忠实度，Backend绑定真实ID。KEEP不抬高查询置信度，CURRENT只继承后台有效原范围；无历史、来源撤回或不可靠判断保持未决。其余条件、Revision、权限、确认及报告门禁不变。

2026-10-24 首次采用与来源复核：复合采用目标复核以当前已授权候选为依据，不要求预先存在正式方案；实际写入仍完整校验身份、来源、Revision、权限和原0.9授权门槛。KEEP与本轮明确文件证据冲突时进入独立来源/查询忠实度复核，不按关键词绑定ID。成功来源复核按用户原话与有效查询条件缓存，置信度或scope表示变化不重复推翻；实际条件变化重新复核。完整来源/查询复核的真实置信度沿用原合同，纯KEEP不提高置信度。

2026-10-24 报告执行授权独立复核：主/备用Semantic提出REPORT_REQUEST时，窄复核仅见完整本轮原话，区分立即生成与查看入口/状态/操作方法；目标愿望不等于本轮执行授权。完整原话证据及原0.9门槛保持，不接收身份、工程值或方案状态。明确准备/读取只走当前授权方案只读投影，不重新解释为选择；不确定保持只读澄清。实际生成仍走原权限、已确认Snapshot、模板版本及报告授权校验。R59真实复测中“自行操作”被误作生成的失败保留，不以产物存在判PASS。

2026-10-24 对话处理过程：SSE在既有权限/配额/会话锁及消息身份核验后推送实际准备阶段；前端展示真实步骤和有权来源名称/印刷页码，不输出原始推理、工具入参或签名URL，不更换模型、不改变查询/候选/Revision/Confirm/Snapshot/报告授权。过程只保留当前客户端消息，不回填旧记录；停止及失败不得伪装完成。验证与限制见docs/ai/processing-progress-2026-10-24.md。本轮未部署。
