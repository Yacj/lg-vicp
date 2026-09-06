# 蓝格 VICP 后端 AI 开发规则

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
- Docker Compose、Nginx。

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

路由边界：

- `/api/v1/platform/*`：B 端平台管理，先校验 `B_ADMIN`，再按具体权限码授权；超级管理员全量放行。
- `/api/v1/platform/knowledge/*`：B 端平台知识库管理（分类/文档/版本/解析/审核/发布/检索日志/别名词典/批量导入/抓取源/排序规则/检索评测/版本 Wiki 章节树/公开文库只读列表），按 `system:knowledge:*` 权限码授权；批量导入返回预签名地址，直传后走 upload-complete 确认；`GET /versions/:versionId/sections` 与 C 端公开文库/AI 来源详情共用 knowledge-wiki-read 服务（DRAFT 审核与已发布阅读共用），`GET /public/documents` 与 `/client/knowledge/documents` 同一读取口径（PUBLIC + PUBLISHED + 生效中）。
- `/api/v1/platform/masterdata/*`：B 端平台主数据管理（企业内容/证书、产品系列/规格/性能参数/附件、材料/材料参数版本），按 `system:md:*` 权限码授权；统一审核状态机 DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED（可驳回 REJECTED，发布后 new-version 派生新草稿），已发布读取接口 `/published/*` 只返回 PUBLISHED 且生效中的数据，供计算模块确定性取数。
- `/api/v1/platform/construction/*`：B 端平台构造方案管理（保温系统、构造方案/构造层/产品选项/方案文档），按 `system:construction:*` 权限码授权；版本化状态机复用 masterdata `md-workflow.service.ts`（`registerVersionedEntity` 注册 + 共用工作流工厂），new-version 同事务复制子表；submit/publish 前强制结构校验（层序连续、基层/产品层唯一、产品层厚度落在选项区间、引用规格/材料已发布生效）；已发布读取接口 `/published/*` 只返回 PUBLISHED 且生效中的数据，供未来图集热工查表模块取数。详见 `docs/construction/README.md`。
- `/api/v1/platform/thermal/*`：B 端平台图集热工参考选用表管理（参考集/参考行 + Excel 导入作业 + 确定性热工计算引擎 + 候选方案查询与确认），按 `system:thermal:*` 权限码授权；导入走预签名直传 + BullMQ 解析（`thermal-import` 队列），apply 单事务建/复用 DRAFT 集，错误行默认拒绝、`ignoreErrors` 显式确认才跳过，DB 唯一冲突整体回滚；参考集版本化状态机复用 masterdata，new-version 同事务复制参考行；submit/publish 前强制结构校验（行引用方案已发布生效、厚度在选项区间、数值>0、证据必填）；已发布读取接口 `/published/sets` 只返回 PUBLISHED 且生效中的集，供方案筛选查 K 值；计算引擎（`POST /calc` 三模式 REFERENCE_TABLE/EQUIVALENT/LAYERED）只接受标识入参、数值全部从已发布数据加载，结果与全过程快照落 `thermal_calc_records`（历史不随后台参数漂移）；人读计算步骤由 `thermal-calc-presentation.ts` 从冻结快照派生（AI `/calc` 响应 `presentation` 字段与 `GET /api/v1/ai/thermal/calc-records/:id`），AI 端入口 `/api/v1/ai/thermal/calc`（C_APP/PC_AI + 项目可见性守卫）；候选方案查询（`POST /candidates/query`）按条件（地区/建筑类型/系统/基层/厚度区间/目标K/目标热阻/标准ID/项目日期 asOfDate）匹配已发布图集参考行，命中/未命中/数据缺失三态标注、相邻已发布规格（neighborTolerance）、排序只按后台规则（命中数 → targetK 差值升序：K≤目标且最接近目标优先 → 标准厚度 → 集 priority → 版本，候选附 ranking.kGap/isClosestToTarget）、不宣称唯一最优、图集无结果不自动批量计算；地区限值多标准并存时返回 `limitCandidates` 由用户选择（不隐式选最严格）；用户确认的最终候选与选择理由快照落 `thermal_candidate_selections`（查询+候选全快照，历史不漂移），AI 端入口 `/api/v1/ai/thermal/candidates`、`/candidate-selections`。详见 `docs/thermal/README.md`。
- `/api/v1/platform/standard/*`：B 端平台地方标准采集（标准来源配置/抓取作业 + 爬虫 CRAWL 与人工 MANUAL 双通道汇入 + 轻量审核流转 + 指标发布转换落库 + 版本替代/过渡期），按 `system:standard:*` 权限码授权；定时抓取复用 `cron_jobs`（jobType `standard_crawl`，`maintenance` 队列分发，worker.ts 已有 `knowledge_crawler` 同款先例），手动触发 `POST /sources/:id/crawl`；通用解析器按站点配置（栏目 URL/url-scroll-none 三种分页/关键字过滤/提取正则），先存详情页原文（对象存储 + SHA-256 幂等/变更检测）后按规则提取，规则调整可重跑不重抓网页；人工录入 `POST /documents` 组合提交（文档+适用范围+指标，指标证据条款引用必填），与爬虫文档同表同身份空间防重复；审核流转 DRAFT -> PENDING_REVIEW -> APPROVED -> PUBLISHED（可驳回 REJECTED，发布同编号旧版自动 DISABLED）；指标 publish 同事务生成 `thermal_standard_limits` 消费行（basisCode=documentNo、standard_document_id 溯源，同 regionCode 不同 basisCode 天然并存）；替代关系 confirm 设置旧文档过渡期 `expiresAt`，过渡期结束由每日抓取 job 顺带扫描失效；AI 对话只消费已发布限值，不直接读抓取库。详见 `docs/standard/README.md`。
- `/api/v1/platform/comparison/*`：B 端平台材料对比规则管理（版本/材料/规则/证据/维度 + 批量导入 + 已发布读取），按 `system:comparison:*` 权限码授权；版本化状态机复用 masterdata，new-version 同事务复制材料/规则/证据并重映射内部 FK；submit/publish 前强制结构校验（规则至少一条、双方材料同版本且类别正确、每条规则至少一条 VICP 侧证据、竞品数值必带竞品侧证据、优势文案/适用条件/必要披露非空）；规则引用同一版本内双方材料（VICP 侧类别为 VICP、竞品侧非 VICP），防不同型号/密度混比；已发布读取 `/published/rules` 只返回 PUBLISHED 且生效中的数据；AI 端 `/api/v1/ai/comparison/rules`（C_APP/PC_AI + 项目可见性守卫）；`material_compare` 场景对话以 prompt 注入消费已审核规则（`prompt-assembly.ts` ruleContext），回答完成后按引用规则写 `ai_rule_usage_logs`（含快照）。详见 `docs/comparison/README.md`。
- `/api/v1/platform/nodes/*`：B 端平台节点图库管理（节点大样图 + 节点-方案关联），按 `system:node:*` 权限码授权；版本化状态机复用 masterdata，new-version 同事务复制关联子表；submit/publish 前强制结构校验（部位必填、高清图/CAD 至少一个、引用保温系统与关联方案已发布生效）；已发布读取 `/nodes/published` 只返回 PUBLISHED 且生效中的节点（关联只保留已发布方案）。详见 `docs/nodes/README.md`。
- `/api/v1/platform/report-templates/*` 与 `/api/v1/platform/reports/*`：B 端平台报告模板与模板报告（章节配置 + 快照冻结 + 强制审核），按 `system:report:*` 权限码授权；模板为版本化审核实体（章节 key 固定枚举、order 连续、DATA 无文案/TEXT 必填文案）；模板报告生成时快照冻结全部章节数据（候选/计算记录整份嵌入 + 已发布静态章节，历史不漂移），Worker 只做确定性渲染；仅模板报告强制审核（READY → PENDING_REVIEW → APPROVED 可发布/REJECTED 可重提），AI 会话报告 publish 保持现状；共用发布端点对 TEMPLATE 强制 APPROVED。详见 `docs/reports/README.md`。
- `/api/v1/platform/review-center/*`：B 端平台统一审核中心（产品/构造/热工/标准/比较/节点/模板/模板报告），按 `system:review:{list,approve}` 权限码授权；`professional_reviews` 为单一数据源，各域 transition（md-workflow/standard/报告审核）在状态变更同一事务内 upsert，审核中心只做队列读取与决议委托（无审核分叉），不替代各模块原审核端点。详见 `docs/reports/README.md`。
- `/api/v1/internal/knowledge/*`：服务间受控接口（静态密钥 `x-internal-key` = `env.INTERNAL_API_KEY`，未配置则整体禁用）；服务端直写对象存储并投递解析，产物为 DRAFT 待审核，不自动发布；不校验 B_ADMIN 客户端。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- `/api/v1/workspace/*`：B 端渠道工作台，先校验 `B_ADMIN`，再执行项目级权限。
- `/api/v1/projects/*`：登录用户共享项目读取。
- `/api/v1/files/*`：统一文件资产中心 + 源文件上传、状态和受控下载。`files` 表是唯一文件资产表（storageProvider/bucket/objectKey 唯一、sha256 索引、软删除/回收站），业务表一律只存 `fileId`；`POST /upload-intent`（`/upload-intents` 别名）按 SHA-256 返回 `mode=REUSE`（复用已有 READY 文件）或预签名直传，`/:id/complete` 发现重复内容时兜底合并并返回 `duplicateOfFileId`；`GET /` 对 B_ADMIN 是 FilePicker/中心列表（全平台 READY 文件 + 引用计数轻字段，`includeRecycled=1` 需 `file:center:view`），对 C 端/PC AI 端保持"我的源文件"口径；`/recent`、`/:id`、`/:id/preview` 面向 B_ADMIN（预览用 `createPreviewUrl` 短期内联签名 URL，绝不返回永久 URL）；`/:id/references` 走 `file-reference.service` 只读 UNION 聚合各业务关系表（业务表是唯一事实源，不建统一引用表）；`/:id/recycle|restore|DELETE /:id/permanent` 需 `file:center:manage`，引用数 > 0 时返回 `error.details.errorCode = "FILE_IN_USE"` + 引用摘要。详见 `docs/files/README.md`。
- `/api/v1/ai/*`：AI 会话与流式对话。
- `/api/v1/client/*`：C 端/PC AI 端只读内容接口（`/client/content/enterprise-profile` 已发布企业介绍、`/client/knowledge/*` 公开文库），JWT + `requireClient(C_APP, PC_AI)`，不依赖后台 RBAC 权限码；只返回 PUBLISHED + 生效中数据。
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

