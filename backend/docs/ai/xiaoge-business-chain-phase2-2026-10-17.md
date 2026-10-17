# 小格 AI 业务理解、检索与热工问答：阶段 2（产品介绍与上下文衔接）

执行日期：2026-10-17（Asia/Hong_Kong）。本阶段只做阶段 2，完成后停止。

## 0. 先核对阶段 0 / 阶段 1 的实际状态

进入阶段 2 之前先复核了上一阶段产物，结论如下（均为本轮实跑/实读）：

| 检查项 | 结果 |
|---|---|
| 阶段 0 文档 | `docs/ai/xiaoge-business-chain-phase0-2026-10-17.md` 存在，A1–A3 / B1–B4 / C1 / D1 / E1–E2 结论与当前源码一致 |
| 阶段 1 证据 | `docs/ai/evidence/xiaoge-business-chain-phase1-2026-10-17/` 有 `tests-full-attempt1/2.json`、`real-readonly-service-attempt1.json` |
| 阶段 1 结论文档 | **缺失**：`docs/ai/` 下没有阶段 1 的结论文档，只有证据 JSON。建议补一份，否则阶段 3 无法引用阶段 1 的问题根因表 |
| 阶段 1 测试 | 本轮重跑 8 个核心文件（solution-candidate-query / reference-query-diagnostics / reference-source-identity / confirmed-page-diagnostics / reference-query.service / thermal-candidate.service / reference-followup-p0.audit）→ **8 文件 81 用例全通过** |
| 阶段 1 attempt1 的 1 个失败 | 失败项是 `reference-followup-p0.audit.test.ts > 局部Refine正式重查并更新Candidate revision`。核对 diff：只新增了 1 行 mock 字段 `readOnlyReferences/readOnlyFacts`，是新增返回合同的必要模拟，**不是改断言迎合实现** |
| 类型检查 | `tsc -p tsconfig.json --noEmit` 干净（阶段 1 状态、阶段 2 改动后各跑一次） |

阶段 1 的实现口径可以确认成立：`querySolutionCandidates` 现在两类来源都读（`completePublishedScope`），来源绑定先于展示截断，知识事实只进 `readOnlyReferences` 不升格为可 Confirm 候选，诊断 `diagnoseReferenceQuery` 贯通到 Service 返回值。

同时发现阶段 1 留下一处结构性问题（本轮**未**改动，留给阶段 3）：

- `solution-candidate-query.service.ts` 在 Service 层直接拼装用户可见文案（`formalAnswer` / `answer` / `readOnlyAnswer` 与 `[[KP:...]]` 标记），`reference-query.service.ts` 再用 `facts.canonicalAnswers = [rendered.text]` 覆盖事实层回答。行为和测试都成立，但「事实取得」与「解释组织」又被合并回 Service，与本轮架构要求相反。阶段 3 应把它移回 AnswerFacts/RenderModel 层。

## 1. 本阶段问题的真实根因与触发条件

### C1（P0）：普通产品咨询只出技术参数清单

**根因**：事实与解释没有分开，且不是模型造成的。

- `product-read.service.ts` 旧实现把 `products` 直接拼成固定字符串（名称 + 型号 + 板厚 + λ + α），这一份字符串对「介绍」和「问参数」是同一种输出。
- `ai-generation.service.ts` 走 `directProductRead` 分支时 `fullText = productRead.answer` 直接落盘并推送，**不调用回答模型**；`tool-result-normalizer.ts` 里已有的「介绍性问题用业务语言」指引属于另一条 Tool 归一化路径，这条分支从不消费它。
- 结果是：无论用户说「我不是工程师，简单介绍」还是「25mm 的 λ 是多少」，都得到同一串参数。触发条件就是 `intent ∈ {PRODUCT_DISCOVERY, PRODUCT_DETAIL}` 且未启用 Agent 的直出分支。

**补充根因（事实侧，本轮只做边界说明，不做数据补录）**：`searchProductCatalog` 的关联文档只取标识与标题，不读正文；目录 `summary` 为空时，服务本身没有可用于「用途/特点」的有依据文案。因此仅改提示词不可能得到有出处的介绍——必须允许「只能说名称与已有字段」，而不是让模型补。

