# C 端正式方案 PDF：阶段 0–2（2026-10-14）

仅修改 App。阶段 0 静态核验后，用户明确确认继续阶段 1/2；本轮在阶段 2 完成后暂停。Backend、数据库、OSS、报告中心与文件打开服务未修改；未执行写入型 E2E 或真实业务 UAT。

## 阶段 0：当前源码契约

| 已实现 | 缺失 | 协议不一致 | 可复用 |
| --- | --- | --- | --- |
| Final/Confirm/不可变 Snapshot | 工作区独立生成 PDF 按钮 | App 创建 DTO 缺 solutionSnapshotId | AiSolutionWorkspace、createSolutionActions |
| POST reports 的确认快照校验与复用 | 按钮到 App store 创建动作 | 创建结果缺 status/reused/solutionSnapshotId | reportApi.create、现有 request |
| GET reports/:id 的任务与实际产物格式 | task/Snapshot 消费 | ReportDetail 缺 task；contentJson 未允许 null | sessionReport、现有轮询与任务卡 |
| 受控 PDF preview-url/download-url | App preview 方法、阶段 3 文件 UI | READY 不代表 PDF 或发布；REJECTED 被旧映射当生成中 | 原下载方法、类型目录、openOriginalFile |
| 报告中心分页/过滤/旧 JSON 详情 | 阶段 3 PDF 详情与列表状态 | publishedAt 在 report 内；my 列表未返回产物格式 | 现有两个页面与 ReportListCard |

Backend 正式类型是 technical_scheme/project_brief。POST 的 Snapshot 参数在后端为可选，但本轮 App 显式入口始终传当前服务端 confirmedSnapshotId；不提交 projectId/contentJson/selectedProductIds。Backend 继承会话项目，重新验证本人、同端、会话、项目、当前 CONFIRMED、Final 与 Snapshot 归属。新建/重试均不自动审核或发布。

GET 详情的 task 状态为 QUEUED/ACTIVE/COMPLETED/FAILED，不能复用报告状态枚举。availableFormats 只表示当前有效文件。publishedAt 位于 report 内。正式模板正文 contentJson 可为 null；旧创建响应没有新扩展字段，DTO 保留兼容。

## 修改文件

| 文件（均位于 App） | 作用 |
| --- | --- |
| src/api/types.ts | Snapshot、nullable 正文/入参、任务摘要、创建/重试结果扩展 |
| src/api/modules/reports.ts | 复用 request 新增 PDF/IMAGE preview-url 方法 |
| src/utils/aiReportTask.ts | 纯函数构造正式创建请求、映射响应与区分生成/任务/审核/发布/文件可用性 |
| src/utils/aiAgentUi.ts | 扩展现有 SessionReport 元数据；导入路径与项目约定对齐 |
| src/store/solution.ts | 在既有 assistant 动作工厂内追加创建；锁、归属与请求 revision 保护 |
| src/store/assistant.ts | 依赖接入、复用 sessionReport/轮询、消费真实 retry 状态、报告消息归属、账号重置保护 |
| src/utils/aiSolution.ts | 启动恢复清除创建锁/错误/请求 revision，不缓存 Snapshot |
| src/utils/aiUserSelection.ts | GENERATE_REPORT、PRODUCT、REPORT_TYPE 不静默自动继续 |
| src/components/ai/AiSolutionWorkspace.vue | 显式“生成技术方案 PDF”、严格可用条件与创建失败消息 |
| src/pages/assistant/index.vue | 登录后按钮调用，传创建锁/错误与会话忙碌状态 |
| src/components/ai/AiReportTaskCard.vue | 创建后立即可跳详情；任务进度、生成错误、审核及发布独立展示 |
| src/auto-imports.d.ts | 自动生成的纯函数声明；移除生成过程中残留的测试导出 |
| src/test/fixtures/report.ts | 报告 Mock Fixture，不属于正式报告数据 |
| src/utils/reportContract.test.ts | 请求/响应、精确 API 路径、负例、状态分离与恢复锁 |
| src/store/solution-report.test.ts | Confirm 后主动创建、复用、失败、防重、归属与上下文竞态 |
| src/store/assistant-report.test.ts | 执行真实 assistant store，Mock 网络/计时器验证同一任务/轮询/消息与账号隔离 |
| src/components/ai/AiSolutionWorkspace.test.ts | 真实 SFC 按钮、无快照/非确认/忙碌门禁及零自动事件 |
| src/components/ai/AiReportTaskCard.test.ts | 真实 SFC 的任务/审核/发布/失败展示 |

未增加第二个生产 store、网络客户端或轮询循环。project_brief 可选入口暂未添加。Backend 的既有自然语言授权与 SSE 协议未改；本轮新正式创建入口由按钮调用 REST，不增加关键词路由。

## 新增行为

