# C 端正式方案 PDF：阶段 1–3 复核与阶段 4 本地验证

日期：2026-10-14。以当前 App 与相邻 Backend 源码为准。阶段 1–3 主链符合契约，但复核发现异步与错误处理边界问题，已在 App 内修复。阶段 4 的本地测试已实施；真实业务 UAT 尚未执行，不能据此宣布整个 PDF 服务链验收通过。

## 静态契约复核

核验 App：reports API、types、solution-types、assistant 页面与 store、solution 动作工厂、AiSolutionWorkspace、aiReportTask、AiReportTaskCard、report-detail、reports、ReportListCard、useReportDetail、openOriginalFile。对照 Backend：reports.routes、report-snapshot.service、report-types、report-review.service、confirmed-solution-document.service；补读报告 retry、错误包络和文件平台官方文档。

| 已实现 | 缺失 | 协议不一致 | 可复用 |
| --- | --- | --- | --- |
| Final → Confirm 返回服务端确认快照；工作区有独立 PDF 按钮 | 真实知识候选及快照的隔离 UAT 证据 | 未发现正式创建路径或 DTO 差异 | AiSolutionWorkspace、solution 动作工厂 |
| 创建固定提交 technical_scheme、conversationId、solutionSnapshotId | Backend 并发幂等的运行证据 | Backend 参数可选，App 正式入口强制提供；属于更严格客户端门禁 | reportApi.create、既有 request |
| 防重复点击、失败可再次提交、reused 沿用 reportId/taskId | 无须新增 store 或接口 | 创建归属校验原先未覆盖类型和创建人，本轮补齐 | sessionReport、原报告轮询 |
| 任务、报告、审核、发布、PDF 格式分别展示 | project_brief 独立按钮为可选项，当前未添加 | READY、task.COMPLETED 都不能替代 availableFormats；现有展示满足 | aiReportTask 纯函数、任务卡 |
| 正式 PDF 详情以 GET reports/:id 为状态源；旧 JSON 保留 | 真机阅读器、实际签名 URL 行为证据 | preview/download 路径与响应一致 | useReportDetail、report-detail |
| 每次文件操作即时签发；H5 窗口、App/微信临时文件打开与保存 | H5 导航后远端 403 无法由跨域页面自动回报；需用户再次点击重取 | 原生 401/403 最多续签一次；切账号后的续签本轮取消 | openOriginalFile |
| 列表分页、筛选、下拉刷新、返回恢复与独立发布状态 | 列表接口本身无 publishedAt/availableFormats | publishedAt 已通过既有详情补充；失败保持未知，不猜未发布 | reports、ReportListCard、readReportListStatus |

正式请求为 `{ reportType: 'technical_scheme', conversationId, solutionSnapshotId: confirmedSnapshotId }`，不提交 contentJson、projectId 或 PRODUCT 选择 ID。Backend 自行关联会话项目、校验当前 CONFIRMED 与快照归属。正式创建结果是 report/taskId/status/reused/solutionSnapshotId；历史响应仍允许没有扩展字段。详情 task 为 QUEUED/ACTIVE/COMPLETED/FAILED，与 report.status 分离。publishedAt 在 report 内。统一 request 添加 `/api/v1` 前缀。

Backend 正式创建在会话事务锁内按当前用户、会话、类型、项目和 snapshot 查询已有报告，复用既有任务，BullMQ 使用稳定 taskId。此项为源码核验；本轮 Mock 重复请求只能证明 App 正确消费 reused，不能证明数据库锁、队列或 OSS 的真实幂等。

未发现必须变更 Backend 才能继续本轮 App 工作的契约缺口。没有修改 Backend、生产数据库、生产 OSS、工程计算、Thermal/Vision/知识页结构化渲染、语义路由或审核发布状态机。

