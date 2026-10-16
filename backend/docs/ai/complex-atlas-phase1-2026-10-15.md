# 复杂热工图集：阶段 1 Backend 识别与工程字段

日期：2026-10-15。范围：用户批准的阶段 1。结论：**部分实现（PARTIAL）**。字段合同、证据校验、草稿/确认边界和兼容性已实现；真实模型仍漏填印刷构造编号、误填来源符号，不能宣称识别全部通过。没有部署、迁移、自动确认或业务数据改写；阶段 2 尚未执行。

## 1. 实现与执行范围

复用 `resolveDefaultVisionModel → buildPageRecognitionPrompt → generateObject → repairPageRecognitionText → pageRecognitionResultSchema`，在候选落库前增加 `preparePageRecognitionCandidate → normalizePageRecognitionAnnotations`。新识别结果强制为 v2 草稿，仍为 `REVIEW_REQUIRED`；原图文字只作为待提取数据，不作为执行指令。

| 项目 | 状态 | 证据及限制 |
| --- | --- | --- |
| 三图真实 Vision 核心调用 | PARTIAL | 4 轮探索性调用，原 PNG 哈希核验，配置读取连接强制只读；不是完整 Worker/UAT |
| 最后一轮 6 个独立构造、全部 38 档 R/K 和芯层 R | PASS | 按原始构造标签/屋面属性逐组核对，见 engineering-comparison.json；不等同于全部字段正确 |
| 固定材料层数值、λ/α、基层/厚度 | PASS | 最后一轮 6 组与独立人工 fixture 的分层数字一致 |
| 75 页构造编号 | FAIL | 最后一轮 raw 标签含 C1-3/C1-4，但 constructionCode 仍为空，不自动从名称补码 |
| 89 页来源符号 | FAIL | 最后一轮将单位写进 symbol；最终校验器留空并警告，不擅自写成 R/R₀ |
| 防水等级 | PARTIAL | 模型在“I级防水”与缺字“级防水”间波动；后者拒绝，不能由 VICP 型号推断；仍须人工逐字核对 |
| 90 页 4 条、75 页 2 条原备注 | PASS | 最后一轮原始 JSON 与源图对照，随 fullText/notes 保留 |
| 无编号页单页人工确认资料、保留同值双构造 | PASS（Mock） | 内存事务测试保留原事实/备注并生成资料 chunks，不写 thermal_reference_rows |
| 证据矛盾确认/同步、旧编辑器丢字段防护 | PASS（Mock） | 写入前拒绝；原确认快照保留 |
| 旧 JSON 与快照引用兼容 | PASS（Fixture） | 不增加默认 v2 字段；旧 hash/optionId 保持；新快照重排使旧 ID 失效 |
| 真实队列 Worker / 隔离数据库人工确认 / 发布 | NOT_RUN | 本阶段实测仅只读配置及真实推理，未建测试业务页、队列、OSS 对象或正式确认记录 |
| 真实 HTTP/SSE、B 端、H5、App/小程序联测 | NOT_RUN | 本阶段没有前端实施，也没有沿用阶段 0 的组件截图冒充阶段 1 联测 |
| 冻结版本重复识别稳定性 | NOT_RUN | 四轮之间调整过 Prompt/校验，不能当作冻结实现的稳定性验收 |

## 2. 文件与最小改动

以下仅列本阶段改动；工作区原有 AI/热工/报告/App 修改不属于本阶段，未回退或重写。