### D3（P0）：口语/错别字的体系词被静默丢弃

**根因**：不在 Policy，也不在别名机制。`applyDomainPolicy` 对 `semantic.unresolved` 与 `semantic.ambiguity` 一律转 `CLARIFY / SEMANTIC_AMBIGUOUS`，别名归一也在 `applySemanticQuery` 的 `SET systemHint` 分支里存在（`query.systemHint = entityText` + `resolveQueryEntities` 走正式目录与已配置别名）。缺的是**上游没有把词交出来**：`薄膜灰系数0.3` 的已存提案只含 `PRODUCT_R` 数值，原话里的体系词既没进 `systemHint` 也没进 `ambiguity`，于是查询被放宽到全部体系，最终由空结果模板回答「没有可核验档位」。

因此这是 Semantic 的**漏字段**问题。本轮用提示词合同收紧（不是代码关键词），并要求名称归一继续只走正式目录 / `knowledgeAliases`。

### 其余 D 项（本轮为复核，非新缺陷）

| 要求 | 结论 |
|---|---|
| 澄清后保留上一轮数值/筛选 | 已实现：`pendingClarification.inheritPrevious` → `REFINE_QUERY`，数值证据用核验过的原问 |
| 改指标 REPLACE 不叠加 | 已实现于 `thermal/semantic-query.ts`（`REPLACE` 清旧 `filters`），本轮补一条回归 |
| 换主题不继承 | 已实现：`NEW_QUERY` 清旧条件；本轮以 `SWITCH_TOPIC`/`NEW_QUERY` 用例复核 |
| 只读查询不误触发副作用授权 | 已实现：`QUERY` 只校验结构与非否定，不要求副作用授权；`STATE_MUTATION/REPORT/CALCULATE` 才要求直接肯定请求 |
| 澄清不清候选 | 已实现：`applyDomainPolicy` 是纯函数；`resolveReferenceQueryWithoutAgent` 在 `CLARIFY` 分支提前返回，不会执行 `delete state.confirmedPageLookup` |
| 旧序号不能套新列表 | 已实现：`reference.revision` 与 `lastReferenceLookup.candidateQueryRevision` 比对 |

## 2. 涉及的文件、函数与调用关系

**新增**

- `src/modules/ai/product-answer.ts`
  - `resolveProductAnswerMode()`：只读 `domainDecision.intent` 与 `semantic.audience`，不做关键词判断。
  - `buildProductAnswerFacts()`：把可信目录结果收成事实合同（名称/summary/类型/型号/板厚/λ/α/已发布规格/资料标题）。
  - `planProductAnswer()`：`FACTS_ONLY` 还是 `MODEL_WITH_FACT_CHECK`（澄清、无结果、模型不可用一律 `FACTS_ONLY`）。
  - `formatProductFactsAnswer()`：确定性的「仅事实」回答，按介绍 / 客户介绍 / 技术三种形态输出。
  - `formatProductAnswerInstructions()`：回答模型的事实边界与表达规则。
  - `validateProductAnswer()`：回答里的板厚/λ/α 数值必须出自事实或用户原话，越界即回落。

**修改**

- `src/modules/ai/product-read.service.ts:63-67`：事实取得到此结束，产出 `facts` + 形态化 `answer`；固定参数清单拼接删除。
- `src/modules/ai/ai-generation.service.ts`
  - `:571` 系统提示由「整份 productRead JSON」改为「事实边界 + 已核验事实」。
  - `:733-756` 直出分支改为：`planProductAnswer` 判形态 → 模型组织（`streamText`，校验通过才落盘）→ 失败回落 `productRead.answer`，并记录 `CATALOG_VERIFIED / CATALOG_FACT_FALLBACK / CATALOG_MODEL_UNAVAILABLE`。
  - `:1158` `factValidationCode` 如实反映是否经过事实校验。
