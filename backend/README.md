# 蓝格 VICP 后端

2026-10-19 全链路修复合同：Semantic 显式使用受支持的 JSON-object 输出（SDK no-schema），Backend Zod、原话证据、权限与业务状态校验继续执行。目标分类与候选身份绑定分别验证；自然称呼只提出当前发布名称与原话厚度，Backend 在当前授权候选及 Revision 中唯一绑定，歧义不猜。Final 与明确保留的参考候选分开，Confirm 冻结后报告只用 Snapshot；正式参考行可用完整发布来源证明，不虚构文件/页图/公式版本。JSONB 来源证明按全部合同字段比较，不依赖属性顺序。原表头及79页页签按客户DOCX和已确认内容指纹作显示投影，源数值/Revision/规则/历史快照不回填。真实UAT使用只读来源副本与独立随机库/Redis/OSS前缀，保持 DeepSeek Chat；最终结果和缺项见 docs/ai/full-chain-uat-2026-10-19.md。无生产部署或业务数据迁移。

2026-10-19 C端表头按客户知识库79张原表核对：显示投影按完整确认内容SHA256绑定，sourceDisplayColumns/sourceTableLayout仅供原表头与单列热阻显示；sourceColumns原语义、数值、revision、候选资格与工程计算不变。缺失/冲突表头用中性名称并在表外提示。屋面原稿的“外墙主断面”保留，77–79为“板材主断面”；11页识别标题疑点单列。旧35问验收FAIL保留，后续按资料治理→S2→R1比较→S5/R5正式确认/PDF→R3计算→完整35问修复复测。见 docs/ai/table-header-repair-2026-10-19.md。

2026-10-19 阶段04固定场景真实H5复测：10组35轮原问逐字执行，1 PASS/1 PARTIAL/8 FAIL，总验收FAIL；另有VLCP/换话题/缺模型3次输入补测，22次越权拒绝及2次本人列表成功。R1多页原引用和R2屋面命中改善，但S2证据换行拼接拒绝、R1比较、S5/R5正式闭环和R3计算续问未通过；页码/原值资料疑点保留。Snapshot/报告/计算均0，Confirm/PDF及其幂等/权限NOT_RUN；后端2796和App150测试/H5构建通过，App依赖按钮类型检查失败。只操作独立随机库/队列/OSS前缀，已独立核验清理；无产品实现改动、生产迁移或部署。见docs/ai/phase04-retest-2026-10-19.md。

2026-10-19 小格交接阶段03：修复基层厚度/板厚混检、正式编码集合、屋面标题型号读取、多页原图回读及产品/λ诊断续问。按用户本轮确认建立VICP正式简称映射，VLCP等近似名称给友好确认提示；产品介绍先讲已有产品内容，参数按需展开。保留所有来源与正式操作门禁，未部署或修改业务资料。缺陷、证据和仍需资料治理的项目见[阶段03记录](docs/ai/phase03-repair-2026-10-19.md)。

2026-10-18 小格参数阶段2–4：按追加授权完成多轮校验、明确指标有限复核、未知产品名称保护与事实引用回答；真实隔离矩阵及Confirm/Snapshot/PDF闭环见[阶段4验收](docs/ai/xiaoge-parameter-phase4-2026-10-18.md)，代码合同见[阶段2、3](docs/ai/xiaoge-parameter-phase2-3-2026-10-18.md)。客户首表/平屋面摘录范围外的资料、别名与介绍文案仍须正式审核。无部署或生产数据变更。

2026-10-18 小格λ参数阶段1：新增独立只读产品/材料参数查询，0.3→导热系数保留原问目标；参数归属、发布/项目权限、来源冲突与无匹配诊断由Service核验，λ不转K，不要求无关基层。使用现有get_product_data Tool及确定性事实回答，无新公开API、迁移、部署或前端改动。阶段2–4未执行；合同与测试见[阶段1记录](docs/ai/xiaoge-lambda-parameter-phase1-2026-10-18.md)。

2026-10-17 小格专项阶段1：结构化查表联合读取授权已发布正式参考集与确认页；只读事实和正式候选资格分开，来源以可验证档位/正式映射关联，来源核验先于截断。失败诊断由Service提供并贯通AnswerFacts/Tool/原页回答；统计保留当前型号、基层、厚度及其余指标，缺列不混同无目标值。未改产品介绍、上下文语义、计算公式、Snapshot/PDF；无迁移、回填或部署，完成阶段1后停止。详见 docs/ai/xiaoge-business-chain-phase1-2026-10-17.md。

