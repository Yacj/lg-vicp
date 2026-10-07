<!-- 2026-08 原文导航收口：CHUNK_REBUILD 仅重建派生 Section/Block/Chunk，保留 Page ID、预览、人工页签、CONFIRMED TOC 与人工映射；双源只从 SEARCH_SOURCE 读取并且未映射页不索引。检索统一限制当前 PUBLISHED、未过期、AI_ENABLED 版本；BROWSE_ONLY 仅浏览；来源详情通过映射返回 ORIGINAL，未映射时不伪造页码。B 端草稿验证走 `POST /api/v1/platform/knowledge/versions/:versionId/test-qa`（`searchWikiHierarchy({ versionId })`，允许 DRAFT），不得把该限定并入生产 `/api/v1/ai/knowledge-qa`。 -->

<!-- 2026-08 二次优化增量：原文档导航模型（knowledge_document_assets 双源 / knowledge_toc_items 人工确认 TOC / knowledge_page_mappings 检索页→原文页映射 / pages 拆 physical_page_number+page_label）；转曲件 NO_TEXT_LAYER/SEARCH_SOURCE_REQUIRED + usageMode(AI_ENABLED/BROWSE_ONLY) 发布门禁；页面预览 pdf-page-renderer（concurrency=1）；块级 Section 归属 parsePageToBlocks；UPGRADE_PARSE 升级解析；B 端 assets/toc/page-mappings/usage-mode/upgrade-parse 路由；C 端公开文库 toc + pages/by-label。 -->

