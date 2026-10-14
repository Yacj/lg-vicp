# C 端正式方案 PDF：隔离 UAT 修复记录

记录日期：2026-10-15（香港时间）。用户已授权按实际失败 UAT 修改 Backend；生产数据库、知识页和原 OSS 文件保持只读。提交轮用户要求不再运行测试，以下结果来自提交前已经完成的开发与验收。

## 修改文件

- Domain 合同：`ai-domain-semantic.ts`、`ai-domain-turn-decision.service.ts`、`ai-domain-policy.ts` 及对应测试。
- 已消费知识页查询：`ai-reference-pages.service.ts`、`solution-candidate-query.service.ts`、`reference-query.service.ts`、`tools/search-knowledge.tool.ts`、`structured-reference-query.test.ts`。
- 语义参数及动作：`semantic-query.service.ts`、`solution-action-semantic.ts`、`solution-action-semantic.service.ts` 及测试；AST 白名单仅登记已有 SM-CODE-01 的编码格式归一。
- 无候选提示：`reference-candidate-resolver.service.ts` 及测试。
- 来源图：`solution-state.service.ts` 及测试。
- 存储签名：`src/storage/oss-storage.ts` 及新增测试；默认 HTTPS，显式 endpoint 配置仍由 SDK 处理。
- `tests/report-runtime.test.ts`：修正既存失败的文案断言，改为断言 `REPORT_RUNTIME_OS_UNSUPPORTED` 错误码。
- App 已有修复和测试见 `app/docs/c-solution-pdf-phase4.md`。Admin Web 本轮没有改动。

## 复用现有能力

继续使用 Domain Semantic → Backend Policy、现有 QueryState/Matcher、当前已发布 AI_ENABLED 原页访问校验、Candidate Result 与 SolutionState 生命周期、Final/Confirm/Snapshot、报告 API、BullMQ Worker、PDF 模板和 OSS adapter。没有新增 API、数据库迁移、网络客户端、前端数值计算或关键词意图路由。

## 新增行为与失败原因

1. 模型曾把查表的 `effectRequest` 留空，把产品咨询错误标为 `QUERY`。提示词明确 effect 枚举合同，Policy 继续要求副作用有直接肯定请求和足够置信度。
2. 原 Domain 引用允许任意字符串/数字组合，模型将 A3-2 填入 POSITION。改为复用已有 Grounding 的序号、编号、厚度强类型 schema。
3. 首次知识回退未保存消费版本，追问重查只读热工表并覆盖为空。保存实际消费的 document/version 范围；统一候选服务仅在该范围复用确认档位 Matcher，当前发布及项目校验仍执行，无资料范围不宽查。
4. 查询分类器补全从现有 schema 派生的 JSON 合同及偏好说明，最低 K 追问通过既有排序返回 A3-4，未改变热工公式或值。
5. 动作引用统一编码展示前缀“外墙”，同编号多厚度仍拒绝歧义；重复描述的公共厚度不应被模型列成独立操作对象。
6. 没有候选时说明尚无可定位候选；低置信操作说明尚未确认的操作，不误称缺少体系/基层。
7. PostgreSQL JSONB 会重排键，原 `JSON.stringify` 比较使相同来源模型误判失效。改用结构比较；原值改变仍阻止重签，快照没有改写。
8. OSS SDK 默认 HTTP；设置默认 HTTPS，预览 inline 与下载 attachment 仍使用独立实时签名接口。

## 接口契约

现有路径和 JSON 响应不变。正式创建仍需真实 `conversationId`、服务端 `confirmedSnapshotId`（提交字段 `solutionSnapshotId`）和显式生成操作。未 Confirm 的创建拒绝；Confirm 本身不生成报告。

实测报告 `status=READY`、任务 `status=COMPLETED/progress=100`、`availableFormats=[PDF,HTML]`、`publishedAt=null` 独立返回。相同快照重复创建 `reused=true`、相同 reportId、报告总数仍为 1。未执行审核或发布。

## 测试及实际结果

