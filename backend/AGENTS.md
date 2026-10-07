# 蓝格 VICP 后端 AI 开发规则

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
- MinIO（开发）、阿里云 OSS（生产）。
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