2026-10-17 查询上下文修复：缺指标只澄清指标；澄清回复仅绑定紧邻、24h内、本人同端同项目原话，不生成候选或授权正式操作。查表数值条件不能丢入通用建议；数字+型不作K/R目标。QUERY已明确部位若漏字段则拒绝宽查并有限复核，仅校验正式枚举、不据词路由或补条件。0.8至0.9查询必须有完整pageQuery并经逐字段校验，仅FACTS_ONLY展示与成功只读查询上下文，禁止覆盖Candidate；低于0.8、结构歧义及副作用仍拒绝，正式动作/计算/报告保持0.9与原完整授权。近似/上限/精确由原话及有效历史核验；旧确认表仅按封闭正式表名只读兼容部位，不回填源JSON。factRead≥0.8仅进受控只读事实服务、不发布Candidate；型号比较大小由代码确定。无Candidate原页回溯仅消费本人同端同项目24h内实际引用，重验版本/revision/optionId，不接受旧序号。优缺点只读确认构造；澄清诊断不标工程事实错误。修复验收后按用户追加授权执行pnpm run deploy --skip-db发布后端；API/Worker在线、live/ready均200、5个关键文件哈希一致，跳过迁移/seed并保留.env。见docs/ai/thermal-query-context-fix-2026-10-17.md。

复杂图集表格与A3查询修复（2026-10-17）：热工表行使用可选sourceRegion，简图文字独立diagramNotes，原非数值列头由sourceTableHeaders透传；编号格不混入型号/基层，B/App保留原层号和分组。读取问句不以“是/为”推成实体赋值，I/II正式名称不能截获III后缀；完整体系名与只读追问走Domain→语义约束，不增加样本关键词路由。旧确认JSON/引用/快照/PDF不回填，无业务迁移。验收后按用户追加指令运行pnpm run deploy --skip-db发布后端，API/Worker及健康检查通过，此次未重跑测试；B/App仅提交代码。证据见docs/ai/atlas-source-layout-and-a3-2026-10-17.md。

复杂图集审计后修复（2026-10-16）：确认页数值核验复用当前授权引用，签名失败保留B端表格；真实OSS/SSE及H5 DOM 12行通过，Backend2377测试通过1跳过，阶段5仍有未验项，详见[修复与复测记录](docs/ai/complex-atlas-repair-2026-10-16.md)。未迁移或回填业务库、未部署。

2026-10-16 存储约束更新：当前项目所有实际环境与隔离验收统一使用阿里云 OSS，不使用 MinIO。本机配置`STORAGE_PROVIDER=oss`；OSS凭据和AI加密主密钥仅保存在忽略的`.env`中，不写入取证日志或报告。旧审计中的MinIO连接失败属于错误环境配置，不作为OSS故障结论。

2026-10-16 复杂图集阶段5真实联合UAT：验收FAIL。隔离库共享服务及H5来源详情12行通过，真实自然SSE未形成引用闭环，芯层R误称产品R、浏览器原图加载仍失败；旧890确认档不回填，A3原值正确但查询回归未过。测试配置源强制只读、全部对象操作统一隔离前缀，派生副本遗漏已精确清理并重跑验证。未部署/迁移业务库/改写旧PDF，见docs/ai/complex-atlas-phase5-2026-10-16.md。

2026-10-16 复杂图集阶段3：确认页只读查表支持无编号及缺产品整体热阻的已核验字段，复用工程过滤/比较与B/C来源读取链；不创建方案候选、不补算。来源语义、确认版本与历史引用核验同步到B/App可选DTO；真实业务联测与App表格视觉仍未验收，未部署/迁移。见[阶段3实现、隔离证据与未通过项](docs/ai/complex-atlas-phase3-2026-10-16.md)。

2026-10-15 复杂图集阶段1：新增兼容的v2识别草稿、独立构造属性、源列头和逐档层证据；不补算产品热阻、不生成构造编号。旧确认页及引用保持兼容，旧审核界面覆盖v2会明确拒绝。真实模型仍有编号/符号识别波动，必须人工审核；未部署、无迁移，B/App实施及数值检索扩展留待后续阶段。见[实现与测试证据](docs/ai/complex-atlas-phase1-2026-10-15.md)。

2026-10-15 C端真实UAT修复：指标替换、范围厚度、首次构造查询、多轮来源/候选保留、冻结方案只读和只读极值比较统一收口；H5富文本与基层展示联调。查询解析复核仍受相同预算和Backend Policy校验，未修改工程公式、迁移或源资料。修复与隔离验收见[本轮记录](docs/ai/c-uat-fixes-2026-10-15.md)。

2026-10-14 报告设置接入正式PDF：企业Logo/封面/页眉页脚与内容开关在创建时冻结，Worker只读冻结配置；关键工程指标、基本引用和风险不受可选开关隐藏。B端默认类型/示意预览仍需前端对接，见[报告设置记录](docs/reports/report-settings-pdf-2026-10-14.md)。

2026-10-14 正式方案 PDF：技术方案/简报新建必须本轮明确授权及本人有效 CONFIRMED SolutionSnapshot，统一服务端加载与会话锁幂等；纯 DocumentModel→冻结 ReportSnapshot→中文 HTML→Chromium PDF。工程值不重查/重算，完整原表保留，缺标准明确未核验。新正式报告以 PDF 为必要产物，旧格式兼容；新增受控 PDF/图片预览。实现、API 与本轮验证/真实 UAT 阻塞见 [分阶段记录](docs/reports/solution-pdf-2026-10-14.md)。