- `src/modules/ai/ai-domain-semantic.ts:12`：新增 `audience`（`GENERAL/SALES/ENGINEER/UNSPECIFIED`，默认 `UNSPECIFIED`），只影响表达，不参与置信度、条件与授权。
- `src/modules/ai/ai-domain-turn-decision.service.ts`：新增两条提示合同——① 无法映射的体系/型号/构造名称必须逐字保留为 `entityText`/`systemHint`，不得静默丢弃后放宽查询；② `audience` 只按用户自述判定。
- `src/modules/ai/domain-semantic.fixture.ts`：受控 fixture 补 `audience` 默认值（类型必需字段，非行为改动）。

调用关系：

```text
resolveDomainTurn → applyDomainPolicy（audience/ambiguity 结构化，纯函数）
  → ai-generation.resolveProductConsultation（正式目录 + 已发布规格 + 有权资料）
    → buildProductAnswerFacts（事实合同）
    → planProductAnswer → 模型组织 → validateProductAnswer → 通过/回落
      → product_cards / sources 事件 → 正文
```

## 3. 修改内容与选择理由

1. **只把表达交给模型，事实仍由服务决定**：产品事实在白名单 JSON 里，模型没有新增字段、换算或补数的空间；数值越界就回落确定性回答，保证「有资料支持」这条底线不依赖模型自律。
2. **形态由 Semantic 决定，不由服务猜**：`PRODUCT_DISCOVERY` 默认介绍形态，`PRODUCT_DETAIL` 默认技术形态，用户自述（`audience`）可覆盖。这样不需要「我不是工程师」这类原句判断，也能推广到销售/设计场景。
3. **澄清、无结果、模型不可用一律走确定性回答**：空事实不进自由生成，避免「模型替资料说话」。
4. **不改变任何权限**：产品分支不产生 Candidate、不写 SolutionState、不授权计算/报告；`audience` 只进提示词。
5. **体系词用结构化字段承接，不用关键词兜底**：`ambiguity` 为空才可能宽查；有词就澄清，能归一则走既有别名/正式目录。归一后仍查不到，由阶段 1 的 `IDENTITY_NOT_FOUND` 诊断说明，而不是含糊的「没有档位」。

## 4. 字符串/正则与兜底

| 新增 | 用途 | 边界与反例 |
|---|---|---|
| `/(\d+(?:\.\d+)?)\s*(?:mm|毫米|㎜)/` | 产品回答事实校验：抽取板厚数值 | 只在**已生成回答**上做数值比对，不参与意图、路由、查询条件；`35mm` 若来自用户原话同样放行 |
| `/(?:λ|α|K值|R0|R₀|\bK\b|\bR\b)\s*…(\d+(?:\.\d+)?)/` | 抽取 λ/α/热工数值 | 同上；不用于判定用户问的是什么指标 |
| 无 | 未新增任何意图关键词、未新增原句正则、未在多个 Service 重复识别自然语言 | 产品形态判断只读 `intent`/`audience`；体系词判断只在 Semantic 提示合同 |

兜底顺序（产品咨询）：模型组织 → 数值校验失败 → 确定性仅事实回答；模型异常 → 确定性回答并记录 `CATALOG_MODEL_UNAVAILABLE`。没有「猜一个更像人话的模板」这一层。

## 5. 测试结果

**定向（本轮实跑，证据 `docs/ai/evidence/xiaoge-business-chain-phase2-2026-10-17/tests-phase2.json`）**

`vitest run` 8 个文件 / 19 个套件：**105 passed / 0 failed**，含：

- `product-answer.test.ts`（13）：形态只由 Semantic 决定；介绍形态不出 λ/α；技术形态出型号/板厚/λ/α/规格；无 summary 时不编造；编造 λ=0.008 与 40mm 被拒；用户自写 35mm 放行；空回答不通过；`planProductAnswer` 四种分支。
- `product-context-continuity.test.ts`（6）：名称进 `ambiguity` → `CLARIFY/SEMANTIC_AMBIGUOUS` 且候选与查询条件原封不动；低置信查表不换授权；结构化只读查表不要求副作用授权；`STATE_MUTATION` 无直接请求只澄清；纠正指标 REPLACE；`audience` 缺省不影响只读语义。
- `product-read.service.test.ts`（6，含新增 2）：介绍目标不直出技术清单；自述工程背景时同一批事实转技术形态。
- 既有上下文套件全通过：`thermal-phase2-dialogue`（11）、`query-clarification-context`（11）、`thermal-query-context-regression`（33）、`domain-semantic-regression`（16）、`ai-domain-turn-decision.service`（9）。

