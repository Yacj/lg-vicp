# 正式方案 PDF：2026-10-14 分阶段实施记录

范围：Backend。没有修改 app/admin-web、业务数据、环境配置、数据库 schema/迁移、热工公式或知识资料。没有新增依赖。当前业务库只读；真实业务验收尚未执行。

## 阶段 0 / 本轮范围：最新源码与基线

1. 真实现状：`solution-state.service.actOnSolution` 已有 Final/Confirm/事务/不可变快照；`toSolutionDocumentModel` 已有纯转换；`assembleReportSnapshot`、`generateTemplateReport`、`createReportProcessor`、报告审核和下载已有实现。`report_templates` 的已发布有效模板是必需前提。
2. P0：通用 REST 与产品上下文可绕过正式确认快照门槛；授权只校验分类标签/evidence。P1：通用字段表不能表达完整工程章节；原表 renderModel 未被消费；Word/长图可阻塞 PDF；取消/重复投递/重启后的状态保护不完整。P2：可靠投递 outbox、长期产物清理和大批量失败任务分页属于后续优化。
3. 本阶段未修改业务代码；只读盘点延续上轮审计，执行了本轮测试基线。未引用历史 PASS 为本轮结果。
4. `pnpm exec vitest run src/modules/ai/solution-report.service.test.ts src/modules/ai/tools/generate-report.authorization.test.ts src/modules/reports src/workers/report-job-state.test.ts`：退出 0，10 文件/69 测试通过，失败 0、跳过 0。
5. 用户确认当前 `lg_vicp_backend.solution_snapshots=0`，不可用于写入式验收；本地无可用 Docker/psql 命令，尚未提供隔离 PostgreSQL/UAT 环境。PM2 配置包含 `lg-vicp-worker`，但本轮未启动/查询远端 PM2。旧审计的服务连通结果不作为本轮 UAT 通过证据。
6. 沿用现有报告类型、创建、详情、重试、审核、发布、下载及 report_queued SSE。
7. 最小下一步：在原创建服务收口本轮授权与有效 CONFIRMED Snapshot。

阶段0基线模块现状（修改前）：

| 模块 | 基线现状 | 真实路径 |
| --- | --- | --- |
| Confirm/不可变Snapshot | 已有 | solution.routes→actOnSolution→validateFinalSolution→来源验证/事务/触发器 |
| 本轮授权/正式入口 | 部分 | hasReportAuthorization→generate_report→generateConfirmedSolutionReport；通用REST未收口 |
| 快照/模板/排队 | 已有 | assembleReportSnapshot→reports/report_snapshots/async_tasks→report-generation |
| 专业工程正文/完整原表 | 缺失 | renderTemplateHtml为通用键值/英文列表；原图失败不消费renderModel |
| Chromium/存储/状态 | 部分 | createReportProcessor已有四格式与OSS；格式耦合、取消保护与状态恢复不足 |
| 审核/下载权限 | 已有 | report-review、report-access、reports.routes的发布门槛/短时下载；无独立报告预览 |

## 阶段 1 / 本轮范围：安全入口与幂等