- 固定业务身份为 `SUPER_ADMIN`、`CHANNEL_USER`、`NORMAL_USER`。
- 经销商和业务员统一为 `CHANNEL_USER`，通过 `channelType` 标签区分。
- 超级管理员和渠道用户可以创建项目；普通用户第一期不能创建。
- 私有项目仅创建者和超级管理员访问。
- 公开项目允许所有登录用户只读；只开放已发布报告，不开放源文件和原始 AI 会话。
- 动态 RBAC 控制后台菜单和功能，不能覆盖项目访问规则。
- `ProjectMember` 只作为扩展点，第一期不开放协作接口。
- 项目变更、权限变更、AI 配置、AI 调用、文件和报告操作必须记录审计。
- 业务写入和对应审计应处于同一个数据库事务。

## AI、文件与报告边界

- AI 不能执行任意 SQL、Shell、服务器文件操作或绕过权限读取数据。
- AI 只能调用具有 Zod 输入、权限检查和审计的后端工具。
- 工程计算由确定性代码完成；AI 负责参数提取、检索、解释和结构化报告草稿。
- 标准条文和技术结论必须引用检索来源；资料不足时明确说明不确定，禁止编造。
- 模型按业务场景从数据库解析，禁止在业务代码写死 DeepSeek 或模型 ID。
- API Key 必须 AES-256-GCM 加密保存，任何响应都不得返回密钥。
- AI 回答点赞、反馈和重新生成都必须保留原始消息，不覆盖历史回答。
- AI 流式回答支持停止：停止只结束当前生成，必须保存已生成内容并将消息标记为 `STOPPED`；会话保持可继续发送新消息。
- 深度思考是会话级设置，默认 `OFF`；每条消息保存实际 `reasoningMode`，不能用全局开关覆盖用户会话。
- AI 场景与提示词版本化：模型按场景解析（`ai_scenes` + `prompts` + `prompt_versions`），提示词只有 DRAFT/PUBLISHED/DISABLED 三种状态、同场景全局唯一生效版本；已发布版本不可直接修改（编辑派生新草稿）。
- AI 对话敏感词围栏：发送消息前对 `ai_content_filters` 启用的词条做确定性校验（CONTAINS/REGEX，可指定生效场景），命中即拦截且不发模型请求；用户消息以 `BLOCKED` 状态落库并记录命中词条、写审计，返回 `AI_CONTENT_BLOCKED` 错误（400 语义码 + 可配置中文提示）。B 端通过 `/api/v1/platform/ai/filters` 管理词条，按 `system:ai:filter:*` 权限码授权。
- AI 会话自动标题：会话首条用户消息回答完成后投递 `ai-title-generation` BullMQ 队列异步生成标题，模型与提示词走 `conversation_title` 场景解析；仅当会话标题仍为空（未手动重命名）时写入，生成失败保持“未知对话”不阻塞主对话。
- 仅 `general_chat` 场景对外开放；其他场景未具备知识库/公式/工具能力前不得对外宣称完整业务能力（`enabled` 门控）。
- AI 配额：并发生成（Redis 计数）+ 每日请求数双重限制，`SUPER_ADMIN` 豁免；错误使用统一 `AI_*` 错误码（`src/shared/ai-errors.ts`）。
- AI 配置、运营、反馈处理与调试使用独立 `system:ai:*` 权限码并写审计，详见 `docs/ai/`。
- AI 会话历史支持分页、搜索、来源筛选、项目筛选、重命名、按用户置顶、移动项目、软删除和恢复；删除会话必须禁用由该会话产生的有效 AI 分享链接。
- 多条 AI 回答生成报告时，通过 `report_sources` 保存来源顺序和回答快照。
- 公开分享只暴露分享快照或已生成报告文件，不开放源文件、知识库原文或原始 AI 会话。
- `PROJECT` 分享只暴露项目摘要和已发布报告快照；不得返回项目源文件、知识库原文、未发布报告、原始会话或后台权限信息。
- 源文件使用预签名直传；解析、OCR、索引和报告导出必须通过 BullMQ Worker。
- OCR 未配置时将文件标记为 `OCR_REQUIRED`，不得把空解析结果当成功。
- 知识库文档版本化：版本状态机 DRAFT -> APPROVED -> PUBLISHED -> DISABLED（照抄 prompt_versions 风格），只有 PUBLISHED 版本参与检索，已发布版本不可直接修改（编辑派生新草稿）；解析任务走 `parsing_jobs` 领域表，与通用 `async_tasks` 职责分离；知识库多来源（B 端上传/批量导入/爬虫/内部 API）统一走 `knowledge-ingest.service` 入库链路，插入 `files` 前按 SHA-256 查重（已发布版本冲突抛 409，仅草稿提示先处理），爬虫与内部 API 产物默认 DRAFT/REVIEW_PENDING 待审核；知识版本支持从文件中心按 fileId 复用已有文件：版本创建可直接带 `originalFileId`/`searchSourceFileId`（可同一 fileId，禁止复制 OSS 对象），`versions/:id/upload-intent` 支持 `existingFileId`（REUSE 不重新上传），`upload-complete` 对 READY 文件直接绑定、对未就绪文件保持完整校验与本人限制；更换正式/AI 识别文件只收新 fileId，旧文件不删除、历史版本引用可追溯。检索权重来自 `knowledge_ranking_rules` 可配置，检索评测存 `knowledge_search_evaluations`。详见 `docs/knowledge/README.md`。
- 知识库为"原文档导航 + 原始页面 + AI 检索索引"模型（2026-08 二次优化）：Original File = 对外展示的正式原文件，Search File = 机器检索文本源（双源资产表 `knowledge_document_assets`，role=ORIGINAL/SEARCH_SOURCE/OCR_SOURCE/PREVIEW）；TOC（`knowledge_toc_items`）= 原文件目录（自动识别仅 PENDING_REVIEW 初稿，B 端人工 CONFIRMED；不由 detectHeading 替代）；Page = 物理页序号（physical_page_number）+ 印刷页码标签（page_label，可为 A1/A5/D16 等非整数，禁止 Number()）；Section = AI 语义章节（≠ TOC）；Block = 页面内标题/段落/表格块（Block 级 sectionId 归属，同页多小节各归各）；`knowledge_chunks` 仅作辅助检索索引。转曲/无文本层 PDF 判定 `NO_TEXT_LAYER`（不是解析失败）：绑定 SEARCH_SOURCE 后经 `knowledge_page_mappings`（禁止物理页硬对齐）建立检索页→原文页映射；无检索源则 `SEARCH_SOURCE_REQUIRED`，只能以 BROWSE_ONLY 发布。用户看到的"原文"必须是 ORIGINAL PDF 页面/预览图（`pageImageObjectKey` 逐页渲染，concurrency=1，`PDF_PREVIEW_DPI` 默认 130），parsedText 一律称"机器提取文本"（`extractedText`）。发布门禁：AI_ENABLED 必须有可搜索文本源（硬拦截），TOC 未确认/映射未核验为软提示；历史资料用 UPGRADE_PARSE 逐步升级（`pnpm backfill:knowledge-wiki` 或 B 端「升级解析」）。
- AI 来源契约统一走 `src/modules/ai/ai-source.mapper.ts`（AiSourceRef：含 tocPath/pageLabel/physicalPageNumber/originalFileId 等；用户展示用 pageLabel，physicalPageNumber 只用于程序打开页面），正常生成与 regenerate 复用同一 mapper，无证据时 sources 为空数组；来源详情（TOC 路径 + ORIGINAL 页面预览 + 机器提取内容 + 高亮）走 `GET /api/v1/ai/knowledge/source-detail`，与公开文库共用 `knowledge-wiki-read.service`（只读 PUBLISHED+生效中，私有项目越权返回 404；公开文库按 pageLabel 定位走 `GET /api/v1/client/knowledge/documents/:id/pages/by-label/:pageLabel`）。
- 专业 AI 会话必须选择保温体系：会话级 `ai_conversations.insulationSystemId`（nullable，可切换写审计），非 general_chat 场景创建/发送前强制校验（`AI_INSULATION_SYSTEM_REQUIRED`）；体系影响 Prompt 上下文、知识检索加权（`knowledge_documents.insulation_system_id` 标注列 + INSULATION_SYSTEM_MATCH 权重）与候选查询 systemId 注入；体系列表 `GET /api/v1/ai/context/insulation-systems`。
- 公开文库只暴露 `knowledge_documents.visibility=PUBLIC` + PUBLISHED + 生效中文档（默认 PRIVATE）；C 端企业介绍只读 `/api/v1/client/content/enterprise-profile`。
- B 端消息通知（提醒闭环）：`notifications` + `notification_reads`（广播行 + 按用户已读差集），`/api/v1/platform/notifications` 系列端点按 `system:notification:*` 授权，轮询无 WebSocket；埋点：AI 点踩/文字反馈、标准待审核、知识解析失败、报告生成失败；`createNotification` 尽力写入不阻塞主流程。
- 渠道数据隔离预留：`data_scope` 枚举新增 CHANNEL/CHANNEL_AND_CHILDREN，`users.channelId/parentChannelId`（nullable），解析器 `src/shared/data-scope.ts`；第一期不改变任何现有查询语义。
- 报告以结构化 JSON 为事实源，模板生成 HTML、图片、Word 和 PDF。