**全量（本轮实跑）**

`pnpm exec vitest run`：**2617 passed / 1 failed / 1 expected fail / 1 skipped**（226 文件）。

- 唯一失败：`tests/report-runtime.test.ts > 服务器脚本自检失败必在迁移/seed/PM2之前退出并恢复dist`，`spawnSync` 返回 `status=null` 且临时目录 `EBUSY`。该用例只涉及 `deploy/` 部署脚本与 Windows 临时目录，本阶段未触及部署脚本；单文件复跑仍失败，判为环境相关不稳定项，**保留失败记录，未修改该测试**。
- `1 expected fail` 是阶段 0 记录的 E1（芯材 R 4.8 与产品整体 R 5.0 口径差），仍未修复（按任务要求只能标记与隔离）。

**未执行**

- 未调用真实模型 / 未重放 HTTP/SSE 连续对话；`audience`、`ambiguity` 的真实模型稳定性需阶段 4 验证。
- 未在隔离库跑产品目录真实数据（本轮产品断言使用受控 fixture/mock）；未验证真实 `summary` 覆盖率。
- 未跑 lint（`pnpm semantic:check`）、build、db:check；未部署、未迁移、未 seed。
- 未验证三端页面实际呈现（产品卡事件与 `sources` 复用原有通道，未做浏览器验收）。

## 6. 对知识库、热工计算、权限、Snapshot 与报告的影响

| 范围 | 影响 |
|---|---|
| 知识库 | 只读，未改检索范围；产品关联资料仍只取标识与标题，未新增正文读取 |
| 热工计算 | 未触及 Calculator、Thermal Tool、VICP-CALC-1 与历史计算；E1 口径差保持标记状态 |
| 权限 | 未改；`audience` 不参与任何授权；已存访问守卫、24h、revision、`optionId/sourcePageId` 重验均未变更 |
| 候选/方案 | 产品分支仍不产生 Candidate；澄清轮不清候选（本轮用例显式断言 Policy 纯函数不改状态） |
| Snapshot / 报告 | 未生成、未改写；正式 Confirm 与 PDF 仍需显式授权，本轮无相关路径变化 |
| 成本/时延 | 产品咨询多一次回答模型调用（原来不调用）。模型不可用或事实不足时自动回落，不阻断回答 |

## 7. 未解决与下一阶段建议

1. **阶段 1 结论文档缺失**：建议补 `docs/ai/xiaoge-business-chain-phase1-2026-10-17.md`，把 A1–A3/B1–B3 的修复与验收落成可引用文档。
2. **阶段 1 的 Service 直出文案**（本轮发现）：`solution-candidate-query.service` 组装正文、`reference-query.service` 覆盖 `canonicalAnswers[0]`。阶段 3 建议移入 AnswerFacts/RenderModel，Service 只返回事实与诊断。这是结构问题，不是当前功能缺陷。
3. **产品资料正文**：`summary` 为空时介绍只能给名称与分类。要不要在产品目录维护「已审核介绍/场景」字段，或允许读取关联文档正文的已发布片段，属于业务与资料治理决策，本阶段不擅自补录。
4. **"薄膜灰"类错别字**：本轮只做了「不得静默丢弃」的合同收紧，未新增任何别名数据。真实模型是否稳定保留该词、是否能映射到正式体系，需阶段 4 用真实模型 + 隔离库复验；若长期不稳定，应由后台 `knowledgeAliases` 补正式别名，而不是加正则。
5. **阶段 3 待查**：Thermal Tool 用 `/已选|选中的|保留的/` 重写已验证 `referenceScope`（阶段 0 的 E2）仍在；`productThermalResistance` 的芯材/产品整体口径隔离仍未落到运行时事实。

**阶段 2 到此停止，等待确认后再进入阶段 3。**