1. `hasReportAuthorization` 复用 Domain Policy 的直接肯定请求/effect/置信度/完整原话证据或本轮服务端 UI 授权。分类标签、旧选择或 Tool 参数均不能单独授权。`loadConfirmedSolutionDocument` 在会话事务锁中验证客户端、本人、会话、项目、当前 CONFIRMED 状态、绑定 Snapshot、Final 与冻结事实。
2. 已收口 P0。正式类型仅 technical_scheme/project_brief；新建正式报告不可走旧 selection/产品 ReportContextSnapshot。已有 TEMPLATE/energy_design/design_note 等旧格式的生成和历史渲染保持兼容，不能由 AI 用作正式方案替代通道。
3. 实际改动：
   - `src/modules/ai/report-authorization.ts`：授权加强；移除开放 Regex 分类；报告类别只消费本轮结构化类型。
   - `src/modules/ai/ai-domain-semantic.ts`、`ai-domain-turn-decision.service.ts`：在现有分类合同中增加 reportType 正式枚举及提示，不新增路由器或词法规则。必要性：防止 Tool 将正式方案目标改写成材料报告绕开门槛。
   - `src/modules/ai/ai-generation.service.ts`、`tools/tool-runtime.ts`：本轮 UI 授权绑定已校验报告类别；必须当前action=GENERATE_REPORT，或当前confirmAction=GENERATE_REPORT且选项恢复校验成功，旧pending的generateReportNow布尔不授权。
   - `src/modules/ai/confirmed-solution-document.service.ts`：只读确认快照加载及完整性验证；与REST一致保留项目管理权限，当前项目读取只用于授权，不覆盖冻结工程/项目信息。
   - `src/modules/ai/solution-report.service.ts`、`tools/generate-report.tool.ts`：正式入口委托同一创建服务，失败给出稳定业务码；复用报告不提前发送完成事件。
   - `src/modules/reports/report-snapshot.service.ts`：正式类型由服务端加载 Snapshot；会话锁序列化相同快照/类型/创建者/当前报告项目绑定的创建，JSON 内冻结 solutionSnapshotId；重复请求复用已有 Report/Task。独立报告后来关联项目不作为独立上下文缓存。失败报告不自动重排队，走受控 retry。当前授权类别与实际创建类别须一致，旧上下文也不能把材料报告授权变为正式方案授权。
   - `src/modules/reports/reports.routes.ts`、`report-platform.routes.ts`：显式 HTTP 创建请求构成本轮 UI 授权，但仍经过本人会话与确认快照门槛；可传 solutionSnapshotId 校验期望快照；projectId/conversationId显式null兼容，无会话的正式报告仍拒绝。
   - `src/shared/report-errors.ts`：响应 details.errorCode 保留可识别业务码。
4. 定向阶段回归：退出 0，7 文件/132 测试通过，失败 0、跳过 0。覆盖授权、未确认、归属、Final、幂等、新快照、方案 REST/状态机与只读建议；使用 Mock/内存事务，不代表 PostgreSQL/BullMQ UAT。
5. 真实确认快照和隔离数据库仍缺失；没有修改当前业务库。
6. 创建响应兼容增加 solutionSnapshotId/status/reused。新建仅 QUEUED；重复请求返回实际已有状态。只有 pending 状态发送 report_queued，不在刚排队时发送 report_completed。
7. 最小下一步：用冻结 DocumentModel 生成中文工程正文及完整原表。

## 阶段 2 / 本轮范围：正式 PDF 文档与格式隔离

1. `renderTemplateHtml` 在原模板链上识别 DocumentModel，委托确定性方案章节；旧 payload 保持通用 HTML/Word 渲染。新方案仅要求 PDF，HTML 为可选调试产物。
2. 已处理 P1：Final/备选分组、产品 R/总 R₀/K/板厚/基层单位、缺项标注、无合规证据的“未进行地区/项目合规性核验”、冻结原表/optionId 高亮、印刷页与物理页分开。VICP-SHEET-1 不冒称客户图集来源。不存在 LLM 必需依赖或重算过程。
3. 实际改动：
   - `src/modules/ai/solution-document-model.ts`：保留 Final/选择 ID，加入未核验状态及来源缺失/计算样例/原页警告；仍为纯转换。
   - `src/modules/ai/solution-state.service.ts`：仅为未来正式 Confirm 的来源页冻结额外 docNumber/physicalPageNumber，不改已有快照或知识页。
   - `src/modules/reports/solution-document-render.ts`：封面、条件、Final 工程表、依据、备选、来源完整表/原页备注与警告、限制及免责声明。数值 String 原值展示，不加精度、不补零。HTML 全部转义；图片仅封闭 PNG/JPEG data URL。showSourceReferences控制完整附录，正文最低来源定位与风险警告仍保留。
   - `src/modules/reports/report-template-render.ts`：原入口兼容分支、原表支持和图片字节校验。
   - `src/workers/report-pdf.ts`：复用 Playwright Chromium；A4、页眉页脚/页码、已安装中文字体检查；禁用页面脚本、拦截外部网络；PDF 有限时保护和稳定错误码。
   - `src/workers/report.worker.ts`：仅新 report snapshot 的 outputPolicy=SOLUTION_PDF_V1 使用 PDF/HTML，不调用 Word/整页截图；PDF 优先登记，HTML 保存失败不阻塞 PDF READY；包括历史技术方案在内的旧报告继续四种格式。旧DocumentModel V1的solutions已有Final合同，只在相同追溯ID且无新策略标识时做字段兼容，不读聊天/DB猜Final；新策略缺Final必拒绝。
