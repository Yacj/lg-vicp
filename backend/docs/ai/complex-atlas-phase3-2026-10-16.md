# 复杂热工图集：阶段 3 确认页查表、来源引用与三端合同

日期：2026-10-16。用户批准范围：阶段 3。**结论：PARTIAL。后端实现、工程字段/权限 Fixture、隔离 HTTP/SSE 和两端真实 DTO 函数验证已完成；正式业务路由、真实语义模型、数据库确认/发布、浏览器和移动端联合 UAT 尚未通过实测。未进入阶段 4，未部署、迁移或回填旧业务数据。**

## 1. 本阶段结论与执行范围

| 项目 | 状态 | 证明与边界 |
| --- | --- | --- |
| 从 v2 人工确认快照查阅参数，不强制同步热工参考行 | PASS（Fixture） | 三图 6 个构造、38 档保留；产品整体 R=null、屋面编号=null 仍可只读查表 |
| 12 行数值、构造及来源精确绑定 | PASS（Fixture HTTP/SSE） | 六次 20/25mm 查询，独立数字断言，真实 page/construction/option/revision 标识；不是自然语言模型成功证明 |
| 部位、坡平、正倒置、等级、基层、型号、板厚、指标及来源版本联合过滤 | PARTIAL | 主要维度通过结构化 Fixture；防水等级仅验证字形归一及缺值拒绝，三图等级尚待人工核正，真实正向等级召回 NOT_RUN；不从 I/II 型推断 |
| 正置/倒置同值不合并、跨构造不串行 | PASS（Fixture） | 新只读事实不按 R/K/板厚去重，保留第 90 页两组独立 ID |
| 完整集合比较、极值与并列数量 | PASS（Fixture） | 比较在服务端对完整匹配集合执行；缺目标字段不输出极值，不对截断后的前几行宣称全量极值 |
| B/C 来源 RenderModel 一致，App/B DTO 不丢字段 | PASS（离线函数+隔离 HTTP/SSE） | 调用真实 B/C 读取函数及 App normalizeReferencePages、B resolveReferenceHighlights；完整表和命中行保留 |
| 读取不激活方案、不刷新 Candidate/Selected | PASS（Mock） | Domain pageQuery 分支不调用 querySolutionCandidates/publishCandidateResult；只读追问上下文独立于 Candidate |
| 旧引用、撤回、换版、跨项目、BROWSE_ONLY | PASS（Fixture） | 当前发布/有效期/项目守卫沿用；旧 optionId/hash、确认版本或来源版本不符即拒绝 |
| 原文 R/组名/单位、参数条与回答语义一致 | PASS（Fixture HTTP/SSE） | 整个三图 SSE 不再出现误标 R₀；不能仅以正文正确代替结构化引用核验 |
| 真实 Domain 模型及自然对话 T01—T12 | NOT_RUN | 本阶段没有调用真实语义模型；提案 Fixture 不证明模型能稳定输出新 pageQuery |
| 正式 HTTP/SSE、隔离数据库审核/发布、真实 Redis/OSS | NOT_RUN | 临时协议服务只在内存读取人工夹具，没有启用正式业务路由/认证/数据库适配器 |
| B/App/H5/小程序真实页面 | NOT_RUN（本阶段） | 没有新增本阶段截图；阶段 2 截图不能当作阶段 3 后端联测证据 |
| A3 四基层参数/定位 | PASS（Fixture） | 旧四基层数值和页码断言保留；仅修正缺来源证据时的符号显示预期 |
| 现有 A3/Confirm/Snapshot/PDF 真实业务回归 | NOT_RUN | 单测不替代真实发布数据、冻结方案和报告运行验收 |

新增逻辑没有以页码 89/90/75、标题、屋面口语写意图分支。样本数字只存在于测试和人工夹具。正式查询条件来自既有 Domain 语义提案及 Zod/原话证据校验；模型不能产生正式 ID、参数事实或副作用授权。

## 2. 改动文件与最小范围理由

下列 Backend 路径相对本仓库；客户端路径明确标出所属仓库。工作区进入本阶段前已有的其他修改保留，未按归档或 Git HEAD 覆盖。