平台能力对照 [uni-app 文件 API 官方文档](https://uniapp.dcloud.io/api/file/file?id=opendocument)：App/微信支持 saveFile/openDocument，H5 使用浏览器窗口；fileType 的平台差异由既有 service 处理。实际阅读器、保存目录与导出菜单仍需设备验证。

## 修改文件与新增行为

| 文件 | 本轮变更 |
| --- | --- |
| src/store/assistant.ts | 普通聊天 delta 不再被无关报告吞掉；轮询校验 reportId；权限错误显示原文并停轮询；草稿停止轮询；retry 校验 reportId；历史恢复拒绝旧账号/会话/新任务之外的迟到响应 |
| src/store/solution.ts | 正式创建响应额外核对 reportType 和 createdById；失败优先显示 Backend 包络原文 |
| src/composables/useReportDetail.ts | 重试进行中阻止额外手动刷新，避免旧 FAILED 响应覆盖重试状态 |
| src/services/files/openOriginalFile.ts | 每次续签前重新校验当前页面/账号，避免下载 403 后以新账号继续请求旧报告 |
| src/store/assistant-report.test.ts | 新增普通聊天/SSE共用任务、权限、草稿、错误归属、完整 Fixture 流程与历史恢复竞态测试 |
| src/store/solution-report.test.ts | 新增创建类型/创建人负例、包络消息与失败再次提交 |
| src/composables/useReportDetail.test.ts | 新增 retry/refresh 互斥及重新进入页面后的刷新锁隔离 |
| src/services/files/openOriginalFile.test.ts | 新增取消续签、保存迟到、H5 签发取消及能力缺失负例 |
| docs/c-solution-pdf-phase4.md | 当前复核、验证结果与待执行 UAT 清单 |

复用现有 Pinia store、网络客户端、报告中心、任务卡、状态映射与文件打开服务。生产逻辑仅修改 4 个已有 TS 文件；未新增第二套报告状态、文件组件或网络实现。

新增 12 项 Node 测试。既有契约/UI/页面测试继续覆盖：无快照/未确认/忙碌按钮门禁、不自动生成、reused、READY 无 PDF、空 task、生成/失败/审核/发布/旧 JSON、列表分页过滤、实时预览/下载路径、H5 窗口拦截、原生保存/打开失败、URL 过期及隐藏/卸载停止轮询。

## 测试与实际结果

| 实际命令 | 结果 |
| --- | --- |
| pnpm test（修改前基线） | 127 项通过，0 失败 |
| node --import ./scripts/register-test-loader.mjs --test src/store/assistant-report.test.ts（修复前回归） | 10 项中 4 项失败，复现普通 delta、权限轮询、草稿/错误归属、retry 错误 reportId 问题 |
| node --import ./scripts/register-test-loader.mjs --test src/store/assistant-report.test.ts src/store/solution-report.test.ts src/composables/useReportDetail.test.ts src/services/files/openOriginalFile.test.ts | 最终 38 项通过，0 失败 |
| pnpm test | 139 项通过，0 失败、0 跳过；含上述本地 Fixture 与 UI 测试 |
| pnpm type-check | 退出 2；最终 17 项存量诊断，与修改前逐项相同；本轮 8 个 TS 文件无类型诊断 |
| pnpm lint | 退出 1；48 项存量错误，与修改前逐项相同 |
| pnpm exec eslint src/store/assistant.ts src/store/solution.ts src/composables/useReportDetail.ts src/services/files/openOriginalFile.ts src/store/assistant-report.test.ts src/store/solution-report.test.ts src/composables/useReportDetail.test.ts src/services/files/openOriginalFile.test.ts | 退出 0，无 lint 错误 |
| pnpm build:h5 | 退出 0，编译完成 |
| pnpm build:mp-weixin | 退出 0，编译完成；不代表微信开发者工具或真机通过 |
| pnpm build:app | 退出 0，编译完成；不代表 APK/IPA 打包或真机通过 |
| git diff --check | 通过；构建产生的 pages.json、components.d.ts、auto-imports.d.ts 已恢复至构建前内容 |

类型错误分布：node_modules/@wot-ui/ui/components/wd-button/wd-button.vue（1）、src/pages/login.vue（1）、src/utils/aiSource.ts（1）、src/utils/aiStream.ts（2）、src/utils/markdown.ts（11）、src/utils/wechatPhoneLogin.ts（1），总计 17。本轮没有引入最终新增诊断。

lint 错误分布：src/components/ai/ReferencePageViewer.test.ts（15）、src/composables/useReferencePageHighlight.test.ts（7）、src/pages/profile/index.vue（1）、src/pages/reference-table/index.vue（1）、src/services/platform/index.ts（2）、src/store/manualThemeStore.ts（4）、src/test/fixtures/referencePage.ts（5）、src/utils/aiComparison.ts（4）、src/utils/aiStream.test.ts（1）、src/utils/aiUserSelection.test.ts（2）、src/utils/referencePage.test.ts（2）、src/utils/referenceTable.test.ts（1）、src/utils/wechatPhoneLogin.test.ts（1）、vite.config.ts（2），总计 48。本轮不扩展清理范围。

日志位于 App 的 `.audit/report-phase4/`：baseline-test/type-check/lint、regression-before/after、targeted-test、final-test/type-check/lint、changed-lint、build-h5/mp-weixin/app。*.log 被现有 gitignore 忽略。构建的提示包括 pnpm 配置字段被忽略、Browserslist 数据过期、UnoCSS 无法加载图标 `-`；App 另有 src/services/app/mediaPermission.ts:80 的 return/自动分号提示。以上配置、依赖、图标与 mediaPermission 文件本轮均未修改。

## 尚未验证与下一阶段阻塞点

没有执行真实报告 POST、BullMQ 任务、PDF 渲染或 OSS 操作，没有真实 PDF 预览/下载与工程数值核验，也没有 H5 浏览器视觉验收、Android/iOS/微信真机验证。本地平台 Mock 与三端编译不能替代这些检查。整体 type-check/lint 仍因存量问题失败，不能表述为全部工程检查通过。

真实 UAT 需要明确授权的隔离环境：非生产 Postgres、Redis/BullMQ worker、独立 OSS 测试桶/前缀、可用 PDF 渲染器、已发布报告模板、C 端测试账号及已发布的真实知识页。环境、账号及真实 CONFIRMED 快照尚未提供，因此本轮未执行写入型 E2E。

获准后执行以下验收，保存脱敏响应与截图，签名 URL 不进入长期证据或持久化：

1. 在隔离环境选真实已发布知识页候选，记录原页 documentId/pageId、构造、基层材料与厚度、产品层 R、总 R₀、K 和单位。设置 Final；只读建议或 Final 均不能触发报告 POST。
2. 点击 Confirm，记录服务端 conversationId/confirmedSnapshotId；GET 既有 solution snapshot 接口核对来源与冻结值。确认操作本身不能生成报告。
3. 点击显式生成按钮，核对 POST reports 请求只有正式类型和两个真实 ID，关联项目由 Backend 返回。等待 QUEUED → GENERATING → READY；分别记录 report.status、task.status/progress、availableFormats、publishedAt。
4. 同一快照重复创建应返回相同 reportId/taskId 与 reused=true；检查隔离库报告/快照/任务数量及 BullMQ job，不以 Mock 次数代替服务端幂等证据。失败 retry 应复用原报告快照并返回实际任务状态。
5. 下载真实 PDF，把原知识页、CONFIRMED snapshot、报告冻结数据和 PDF 中的构造、基层、产品 R、总 R₀、K 逐项对照；允许显示精度按后端模板约定处理，不由前端补算或修正。出现差异列出字段和值，停止并转 Backend/Snapshot/模板排查。
6. 分别测试 H5 新标签预览/下载、Android/iOS 下载临时文件和保存打开、微信下载域名/阅读器菜单。过期 URL 再次点击必须实时重取；原生 403 续签有次数上限；下载/保存/阅读器失败必须提示。H5 跳转后远端错误由用户返回并再次点击申请新 URL。
7. 查看生成中/成功无 PDF/失败/审核中/审核通过未发布/驳回/已发布及旧 JSON 报告；无 PDF 不显示可下载，不自动发布，不提供默认审核权限。
8. 生成与下载中切换会话、继续调整、退出并同账号重登、切账号、隐藏卸载；旧响应不绑定新上下文，轮询停止；报告中心仍能通过分页/筛选/刷新恢复授权历史报告。

任何需要增加 Backend 字段或改变权限/状态机的缺口应列出实际请求、响应与预期差异并停在该点。真实 UAT 完成前，结论限定为 App 本地验证通过与存量检查问题明确。

## 后续真实 UAT（2026-10-14）

用户已授权随机隔离环境并提供测试账号；后续执行了 52 轮真实 HTTP/SSE 连续对话、H5 登录/恢复/SSE 和真实 API 门禁。业务未通过，正式知识候选到 Final/Confirm/PDF 的链路被 Backend 返回 0 候选阻断；另发现原图印刷页 25/26 与已核验 pageLabel 5/6 不一致。不是 Mock 联调结论，也没有真实正式 PDF 通过证据。详见 [真实隔离 UAT 执行报告](./c-uat-real-20261014.md)。本报告前面的“尚未验证”描述为本地开发轮完成时的状态，后续结果以该执行报告为准。

2026-10-15 后续：用户授权 Backend 修复后，正式候选→Confirm→真实 PDF 已跑通，来源图和冻结数值已核对。原页码数据、浏览器阅读及真机/故障场景仍有未通过或未执行项，详见 [后续修复记录](../../backend/docs/reports/c-pdf-uat-fixes-2026-10-15.md)。此前本地命令日志已随证据移至 `C:/Users/zjj/.codex/visualizations/2026/10/14/01a13aa9-63b7-7300-a8fc-d3f68d1cdcc1/c-uat-backend-fix/local-checks/`；提交轮按用户要求没有再运行测试。