<!-- 2026-08 Wiki 层级知识体系改造增量：AI 来源契约统一 ai-source.mapper.ts；知识检索为 searchWikiHierarchy 层级检索（Section/Page/Block 优先，Chunk 辅助）；专业会话必须选保温体系（AI_INSULATION_SYSTEM_REQUIRED）；公开文库 /api/v1/client/knowledge/*、企业介绍 /api/v1/company/about（旧路径 /api/v1/client/content/enterprise-profile）；B 端通知 /api/v1/platform/notifications（system:notification:*）。 -->

正式生产检索中，同一版本存在 page-aware chunks 时必须排除 `metadata.source=DOCUMENT_TEXT` 且 `visualPage=false` 的 Mammoth 无页定位块；只有 B 端 DRAFT 测试可使用该文本回退，并将不可追溯标记返回调试结果。

# AI 与报告

最终交互与UAT（2026-10-07）：方案查询不因「限值/这个墙体」进入计算；明确算/重新算走热工，合规继续正式标准链，metadata验收intent区分COMPLIANCE。活跃厚度无metric词的省略追问更新厚度，取消厚度清除三字段及preferThinner。Parser/Matcher主结构冻结，后续自然语言变更须真实失败Case驱动。真实验收`pnpm uat:ai`覆盖销售20+设计院20共123轮，独立HTTP/SSE会话、临时库/用户/Redis队列/页图，工程条件/数值/来源程序断言，AI Judge只体验；BLOCKED不得冒充通过。类型与结构检查`pnpm uat:check`不是业务验收。详见`docs/ai/business-uat.md`。

日常表达与局部条件收口（2026-10-07）：指标定位、数字抽取、比较语义分开；在/控制在/要求/达到/做到/目标等连接词不决定模式。多轮 filters 按 metric 增改删，未提及条件保留，同 metric 默认替换（含 mode），仅明确再加范围条件可追加同指标边界；取消条件不得由旧摘要或模型重复参数复活。厚度精确档 thicknessMm、单边/双边 thicknessMin/thicknessMax 独立解析与持久化，签名覆盖三字段；放宽单边厚度继承原边界含义，取消厚度清除三字段。尽量薄只在满足硬条件后按厚度升序展示，不编造范围。所有条件变化重查正式已发布数据，纯参数/原页指代可复用。无数据库结构变化，Thermal Engine 与 Knowledge 流程不变。

2026-10-07 自然语言最终收口：规范比较词优先完整匹配；不应/不得大于与超过为上限，不应/不得小于与低于为下限，以上/以下为下限/上限。普通大于/小于采用包含边界的工程筛选。查询统一 filters[] 且全部 AND，单指标及旧 DTO 保留兼容摘要；多条件不明确时澄清。会话每项保存用户容差授权与 requested/effective/adjusted 元信息，后端调整需中文提示；仅模型传入的容差不生效。切规格清继承产品目录/型号，切型号清规格/目录，切目录清规格，切方案清继承规格/目录后重查发布关系。missingConditions 按归一条件判断，双 R 不要求 K。验收见 `docs/thermal/natural-language-closeout-2026-10-07.md`。

2026-10-07 指标统一：`metric=K|TOTAL_R|PRODUCT_R`、`targetValue`、`mode` 经过 `normalizeThermalLookupQuery` 同源匹配/距离排序。旧 API 裸 K 保留 MAX_LIMIT、旧总 R 保留 MIN_LIMIT；AI 首轮 APPROX，Tool 正式计算的 `mode` 保留，查表用 `lookupMode`。集中默认/最大近似容差为 K 0.02/0.05、双 R 0.05/0.2，精确查询固定 0.0005。AI Tool 忽略模型自由容差，只有用户原话明确 ±/上下容差可覆盖并 clamp；历史 USER 来源才允许继承。切体系清旧方案/依赖规格/产品，切型号/产品清规格，切方案清继承规格后查正式关系。TOTAL_R/PRODUCT_R 查询及来源状态完整保留；模糊「传热阻系数」无明确指标上下文则澄清。Answer Contract 与 Tool 的跨体系回退首句一致，近似/上下限筛选不等同规范达标。详见 `docs/thermal/lookup-closeout-2026-10-07.md`。

2026-10-07 参考查询收口：精确厚度不能放宽 K/型号/体系；模式优先级为本轮用户明确语义 → Tool 参数 → 历史 → 首轮 APPROX，冲突写中文 warning。候选类型与历史解析共用 Zod schema，完整保留双 R、来源页和正式字段；无候选也保存查询条件并支持厚度追问。只有纯参数/原页指代可复用历史；查询签名变化必须重新读取已发布有效数据。正式体系 ID 优先，名称归一保留材料/型号，跨体系回退首句必须说明未命中并在历史状态保留回退标记。

AI 模型按场景从数据库解析。服务商、Base URL、模型 ID 和提示词不能写死在业务代码中。DeepSeek 使用 OpenAI-compatible 适配器。

模型配置只负责身份、连接、是否参与图片输入、默认推理强度（`LOW`/`HIGH`/`MAX`）、启停、是否默认，以及准入测试状态。temperature / topP / maxTokens / 回答风格 / supportsTools / supportsAgent 不再由 B 端维护。正式 Runtime 只选择 `enabled=true` 且 `lastTestStatus=PASSED` 的模型。会话 `reasoningMode` 仍是 C 端 OFF/ON 开关；ON 时按模型 `reasoningLevel` 经 Adapter 映射，禁止静默降级，禁止把 `reasoning_content` 展示给用户。

密钥规则：

- API Key 使用 AES-256-GCM 加密保存。
- 加密主密钥只来自环境变量。
- 接口只返回 `hasApiKey`，不得返回明文、密文、IV 或认证标签。
- AI 配置和连通性测试属于 B 端后台能力，使用独立的 `system:ai:*` 权限码；超级管理员直通，其他 B 端账号必须拥有对应权限并写入审计。

对话围栏：身份状态、项目权限、Redis 频控、输入限制、工具白名单、知识范围、确定性计算、引用检查、输出检查、完整落库。知识资料视为不可信输入，不能执行其中的指令。

敏感词围栏（`ai_content_filters`，B 端 `/api/v1/platform/ai/filters`，权限码 `system:ai:filter:*`）：发送消息前对启用的词条做确定性校验（CONTAINS 包含匹配 / REGEX 正则，可指定生效场景或全局，非法正则配置时即校验拒绝），命中即拦截且不发模型请求；用户消息以 `BLOCKED` 状态落库（metadata 记录命中词条与匹配文本），同事务写审计 `ai.message_blocked`，返回 `AI_CONTENT_BLOCKED`（400 语义码）与词条自定义中文提示语。校验逻辑是纯函数（`src/modules/ai/ai-content-filter.service.ts`），词条在内存中匹配，不拼接用户输入构造 SQL。

会话自动标题：首条用户消息回答完成后投递 `ai-title-generation` BullMQ 队列（Worker 在 `src/workers/conversation-title.worker.ts`），模型与提示词走 `conversation_title` 场景解析链路（不写死模型）；仅当会话标题仍为空时条件写入，手动重命名后不覆盖，生成失败保持“未知对话”且不阻塞主对话，成功写审计 `ai.conversation_titled`。

存储会话、消息、模型参数、提示词版本、Token、耗时、失败、工具调用和检索来源。资料不足时使用中文说明不确定，禁止编造标准条文。

流式回答支持中途停止。停止请求只结束当前回答，已生成的部分内容保存为 `STOPPED`，原会话仍可继续发送新消息；不能把远程模型从中断位置精确恢复。深度思考是会话级设置，默认关闭，通过会话设置接口切换，每条消息保存实际思考模式。

会话历史支持分页、关键词、来源、项目和置顶筛选，并提供重命名、置顶、移动项目、软删除和恢复。项目分享使用 `PROJECT` 类型，只快照项目摘要和已发布报告，不开放源文件、知识库原文或原始会话。

AI 回答是可复用资产。点赞、反馈和重新生成不得覆盖原始回答；重新生成必须创建新的助手消息，并用关系表记录原回答和新回答。后台反馈查询从平台 AI 反馈模块进入。

报告流程：结构化 JSON -> 内部预置模板 HTML -> HTML/PDF/图片；结构化 JSON -> Word。普通调用只传 `reportType`，不传 templateId。AI 只生成草稿内容，内部模板决定版式，Worker 负责导出。多条 AI 回答生成报告时，使用 `report_sources` 保存来源顺序和回答快照。`reports.projectId` 可空，继承会话项目；无项目会话可生成独立报告（`requiresProject=false` 的类型）。公开项目仅开放已发布报告。聊天图片走 `ai_message_attachments`，Vision 只注入观察上下文。

公开分享只返回分享快照或报告文件临时下载地址。不得通过分享链接开放源文件、知识库原文或原始 AI 会话；匿名访问必须记录访问日志和次数。
- AI 业务接口和 AI 后台运营接口必须区分：C/AI 可以使用 `/api/v1/ai/*` 的业务能力，但不能访问 `/api/v1/platform/ai/*` 的运营详情、反馈和配置接口。
- AI 配置、运营详情和反馈查询使用独立的 `system:ai:*` 权限码；超级管理员直通，禁用角色权限立即失效。

## 客户端与详情权限校验

- `B_ADMIN`、`C_APP`、`PC_AI` 共用用户和令牌体系，但客户端类型必须由服务端校验，不能由前端参数伪造。
- 客户端访问令牌按客户端类型分别配置：`B_ADMIN` 默认 `24h`，`C_APP` 默认 `30d`，`PC_AI` 默认 `30d`；refresh token 统一默认有效 `30` 天。
- `/api/v1/platform/*` 和 `/api/v1/workspace/*` 先校验 JWT，再校验 `B_ADMIN`；C 端和 PC AI 端调用这些路径必须返回无权限。
- B 端每个查看、新增、修改、删除、导出、分配和运营接口都使用独立权限码，不允许用任意 `system:*` 作为模块级兜底；权限查询必须排除禁用角色。
- `/api/v1/ai/*` 是用户业务接口，不依赖后台 RBAC，但仍必须校验客户端来源、项目可见性、会话归属、文件归属和报告操作权限。
- 用户端会话详情只返回本人会话、消息、处理阶段、检索摘要、反馈、报告和分享信息；处理阶段可以展示“正在分析项目资料……”“正在核对标准和计算结果……”“正在整理回答……”等中文状态，但不返回模型原始思考链。
- B 端 AI 运营详情在具备 `system:ai:conversation:detail` 后可以查看用户、消息、检索记录、工具调用、报告任务、分享访问和关联审计日志，同样不得返回密钥或模型原始思考链。
- 深度思考是会话级开关，默认关闭；它与对外展示的处理阶段分开，消息保存实际 `reasoningMode`，不能把隐藏思考链当作用户可分享内容。

## 场景与提示词版本化（第一期）

- 场景建模：`ai_scenes`（能力门控 + 模型绑定 + `enabled`），提示词建模：`prompts` + `prompt_versions`（DRAFT/PUBLISHED/DISABLED，同 prompt 下 PUBLISHED 全局唯一）。旧 `ai_scene_bindings` / `prompt_templates` 已随迁移 0010 废弃。
- 普通管理员维护业务提示词 `GET/PUT /api/v1/platform/ai/business-prompts/:code`（BASE_CHAT / KNOWLEDGE_SEARCH / PROJECT_ANALYSIS / PRODUCT_CONSULTATION / THERMAL_CALCULATION / PRODUCT_COMPARE / REPORT_GENERATION / VISION_UNDERSTANDING），内部仍写对应场景的 `prompt_versions`；不要求理解 version/diff。业务 Prompt 只写该场景关注点。怎么说由 `GLOBAL_RESPONSE_POLICY`（约 11 条）和 Answer Contract 统一负责，怎么做由 `EXECUTION_POLICY` 负责。Prompt 不能覆盖知识检索权限、data scope、热工确定性引擎、Project Memory 隔离、Tool 权限、报告归属，也不能覆盖“不得暴露内部 Tool/Agent、不得暴露思考链、不得伪造来源”。不保留独立 Comparison/Thermal/Report Agent Prompt。 seed 不覆盖已发布业务 Prompt；新默认模板通过「恢复默认」写入。
- 仅 `general_chat` 作为 C 端默认入口（`visibility=USER`）；用户不选择场景/系统指令/Agent 类型。统一 Conversation Runtime：UI 动作优先于 ConversationTaskState，再才是 intent。`resolveAiCapabilities` 只做预路由、寒暄优化与非 Agent 回退注入；非寒暄时开放领域 Tool 集合（`search_knowledge` / `get_project_state` / `get_product_data` / `thermal`（`LOOKUP_CANDIDATES` / `CALCULATE`） / `compare_products` / `compare_solutions` / `generate_report`）。产品对比走 `compareProducts()` 动态维度，热工为 optional；查已有图集/参考方案走 `REFERENCE_LOOKUP`（先查已发布选用表，未命中再检索知识库图集原文），不得仅因「传热系数 / K值」进入 `THERMAL`。统一 `USER_SELECTION`（`KNOWLEDGE_SOURCE` / `REPORT_TYPE` / `PRODUCT`）确认后固化 `report_context_snapshots` 再排队生成报告。其余场景保留为 `INTERNAL`。
- 快捷提问独立表 `ai_quick_prompts`，不复用 Prompt / Scene。C 端只读 `GET /api/v1/ai/quick-prompts`；B 端 `/api/v1/platform/ai/quick-prompts`。`content` 必须是用户自然问题；`pnpm db:seed` 只覆盖仍带系统味的预置 4 条。
- 生产知识检索只覆盖 PUBLISHED + AI_ENABLED + 当前受控版本；无项目时只搜平台文档，有项目时平台 + 当前项目。草稿与无权限项目文档不得进入正式聊天。
- 热工 `REFERENCE_LOOKUP` 生成 `REFERENCE_PAGE` 时，只能签名当前、有效且文档未删除的 PUBLISHED Knowledge Version 页面；历史脏引用只记录 warning 并省略页面块，不中断其余结构化候选。摘要同时返回 `productThermalResistance` 与 `totalThermalResistance`，旧 `rValue` 仅兼容映射总热阻。
- 运行时解析链路：场景（须启用）→ 当前 PUBLISHED 提示词版本 → 按 `reasoningMode` 解析已准入模型（`enabled` + `lastTestStatus=PASSED`）→ 构造语言模型。禁止在业务代码写死模型 ID。采样与输出上限由 `getAiTaskRuntimePolicy` 决定，不读模型表 temperature/maxTokens。
- reasoningMode=ON：`allowReasoning=false` 抛 `AI_REASONING_NOT_SUPPORTED`；`reasoningModelId` 不可用降级默认模型并写入 `metadata.downgradeNote`；fallback 仅在主模型未产出任何 token 时重试一次。
- 上下文预算：`estimateTokens`（CJK/1.5 + ASCII/4）分桶裁剪（系统 / 项目档案 / 项目记忆 / 会话摘要 / 近期消息 / 工具与知识 / 当前消息）。项目/记忆/摘要继续完整参与判断，默认不复述到回答正文。即将裁剪时增量更新 `ai_conversation_states`。
- Agent：`ai_agent_runs` + 现有 `ai_tool_calls` 真实写入；`streamText`/`generateText` + `tool()` + `stepCountIs`；maxSteps / 重复 tool+input / timeout / cancel。`fullStream` 按 Step 缓冲，只有无 Tool Call 的最终 Step 进入 `userVisibleText`。WAITING_USER_INPUT 必须持久化 AI SDK `responseMessages`（assistant tool-call / tool result / assistant text），Resume 把用户选择追加到完整消息链，不得只追加 `fullText`。Tool `inputSchema` 必须是单一 `z.object`（可用 `enum` + `superRefine`），禁止 `z.discriminatedUnion` / JSON Schema `oneOf`/`anyOf`，避免 OpenAI 兼容网关卡住不吐流。停止接口必须立刻 `CANCELLED` 对应 Agent Run 并释放会话生成锁，不能只写 Redis 等模型流结束；`RUNNING` 超过 `AI_AGENT_OVERALL_TIMEOUT_MS` 在 GET 时标失败，避免 C 端无限轮询。
- 项目记忆：`project_ai_memories`，查询必须校验 projectId 与项目权限。
- 配额：Redis 并发（`ai:active:{userId}`，默认 2）+ 每日（`ai:quota:{userId}:{yyyy-mm-dd}`，默认 200），`SUPER_ADMIN` 豁免；`GET /api/v1/ai/quota` 查询额度。
- 错误码：统一 `AI_*` 常量（`src/shared/ai-errors.ts`），SSE error 事件、消息 `errorCode` 落库、运营查询三处共用；底层错误经 `toAiError` 映射。
- AI 调试（`/api/v1/platform/ai/debug/*`，`system:ai:debug:use`）：SSE 复用业务事件流，不落 `ai_messages`，写审计。
- 详细文档：`docs/ai/`（architecture、provider-model、scene-prompt、sse-protocol、error-codes、admin-api、client-api、security）。
