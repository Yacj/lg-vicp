# 筑小格 C 端 H5 + Backend UAT 复测记录

日期：2026-10-15（香港时间）。按用户本轮补充，前端范围为 **H5**，不包含 Android/iOS 真机或微信小程序。账号：152****4975。

**本轮结论：不通过完整发布验收。正式方案确认及 PDF 主干可用，但自然语言验收被模型 503/超时阻塞，H5 还有确定可复现的正文空白缺陷。不能将自动测试或 REST 补测记作整本自然语言 UAT 已通过。**

## 基线与隔离

- App / Backend 共用仓库 HEAD：`5719bac5327ccaa8718c47c391507fba1644041d`，以当前本地代码执行，没有部署服务器。
- 依据用户粘贴的《C 端对话与正式方案报告 UAT 测试手册》执行；上次记录保留在 `c-uat-real-20261014.md`，没有覆盖历史结果。
- 仅以只读事务读取源库，创建本轮 UUID 随机隔离数据库；迁移、测试登录、会话、用户 B、方案、Snapshot、报告、审计都写入隔离库。
- Redis 应用键、BullMQ 队列及报告 OSS 对象使用本轮 UUID 前缀。原知识页对象只读，上传能力关闭，禁止删除源对象。
- 本地 API：`127.0.0.1:3300`；本地 H5：`127.0.0.1:5173`。原配置文件未改。
- 知识基线复核：79 页、161 Chunk、3 个报告模板；知识页 metadata 与源库逐页结构比较一致。`standard_documents` 和 `thermal_standard_limits` 均为 0。
- 用户同意仅在本次隔离测试中完成 H5 登录页协议勾选。密码、JWT 和完整签名 URL 没有保存到报告或证据文件。

## 自动检查

| 检查 | 本轮实际结果 |
| --- | --- |
| App `pnpm test` | 139 通过，0 失败 |
| App `pnpm build:h5` | 通过 |
| App `pnpm type-check` | 失败：17 项诊断；与上次记录数量一致，本轮未改业务代码 |
| App `pnpm lint` | 失败：48 项诊断；与上次记录数量一致 |
| Backend `pnpm test` | 2259 通过，1 跳过；199 个测试文件通过，1 个文件跳过 |
| Backend `pnpm lint` | 通过，含语义 AST 检查与 TypeScript |
| Backend `pnpm build` | 通过 |

类型/lint 的数量一致不代表逐项自动比对过全部历史诊断；以本轮日志为准。139 项 App 测试也没有发现下述真实 H5 组件注册问题，不能代替浏览器验收。

## 自然语言脚本：16 轮实际执行，37 轮未执行

手册中 12 组纯对话脚本共 53 轮。本轮实际 HTTP/SSE 及持久化消息核对到 16 轮，全部为 `BLOCKED`：UAT-01 四轮、UAT-02 五轮、UAT-03 六轮、UAT-06 第一轮。余下 37 轮为 `NOT_RUN`，不是通过。另有一次 H5 独立发送同样的四基层问题，不混入这 53 轮。

每组使用新会话，组内连续发送。实际业务答复均为：

> 想确认一下：请指定这轮要讨论的保温体系或实际基层；可以先整理参考选型框架。

持久化诊断为 `parserSource=UNAVAILABLE`、`policyReason=SEMANTIC_UNAVAILABLE`、`domainIntent=CLARIFY`、`mutation=NONE`；没有正式候选或原页事件。16 轮完成态不能理解为业务回答正确。

真实 AI SDK 探针可以解析、解密场景运行配置，但首次请求得到上游 HTTP **503**（Service is too busy），最后复查又达到现有 **12 秒**语义超时。数据库只有一个启用且已准入的 `deepseek-chat`，general_chat 的 fallback 仍指向同一个模型。没有换模型、改密钥或降低授权门槛。

因此本轮不能重新验证最低 K、自然语言厚度继承、否定意图、口语纠错、概念/产品咨询、合规对话等业务表现。持续同一基础设施故障后停止剩余自然语言请求，继续执行独立 REST / H5 / Worker 检查。

## 正式方案与 PDF：真实接口 + H5 接续