| 文件 | 修改原因与最小范围 |
| --- | --- |
| `src/shared/confirmed-page-query.ts`（新增） | 复用 pageRecognitionSystemSchema 的枚举，定义只读查询字段；只校验模型已指定字段的字形，不扫描整句判定业务意图 |
| `src/modules/thermal/thermal-query-state.ts` | 增加可选构造属性/页码/编号集合及硬条件核验；正式候选缺相应证据时也不能误算满足 |
| `src/modules/thermal/semantic-query.ts` | 扩展原 ENTITY 合同，原话 grounding 后设置/移除属性；多个构造编号按 SET/APPEND 保留，处理不依赖提案顺序；不改指标/厚度 Parser 主结构或热工公式 |
| `src/modules/ai/ai-domain-semantic.ts`、`ai-domain-turn-decision.service.ts`、`ai-domain-policy.ts` | 既有 Domain 增加可选 pageQuery，复用 semanticQuerySchema；仅允许 REFERENCE_QUERY/REFERENCE_REFINE 使用，拒绝将它带入建议/写入目标；不另建意图 Router |
| `src/modules/ai/semantic-query.service.ts` | 复用 Domain 已给出的 pageQuery 进行确定性校验，不重复调用第二个分类模型；B 端 v2 在原 semantic_query 场景中理解；失败保留澄清，不宽查 |
| `src/modules/knowledge/confirmed-page-facts.ts`（新增） | 查询同份已确认快照的纯函数，复用 validateCandidateAgainstQueryState/matchesMetric/metricRankingGap；允许缺未询问产品 R，保留独立构造，不制造 Candidate 或正式产品 ID |
| `src/modules/knowledge/knowledge-test-reference.ts` | v2 走共享只读事实，旧完整候选路径保留；答案逐项抄录非空确认字段；统计完整集合与展示数量，原表/备注不裁切；参数条使用来源列头 |
| `src/modules/knowledge/knowledge-workflow.service.ts` | B 版本测试只在存在 v2 确认快照时调用扩展语义；旧版问答不额外要求新的模型调用 |
| `src/modules/ai/ai-reference-pages.service.ts` | C 端复用同一事实查询和现有发布/项目守卫；允许在上次已消费版本内继续只读查表；持久化重读当前模型，不信任传入 renderModel/summary；历史重签及版本验证 |
| `src/modules/ai/reference-query.service.ts` | pageQuery 不走正式候选查询与发布；普通候选流程继续复用原服务 |
| `src/modules/ai/confirmed-page-lookup-state.ts`（新增）、`conversation-task.ts` | 在现有任务 JSON 内保存只读查询条件，绑定本人/同端/同会话/项目/24h；不保存参数副本或签名 URL，不替代 lastReferenceLookup |
| `src/modules/ai/ai-generation.service.ts` | 将 pageQuery 交回上述共享服务，来源只读结果不发布为 Candidate；保留既有选择/确认/报告门禁 |
| `src/shared/knowledge-page-render.ts` | v2 模型增加可选 confirmedRevision；保留原 hash、组序/行序及旧 JSON 行为，不回填历史 |
| `src/modules/ai/reference-page.ts` | 可选来源版本及页码核验信息；引用参数条来源驱动，缺证据保守显示；旧字段名兼容，不生成像素框选 |
| `src/modules/knowledge/confirmed-page-facts.test.ts`、`src/modules/ai/confirmed-page-query-readonly.test.ts`（新增） | 12 行、38 档、同值身份、缺值/权限、复合条件、上下文隔离、B/C 一致、无 Candidate 发布测试 |
| `src/modules/knowledge/knowledge-test-reference.test.ts`、`src/modules/ai/structured-reference-query.test.ts` | 保留旧数值/来源断言，将无来源符号证据仍强制 R₀ 的预期改为保守标签 |
| `scripts/verify-complex-atlas-query.ts`（新增）、`tsconfig.uat.json` | 可复现隔离 HTTP/SSE 与两端真实 DTO 函数取证；脚本纳入类型检查，不注册产品路由 |
| Admin：`src/types/knowledge.ts`、`src/types/knowledge-page-render.ts`、`src/utils/knowledge-page-render.ts`、`src/utils/complex-atlas.test.ts` | 可选版本字段及客户端高亮守卫，保留 answerOffset；不改审核/表格样式 |
| App：`src/api/reference-page.ts`、`src/utils/referencePage.ts`、`src/utils/referencePage.test.ts` | 同步来源语义、逐档层证据、确认版本及页码信息；归一化保留字段并拒绝旧版本高亮；没有实施阶段 4 表格 UI |
| `AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、skill `references/ai-and-reports.md` | 同步只读事实、来源与阶段边界 |
| 本文、`docs/ai/evidence/complex-atlas-phase3/` | 保留 HTTP/SSE、RenderModel、12 行绑定、命令日志及失败清单 |

未修改数据库 schema/migration、Vision Pipeline、正式热工引擎、Candidate/Selected/Final/Confirm 的状态机、SolutionSnapshot、DocumentModel、报告生成、采集 Source/Skill、公开文库流程、产品或项目权限。

## 3. 接口、数据与兼容影响

```text
B：既有版本 test-qa 权限/版本门禁
 → loadKnowledgeTestReferences（只读该版本的 confirmedStructuredData）
 → v2 使用既有 parseSemanticQuery → queryConfirmedPageFacts