2026-10-13 语义匹配强制治理：开放自然语言只走现有resolveDomainTurn→结构化目标/关系/patch/reference/effect→Backend Policy；禁止方案/确认/加入等开放子串、删除否定、参数变化排斥Advice、pending boolean授权或泛化故障澄清。只允许工程格式提取、正式枚举/ID、无损归一、封闭完整命令/问候；副作用仍经权限/revision/来源/状态机。新增灰区快路径必须Rule ID+封闭语法/职责+5正5反3否定引用多轮+无副作用证明+冲突核验+owner批准与CI，缺一禁止。AST精确指纹白名单见docs/ai/semantic-matching-policy.md；不得全项目禁正则，不改资料、Thermal Engine、迁移或业务数据。

2026-10-13 参考方案建议：新增只读 SOLUTION_ADVICE，复用最近可见且当前有效的确认候选，按实际基层组织一般选型分支；无需地区/建筑即可建议，不作合规结论，不创建正式方案快照或报告。轻量业务目标与正式筛选、SolutionState分离，换话题/换revision/过期即失效。实现与验收见 [方案建议及上下文衔接](docs/ai/solution-advice-2026-10-13.md)。

2026-10-13 Domain收口：合规独立只读服务核验正式地区/建筑/结构范围与限值，不重算或刷新候选。报告execute先验证本轮领域或服务端UI授权；正式方案报告只消费CONFIRMED不可变SolutionSnapshot→DocumentModel，禁止旧产品报告替代，签名URL不入快照。裸指标先澄清查看/新目标，概念解释不恢复旧任务，同厚度多候选比较只读。产品SEARCH/READ只用正式目录/发布规格，比较ID来自搜索或UI；族简称可由启用GLOBAL后台别名显式绑定集合，缺映射拒绝宽查。无迁移/数据改写，见docs/ai/domain-turn-closeout-2026-10-13.md。

2026-10-13 矩阵补测：带明确指标的候选请求不被“做法”抢入知识；K概念问句不查表；当前可见基层参数与完整热工原表只读，基层/板厚分开且多项逐个绑定，数量歧义不补旧列表。分类上下文含previousQuery，诊断只记意图/实际路径/字段差异/revision/标识/校验状态。S4术语口径待真实UAT，冻结Parser/Matcher不改。见docs/ai/high-frequency-matrix-coverage-2026-10-13.md。

2026-10-13 高频意图P0：每轮DomainTurnDecision先于动作解析，Agent/非Agent/回答合同共享；原页/参数与普通候选比较走只读Resolver，校验最近可见revision、24h、归属和当前确认来源，不重查或刷新Candidate/Selected。计算需本轮明确授权及核验对象，不信任旧lookup.Selected。基层材料/厚度/型号与双R/K同候选校验；无可靠正式族映射时澄清，禁止名称推导族ID。无迁移/部署，详见docs/ai/backend-p0-routing-fixes-2026-10-13.md。

2026-10-12 普通问答回归修复：无可定位候选时不调用 Solution Action 模型，交还正常问答；lastReferenceLookup 候选仍支持首次懒激活。动作分类提示词必须包含 JSON 与从正式 Zod schema 派生的完整字段合同，兼容只支持 json_object 的模型网关；失败日志只记录错误类型/HTTP码。

Candidate 生命周期（2026-10-12）：查到候选不等于开始方案。普通查表/知识回退/计算仅保存 lastReferenceLookup（query、candidates、createdAt、candidateQueryRevision、projectId）并发 reference_candidates；只有已有 editable active state 才刷新方案池。Confirmed 后普通查询不创建新 state。显式选择/加入/开始/修订才激活；首次选择事务核验权限、24h 有效期、revision、当前来源，seed 后执行既有 mutation。/solution/activate 单请求 ADD/SELECT/SET_FINAL；序号基于最近可见查询 revision，旧列表拒绝。无新迁移，不改 Matcher/QueryState/快照/报告或前端。

2026-10-12 修复会话详情和发送消息误报“AI 会话不存在或无权访问”：方案访问将令牌大写 `clientType` 映射为会话小写 `clientApp`，与创建入口共用 `clientAppForClient`。保留会话归属、客户端隔离和项目权限；回归测试使用真实 `c_app/pc_ai`，无需数据迁移。

2026-10-12 修复 `/api/v1/reports/types` 未登录返回 500：统一错误处理器独立序列化失败响应，避免 HTTP 200 业务错误被成功响应 schema 拒绝。未登录、无效或过期令牌返回 HTTP 200 + `error.code=401`；成功响应仍受路由 schema 校验。

2026-10-12 Solution Loop Contract 冻结：仅收口开放动作语义解析、硬条件变化后冲突确认失效、各入口统一候选查询策略。复用既有状态/确认/快照服务，无新增迁移或REST协议破坏；未开发PDF/Word或C端。见[闭环说明与冻结补充](docs/ai/solution-workflow-2026-10-12.md)。