- Confirm 只保存方案；生成按钮独立调用 POST /reports。无有效服务端会话或 confirmedSnapshotId、非严格 CONFIRMED、会话忙碌、方案动作进行中、创建请求未结束时不提交。
- 请求固定为 {reportType:'technical_scheme', conversationId, solutionSnapshotId}。项目关联只消费 Backend 返回值。
- 同快照重复请求沿用 Backend reportId/taskId/status/reused；READY/FAILED 不被改为 QUEUED。请求失败显示原错误，允许用户按原 Snapshot 再次点击。
- 修订/新建方案点击即失效旧创建；换 Snapshot/会话/账号或退出后同账号重进也拒绝迟到成功/失败。旧请求不会释放新请求锁。
- 任务卡复用 sessionReport。只有 report.status 决定生成/审核；task 只提供任务进度；publishedAt 单独展示；PDF 可用性仅由 availableFormats 决定。
- 按钮生成不绑定聊天消息，不覆写普通工程回答；旧 SSE 报告只更新其对应消息。
- 页面隐藏及会话/账号切换期间的迟到轮询不回写、不再次安排计时器。失败 retry 仍按原 reportId 消费服务端实际状态。

## 本轮实际检查

| 命令 | 实际结果 |
| --- | --- |
| node --import ./scripts/register-test-loader.mjs --test src/utils/reportContract.test.ts src/store/solution-report.test.ts src/store/solution.test.ts src/components/ai/AiSolutionWorkspace.test.ts src/utils/aiReportTask.test.ts src/utils/aiUserSelection.test.ts | 首轮定向 32 项通过、0 失败；后续新增竞态/真实 store Mock 用例纳入全量 |
| pnpm test | 最终 105 项通过、0 失败、0 跳过；44.20 秒；全部为本地测试，非真实联调 |
| pnpm type-check | 退出 2；最终 17 项存量错误（基线 18），本轮修改/新增文件没有类型诊断 |
| pnpm lint | 退出 1；48 项存量错误（基线也是 48），逐项错误与基线相同 |
| pnpm exec eslint（上述修改/新增 TS/Vue 文件） | 通过；0 错误/警告；最后账号隔离修复对应文件再次通过 |
| pnpm build:h5 | 最终退出 0；仅本地 H5 production 构建；有既有 Browserslist 提示 |
| git diff --check（本轮业务文件） | 通过；构建引起的 pages.json 变化恢复为构建前内容 |

第一次新增回调造成 Pinia 循环类型推断，已补返回类型并复验；不作为最终通过结果。基线 aiAgentUi.ts 的 .ts 导入类型诊断在该文件接入元数据时修复，18→17 不是忽略错误。

剩余类型错误：依赖 wd-button.vue 1、src/pages/login.vue 1、src/utils/aiSource.ts 1、src/utils/aiStream.ts 2、src/utils/markdown.ts 11、src/utils/wechatPhoneLogin.ts 1。

存量 lint 错误文件：ReferencePageViewer.test.ts（15）、useReferencePageHighlight.test.ts（7）、profile/index.vue（1）、reference-table/index.vue（1）、services/platform/index.ts（2）、manualThemeStore.ts（4）、fixtures/referencePage.ts（5）、aiComparison.ts（4）、aiStream.test.ts（1）、aiUserSelection.test.ts（2）、referencePage.test.ts（2）、referenceTable.test.ts（1）、wechatPhoneLogin.test.ts（1）、vite.config.ts（2）。共 48 项，本轮未扩展清理范围。

完整日志目录：C:/Users/admin/.codex/visualizations/2026/10/14/01a13969-ec0c-7643-912f-8628b674819e/report-phase12/。包含修改前基线、最终 test/type-check/lint/changed-files-lint/build-h5 日志。

## 尚未验证与阶段 3

本轮没有实际生成正式 PDF、预览或下载，没有运行 Backend 测试，没有访问真实 Postgres/Redis/BullMQ/OSS，没有执行 H5 浏览器视觉验收或 App/微信小程序真机验证。Mock 验证不代表队列幂等、数据库锁或真实权限联调通过。

下一阶段需要用户确认后实现 report-detail 的独立详情状态与 PDF 预览/下载、生命周期刷新、旧 JSON 兼容、reports/ReportListCard 的列表状态与返回刷新，以及 openOriginalFile 的平台失败处理。preview-url API 方法已备好，但当前详情仍为旧 JSON 页面，点击“查看报告”尚不能阅读正式 PDF。

没有发现需要修改 Backend 的阶段 1/2 契约缺口。阶段 3 的 App 功能等待确认；真实 UAT 仍需授权隔离 Postgres+Redis/BullMQ+OSS、正式 Confirm 生成的真实 Snapshot。UAT 必须核对真实知识原页、构造、基层、板厚、产品 R、总 R₀、K，前端不得补算。