为独立验证后半链路，使用现有 REST 接口显式开始方案，以完整查询条件绑定当前已发布 AI_ENABLED 知识文档/版本。候选来自真实确认页，没有伪造 Candidate、Snapshot、工程数字或成功状态。**这项补测不能替代“从自然语言首问到 PDF”的端到端通过结论。**

| 检查 | 实际结果 |
| --- | --- |
| 45mm 四基层 | PASS：四条齐全，K=0.302 / 0.294 / 0.293 / 0.248；基层、基层厚度与双 R 同条一致 |
| 改 18mm | PASS：四条；A3-2 R=1.200、R₀=1.598、K=0.626 |
| 改 999mm | PASS：0 条候选，没有捏造档位 |
| 恢复 45mm | PASS：恢复四条，revision 按 1→2→3→4 更新 |
| SELECT / COMPARE / SET_FINAL | PASS（API）：选 A3-2、A3-4；仅比较已选；Final 仅 A3-2 |
| 旧 expectedVersion | PASS：拒绝，`SOLUTION_VERSION_CONFLICT` |
| Final 尚未确认 | PASS：Snapshot=0、Report=0 |
| H5 恢复工作区 | PASS：四候选、已选二条、最终一条可恢复；对比显示二条，但缺基层展示，见 F04 |
| H5 点击“确认生成方案” | PASS：创建真实 CONFIRMED Snapshot；Snapshot=1、Report=0，没有自动出报告 |
| H5 点击“生成技术方案 PDF” | PASS：创建 technical_scheme，Worker 最终 COMPLETED/100%，报告 READY、publishedAt=null |
| 离开对话进入报告中心 | PASS：找回同一报告，显示“报告已生成 · 未发布” |
| 两个并发重复创建请求 | PASS：均 reused=true、同一 reportId，technical_scheme 总数仍为 1 |
| PDF 预览/下载 API | PASS：实时 HTTPS 签名；均 HTTP 200；同一 1,877,874 字节有效 PDF，预览 inline、下载 attachment |
| PDF 内容与冻结事实 | PASS：A3-2 最终与 A3-4 备选的构造、基层、基层厚度、保温厚度、R/R₀/K 逐项一致 |
| PDF 版面 | PARTIAL：7 页中文可读，两张完整原页图、最终采用行高亮；页码数据错误、尾部分页见 F03/F06 |
| 浏览器 PDF 阅读/保存 | BLOCKED：H5 预览打开后，内置浏览器 URL 安全策略拒绝观察；没有换浏览器或绕过限制，不能判阅读器/保存通过 |

最终采用 A3-2：45mm、190mm 混凝土空心砌块、R=3.000、R₀=3.398、K=0.294。备选 A3-4：45mm、200mm 加气混凝土砌块、R=3.000、R₀=4.040、K=0.248。

## 权限、状态与故障

15 项报告/权限独立探针全部通过，详见 `report-proof.json`：已确认报告创建、READY 未发布、幂等、PDF 字节，以及真实用户 B 对 A 的会话、方案、Snapshot、报告、预览签名、下载签名和代建报告的拒绝。未登录/无效令牌、未经审核的发布也被拒绝。

当前错误处理器采用 **HTTP 200 + error.code=401/403/404** 业务包络；未登录/无效令牌实际 `success=false,error.code=401`。初始探针要求传输层 HTTP 401 过严，已依据现有接口合同修正；没有把已泄露数据的结果改称通过。

| 额外边界 | 实际结果 |
| --- | --- |
| 未 Confirm 创建正式报告 | PASS：拒绝，`SOLUTION_SNAPSHOT_REQUIRED` |
| 新会话方案隔离 | PASS：GET solution 为 null；拿旧会话 stateId 到新会话 Confirm 被 404 拒绝 |
| Snapshot 数据库不可变 | PASS：真实 PostgreSQL 触发器拒绝 UPDATE / DELETE；探针均在回滚事务中，快照仍存在 |
| 短效 URL 实际过期 | PASS：1 秒测试签名初次 200，4 秒后 403/AccessDenied，重签 200；签名值未落盘 |
| Worker 故障 | PASS：仅本轮队列把真实 project_brief 作业移至专用故障 Worker，Chromium 路径设为不存在文件；复用原处理器，报告/任务真实 FAILED |
| H5 故障显示及重试 | PASS：显示生成失败和重试按钮；点击“重新生成”后同一 reportId 恢复 READY，最新任务 COMPLETED/100%，旧失败任务保留 |
| 重试、幂等后冻结事实 | PASS：Snapshot payload 与确认时完全一致；没有自动发布 |