2026-10-12 智配方案闭环：独立 SolutionState 保存正式候选池、多选、偏好、冲突与 Final；明确确认后事务冻结不可变 SolutionSnapshot。聊天、REST 和工具共用服务，恢复会话直接读正式状态。新增0054迁移，预留 Snapshot→DocumentModel；本轮不生成PDF/Word。设计、接口、验收与环境限制见[智配方案闭环](docs/ai/solution-workflow-2026-10-12.md)。

2026-10-12 语义查询重构：正式查表与知识回退共用 Semantic Query / QueryState；规则只负责格式和高置信符号，口语交由结构化分类模型，实体回查正式目录、数字和硬条件由代码验证。候选行ID作为唯一身份，EXACT未命中保留同身份实际值；页面确认/热工同步独立可观测，页码来源与核验状态分离，候选与完整页optionId统一。无需迁移，计算公式不变。审计、架构、测试和限制见[重构说明](docs/ai/semantic-query-refactor-2026-10-12.md)。

2026-10-11 C端阅读优化：销售/设计院优先厚度与所问指标，正式查表摘要带 answerStyle/primaryFieldKeys，客户端简洁卡片替换可定位摘要并独立展示来源；默认两项、其余展开，参考页保留整页表格高亮。普通解释、工程结论、正式数值与匹配规则不变。详见 [C端完整参考页](docs/ai/c-reference-pages.md)。

2026-10-11 C端 AI 来源页补齐：查表回答与完整确认页、正式档位高亮和段落位置同源；候选冲突不猜高亮。历史消息重新授权/重签，来源详情返回完整页面模型，元数据不保存签名URL。未改Parser/Matcher主结构、公式或数据库。真实UAT当前因数据库ECONNREFUSED而BLOCKED，详见[C端完整参考页](docs/ai/c-reference-pages.md)。

2026-10-11 B端版本问答支持完整原页引用：明确数值查表复用现有条件语义，读取当前版本全部确认档位，回答与高亮确定性同源；普通问答确认记录优先完整预算。确认快照 renderModel 保留全部构造和档位，返回字段/回答位置并隐藏内部引用标记。详见[完整原页引用](docs/knowledge/answer-page-references.md)。

2026-10-09 热工回答质量：Candidate原子事实绑定、产品R/总R歧义澄清、真实印刷页码、销售简短回答与专业追问展开；无DB迁移或计算公式变化。实现、测试与真实UAT阻塞记录见[热工回答质量](docs/ai/thermal-answer-quality-2026-10-09.md)。

2026-10-07 最终交互 + 真实业务UAT：四个边界收口（查询/计算/合规路由、厚度省略追问、厚度口语与取消、指标省略连接词）。`pnpm uat:ai`运行销售20+设计院20、123轮真实HTTP/SSE场景；`pnpm uat:check`只做类型/结构检查。UAT使用独立临时库/用户/Redis队列/页图，事实全部确定性断言，默认规则体验评审，可用`--judge`启用只评价回答体验的AI Judge。Parser/Matcher主结构冻结，后续变更必须有真实失败Case。场景列表、运行依赖、报告及验收限制见[销售与设计院业务UAT](docs/ai/business-uat.md)。

日常表达与局部条件收口（2026-10-07）：指标定位、数字抽取、比较语义分开；在/控制在/要求/达到/做到/目标等连接词不决定模式。多轮 filters 按 metric 增改删，未提及条件保留，同 metric 默认替换（含 mode），仅明确再加范围条件可追加同指标边界；取消条件不得由旧摘要或模型重复参数复活。厚度精确档 thicknessMm、单边/双边 thicknessMin/thicknessMax 独立解析与持久化，签名覆盖三字段；放宽单边厚度继承原边界含义，取消厚度清除三字段。尽量薄只在满足硬条件后按厚度升序展示，不编造范围。所有条件变化重查正式已发布数据，纯参数/原页指代可复用。无数据库结构变化，Thermal Engine 与 Knowledge 流程不变。 本轮实现与验证见 [日常表达与多轮条件验收](docs/thermal/daily-language-closeout-2026-10-07.md)。

2026-10-07 自然语言与多条件最终收口：支持“不应/不得/以上/以下”等规范比较词；普通大于/小于采用包含边界的工程筛选口径。API 与 Tool 新增可选 `filters[]`，多个指标全部 AND，旧单指标及 K/R 字段继续兼容。多轮规格/产品/型号切换清旧依赖并重新查询正式发布数据；双 R 查询不再误报 missing targetK。超限容差返回 requested/effective/adjusted 元信息与中文提示，会话 JSON 保留每项授权来源。详见 `docs/thermal/natural-language-closeout-2026-10-07.md`；无数据库结构修改。

2026-10-07 查询语义收口：参考查询统一使用 `metric`（K / TOTAL_R / PRODUCT_R）、`targetValue`、`mode`；双 R 均支持近似、上限、下限与固定精度匹配。保留旧 API 字段，AI 容差由用户原话与后端规则确定；切体系/型号/产品清理依赖 ID，条件变化重查已发布数据，跨体系回退先说明未命中。完整契约及验证记录见 `docs/thermal/lookup-closeout-2026-10-07.md`。本轮没有数据库结构修改。