## 需求变更定位

- 数据模型或索引：`src/db/schema.ts` 和 `drizzle/`。
- 项目可见性：`src/shared/permissions.ts` 与项目模块。
- 用户、角色、部门、字典：用户、权限和系统管理模块。
- 文件上传、解析、OCR：文件模块、存储适配器和文档 Worker。文件资产中心（列表/详情/引用/预览/回收站/SHA-256 复用）：`src/modules/files/`（`file-center.service.ts` + `file-reference.service.ts` 引用聚合 + `files.routes.ts`），权限码见 `src/shared/file-permissions.ts`（`file:center:*`），FilePicker 知识接入见 knowledge 模块 `createDocumentVersion`/`createVersionUploadIntent`。详见 `docs/files/README.md`。
- 知识库文档、版本、解析、检索：知识库模块（`src/modules/knowledge/`，含层级检索 `searchWikiHierarchy`、统一 Wiki 读取 `knowledge-wiki-read.service.ts`、原文导航服务 `knowledge-original.service.ts`（资产/TOC/页面/映射/门禁）、页面映射纯函数 `knowledge-page-mapping.ts`、块化管线 `knowledge-chunking.ts`（parsePageToBlocks/buildSectionDrafts/buildChunksFromBlocks）、C 端公开文库 `knowledge-client.routes.ts`）、`knowledge_*`/`parsing_jobs` 表及 `drizzle/` 最新迁移（0028：assets/toc_items/page_mappings/页码拆分/usageMode）；历史资料升级 `pnpm backfill:knowledge-wiki`（UPGRADE_PARSE）；后台知识库接口按 `system:knowledge:*` 权限码授权。
- 企业/产品/材料参数主数据：主数据模块（`src/modules/masterdata/`，服务层 + `md-workflow.service.ts` 通用状态机 + `md.schemas.ts` DTO + `masterdata.routes.ts`）、`md_*` 表；权限码见 `src/shared/md-permissions.ts`；已发布读取服务 `md-read.service.ts` 只返回 PUBLISHED 且生效中的数据；导入示例 `pnpm md:import-example`。详见 `docs/masterdata/README.md`。
- 保温系统/构造方案/构造层/产品选项/方案文档：构造模块（`src/modules/construction/`，服务层 + 结构校验器 `construction-structure.service.ts` + 已发布读取 `construction-read.service.ts` + `construction.schemas.ts` DTO + `construction.routes.ts`）、`insulation_systems`/`construction_schemes`/`construction_layers`/`scheme_product_options`/`scheme_documents` 表；版本化状态机与工作流工厂复用 masterdata（`registerVersionedEntity`/`registerVersionedWorkflow`，见 `src/modules/masterdata/md-workflow.service.ts` 与 `workflow-routes.ts`）；权限码见 `src/shared/construction-permissions.ts`；导入示例 `pnpm construction:import-example`。详见 `docs/construction/README.md`。
- 图集热工参考选用表与确定性热工计算引擎：thermal 模块（`src/modules/thermal/`，服务层 `thermal.service.ts` + Excel 解析匹配 `thermal-import.service.ts` + 已发布读取 `thermal-read.service.ts` + `thermal.schemas.ts` DTO + 计算引擎 `thermal-calculator.ts`（纯函数）/`thermal-calc.service.ts`/`thermal-calc.schemas.ts`/`thermal.routes.ts`/`ai-thermal.routes.ts` + 候选匹配 `thermal-candidate-matcher.ts`（纯函数）/`thermal-candidate.service.ts`/`thermal-candidate.schemas.ts`）、`thermal_reference_sets`/`thermal_reference_rows`/`thermal_import_jobs`/`thermal_import_errors`/`thermal_calc_rules`/`thermal_standard_limits`/`thermal_calc_records`/`thermal_candidate_selections` 表；版本化状态机复用 masterdata；导入队列 `thermal-import`（`src/queues/queues.ts` + `src/workers/thermal-import.worker.ts`）；权限码见 `src/shared/thermal-permissions.ts`（计算与候选查询复用同一组，不新增权限码）；模板生成 `pnpm thermal:template`；计算引擎公式族由 `thermal_calc_rules.formula_version` 标识（当前 VICP-CALC-1），甲方样例回归放 `fixtures/thermal-regression/`。详见 `docs/thermal/README.md`。
- 地方标准采集（爬虫/人工双通道、审核与消费转换）：standard 模块（`src/modules/standard/`，服务层 `standard.service.ts` + 通用站点抓取 `standard-crawl.service.ts` + `standard.schemas.ts` DTO + `standard.routes.ts`）、`standard_sources`/`crawl_jobs`/`standard_documents`/`standard_applicability`/`standard_indicators`/`standard_replacements` 表（迁移 0019_tough_harpoon + 0020）+ `thermal_standard_limits.standard_document_id` 溯源列；定时抓取复用 cron_jobs（jobType `standard_crawl`，`maintenance` 队列，`src/worker.ts` 分发到 `runStandardCrawl`）；权限码见 `src/shared/standard-permissions.ts`（`system:standard:*`），错误码见 `src/shared/standard-errors.ts`；指标 publish 同事务转换落库 `thermal_standard_limits`（消费模型，候选查询/计算引擎零改造），同地区多 basisCode 天然并存、同键新版本发布自动停用旧版。详见 `docs/standard/README.md`。
- 材料对比规则引擎（VICP vs 竞品对比的审核化结构化规则）：comparison 模块（`src/modules/comparison/`，服务层 `comparison.service.ts` + 已发布读取 `comparison-read.service.ts` + prompt 上下文与使用日志 `material-compare.service.ts` + `comparison.schemas.ts` DTO + `comparison.routes.ts`/`ai-comparison.routes.ts`）、`comparison_versions`/`comparison_materials`/`comparison_dimensions`/`comparison_rules`/`comparison_evidence`/`ai_rule_usage_logs` 表；版本化状态机复用 masterdata，new-version 同事务复制子表并重映射 FK；五维固定维度（thermal/fire/durability/construction/approval）seed 预置、禁止删除/禁用；权限码见 `src/shared/comparison-permissions.ts`（`system:comparison:*`），错误码见 `src/shared/comparison-errors.ts`；AI 集成：`material_compare` 场景 prompt 注入（`prompt-assembly.ts` ruleContext + `ai.routes.ts` 发送/regenerate 两处），使用日志 `ai_rule_usage_logs` 含规则快照；导入示例 `pnpm comparison:import-example`。详见 `docs/comparison/README.md`。
- 节点图库（节点大样图 + 节点-方案关联）：nodes 模块（`src/modules/nodes/`，服务层 `node.service.ts` + 已发布读取 `listPublishedNodesWithLinks` + `node.schemas.ts` DTO + `node.routes.ts`）、`node_drawings`/`node_scheme_links` 表；版本化状态机复用 masterdata，new-version 同事务复制关联子表；submit/publish 前结构校验（部位必填、图/CAD 至少一个、引用系统与方案已发布生效）；权限码见 `src/shared/node-permissions.ts`（`system:node:*`），错误码见 `src/shared/node-errors.ts`；节点图/CAD 文件 MIME 白名单（png/jpeg/svg/dwg/dxf）见 `src/modules/files/file.schemas.ts`。详见 `docs/nodes/README.md`。
- 报告模板/模板报告快照/统一审核中心：reports 模块（`src/modules/reports/`，模板服务 `report-template.service.ts` + 快照组装 `report-snapshot.service.ts` + 审核 `report-review.service.ts` + 确定性渲染 `report-template-render.ts` + 平台路由 `report-platform.routes.ts`）+ review-center 模块（`src/modules/review-center/`，统一审核记录 `professional-review.ts` + 委托服务 `review-center.service.ts` + `review-center.routes.ts`）、`report_templates`/`report_snapshots`/`professional_reviews` 表 + `reports` 审核列；仅模板报告强制审核（READY → PENDING_REVIEW → APPROVED 可发布/REJECTED 可重提），AI 会话报告 publish 保持现状；`professional_reviews` 由各域 transition（md-workflow/standard/报告审核）同事务 upsert，审核中心只读队列与委托决议；权限码见 `src/shared/report-permissions.ts`（`system:report:*`）/`src/shared/review-permissions.ts`（`system:review:*`），错误码见 `src/shared/report-errors.ts`/`src/shared/review-errors.ts`；默认模板 `standard_report` 由 seed 写入。详见 `docs/reports/README.md`。
- AI 模型配置、围栏、对话：AI 配置模块、AI 模块和知识检索模块；后台 AI 配置与运营接口按 `system:ai:*` 权限码授权。
- B 端消息通知/提醒闭环：notifications 模块（`src/modules/notifications/`），`notifications`/`notification_reads` 表；AI 反馈埋点在 `ai.routes.ts`、标准待审在 `standard.service.ts`、解析失败在 `document.worker.ts`、报告失败在 `report.worker.ts`；权限码见 `src/shared/notification-permissions.ts`。
- 会话保温体系：`ai_conversations.insulation_system_id`、`ai.routes.ts`（创建/发送守卫/切换/体系列表）、`ai-source.mapper.ts`（统一 sources）、错误码 `AI_INSULATION_SYSTEM_REQUIRED`。
- 渠道权限预留：`users.channel_id/parent_channel_id`、`data_scope` 新枚举值、`src/shared/data-scope.ts` 解析器（第一期不做业务过滤）。
- AI 停止生成和会话深度思考：`src/modules/ai/ai.routes.ts`、`ai_messages`/`ai_conversations` 状态字段及 `drizzle/` 最新迁移。
- AI 回答点赞、反馈和重新生成：AI 模块、平台 AI 反馈模块、`ai_message_feedbacks`、`ai_message_regenerations`。
- 报告来源和报告输出：报告模块、报告 Worker、`report_sources`。
- 公开分享：分享模块、`share_links`、`share_views`。
- Redis/BullMQ：队列定义、插件和 Worker 入口。
- 全局错误、响应和中文提示：共享错误、响应及错误处理插件。