| 已执行命令/验收 | 实际结果 |
| --- | --- |
| Backend 基线 `pnpm test` | 2248 通过、1 失败、1 跳过；失败是运行环境错误文案断言 |
| Backend 最终 `pnpm test` | 2259 通过、1 既存跳过；共 2260 项 |
| Backend `pnpm lint` | 通过，含 semantic AST 检查和 TypeScript；31 个精确登记表达式 |
| Backend `pnpm build` | 通过 |
| App 先前阶段 4 `pnpm test` | 139 通过，0 失败 |
| App 先前 `pnpm type-check` / `pnpm lint` | 17 / 48 项既存诊断，与基线一致；改动文件无新增诊断，详见 App 阶段 4 文档 |
| App 先前 H5 / App / 微信编译 | 通过；不能作为真机 UAT |
| 最终真实 HTTP/SSE | 四基层查询 → 最低 K → A3-2 原页 → 明确开始智配；另测正式产品目录查询 |
| 真实 REST 完整条件查询 | 18mm 返回 4 候选；999mm 返回 0；恢复 45mm 返回 4；未形成 Confirm 或报告 |
| H5 与报告 | 工作区 Final/Confirm、正式 PDF 任务卡/详情、报告中心恢复有真实记录；后台未自动发布 |
| 真实权限负例 | 8 项通过：未 Confirm 创建拒绝、状态不越级、他人会话/方案/快照/未发布报告/产物签名拒绝、类型目录 |
| 最终真实 PDF | 5 页、1 张完整原页图；A3-1/A3-2 基层、45mm、产品 R、总 R₀、K 与快照逐行一致；中文、分页、高亮已逐页检查 |
| 预览/下载接口 | 实时 HTTPS 签名，两个接口读取到完全相同的 1,002,656 字节 PDF；签名 URL 不落证据文件 |

最终快照选用 A3-2（R=3、R₀=3.398、K=0.294、190mm 混凝土空心砌块）和 A3-1（R=3、R₀=3.313、K=0.302、200mm 钢筋混凝土），均为原确认档位。仅比较来源事实，未重算工程值。

## 尚未验证

- 内置浏览器预览标签显示不可访问；读取该标签被浏览器安全策略拒绝。没有绕过策略，也没有声称 PDF 阅读器已通过。API 文件读取和本地 PDF 检查已通过，标准浏览器阅读/保存仍需补验。
- Android/iOS、微信真机下载打开/保存、实际 URL 过期、Worker 故障重试、审核发布、主动断网恢复未重新执行。Fixture 不能代替这些 UAT。
- 原 52 轮连续对话失败记录保留；本轮重跑针对阻塞的相关路径，没有将整本 UAT 手册改判为全部通过。
- 复杂“加入并对比”请求仍可能因模型置信度不足被安全拒绝；未降低门槛，明确命令及按钮路径可继续。

## 下一阶段阻塞点与清理

原页图印刷页码为 25/26，确认知识页 `pageLabel` 为 5/6 且标记人工核验。报告忠实冻结了原数据，页码差异仍阻塞完整来源验收。需要管理员通过新草稿修订、核验、发布，不能由前端或报告代码猜改生产数据。没有正式标准数据，地区合规验收仍不具备条件。

最终隔离环境于 2026-10-15 00:25（香港时间）清理并核对：数据库已删除、Redis 命名空间剩余 0 键、2 个本次 PDF/HTML 对象已删除，API/Worker/H5 已停止，开发生成文件已恢复。仅清理本次 UUID 范围。

证据已归档到 `C:/Users/zjj/.codex/visualizations/2026/10/14/01a13aa9-63b7-7300-a8fc-d3f68d1cdcc1/c-uat-backend-fix/`，不提交脚本、原始日志、图片、PDF 或环境数据到源码仓库。`integration/report-proof.json`、`pdf-verification.json`、`rest-query-proof.json`、`negatives.json`、`cleanup-proof.json` 记录实测结果；`local-checks/` 保留先前命令日志。生产未部署。