2026-10-07 生产收口：精确厚度保留 K/型号/体系等硬筛选；参考查询模式按用户语义 → Tool 参数 → 历史 → APPROX，条件变化重查完整发布数据。候选状态完整保留双热阻、来源原页和正式字段；STRICT 与工作台共用发布 readiness，空 BROWSE_ONLY 版本返回 NO_PAGES。迁移检查及原页联调见 `scripts/verify-migrations.mjs`、`scripts/verify-reference-lookup.mjs` 与 `docs/production-closeout-2026-10-07.md`。

迁移验证：`pnpm db:verify` 默认使用 Docker；`node scripts/verify-migrations.mjs --static` 只检查 SQL/journal/snapshot。设置 `MIGRATION_VERIFY_DATABASE_URL` 后 `pnpm db:verify` 在指定 PostgreSQL 实例创建唯一命名的隔离临时库，验证真实 Drizzle 新库/漏 0032 升级/已手工执行/冲突回滚，再自动清理。该连接须有临时库创建权限，验证脚本不迁移连接指定的业务数据库。构建后运行 `node scripts/verify-reference-lookup.mjs` 做真实 Tool/状态/原页签名下载/STRICT 门禁联调；同样只在隔离临时库写业务数据。

蓝格 VICP 是面向外墙保温和建筑节能业务的 AI 智配系统后端，服务三个客户端：

- `B_ADMIN`：B 端管理后台和渠道工作台。
- `PC_AI`：PC AI 对话端。
- `C_APP`：C 端 App/小程序。

核心闭环是：项目管理、PDF/DOCX 资料解析、项目知识检索、AI 对话、确定性工程计算、结构化报告生成、公开分享和全流程审计。

## 业务边界

- 不使用租户模型，平台数据统一存储，以项目作为业务权限边界。
- `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER` 是固定业务角色，保留在 `users.role`。分端访问真源是 `user_app_access`（`ADMIN` / `CLIENT`）。B 端 Token `aud=admin` 且需 ACTIVE ADMIN access；C / PC AI 端 Token `aud=client` 且有效身份为 `NORMAL_USER`。同一手机号只对应一个 User；超级管理员第一次进 C 端会自动开通 CLIENT，不新建第二个账号，也不能用该令牌进入后台。渠道账号不能登录 B 端。
- 普通用户可在 C 端用手机号密码注册，或通过微信手机号快捷登录首次自动注册；可创建/编辑/删除自己的项目。B 端超级管理员可查看/删除全平台项目，不能新增。
- B 端用户为统一 `/api/v1/platform/users` 列表；后台只能新建超级管理员，普通用户资料不能通过编辑接口改，部门成员走 `/platform/departments/:id/members`。C 端可选部门：`GET /api/v1/client/me/departments`。
- 项目可见范围 P0 为 `PRIVATE` 与 `DEPARTMENT`（含子部门）；历史 `PUBLIC` 只读兼容。私有项目仅创建者可访问；B 端超级管理员可查看但不能用 C 端令牌绕过归属。
- 公开项目不公开源文件、知识库原文、原始 AI 会话和未发布报告，只允许查看已发布报告。
- 项目成员关系只保留数据结构，第一期不开放邀请和协作接口。

## 客户端与权限