Worker 故障是明确的隔离基础设施注入，不是自然发生的业务失败；没有 Mock 报告处理器或预置 FAILED 数据。该额外 project_brief 使本轮最终报告总数为 2（两种类型），Snapshot 总数仍为 1。不能把它误记为同类型重复报告。

尚未执行：H5 实际主动断网/重连、H5 生成按钮快速双击、真实 500 的用户界面处理、审核通过/发布正向流程、退出登录后的完整重新登录恢复。并发 API 幂等不替代按钮双击；只读权限负例也不替代完整审核发布验收。

## 缺陷与阻塞清单

### F01｜P1：H5 AI 正文为空白

复现：登录隔离 H5 → 发送四基层问题 → 等待 SSE 完成 → 刷新恢复会话。后端已保存非空澄清正文，前端只显示空白灰色气泡和操作图标。

浏览器控制台：`Failed to resolve component: mp-html`。DOM 实读 `<mp-html content="<p>想确认一下…</p>">` 为未解析元素，children=0、textContent 为空。定位 `src/components/ai/AiMessageList.vue:321`；组件自动导入/uni_modules 注册路径需排查，不能只调整回答文字。证据：`h5-empty-answer.jpg`、`h5-console.json`。

### F02｜P1：模型不可用被包装成缺少业务条件

上游 503/超时本身为环境阻塞；服务端仍以正常完成态返回“请指定保温体系或实际基层”，而用户已给出Ⅲ型、45mm。问题在 `ai-domain-turn-decision.service.ts:55` 的不可用降级语义及 UI 提示，不能据此认定候选匹配算法再次坏了。应明确提示服务暂不可用/可重试，并保留可诊断标识。

### F03｜P1：知识标签与原图印刷页码不一致，PDF 延续错误标签

物理页 5/6：pageLabel=5/6、verified=true；逐页原图实读的印刷页次为 **25/26**。本轮 PDF 写“印刷页 5/6”，同一 PDF 内嵌原图却显示 25/26。事实冻结一致不代表来源标签正确。需要资料侧以新草稿核验修订；本轮没有改生产标签，也没有让 App/PDF 猜改快照。

证据：`source-check.json`、`source-page-5.png` / `source-page-6.png`、`pdf-verification.json`、PDF 第 2/4/6 页渲染。

### F04｜P1：H5 候选和比较卡没有展示基层及基层厚度

真实 API 包含 A3-2 的混凝土空心砌块 190mm 与 A3-4 的加气混凝土砌块 200mm；H5 比较区只显示体系、构造、板厚、双 R/K、来源，没有这两项决定适用前提的事实。候选卡也相同。定位 `AiSolutionComparisonCard.vue:23`、`AiSolutionCandidateCard.vue` 及 `SolutionCandidate` 客户端投影。不得让用户将最低 K 误解为可以任意换墙体。

### F05｜P1（本次浏览器复现，原因未定）：原页图片加载失败

H5 点 A3-4“查看参考页”定位到正确 pageId/optionId，但显示“图片加载失败”；手动重试后仍失败，控制台为 `getImageInfo:fail`。相同源对象用后端 OSS SDK 可读，实时 HTTPS 签名 HTTP 200、PNG 文件有效。不能将该结果归为源对象不存在；也尚不能排除内置浏览器环境因素。定位 `useReferencePageImage.ts:9` 及来源详情到图片读取链路。

证据：`h5-source-error.jpg`、`h5-console.json`、`source-check.json`。本轮没有通过 H5 原页图/高亮验收；PDF 内嵌两张完整原图通过是独立结果。

### F06｜P2：PDF 风险条目跨页，末页留白较多

第 6 页末尾为“风险与限制”首条，第 7 页顶部续第二条，再显示免责声明；中文与内容未丢失，可优化章节分页。另有 App 17 项类型诊断和 48 项 lint 诊断待治理，均不能记作门禁通过。

## 手册全范围对应