C：resolveDomainTurn → applyDomainPolicy → pageQuery
 → parseSemanticQuery（复用已有提案，grounding/校验）
 → 当前有权资料 hits / 上次已消费版本
 → readConsumableReferencePages（PUBLISHED/current/AI_ENABLED/有效期/项目）
 → queryConfirmedPageFacts

共享：完整 RenderModel + 完整集合统计 + 确定性回答
 → 引用标记流处理（optionId/fieldKeys/answerOffset）
 → REFERENCE_PAGE → B/App DTO → 表格/原页入口
 → 持久化重读确认模型 → 历史重验来源及重签
```

生产 API 路径、成功/失败封装和 SSE 事件名不变；没有新增公开查表端点。新字段均可选：

| 层级 | 字段/行为 |
| --- | --- |
| Domain 结构化输出 | `pageQuery?: SemanticQuery|null`，只作为现有读取意图的条件提案，不授权副作用 |
| QueryState JSON | `applicationPart/roofForm/placement/waterproofGrade/pageLabel/constructionCodes/specClasses`，后两者为查询集合，构造自身仍为单个型号；来自本轮连续原话证据，不能由页码/型号猜属性 |
| 任务 JSON | `confirmedPageLookup`：查询条件、时间、会话/用户/项目/clientApp；24h 有效，每次事实重读并验证来源，无参数快照、URL 或 Candidate ID |
| v2 RenderModel/引用 | `confirmedRevision?`，值来自既有确认快照 hash；旧模型无字段仍按旧正式 ID 验证 |
| 引用 page | `versionId?/pageLabelSource?/pageLabelVerified?`；没有印刷页码证据时不以物理页序补齐 |
| App DTO | 补齐阶段 1 的原标签/属性/源列/行证据/layerValues 可选合同；前端不补算和推断 |

已确认页的草稿重新识别与发布状态仍按原门禁处理。纯查表允许产品整体 R 或打印编号缺省，不降低正式热工同步、方案映射或 Candidate 准入。只读事实不会进入可激活的候选列表，也不以“确认一下数字”生成快照/报告。

原 hash 算法不变：确认内容或顺序变动后 constructionId/optionId 全部变化，旧引用不能绑定到新行。新增 confirmedRevision 显式约束与已有 ID 校验共同使用；没有迁移、永久跨版本构造 ID 或历史确认快照回放。旧引用失效会省略高亮，不能复活旧缓存或用相同行序重绑。

来源列名和工程字段分开：三图的整构造列忠实显示“传热阻 R”，表组“外墙主断面”保留。层 rValue、逐档芯层 R、产品整体 R 与 totalThermalResistance 不互填。旧页缺原文符号证据时使用“整构造传热阻（源文符号待核）”，不继续强标 R₀。

v2 查表不设置 THERMAL_SOLUTIONS 方案卡替换提示，避免将只读事实伪装成正式候选；普通正文和独立来源表继续保留。旧正式候选的提示兼容。

当前仍保留每轮最多三页来源/十二条回答引用及上下文预算。**完整 RenderModel 不裁成命中行**，统计按完整匹配集合计算；超出回答/来源预算明确说明展示数量和未展示项，不称全表只有这些行。缺少目标字段时不计算该指标极值，R/K 相等不解释为做法相同。

## 4. 测试证据及未通过项

证据目录：[complex-atlas-phase3](evidence/complex-atlas-phase3/)。本阶段 Fixture 沿用已明确标注 MANUAL_SOURCE_BASELINE 的三图 JSON，没有用人工夹具冒充真实 Vision/人工正式确认。原始图片及阶段 1 模型输出未被改写。

### 隔离 HTTP/SSE 与 12 行

执行 `node --import tsx scripts/verify-complex-atlas-query.ts`。脚本临时监听随机本机端口，使用内存数据库适配器、真实共享查询函数和真实 B/App DTO 纯函数；没有真实数据库、Redis、模型、OSS，也没有注册正式认证路由。运行完成自动关闭服务。

证据：[transport-report.json](evidence/complex-atlas-phase3/transport-report.json)、[twelve-rows.json](evidence/complex-atlas-phase3/twelve-rows.json)、六组 `page-{89,90,75}-{20,25}mm.b-http.json` 与 `.c-sse.txt`。这些文件记录结构化请求，不证明自然语言模型能够稳定提取条件。

| 页 | 独立构造 | mm | R | K | 验证 |
| --- | --- | --- | --- | --- | --- |
| 89 | I 型坡屋面正置 | 20 | 5.225 | 0.191 | PASS（Fixture HTTP/SSE） |
| 89 | I 型坡屋面倒置 | 20 | 5.198 | 0.192 | PASS（Fixture HTTP/SSE） |
| 89 | I 型坡屋面正置 | 25 | 6.025 | 0.166 | PASS（Fixture HTTP/SSE） |
| 89 | I 型坡屋面倒置 | 25 | 5.998 | 0.167 | PASS（Fixture HTTP/SSE） |
| 90 | II 型平屋面正置 | 20 | 5.369 | 0.186 | PASS（Fixture HTTP/SSE） |
| 90 | II 型平屋面倒置 | 20 | 5.369 | 0.186 | PASS（Fixture HTTP/SSE） |
| 90 | II 型平屋面正置 | 25 | 6.169 | 0.162 | PASS（Fixture HTTP/SSE） |
| 90 | II 型平屋面倒置 | 25 | 6.169 | 0.162 | PASS（Fixture HTTP/SSE） |
| 75 | I 型外墙 C1-3，蒸压灰砂砖 240mm | 20 | 6.916 | 0.145 | PASS（Fixture HTTP/SSE） |
| 75 | I 型外墙 C1-4，加气混凝土砌块 200mm | 20 | 7.540 | 0.133 | PASS（Fixture HTTP/SSE） |
| 75 | I 型外墙 C1-3，蒸压灰砂砖 240mm | 25 | 8.516 | 0.117 | PASS（Fixture HTTP/SSE） |
| 75 | I 型外墙 C1-4，加气混凝土砌块 200mm | 25 | 9.140 | 0.109 | PASS（Fixture HTTP/SSE） |

R 单位 (m²·K)/W，K 单位 W/(m²·K)。JSON 中同时保留所属 constructionId/optionId、fieldKeys、confirmedRevision、来源版本和完整表。源页 89/90 每组六档，75 每组七档，合计 38 档；产品整体 R 全为空。第 90 页两个相同数值各有独立来源行。

取证发现并修复了“正文已经写 R，但引用 highlights.label 仍写 R₀”的协议缺陷；这证明必须检查完整 SSE，而非只看回答文字。旧无符号证据夹具的 R₀ 断言相应改为保守标签，四基层数值与 ID 验证保留。

### 命令检查

| 命令/范围 | 状态 | 实际结果与日志 |
| --- | --- | --- |
| Backend `pnpm lint` | PASS | 最终 AST 检查及 TypeScript，10 个关键文件、31 个原白名单表达式，无新增自然语言规则豁免；[backend-lint-close.log](evidence/complex-atlas-phase3/backend-lint-close.log) |
| Backend `pnpm build` | PASS | [build-close.log](evidence/complex-atlas-phase3/build-close.log)，仅构建已校验路径下的 dist，不部署 |
| Backend `pnpm db:check` | PASS | [db-check.log](evidence/complex-atlas-phase3/db-check.log)，迁移静态检查，不执行迁移 |
| `pnpm exec tsc -p tsconfig.uat.json --noEmit` | PASS | 含隔离取证脚本；[script-check-close.log](evidence/complex-atlas-phase3/script-check-close.log) |
| Backend 全量 `vitest run --maxWorkers=2` | FAIL | 最后一次完整运行：2294 PASS / 54 FAIL / 1 SKIP；[backend-full-final.log](evidence/complex-atlas-phase3/backend-full-final.log)、[原 JSON](evidence/complex-atlas-phase3/full-test-final.json) |
| Backend 最终 13 文件定向，`--maxWorkers=1` | PASS | 240/240，含最终 pageQuery 范围门禁、A3 四基层、确认页、Domain/语义、来源/历史、部署脚本桩；[backend-targeted-close.log](evidence/complex-atlas-phase3/backend-targeted-close.log) |
| `node --import tsx scripts/verify-complex-atlas-query.ts` | PASS（Fixture） | 6 HTTP/SSE 查询、12 行、B/C 全模型一致、App/B 真实 DTO 函数不丢数据；[transport-close.log](evidence/complex-atlas-phase3/transport-close.log) |
| Admin `pnpm test --maxWorkers=2` | PARTIAL（中止，已见 FAIL） | ECharts 检查约 20 秒后报失败，此后近 20 分钟仍未结束，主动停止；没有完整通过计数或最终堆栈；[admin-full.log](evidence/complex-atlas-phase3/admin-full.log) |
| Admin 本次范围 + ECharts 独立复核 | PASS（范围限定） | 3 文件 23/23，`--maxWorkers=1 --testTimeout=30000`；[admin-recheck.log](evidence/complex-atlas-phase3/admin-recheck.log)，不替代全量结果 |
| Admin `pnpm typecheck`、`pnpm build` | FAIL | 标准管理八处 row/index 未定义及审核中心 `.value`，9 个既有错误；[typecheck](evidence/complex-atlas-phase3/admin-typecheck.log)、[build](evidence/complex-atlas-phase3/admin-build.log) |
| Admin `pnpm lint` | FAIL | 4176 errors / 415 warnings，与阶段 2 最终数量相同；[admin-lint-close.log](evidence/complex-atlas-phase3/admin-lint-close.log) |
| Admin 三个类型/测试文件 ESLint | PASS（范围限定） | `knowledge.ts/knowledge-page-render.ts/complex-atlas.test.ts`；[admin-new-scope-lint.log](evidence/complex-atlas-phase3/admin-new-scope-lint.log)，旧工具文件仍有既有风格错误，不声称全量通过 |
| App `pnpm test` | PASS | 140/140；[app-test-final.log](evidence/complex-atlas-phase3/app-test-final.log) |
| App `pnpm build:h5` | PASS（构建） | [app-buildh5.log](evidence/complex-atlas-phase3/app-buildh5.log)，有 Browserslist/图标警告；不是浏览器 UI 验收 |
| App `pnpm type-check`、`pnpm lint` | FAIL | 第三方 wd-button 的 ButtonOpenType 类型不兼容；lint 48 errors，与前阶段数量相同；[typecheck](evidence/complex-atlas-phase3/app-typecheck.log)、[lint](evidence/complex-atlas-phase3/app-lint.log) |
| `git diff --check` | PASS | 本阶段相关路径无空白错误，Git 行尾转换提示不当作失败 |
| 真实语义/Vision、正式 HTTP/SSE、数据库/OSS、B/H5/App 页面 | NOT_RUN | 没有以构建、函数测试或 Fixture 网络证明真实业务联测成功 |

Backend 首次全量为 2293 PASS / 52 FAIL / 1 SKIP，与阶段 1 的 52 个失败名称集合相同；中间一次为 2295 PASS / 53 FAIL / 1 SKIP。最后一次完整运行另出现两个失败：A3 紧凑文案断言仍使用不符合实际输出的符号/格式预期，以及部署脚本桩进程未取得预期退出码。前者已改为精确的新保守标签加数值/单位断言，后者未修改生产或测试逻辑；两项均在后续单 worker 的 240 项定向复核中通过。保留全部三次完整运行日志，**没有在最后修改后再次声称全量只剩 52 个失败**；最终全量状态仍为 FAIL，独立复核不覆盖其他既有失败。

逐项失败比较见 [failure-baseline-comparison.json](evidence/complex-atlas-phase3/failure-baseline-comparison.json)。52 个前阶段失败集中于 Domain 语义回归、只读来源 Resolver、事实读取、建议上下文/服务及方案状态；没有为消除这些失败重写它们的业务流程。

Admin 首次全量日志只有 ECharts 失败提示，未获得最终堆栈，不能把资源竞争推测写成已证实根因；提高独立复核超时后通过。该全量运行主动中止，剩余项目不能计作 PASS。最终小范围只拆改导入顺序和保留 answerOffset；功能范围由 23 项复核覆盖，未再次运行十余分钟的全量套件。

Backend 最终定向文件：`src/modules/knowledge/{confirmed-page-facts,knowledge-test-reference}.test.ts`，`src/modules/ai/{confirmed-page-query-readonly,ai-reference-pages,reference-page,semantic-query.service,ai-domain-policy,ai-domain-turn-decision.service,conversation-task,structured-reference-query}.test.ts`，`src/modules/ai/tools/thermal-lookup.test.ts`，`src/modules/thermal/semantic-query.test.ts`，`tests/report-runtime.test.ts`。Admin 为 `src/utils/complex-atlas.test.ts`、`src/components/business/knowledge/KnowledgePageViewer.test.ts`、`src/charts/echarts.test.ts`。

完整变更路径及代码哈希见 [implementation-manifest.json](evidence/complex-atlas-phase3/implementation-manifest.json)；清单仅列本阶段实际修改，保留工作区其他既有改动。

## 5. 下一阶段前置条件及剩余风险

1. **真实自然语言模型未运行。** 新可选 pageQuery 能通过受控提案校验、复用及多轮 Fixture；不代表真实模型已稳定理解 T01—T12。正式联测需核对 Domain intent/relation、原话依据、实际查询条件及来源，不能只检查答案。
2. **真实业务服务未联测。** 隔离 HTTP/SSE 只证明传输和共享读取函数，并非正式登录、权限路由、数据库确认/发布或队列服务可用。后续只使用隔离库、独立 Redis/OSS 命名空间与授权凭据；不得向现有业务库写入测试页/会话。
3. **App 表格 UI 留在阶段 4。** 本阶段仅同步类型/归一化/版本守卫；App 原有硬编码 R₀/表组、窄屏层级、原图重试和历史交互尚未由本阶段修复或验收。H5/App/小程序截图均 NOT_RUN。
4. **B 端真实壳层与新后端联合浏览器验收未运行。** 阶段 2 截图证明隔离组件展示，不能替代本阶段正式服务联测。没有把旧截图标为本阶段新证据。
5. **源数据质量风险继续保留。** 阶段 1 模型仍可能漏编号/误符号/防水字形不稳；人工夹具第 90 页正置部分 sourceLayerLabel 与原图序号偏移仍需人工核正。本阶段未静默修改夹具、原图、旧确认资料。
6. **历史引用采用安全失效。** 没有新增持久历史确认快照回放能力；重新确认后旧引用可能失效，只能说明失效，不能重绑新行。
7. **工程质量与旧能力。** 全量现有失败、B/App 类型/lint 问题及真实 A3/Confirm/PDF 业务回归分别报告；不扩展本阶段去修标准管理、审核中心或第三方组件。
8. **条件表达边界。** 多型号/构造编码支持明确 SET/APPEND 集合；部位/坡平/正倒置单值属性冲突不能后值覆盖前值，须澄清。属性排除及 OR 尚不支持时保留 unresolved，不静默丢条件。
9. **超大单页仍需验证。** 已限制来源页数、回答引用和上下文预算，完整 RenderModel 保留全部档位；尚未实现超大单页的分页加载，也未进行其浏览器/移动性能实测，不把样本 38 档的通过当作任意规模表格的性能验收。

旧 A3 系列、现有热工参考档位、Candidate、SolutionSnapshot、已生成 PDF 均未迁移、重新识别、重算或回写。只读读取服务允许缺未核验字段，不改变正式热工同步和方案确认条件。没有自动发布知识版本或生产部署。

## 6. 当前阶段停止

阶段 3 按 PARTIAL 交付后停止，等待用户批准阶段 4。当前无需数据库迁移；发布和批量重新识别不在本阶段授权执行范围。进入阶段 4 之前应保留本报告的未运行清单，后续联合 UAT 补齐真实服务、浏览器和移动端证据。