- `/api/v1/platform/*` 和 `/api/v1/workspace/*` 必须使用 `aud=admin` 的 `B_ADMIN` 令牌，并具备 ACTIVE ADMIN access。
- `/api/v1/client/*` 为 C 端/PC AI 端只读内容接口（企业介绍兼容入口、公开文库），要求 JWT、`aud=client` 且客户端为 `C_APP`/`PC_AI`，不依赖后台 RBAC。普通企业介绍请用 `GET /api/v1/company/about`。ADMIN Token 不得冒充 C 端 Token。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- B 端后台接口必须先通过 JWT 和客户端校验，再通过具体按钮权限码校验；超级管理员直通。例外：当前账号可见范围内的只读项目统计（`GET /platform/projects/statistics`）不要求按钮权限码。
- 知识库采用“原文档导航 + 原始页面 + AI 检索索引”：平台管理路径 `/api/v1/platform/knowledge/*` 要求 `B_ADMIN` 与精确 `system:knowledge:*` 权限；C_APP/PC_AI 公开读取仅使用 `/api/v1/client/knowledge/*`。普通 B 端新建走 `POST /documents/create-with-file`（只收 fileId，自动解析），草稿验证走 `POST /versions/:versionId/test-qa`（只检索当前版本）。Knowledge Version 只有 DRAFT 可修改内容；进入 PENDING_REVIEW/APPROVED/PUBLISHED/DISABLED 后只读，修改需创建新 DRAFT。生产 AI 只检索当前、已发布、未过期且 `AI_ENABLED` 的版本；有 page-aware 分块时排除无页定位的 Mammoth `DOCUMENT_TEXT` 回退块；离线页图版本发布为 AI_ENABLED 前每页必须有原页图且识别已 CONFIRMED。`BROWSE_ONLY` 仅可浏览原文件。DOCX：Mammoth 负责文本/RAG；页面视觉通过离线高保真 PNG/ZIP 上传并人工确认，LibreOffice 默认关闭且仅作 fallback。同页识别以稳定 BullMQ jobId + `recognitionRunId` 单飞，旧任务不得覆盖新结果，只有 `REVIEW_REQUIRED` 可确认。热工参考行通过 `sourcePageId` 绑定页面；参考集发布前要求来源页属于当前、有效的 PUBLISHED Knowledge Version，AI 输出 `reference_pages` 前再次校验并只签名合法页。
- 页面视觉识别的 AI SDK 调用将识别规则传入 `instructions`，图片和页码传入用户 `messages`，以兼容当前 SDK 的提示词校验。
- 图集页面结构化识别使用独立 `PAGE_RECOGNITION` 预算（最多 8192 输出 token、120 秒）；聊天图片观察仍使用 `VISION` 的 1200 token 预算。
- 视觉模型的兼容网关可能不支持 JSON schema 约束，识别提示词同时明确列出结构化结果字段与层级，防止输出字段别名被解析器丢弃。
- 页面识别结果对明确的格式偏差做确定性修复并重新校验 schema；含义不明的热工值留给人工审核，失败日志不记录模型原文。
- 页面识别的服务商余额不足单独提示用户联系平台管理员处理后重试，不展示服务商原始错误。
- 多厚度表格按构造和同行数值生成选项；产品层共用参数保留在构造层，可变厚度与热阻逐档保存。页面确认后若未选择可编辑热工参考集，资料问答可用，参考档位仍需关联后同步。
- 知识库详情提供一键识别和无风险页一键核对，结果逐页列出成功、失败和跳过原因；模型解释性备注不等同识别失败。查看内容优先已确认目录，其次正文章节，并始终允许按文件页浏览。
- 不允许使用任意 `system:*` 作为模块级通行证；查看、新增、修改、删除、导出、分配和测试使用独立权限码。
- C 端和 PC AI 端不能访问后台管理接口，但可以访问明确开放的 AI、公开项目、本人项目、受控文件、报告和分享业务接口。
- 项目权限独立于后台 RBAC，必须继续执行 `canViewProject`、`canManageProject`、会话归属和文件归属校验。

## 技术架构

- API：Fastify + TypeScript + Zod + Swagger。
- 数据库：PostgreSQL + Drizzle ORM + `postgres.js`。
- 缓存与任务：Redis + BullMQ；API 创建任务，Worker 处理解析、报告和维护任务。
- AI：AI SDK + OpenAI-compatible provider；服务商、模型从数据库读取。C 端默认 `general_chat`，不要求用户选择场景/系统指令；快捷提问独立配置；Chat Agent 核心 Tools 为知识/项目状态/热工/对比/报告 5 个；`resolveAiCapabilities` 只做预路由，支持 tools 的模型走 `streamText` Agent Loop。
- 存储：开发环境 MinIO，生产环境优先阿里云 OSS。
- 部署：Docker Compose + Nginx；可选 PM2 托管宿主机 API/Worker。

## 接口响应约定

- 成功响应使用 HTTP `200`，结构为 `{ success: true, data, requestId }`。
- 业务错误统一使用 HTTP `200`，`error.code` 使用数值型 HTTP 语义码：访问令牌、刷新令牌和当前登录态无效使用 `401`；权限不足使用 `403`；参数错误使用 `400`；其他业务处理失败使用 `500`。未捕获的服务器异常使用 HTTP `500`，返回数值型 `500`。

## Swagger 文档规范

新增或修改 Fastify 路由时，必须在路由 `schema.tags` 中声明文档标签，并遵守以下约定：

- 标签格式统一为“客户端边界 / 业务模块”。
- 客户端边界仅允许：`B端`、`C端`、`PC AI端`、`共用`、`公共`。
- B 端平台管理使用 `B端 / 平台 / <模块>`，B 端工作台使用 `B端 / 工作台 / <模块>`。
- 多客户端共用的业务能力根据真实访问边界使用 `共用 / <模块>`；匿名接口使用 `公共 / <模块>`。
- 不得继续使用没有客户端前缀的标签，例如 `用户管理`、`AI 对话`、`文件`、`报告`。
- 新增标签必须同步登记到 `src/plugins/swagger.ts` 的 OpenAPI 标签目录。
- Swagger 标签只用于文档分类，不能替代 JWT、客户端隔离、按钮权限码、项目权限、文件归属或会话归属校验。

示例：

```typescript
schema: {
  tags: ["B端 / 平台 / 用户管理"]
}
```

目录职责：

| 目录 | 职责 |
| --- | --- |
| `src/app.ts` | Fastify 插件和路由注册 |
| `src/server.ts` | API 进程入口 |
| `src/worker.ts` | BullMQ Worker 入口 |
| `src/db` | Drizzle schema、迁移入口和 seed |
| `src/plugins` | 数据库、Redis、队列、存储、认证、错误和 Swagger |
| `src/modules` | 认证、项目、用户、权限、AI、文件、报告和分享业务 |
| `src/workers` | 文档处理和报告生成处理器 |
| `src/storage` | MinIO/OSS 统一对象存储适配器 |
| `src/shared` | 权限、错误、响应、分页和常量 |
| `drizzle` | 已提交的 PostgreSQL migration |