4. 本轮已执行 Fixture 真 PDF：本机 Edge Chromium、4 个 A3 构造、45mm、65 行额外未采用原表分页行，输出 7 页 A4/216352 字节；程序核对冻结字段和 Snapshot ID，Poppler 逐页 PNG 视觉检查通过。首两次尝试因禁用脚本页面上的异步字体/样式等待中断，已修正为同步字体检查，未算通过。最终复测结果见末尾验证表。
5. Fixture 不连接 DB/Redis/OSS，不代表真实 CONFIRMED 快照或业务验收；实际对象图片加载/原图、生产 Chromium/字体尚未验证。
6. formal technical_scheme/project_brief 可用格式为 PDF（HTML 尽力保留），客户端应读取 availableFormats。旧报告 Word/IMAGE 保留。
7. 最小下一步：状态恢复、受控预览下载及真实队列测试环境验收。

## 阶段 3 / 本轮范围：任务状态、审核与预览下载

1. 已复用 ReportSnapshot/BullMQ/OSS/report_artifacts；审核仍 READY→PENDING_REVIEW→APPROVED→发布。管理者可处理未发布报告，其他项目可见用户须已发布。
2. 已处理 P0/P1：先校验报告状态再领取；取消/删除/已完成/审核态/已发布任务跳过；任务 generationToken 与最新 taskId 共同保护写回；中间重试仍 GENERATING，终态事务更新 FAILED/审计/通知。丢失 failed 事件由启动及周期队列对账补偿。缺失 job 不猜测失败，不重建业务事实。
3. 实际改动：
   - `src/workers/report.worker.ts`：上述状态和 attempt 保护、产物 upsert、原图不可用警告、去敏错误消息与失败通知隔离；运行中取消/删除也结束当前任务为跳过，不影响新attempt。
   - `src/workers/report-job-state.ts`：终态事件补偿和已明确 failed 的队列任务对账。
   - `src/worker.ts`：接入失败事件、启动/周期对账，关闭时等待对账；报告日志不输出原始底层异常/凭据。
   - `src/modules/reports/report-generation.service.ts`：并发 retry 复用任务；只重渲染原 ReportSnapshot，不恢复/查询 Candidate；项目与本人管理权限重新验证。
   - `src/modules/reports/reports.routes.ts`：详情返回 solutionSnapshotId/任务摘要；实际 READY 文件决定 availableFormats；预览与下载共用权限，失效文件/失效项目拒绝；兼容generate与retry共用幂等重试服务。
   - `src/modules/reports/report-access.ts`：独立报告的超级管理员特权仅 B_ADMIN，C 端身份不继承。
4. 定向服务/路由/Worker模拟回归：退出 0，14 文件/119 测试通过，失败 0、跳过 0；后续完整验证见末尾。Mock OSS、内存事务及 Fastify inject 与真实 HTTP/队列/OSS 分开。
5. 尚未启动完整隔离 API/Worker，也未对 OSS 执行 PUT/GET 或对真实报告取下载地址。
6. API 对接：
   - `POST /api/v1/reports`：`{reportType:"technical_scheme"|"project_brief",conversationId,solutionSnapshotId?}`；请求中的 projectId 与会话项目须一致。不能提交 DocumentModel/授权对象/工程值代替快照。
   - `GET /api/v1/reports/:id`：`report`、`task:{id,status,progress,errorMessage}`、`solutionSnapshotId`、`availableFormats`。
   - `GET /api/v1/reports/:id/artifacts/PDF/preview-url`：短时内联预览；只允许 PDF/IMAGE。
   - `GET /api/v1/reports/:id/artifacts/PDF/download-url`：原下载接口、短时 attachment 签名。
   - `POST /api/v1/reports/:id/retry`：复用原报告快照；不更改正式方案。新建和重试均不等同于审核/发布。
   - B 端接口保留原 RBAC；正式 Snapshot 访问仍遵守既有会话客户端隔离，不能借他人或跨端会话绕过门槛。
7. 最小下一步：真实隔离环境从正式查询→选择→Final→Confirm→报告创建→Worker→审核/下载的 UAT。

## 阶段 4 / 本轮范围：验证与剩余验收