修改长期约束时，同步更新本文件、`README.md`、`.agents/skills/lg-backend` 和 `.cursor/rules`。
- 客户端固定为 `B_ADMIN`、`C_APP`、`PC_AI`。所有 `/api/v1/platform/*` 和 `/api/v1/workspace/*` 接口必须先通过 JWT 和 `B_ADMIN` 客户端校验，C 端和 PC AI 端不得调用后台管理接口。
- B 端后台接口必须同时具备认证和接口级权限码校验。超级管理员可以直通；其他 B 端账号必须拥有对应按钮权限，例如 `system:user:list`、`system:user:add`、`system:menu:edit`、`system:ai:model:test`。
- 不允许使用“拥有任意 `system:*` 权限即可访问整个模块”的宽权限判断。新增、修改、删除、导出、分配和查看必须使用不同权限码。
- 角色权限查询必须过滤 `roles.enabled = true`。禁用角色不能继续授予菜单或接口权限。
- C 端和 PC AI 端虽然不能访问后台管理接口，但可以访问明确开放的业务接口（AI、公开项目、本人项目、受控文件、报告和分享）；这些接口必须继续执行项目所有者、项目可见性、会话归属和文件归属校验。
- 项目业务权限独立于后台 RBAC。RBAC 只控制后台菜单和按钮，不能替代 `canViewProject`、`canManageProject` 等项目级校验。
- 动态路由只返回当前 B 端账号拥有权限的目录、页面和按钮；目录下没有任何可见子菜单时整体隐藏（不返回空壳目录）；Vue 端只能从组件白名单加载组件，不能执行数据库任意路径。

### 权限变更验收

- 用 C_APP 和 PC_AI 令牌请求任意 `/platform`、`/workspace` 接口必须返回 `FORBIDDEN`。
- B_ADMIN 无权限时，查看、新增、修改、删除、导出和分配接口分别返回 `FORBIDDEN`。
- 禁用角色后重新请求接口，原角色权限立即失效。
- B 端仍可访问 AI 业务接口，但必须通过场景、客户端来源、项目和会话权限校验。