## AI 规则

- AI 不能执行任意 SQL、Shell、服务器文件操作或绕过项目权限。
- AI 围栏顺序为身份、项目权限、频控、输入限制、工具白名单、知识范围、确定性计算、引用检查、输出检查和落库审计。
- 深度思考是会话级配置，默认 `OFF`；每条消息保存实际 `reasoningMode`。
- 流式对话支持停止，停止后保存已生成内容并标记为 `STOPPED`，会话仍可继续。
- 用户端详情只展示本人消息、处理阶段、检索摘要、反馈、报告和分享；不展示模型原始思考链。
- B 端 AI 运营详情是独立后台接口，需要 `system:ai:conversation:*` 权限，可查看工具调用、任务、分享访问和审计摘要。
- AI 配置（服务商/模型准入测试/快捷提问/场景/提示词版本化）、SSE 协议、错误码、配额与安全细则见 `docs/ai/`。正式模型必须通过文本/工具/推理准入测试后才能启用。
- 主数据/企业信息/构造方案/图集热工/标准采集/材料对比/节点图库/报告与审核中心细则见 `docs/masterdata|company|construction|thermal|standard|comparison|nodes|reports/README.md`；采集管理见 `docs/collection/README.md`；B 端菜单信息架构见 `docs/menus/README.md`。
- API Key 使用 AES-256-GCM 加密，任何接口都不能返回密钥明文或完整密文。
- 报告来源通过 `report_sources` 保存回答快照和顺序，报告由 Worker 导出 HTML、PDF、图片和 Word。

## 开发启动

1. 安装 Node.js LTS、pnpm；本地基础设施使用 Docker（`docker compose up -d postgres redis minio`），或单独安装 PostgreSQL 和 Redis。
2. 复制环境变量模板：

   ```powershell
   Copy-Item .env.example .env
   ```

3. 修改 `.env` 中的 JWT 密钥、AI 加密密钥和管理员密码。
   `DATABASE_URL` 与 `REDIS_URL` 必须指向本地服务（默认值即本地地址），**禁止指向生产库**；生产连接只存在于服务器 `.env`。
4. 安装依赖并执行迁移、初始化数据：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm db:migrate
   pnpm db:seed
   ```

5. 分别启动 API 和 Worker：

   ```powershell
   pnpm dev
   pnpm dev:worker
   ```

完整基础设施可以使用：

```powershell
docker compose up --build
```

健康检查：`/health/live`、`/health/ready`，`/health` 保留兼容接口。

## 部署到服务器

推荐在开发机执行 `pnpm deploy`：本地编译打包，经 SSH 上传到服务器，**不走 git、不拖拽文件、不在 2G 机器上跑 tsc**。

### 日常一键发布（本地打包 + SSH）

1. 复制 `deploy/.env.deploy.example` 为 `deploy/.env.deploy`（已 gitignore，不会上传）。
2. 填写服务器地址、密码（或私钥）、存放路径：

```
DEPLOY_SSH_HOST=服务器IP或域名
DEPLOY_SSH_USER=root
DEPLOY_SSH_PORT=22
DEPLOY_SSH_PASSWORD=登录密码
DEPLOY_REMOTE_DIR=/www/wwwroot/lgapi.zblack.cn
```

`DEPLOY_REMOTE_DIR` 必须与线上 PM2 运行目录一致（含 `package.json` 的那一层），不要填 `dist/`。

3. 在 `backend/` 执行：

```powershell
pnpm deploy
```

脚本会：本地 `pnpm build` → 打包 `dist` + `drizzle` + 锁文件 → SSH 上传 → 服务器安装依赖 → **迁移前备份数据库（有 pg_dump 时）** → 只执行已提交的 Drizzle migration → 成功后才重载 PM2。

PM2发布新增报告运行环境门禁：安装Node依赖后、数据库步骤之前，用Chromium验证中文字体与真实PDF；缺依赖默认中止。首次可用 `pnpm run deploy --skip-db --install-report-runtime` 显式安装，日常纯代码发布用 `pnpm run deploy --skip-db`（避免pnpm11内置deploy命令冲突）。国内源与离线预装/缓存、系统支持范围见[PM2报告环境说明](docs/reports/pm2-report-runtime-2026-10-14.md)。不覆盖服务器.env或系统软件源。

SQL 约束：

- 不上传、不覆盖服务器 `.env`（生产库连接以服务器为准）。
- 不执行 `schema push`、不删库、不重置表。
- 迁移失败则回滚 `dist` 且 **不重载 PM2**，当前进程继续跑旧代码。
- `seed` 幂等：首次落地会跑一次，已存在管理员不会被覆盖。

首次在空目录部署时，服务器会生成 `.env` 并退出，请登录改好 `DATABASE_URL`、`BOOTSTRAP_ADMIN_PASSWORD` 等后再执行一次 `pnpm deploy`。

宝塔 Nginx 反代到 `http://127.0.0.1:3000`。健康检查：`/health/live`，文档：`/docs`。