1. 静态代码、单元/模拟集成和本地 Fixture PDF 与完整业务 UAT 分开。所有“实现完成”结论仅指对应源码加本轮测试证据。
2. 环境 P0：没有授权隔离 PostgreSQL/UAT 库及真实 CONFIRMED Snapshot，真实业务闭环仍未验证。不能宣布整体完成。P2：提交成功但进程在 Redis 投递前退出的窗口由同快照重复请求以稳定 taskId 恢复；自动可靠投递/outbox 未引入。周期失败对账首版每批最多100条，长期大规模积压分页仍可优化。
3. 测试/工具文件：
   - 更新 `src/modules/ai/solution-report.service.test.ts`、`tools/generate-report.authorization.test.ts`、`solution-advice.service.test.ts`、`domain-semantic.fixture.ts`。
   - 更新 `src/modules/reports/report-snapshot.test.ts`、`solution-report-snapshot.test.ts`、`report-template-render.test.ts`、`report-access.test.ts`。
   - 新增 `src/modules/ai/solution-report.fixture.ts`、`src/modules/reports/solution-document-render.test.ts`、`solution-report-generation.test.ts`、`report-download.routes.test.ts`、`src/workers/report.worker.test.ts`、`tests/helpers/report-memory-db.ts`。
   - 新增 `scripts/check-solution-pdf-fixture.ts`：仅写本地 Fixture PDF/HTML/检查摘要，绝不连接 DB/Redis/OSS。
   - 同步本说明、AGENTS.md、README.md、报告 README、Cursor 报告规则及 skill reference。
4. 验证记录见下表；失败尝试保留，不与后续修复后的通过混淆。
5. 运行前置：已发布有效 standard_report/project_brief；Worker 的 Chromium 可执行路径及中文字体；隔离 Redis/BullMQ（不同 DB/实例及队列）；独立 PostgreSQL；OSS 独立前缀/测试凭据；合法测试用户及正式流程创建的真实 CONFIRMED Snapshot。当前业务库禁止测试写入，模板不可自动发布/覆盖。
6. 前端无需代码修改；预览接口为兼容扩展，实际格式以服务端返回为准。不得把 Fixture PDF 提供为客户正式方案。
7. 尚需隔离环境验证：真实数据库会话锁/并发/触发器；真实 HTTP/SSE 授权与只读零副作用；Bull Worker 消费及重启/重试；OSS PUT/HEAD/GET；原页图片/页码；本人及项目权限预览下载；提交审核、通过、发布后可见性。Snapshot 必须通过既有正式查询/选择/Final/Confirm 产生，不直接插入。

## 本轮最终验证表

| 检查 | 实际结果 |
| --- | --- |
| 首次全量 `pnpm test --maxWorkers=4` | 退出1：2214通过、2失败、1跳过。新增静态AI加载引发旧报告上下文测试环境依赖；修为正式路径惰性加载 |
| 该问题定向重跑 | 退出0：3文件/27通过，失败0、跳过0 |
| 第二次全量 | 退出0：197文件通过、1文件跳过；2216通过、1跳过，失败0 |
| 最终源码全量 `pnpm test --maxWorkers=4` | 退出0：197文件通过、1文件原有跳过；2229通过、0失败、1原有跳过（总2230）；最终复跑耗时120.49秒 |
| 最终 `pnpm lint` / semantic AST / TypeScript | 退出0；AST为10个关键文件/30个现有白名单表达式。已修复Worker联合类型、真实任务状态枚举和可选filter.mode类型问题 |
| 最终 `pnpm build` | 退出0；仅本地dist构建，未部署或重载进程 |
| `pnpm db:check` | 退出0，静态迁移一致性检查；未执行迁移 |
| 最终 Fixture PDF / Poppler | Fixture脚本退出0，7页A4/216364字节、4候选事实核对；Poppler退出0，末轮7页PNG均与已检查版本像素相同；不代表业务UAT |
| 最终 `git diff --check` | 退出0；未变更package.json/lockfile/schema/迁移；app/admin-web的既有未跟踪文件未触碰 |
| 隔离完整业务流程、真实HTTP/SSE、BullMQ消费、OSS上传/下载 | **未执行 / 环境阻塞**，无真实确认快照、无授权隔离环境；没有拿Mock替代 |

可复现Fixture命令（仅本地，无业务写入）：

```powershell
pnpm exec tsx scripts/check-solution-pdf-fixture.ts --chromium '<本机Chromium可执行路径>' --output '<本地Fixture产物目录>'
```

初次测试框架运行由 pnpm 自动补齐 lockfile 已列出的开发包；package.json 与 pnpm-lock.yaml 无变更，没有新增依赖。整个任务未启动生产 Worker、未部署、未打印/提交环境凭据或签名下载地址。