| 文件 | 本阶段变化与原因 |
| --- | --- |
| `src/shared/page-recognition.ts` | 扩展现有 Zod 与 Prompt，不另建识别 Pipeline；新增字段可选，不回填旧 JSON |
| `src/shared/page-recognition-evidence.ts` | 新增纯校验器：封闭工程字段、原数字字形、源列作用域、组内层引用；不解析开放意图、不计算热工值 |
| `src/modules/knowledge/knowledge-page-recognition-output.ts` | 表示修复保留新字段；删除坏材料层后重映射数组下标，拒绝悬空引用；不按中文表头猜测未知 fieldKey |
| `src/modules/knowledge/knowledge-page-recognition.service.ts` | 新候选 v2 校验，saveDraft 防旧编辑器降级，confirm/sync 写入前重验；批量确认保留风险门禁 |
| `src/shared/knowledge-page-render.ts` | 最小透传原标签/工程属性/源列/逐档层证据；v2 不使用旧 systemName 编号兼容推断；保留原 hash 算法 |
| `src/shared/page-recognition-evidence.test.ts` | 三页/38 档/12 个独立基线断言、同值身份、源列语义、旧 ID 兼容及防串层 |
| `src/modules/knowledge/knowledge-page-recognition-worker-v2.test.ts` | 模拟真实 Worker 完整成功分支，证明新草稿待审、原确认快照不覆盖、不写正式表 |
| `src/modules/knowledge/knowledge-page-recognition-v2.test.ts` | 内存事务验证无编号人工确认、证据矛盾拒绝和同步前门禁 |
| `src/modules/knowledge/knowledge-page-recognition.queue.test.ts` | 增加旧编辑器覆盖拒绝、显式 null 页码不复活与旧确认快照保护 |
| `src/modules/knowledge/knowledge-page-recognition-output.test.ts` | 增加新字段保留、坏层下标隔离、实际模型空 fieldKey 安全修复案例 |
| `tests/fixtures/complex-atlas/page-{89,90,75}.json`、`README.md` | 明确标识 MANUAL_SOURCE_BASELINE；与真实模型输出分开，不拿人工修正结果冒充 Vision |
| `scripts/verify-complex-atlas-recognition.ts` | 原图核心推理取证脚本；只读配置、不建库/队列/OSS；严格身份或页码断言失败返回非零 |
| `tsconfig.uat.json` | 将上述脚本纳入已有类型检查；不运行会创建测试库/迁移的 UAT harness |
| `AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、skill references 的 `files-and-jobs.md` / `ai-and-reports.md` | 按仓库规则同步长期约束与当前阶段限制，不改变权限/报告业务 |
| 本文及 `docs/ai/evidence/complex-atlas-phase1/` | 保留 4 轮原始输出、最终候选重放、逐行对照、测试日志和未通过项 |

核心四文件相对进入阶段 1 时真实工作区的[精确补丁](evidence/complex-atlas-phase1/implementation.patch)包含 Schema/Prompt、修复、门禁及 RenderModel 差异，保留进入本阶段前已有修改。

没有修改数据库 schema、迁移、Semantic Router、Parser/Matcher、热工引擎、B/App 组件、PDF/报告流程。

## 3. 接口、数据合同与兼容

### 新增的可选字段

| 层级 | 字段 | 含义 |
| --- | --- | --- |
| 顶层 | `schemaVersion?: 2`、`pageLabelEvidence?` | 标记新草稿证据合同；印刷页码字形证据，不是上传序号 |
| systems[] | `rawConstructionLabel?`、`constructionCodeEvidence?` | 整个印刷构造标签及编号栏证据；无编号允许 constructionCode=null |
| systems[] | `applicationPart?` | EXTERNAL_WALL / ROOF / null；现有工程目录未找到等价字段枚举，局部封闭定义 |
| systems[] | `roofForm?`、`placement?`、`waterproofGrade?` | SLOPED/FLAT、UPRIGHT/INVERTED、原文等级；与已有 specClass=I/II/III 分开 |
| systems[] | `sourceColumns?` | fieldKey、label、groupLabel、symbol、unit、scope；scope=LAYER/PRODUCT/CONSTRUCTION/UNKNOWN |
| layers[] | `sourceLayerLabel?`、`sourceGroupLabel?` | 印刷层标签/共同父标签；保留上包覆、芯层、下包覆，不因多档厚度复制材料层 |
| options[] | `sourceRowLabel?`、`fieldEvidence?` | 原行厚度标签及同字段原始数字字符串；与原图一起人工审核 |
| options[] | `layerValues?` | 本组 layers 的 0 起始 layerIndex、厚度/层 R 与原数字字形；不是印刷层号，也不是产品 R |

没有新增数据库字段；这些内容使用既有 JSON metadata/confirmedStructuredData。RenderModel 可选透传同一份字段；B/App 类型及显示将在后续阶段接入，当前不能宣称三端已同步。

### 数值和证据规则

- 层 R、芯层逐档 R、完整产品整体 R、整构造 R、K 分别存储。三图只给芯层 R，所有 38 档 `productThermalResistance=null`，不相加包覆层、不算倒数 K、不填齐“四字段”。
- 新候选的非空四字段必须有对应源列/作用域及相等的原数字证据；未知作用域或不一致留空并警告。证据只验证模型声明的一致性，不能替代人工对照图像。
- 编号须与原标签中的完整标识及原文证据一致；整格证据也可接受，拒绝将 C1-30 截成 C1-3，数字层号不能冒充屋面构造编号。模型不能提供 schemeId/productSpecId/catalogProductId。
- `waterproofGrade` 只有“级防水”时拒绝；必须有等级及相同原标签字形。模型仍可能误读字形，因此保留 REVIEW_REQUIRED。
- 单位串不能作为 symbol；拒绝后留空待核，不根据 ROOF 更名表组，也不补写 R₀。原图三页组头都是“外墙主断面”，整体列印作“传热阻 R”。
- Schema 表示修复不修正事实：未知源列只写警告并留在全文/原始输出，后续工程值校验缺证据即留空。固定材料属性与 sourceColumns 的视觉准确性仍需人工核对。

### 人工确认、发布、版本与只读边界

既有单页确认本来就允许不选 thermalSetId，本阶段用事务 Mock 证明 v2 无编号页仍可人工确认为资料、生成正文 chunks 与 RenderModel，返回 NOT_SYNCED。正式热工同步继续要求已发布方案/规格的人工映射、DRAFT 集、完整工程字段；不得由本次识别自动加入方案或生成报告。批量确认对缺编号、缺产品 R 或 warnings 继续拒绝。

**当前数值查表仍有阶段 3 缺口：**既有 `knowledge-test-reference` 等数值候选准入要求完整产品 R/构造编号。本阶段只保持资料正文检索、原页读取、候选预览及无编号人工确认能力，没有绕过该准入；三页 v2 候选不能据此宣称已在 B/C 正式数值查表中可召回。草稿不进入 C 端生产检索；发布/当前版本/权限/原页授权沿用原流程。

`schemaVersion` 没有 default。旧 JSON 读取不调用 v2 候选准备，不重序列化回库。已有引用继续为 `SHA256(JSON.stringify([pageId, confirmedData]))[:24] + groupIndex + optionIndex`；pageId 的版本归属和发布/权限由既有来源服务验证，同一确认快照中构造/行 ID 独立且稳定。同值两组 ID 不同；重新确认改变内容或顺序后全部旧 ID 失效，不能重绑到同位置新行。未新增跨快照永久逻辑 ID，也未建立历史快照回放；旧引用可能失效，但不能错误高亮新行。

保存 v2 草稿时，旧编辑器若提交不带 v2 标记的整份 structuredData，返回业务错误 `PAGE_RECOGNITION_EDITOR_UPGRADE_REQUIRED`（语义 409）；证据矛盾的直接确认/同步返回 `PAGE_RECOGNITION_EVIDENCE_INVALID`（语义 400）。统一错误封装保持原合同。**阶段 2 接入前不要单独发布后端并让旧 B 端重新识别**，否则旧审核界面将明确拒绝覆盖 v2，而不会静默丢字段。旧草稿/确认页不受 v2 门禁回填影响。

无需迁移、回填或数据回滚。未来若需跨确认快照永久定位历史数据，应在阶段 3 按证据另行评审，不能静默改变现有 ID。

## 4. 三图与真实输出

原文件始终直接读取，未改图、裁剪、重画或合并。原件为用户 TEMP 附件，哈希与人工 fixture 一致。

| 页 | 原件 SHA-256 | 构造/全部板厚 mm |
| --- | --- | --- |
| 89 | `6d48ac8f8a746eb6c012f8c9ad6c2bf24a4161ab65b00ee9222f351e41a4ba9c` | I 型坡屋面正置/倒置；各 5/10/15/20/25/30 |
| 90 | `3cda1d4a7da48652b779c637bf19418c0fd4b894dccaaf0fdb951b7a8d916aa3` | II 型平屋面正置/倒置；各 5/10/15/20/25/30 |
| 75 | `a712567ae0622aa41f14961f2cf6cd5ebe28e8ecf701391c0d6814dc3e6ebcea` | I 型外墙 C1-3/C1-4；各 5/8/10/15/20/25/30 |

配置模型为 deepseek-chat，响应体返回的实际模型名称保留在各 raw.json 的 responseBody。连接配置 `default_transaction_read_only=on`，取证 report 记录 `transaction_read_only=on`。没有把凭据、响应 headers 或请求图片 data URL 存入文档。

原始结果在 [run1](evidence/complex-atlas-phase1/run1/report.json)、[run2](evidence/complex-atlas-phase1/run2/report.json)、[run3](evidence/complex-atlas-phase1/run3/report.json)、[run4](evidence/complex-atlas-phase1/run4/report.json)。每轮保留 raw / structured / render JSON，失败页保留 failure.json，不删除失败轮次。原始严格脚本将编号缺失计入身份断言，故 75 页日志为 0/14，而非数字识别全错；独立工程对照将“原标签归属正确”和“构造编号字段完整”分开记录。

| 轮次 | 89 | 90 | 75 | 不足 |
| --- | --- | --- | --- | --- |
| run1 | 12 档数字/屋面身份通过 | 12 档数字/屋面身份通过 | 原标签两组保留；漏部位/编号/组级基层 | 防水字段残缺、源符号仍需审核 |
| run2 | 12 档通过 | FAIL：模型 sourceColumns.fieldKey=null，未通过 Schema | 数字正确且识别 C1-3/C1-4，但编号证据为整格文字，当时校验过严而清空 | 已支持整格证据，空 fieldKey 改为留全文/警告，绝不猜字段 |
| run3 | 12 档通过 | 12 档通过 | 原标签保留、编号仍空 | 证明输出仍不稳定 |
| run4 | 数字通过，symbol 写成单位 | 数字、两组同值与 4 条备注保留 | 数字/基层正确，编号仍空 | 最终候选保留人工核对缺口 |

最终代码对 run4 原始对象做了一次**离线证据处理重放**，不是额外模型成功轮次，也不是已确认记录：

- [89 页候选](evidence/complex-atlas-phase1/page-89.candidate.json) / [候选 RenderModel](evidence/complex-atlas-phase1/page-89.candidate-render.json)
- [90 页候选](evidence/complex-atlas-phase1/page-90.candidate.json) / [候选 RenderModel](evidence/complex-atlas-phase1/page-90.candidate-render.json)
- [75 页候选](evidence/complex-atlas-phase1/page-75.candidate.json) / [候选 RenderModel](evidence/complex-atlas-phase1/page-75.candidate-render.json)

三个文件均标注 REVIEW_REQUIRED、confirmed=false；89 页 symbol 被留空，75 页 constructionCode 仍为空，未拿人工 baseline 修补模型输出。所有分层、λ/α、层 R、options、来源列、备注、原始标签和页码见上述 JSON；[完整 38 行工程对照](evidence/complex-atlas-phase1/engineering-comparison.json)同时保留 constructionId/optionId、基层和源符号检查结果。

### 12 行独立基线

R 单位 `(m²·K)/W`，K 单位 `W/(m²·K)`。这里的 R 是整构造源列“传热阻 R”，不是芯层/产品 R，不重命名 R₀。

| 页 | 原图构造 | mm | 预期/实际 R | 预期/实际 K | 数值与原标签归属 | 其他未通过 |
| --- | --- | --- | --- | --- | --- | --- |
| 89 | 坡屋面正置 | 20 | 5.225 / 5.225 | .191 / .191 | PASS | symbol 待核 |
| 89 | 坡屋面倒置 | 20 | 5.198 / 5.198 | .192 / .192 | PASS | symbol 待核 |
| 89 | 坡屋面正置 | 25 | 6.025 / 6.025 | .166 / .166 | PASS | symbol 待核 |
| 89 | 坡屋面倒置 | 25 | 5.998 / 5.998 | .167 / .167 | PASS | symbol 待核 |
| 90 | 平屋面正置 | 20 | 5.369 / 5.369 | .186 / .186 | PASS | 防水等级待核 |
| 90 | 平屋面倒置 | 20 | 5.369 / 5.369 | .186 / .186 | PASS | 防水等级待核 |
| 90 | 平屋面正置 | 25 | 6.169 / 6.169 | .162 / .162 | PASS | 防水等级待核 |
| 90 | 平屋面倒置 | 25 | 6.169 / 6.169 | .162 / .162 | PASS | 防水等级待核 |
| 75 | 外墙 C1-3 / 蒸压灰砂砖 240 | 20 | 6.916 / 6.916 | .145 / .145 | PASS | 编号字段缺失 |
| 75 | 外墙 C1-4 / 加气混凝土砌块 200 | 20 | 7.540 / 7.540 | .133 / .133 | PASS | 编号字段缺失 |
| 75 | 外墙 C1-3 / 蒸压灰砂砖 240 | 25 | 8.516 / 8.516 | .117 / .117 | PASS | 编号字段缺失 |
| 75 | 外墙 C1-4 / 加气混凝土砌块 200 | 25 | 9.140 / 9.140 | .109 / .109 | PASS | 编号字段缺失 |

90 页两组的 12 个 optionId 独立；75 页即使 constructionCode=null，仍由原标签和独立 constructionId 区分，未按 R/K/厚度去重。正式 HTTP/SSE 的已确认行引用尚未执行，不能把候选 RenderModel 当作 API 验收。

## 5. 测试证据与旧能力边界

| 命令/范围 | 状态 | 结果/日志 |
| --- | --- | --- |
| `pnpm lint`（最终代码） | PASS | 语义 AST 检查 + Backend TypeScript；[日志](evidence/complex-atlas-phase1/lint-release.log) |
| `pnpm build`（最终代码） | PASS | [日志](evidence/complex-atlas-phase1/build-release.log) |
| `pnpm db:check` | PASS | 迁移静态检查，不执行迁移；[日志](evidence/complex-atlas-phase1/db-check.log) |
| `pnpm exec tsc -p tsconfig.uat.json --noEmit`（最终代码） | PASS | 包含新增取证脚本；[日志](evidence/complex-atlas-phase1/script-typecheck-release.log)，成功无输出 |
| `pnpm test` | FAIL | 2267 PASS / 52 FAIL / 1 SKIP，6 个失败文件；[全量日志](evidence/complex-atlas-phase1/full-test.log) |
| 最终定向测试命令（下方） | PASS | 9 文件 90 项，覆盖最终证据校验/修复和资料来源引用；[日志](evidence/complex-atlas-phase1/targeted-release.log) |
| 真实模型取证脚本（下方） | PARTIAL | 各轮 report 有严格 FAIL；[最后一轮日志](evidence/complex-atlas-phase1/vision-round4.log) |
| 真实 HTTP/SSE、浏览器、移动端 | NOT_RUN | 本阶段无对应实测，不引用 Mock 代替 |

最终定向命令：

```powershell
pnpm exec vitest run src/shared/page-recognition-evidence.test.ts src/modules/knowledge/knowledge-page-recognition src/shared/knowledge-page-render.test.ts src/shared/readable-page-render.test.ts src/modules/knowledge/knowledge-test-reference.test.ts --maxWorkers=2
```

真实取证命令（输出位置在 TEMP，各轮目录不同）：

```powershell
node --import tsx scripts/verify-complex-atlas-recognition.ts --output C:/Users/admin/AppData/Local/Temp/vicp-complex-atlas-phase1-20261015/live-round4
```

全量测试之后新增了空 fieldKey 安全修复、symbol 单位串校验及 Worker 候选安全测试；这部分以最终 90 项定向测试和最终 lint/build 验证，没有重复声称最后一行改动后再次全量运行。全量 52 条失败的测试名称集合与阶段 0 完全相同，见 [逐项比较](evidence/complex-atlas-phase1/failure-baseline-comparison.json) 和 [完整失败清单](evidence/complex-atlas-phase1/failed-cases.txt)。集中在 domain-semantic-regression、reference-candidate-resolver.service、reference-fact-read.service、solution-advice-context、solution-advice.service、solution-state.service；没有改这些文件来消除既有失败，整库测试不能标 PASS。

旧 A3 JSON/ID 兼容测试是构造 Fixture，不是旧 A3-1～A3-4 四基层实际发布数据验收。真实 A3、Confirm/Snapshot/PDF/权限端到端回归 **NOT_RUN**；此前只读库存与本次任务的写入范围不足以证明生产回归。旧 CONFIRMED 页、热工行、Candidate、SolutionSnapshot、既有 PDF 均未被本阶段迁移/重识别/确认或回写。后台取证只读读取模型配置；单元/事务测试使用内存 Mock，未把测试页写入当前业务数据库。

## 6. 未通过清单与下一阶段前置条件

1. **识别 PARTIAL**：75 页编码漏填；89 页源符号误填；防水等级字形仍不稳定。已保留原始数据与 REVIEW_REQUIRED，必须人工核对，不能自动确认。后续如继续优化，需要按冻结 Prompt/模型配置重新做重复识别，而不是按页码写补丁。
2. **审核 UI NOT_RUN**：B 端尚不支持新属性/证据。旧编辑器降级提交会拒绝。阶段 2 必须先展示这些字段、允许保留空编号、对比原图并保留人工修订信息，再考虑发布后端/重新识别。
3. **查表缺口未实施**：新 v2 的产品 R 正确保留 null，因此不能沿用旧“四字段齐全”准入假装召回成功。阶段 3 应复用已确认页做只读查表，不放宽正式热工同步或方案确认。
4. **引用/前端未联测**：当前只是服务端可选字段透传及候选预览。B/App 的源表头 R、层档位合并显示、双构造同值、图片授权、历史恢复与真实 SSE 留待对应阶段验证。
5. **环境与旧能力**：真实确认/发布测试须使用可写的隔离业务库、独立 Redis 队列/OSS 前缀；当前仅真实 Vision 核心有证据。旧 A3/PDF 真实回归及既有 52 条测试失败继续列为未通过，不据此部署。

本阶段没有迁移或外部发布等待批准；阶段 1 到此停止。继续阶段 2 需要用户明确批准；保留上述缺口，不自动进入下一阶段。