`bash deploy/deploy.sh` 已停用（不再 `git pull`）。生产只走上面的 `pnpm deploy`。

### 修改管理员密码

`BOOTSTRAP_ADMIN_PASSWORD` 只在首次 seed 时生效（`src/db/seed.ts` 不会覆盖已存在用户）。修改管理员密码的正确方式：

- 后台 UI（推荐）：登录后进入「用户管理 -> 重置密码」（权限码 `system:user:reset-password`，超级管理员直通，操作会写入审计日志）。
- 接口：`POST /api/v1/platform/users/:id/reset-password`，请求体 `{ "password": "<至少12位新密码>" }`。B 端登录接口 `POST /api/v1/auth/b/login` 需要图形验证码，命令行调用较繁琐，建议直接使用后台界面。

### 常见运维

- 日志：`docker compose logs -f`（指定服务：`docker compose logs -f api`）。PM2 运行时用 `pm2 logs`、`pm2 status`（进程名 `lg-vicp-api` / `lg-vicp-worker`）。
- 使用 80 端口：修改 `docker-compose.yml` 中 nginx（或 PM2 的 `gateway`）的端口映射 `8080:80` 为 `80:80`。
- 数据备份：数据保存在 Docker 卷 `postgres_data`、`redis_data`、`minio_data`，备份 `docker compose exec postgres pg_dump` 输出和 MinIO 对象即可。

## 常用命令

```powershell
pnpm deploy     # 本地打包后 SSH 发布（不走 git）
pnpm lint       # TypeScript 检查
pnpm test       # Vitest 测试
pnpm build      # 构建 API 和 Worker
pnpm db:check   # 检查 Drizzle migration
pnpm db:generate
pnpm db:migrate
pnpm db:verify  # 临时容器验证全部迁移（干净库 + 脏数据模拟两个场景）
pnpm db:studio
pnpm pm2:start  # 服务器：按 deploy/ecosystem.config.cjs 启动或重载 PM2
pnpm pm2:logs   # 服务器：查看 PM2 日志
```

## 修改流程

1. 先阅读 `AGENTS.md`、`.cursor/rules/00-project-context.mdc` 和对应参考文档。
2. 按 `.cursor/rules/90-change-map.mdc` 找到正确模块，不跨模块复制业务规则。
3. 修改数据模型时先改 `src/db/schema.ts`，再生成并检查 migration；数据迁移按旧数据形态编写防御性 SQL（去重、空值兜底、幂等），并用 `pnpm db:verify` 在临时容器验证；生产禁止使用 schema push。
4. 新增或修改后台接口时同时添加客户端校验、精确权限码、项目级校验和审计日志。
5. 数据写入和对应审计尽量放在同一个数据库事务中；耗时解析和导出必须交给 BullMQ Worker。
6. AI 相关改动必须检查围栏、来源引用、密钥处理、停止生成、会话详情和报告来源。
7. 长期业务或架构变化必须同步更新 `AGENTS.md`、`.agents/skills/lg-backend`、`.cursor/rules` 和本 README。
8. 交付前执行 `pnpm db:check`、`pnpm lint`、`pnpm test` 和 `pnpm build`。

## 变更定位

- 用户、角色、部门、岗位、字典：`src/modules/users`、`src/modules/system-management`、`src/modules/platform-ops`。
- 客户端认证和动态路由：`src/modules/auth`、`src/plugins/auth.ts`、`src/modules/menus`。
- 项目可见性和项目权限：`src/modules/projects`、`src/shared/permissions.ts`。
- AI 配置、对话、围栏和检索：`src/modules/ai-config`、`src/modules/ai`、`src/modules/knowledge`。聊天图片走 `ai_message_attachments` + `purpose=CHAT_IMAGE`，会话可不关联项目。
- 文件、解析、OCR 和队列：`src/modules/files`（含文件资产中心：列表/引用/预览/回收站/SHA-256 复用，详见 `docs/files/README.md`）、`src/workers`、`src/queues`、`src/storage`。
- 报告、来源和导出：`src/modules/reports`、`src/workers/report.worker.ts`。AI 会话报告 `projectId` 可空；`GET /api/v1/reports/my` 查当前用户报告。
- 分享和匿名访问：`src/modules/shares`、`share_links`、`share_views`。
- 全局响应、错误和中文提示：`src/shared/response.ts`、`src/shared/errors.ts`、`src/plugins/error-handler.ts`。

更多细则按任务读取：

- `.agents/skills/lg-backend/references/project-brief.md`
- `.agents/skills/lg-backend/references/backend-architecture.md`
- `.agents/skills/lg-backend/references/permissions-and-projects.md`
- `.agents/skills/lg-backend/references/ai-and-reports.md`
- `.agents/skills/lg-backend/references/files-and-jobs.md`

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