| 手册 | 本轮覆盖与限制 |
| --- | --- |
| UAT-01 | 4 轮 BLOCKED；完整条件 REST 的四条事实通过，H5 正文 FAIL |
| UAT-02 | 5 轮 BLOCKED；18/45mm 完整条件 API 通过，不能证明自然语言继承通过 |
| UAT-03 | 6 轮 BLOCKED；普通对话没有自动创建 Snapshot/报告，但建议内容未验收 |
| UAT-04 | PARTIAL：真实 REST 选择/Final + H5 Confirm 通过；自然语言选用入口受阻，基层显示缺失 |
| UAT-05 | PARTIAL：真实 H5 创建、Worker、中心恢复、API 文件、幂等通过；页码 FAIL，浏览器 PDF 阅读/保存 BLOCKED |
| UAT-06 | 第 1 轮 BLOCKED；余 3 轮 NOT_RUN |
| UAT-07 | 4 轮 NOT_RUN；上游持续不可用 |
| UAT-08 | 4 轮 NOT_RUN；未验证真实计算/算法解释 |
| UAT-09 | 3 轮 NOT_RUN；标准/限值仍为零，报告正确保留未核验警示，不替代对话验收 |
| UAT-10 | 5 轮 NOT_RUN；补测 query revision 更新和旧 version 拒绝通过，序号自然语言绑定未验收 |
| UAT-11 | 5 轮 NOT_RUN；未 Confirm 报告门禁独立通过，不替代否定语义验收 |
| UAT-12 | 5 轮 NOT_RUN；没有进行 H5 主动断网恢复 |
| UAT-13 | PARTIAL：A/B 真实权限、URL 过期、新会话 state 隔离通过；跨会话口语指代与退出重登未执行 |
| UAT-14 | PARTIAL：并发幂等、真实 Worker 失败和 H5 retry、READY/发布分离通过；断网、按钮双击、500 未执行 |
| UAT-15 | 4 轮 NOT_RUN |
| UAT-16 | 4 轮 NOT_RUN；999mm 完整条件 API 无命中通过，不替代自然语言证据边界验收 |

上述组别状态含补测与限制，不能相加作为 53 个对话轮次的统计。53 轮的唯一逐轮表为 `uat-matrix.json`：PASS=0、PARTIAL=0、FAIL=0、BLOCKED=16、NOT_RUN=37。另有明确 H5 FAIL 与资料 FAIL，故整体仍不通过。

## 证据与清理

本轮本地证据目录：

`C:/Users/admin/.codex/visualizations/2026/10/15/01a13d15-1b5d-7bc2-8259-e164bbf59a66/uat-retest/`

关键文件：`uat-matrix.json`、`audit.json`、`conversations-reviewed.json`、`query-assertions.json`、`integration.json`、`report-proof.json`、`boundaries.json`、`expiry.json`、`worker-fault.json`、`pdf-verification.json`、`model-diagnostic-initial.json` / `model-diagnostic.json`、H5 截图、7 页 PDF 渲染与原始检查日志。测试脚本和 PDF 留在证据区，不作为业务源码提交。

一次性采集脚本初期使用了不存在的 tool-call status 列；已按真实 success 列修正，并从原持久化消息/工具补齐证据，没有重发问题或将采集成功当业务通过。最后一个未写入 runner 文件的 UAT-06 回答已由 `audit.json` 恢复，故实际计 16 轮。

清理结果见证据目录 `cleanup-proof.json` 与 `cleanup-verification.json`。仅清理本轮创建的随机数据库、队列前缀和报告对象；不清理源知识库、源账号或其他用户数据。H5 生成配置恢复，业务代码没有修改；本轮只新增此复测文档。

09:35（香港时间）完成实际复核：随机数据库不存在、Redis 本轮主/故障前缀剩余 0 键、4 个本轮 PDF/HTML 对象全部不存在，API/H5 监听已停止。源库上述基线计数保持一致。54 个文本证据文件扫描未发现提供的明文密码、JWT 或完整 OSS 签名参数；扫描范围和结果见 `redaction-check.json`。

后续优先级：先恢复可用模型并修复 H5 正文注册，再处理基层展示与来源页码，查清图片读取失败；随后从 UAT-01 重新执行完整连续脚本，并补齐浏览器预览/下载、断网、双击和 500。当前结果不具备“全 P0 PASS、无 P0/P1 未关闭问题”的发布条件。
