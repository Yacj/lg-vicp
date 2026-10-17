# 小格 AI：阶段 4 两个 P0 的根因定位与修复（修复轮）

执行日期：2026-10-17（Asia/Hong_Kong）。本轮只处理阶段 4 结论中的 F1 / F2，完成后停止。

## 1. F2（已定位并修复）：构造编号查表被逐字段复核无条件拒绝

### 精确根因（隔离环境实测，不再是推测）

在隔离 UAT 库里直接构造同一轮语义提案（`A1-3 I型18mm图集参数`）打印中间状态：

```text
entities 17  aliases 0
explicit = {"schemeId":"a989363b-b10c-47be-b1dc-01e2488702eb"}
query    = {"schemeCode":"A1-3","specClass":"I","thicknessMm":18}
unresolved = [{"field":"schemeId","reason":"明确指定的对象未被完整保留，请确认。"}]
```

- 字典能从「A1-3」解析出正式构造 ID；
- 模型按提示合同输出的是 `schemeCode` 文本，而不是目录 ID；
- `semantic-query.ts` 的逐字段复核要求 `query.schemeId === explicit.schemeId`，于是判定「身份丢失」。

**影响面**：任何按构造编号的查表（`A1-3 …`）都会被拒绝，与具体产品/指标无关。

### 修法

`src/modules/thermal/semantic-query.ts`：把「构造编号」与「构造 ID」视为同一条身份的两种表示，只要其中一种已被保留就不判丢失；等价性通过字典里 `schemeId` 实体的 `names`（含 `schemeCode`）校验，不做模糊匹配。

```ts
const sameSchemeIdentity = (schemeId) => query.schemeCode
  && dictionary.entities.some(e => e.field === "schemeId" && e.value === schemeId
    && e.names.some(name => normalizeSemanticText(name) === normalizeSemanticText(query.schemeCode)));
```

- 只在这一个字段上放宽，其它字段逐一不变；
- 没有保留任何编号表示时仍然拒绝（有回归用例）；
- 不放宽容差、不补条件、不签发目录 ID。

### 验证

- 单测 `src/modules/ai/scheme-identity-recheck.test.ts`（3 例）：保留编号不拒绝；无编号仍拒绝；无字典时不签发 ID。
- 真实 UAT `DESIGN-012` Turn 1（隔离库 + 真实模型）：

| | 修复前（阶段 4） | 修复后（本轮） |
|---|---|---|
| 决策 | `PAGE_QUERY_CONSTRAINTS_INVALID` → CLARIFY「明确指定的对象未被完整保留」 | `READ_ONLY_QUERY`，`toolRoute=["backend:knowledge","backend:reference_query"]` |
| 回答 | 无法回答 | A1-3 / 18mm / 产品层 2.880 / 总 3.297 / K 0.303 / 印刷页 22 |

UAT 仍标 FAIL，但失败项只剩断言口径：期望 `thermal` 工具（架构上 `pageQuery` 走 `reference_query`）、期望正式候选（该轮只有已确认页只读结果）、以及把「不判断规范达标」误判为合规肯定。**功能失败已消除。**

## 2. F1-B（部分修复）：「导热系数λ是多少」不再索要构造编号

`src/modules/ai/reference-fact-read.service.ts`：

1. 省略身份的来源从 `VERIFY` 扩展到 `EXPLAIN`：只取「最近一次实际助手回答中的唯一构造编号」，不从待核对数字反选身份；
2. 历史资料范围只在**确实存在可回溯原页定位**时使用，否则退回本轮授权检索命中，避免「有身份无来源」。

真实 UAT `SALES-014` Turn 2：

| | 阶段 4 | 本轮 |
|---|---|---|
| 决策 | `FACT_IDENTITY_REQUIRED`「请补充要核对的构造编号」 | `CONFIRMED_FACT_READ`，`candidateIdList` 2 档，`sourcePageIds` 1 页 |
| 回答 | 要求用户重报身份 | A1-3、18mm/25mm、R/R₀/K，页 22 |

**仍未完成**：回答没有给出用户问的 λ（`factRead.metric` 枚举里没有 λ，只读事实输出未按所问字段投影）。UAT 因此仍判 ANSWER_CONTRACT 失败。

## 3. F1-A（未修复，已回退）：序号引用仍不能回溯

我最初在 `readHistoricalConfirmedPage` 里加了「按最近一条展示顺序解析 POSITION」，SALES-017 Turn 3 确实从「没有可定位的候选」变成「第 1 条确认记录：页码 22」。

但全量测试暴露既有安全边界用例：

```text
src/modules/ai/confirmed-page-reference-read.test.ts
  position 不能借原页回溯绕过边界  → 期望 undefined
```

该用例是**故意**把 POSITION 排除在原页回溯之外的（序号必须绑定候选 revision，不能从历史页块重建）。用改测试的方式让它通过，等于删除一条既有安全约束，因此**我回退了这段实现**，也回退了为它添加的语义提示行。

**建议的正确修法**（下一轮）：把只读确认页结果发布为「可引用、不可确认」的引用上下文（`referenceKind=KNOWLEDGE_PAGE`，`confirmationEligible=false`），让序号/来源追问走既有 revision 绑定路径，而不是在历史页块里重建顺序。这条要动 `querySolutionCandidates`/`referenceCandidate` 的发布口径，风险高于本轮范围，未实施。

## 4. 其他改动与记录

- `src/modules/ai/tools/thermal-calculate.tool.ts`：`ToolSemanticDecision` 的 scope 枚举补 `LAST_VISIBLE_CANDIDATES` / `NONE`（阶段 3 的类型过窄，`tsc` 后才暴露，属编译修正，不改变运行逻辑）。
- 本轮新增测试 3 例；`readonly-reference-followup.test.ts` 中途创建又删除（其中位置用例随实现一起回退）。
- **失败记录全部保留**：阶段 5 第一次 SALES-017 运行 Hard Fail 由 5 升到 8（实现引入位置解析后断言面变大），第二次回退后回到 6；两次报告都在证据目录里，没有用后一次覆盖前一次。

## 5. 测试结果

| 项目 | 结果 |
|---|---|
| 定向（语义复核 / 原页回溯边界 / 语义查询 / 事实读取） | **52 passed** |
| 全量 `vitest run`（最终状态） | **2652 passed / 1 failed / 1 expected fail / 1 skipped**（230 文件） |
| 唯一失败 | `tests/report-runtime.test.ts`（spawnSync 返回 null + 临时目录 EBUSY），连续第 4 个阶段复现，未修改 |
| `tsc --noEmit` | 通过 |
| 真实 UAT | DESIGN-012（1 次）、SALES-017（2 次）、SALES-014（3 次），隔离库/Redis/OSS 前缀，均正常清理 |

证据：`docs/ai/evidence/xiaoge-business-chain-phase5-2026-10-17/`（`uat-*`、`uat2-*`、`uat3-*`、`tests-full.json`、`tests-full-final.json`）。

**未执行**：第 5 类真实闭环（方案 UAT 仍在创建会话处失败）、PDF 渲染、权限负向真实 HTTP、lint/build、部署。

## 6. 影响评估

| 范围 | 影响 |
|---|---|
| 语义查表 | 只修「同身份两表示」的误判；其它字段校验、容差、条件补全均未变 |
| 只读事实读取 | 身份继承范围扩到 EXPLAIN，且仅用最近一次助手回答中的唯一编号；历史范围需有原页定位 |
| 热工计算 / 公式 | 未触及；VICP-CALC-1 与历史记录不变 |
| 权限 / Snapshot / 报告 | 未变；本轮没有新增任何确认或报告入口 |
| 前端 | 未改 |

## 7. 下一步

1. **F1-A 正解**：只读结果「可引用不可确认」的引用上下文（revision 绑定 + 24h + 本人同端同项目 + optionId 校验），替代在历史页块里重建序号。
2. **λ 类属性追问**：`factRead` 缺「按字段投影」能力（λ/α 只有 detailed 渲染分支），需要把所问字段显式带到只读事实输出。
3. **DESIGN-012 T2/T3**：知识只读命中不能直接成为正式计算输入（需方案/规格 ID）。要么从确认页档位创建计算草稿（产品决策），要么接受「先选正式方案再算」的现有约束，并把回答话术改到不产生「参考值=计算结果」的歧义。
4. UAT 断言层（intent 读 taskType、tools 期望 thermal、合规否定句误判）与方案 UAT 创建会话失败，仍待修。

**修复轮到此停止。**

---

## 8. 补充：上线可行性核查（同日 16:35 追加）

### 8.1 方案 UAT 脚本本身有一个过期参数

`scripts/run-solution-uat.ts` 创建会话时传 `clientApp: "PC_AI"`，而会话接口要求存储用小写枚举（`pc_ai`），因此之前"创建会话失败"。已改为 `pc_ai`（仅测试脚本，非产品代码），并注释说明 JWT 的 `PC_AI` 与会话 `pc_ai` 的差异。

### 8.2 修正脚本后暴露的真实链路口径（重要，且是本轮之前就存在）

隔离环境实测（真实模型，`pc_ai` 会话）：

```text
用户：薄抹灰K不超过0.35有哪些方案？
SSE 事件：message, progress, delta, reference_pages, done
reference_candidates：0 条        solution_advice：0 次
用户：第一个留下
SSE 事件：message, progress, delta, done    （没有任何结构化响应）
```

根因链：`reference-query.service.ts:45` 在 `domainDecision.semantic.pageQuery` 存在时**直接返回查询事实、不调用 `querySolutionCandidates`**；`ai-generation.service.ts:531` 又要求 `!readOnlyPageFacts` 才发布候选。于是结构化查表只会产出只读确认页（`reference_pages`），**不进入任何候选发布**，方案选择 / Final / Confirm / Snapshot / PDF 无从启动。

这是既有行为（阶段 0 引用的同一行代码），不是本轮改动引入；但它是 C 端"查表→选方案→出报告"链路的阻断点。

### 8.3 上线结论

- 纯代码改动，`drizzle/` 无新增迁移，可用 `pnpm run deploy --skip-db`；不涉及历史数据、Snapshot、PDF 或公式。
- **不建议**直接推线上做完整 C 端回归：方案链路阻断 + 序号/λ 追问仍不完整，测试会大面积失败且难以区分新老问题。
- **可以**做只读范围冒烟（产品介绍、查表、原页、口径说明、无命中诊断），前提是把 8.2 与 F1-A 列入已知问题清单。

---

## 9. 查表→候选：路由已修，但被来源绑定拦住（同日 16:45 追加）

### 9.1 已完成

`src/modules/ai/reference-query.service.ts` 新增 `referenceQueryNeedsCandidates()`：只有「语义明确只要原页/层次等只读字段，且没有身份/指标/厚度条件」才跳过候选查询；带指标、厚度、方案/规格/体系身份的查询一律进入 `querySolutionCandidates`。

回归用例 `reference-query-candidate-routing.test.ts`（5 例）覆盖：指标/厚度/构造身份/体系提示 → 需要候选；纯 `readFields`/`pageLabel`/空查询 → 不需要。

### 9.2 直接调用候选查询的阶段计数（隔离库，绕过语义层）

```text
K<=0.35      candidates=0  stageCounts={beforeAll:4, afterFamily:4, afterMetric:4, afterThickness:4, afterAllHard:4}  issues=[SOURCE_NOT_VERIFIABLE]
A1-3 18mm    candidates=0  stageCounts={beforeAll:4, afterFamily:2, afterThickness:1, afterAllHard:2}                    issues=[SOURCE_NOT_VERIFIABLE]
```

隔离库确认真实存在 1 个正式参考集、4 行已发布行（含 A1-3 18mm 2.880/3.297/0.303，页 22）。

结论：**硬条件与匹配都通过（afterAllHard=4），是「来源绑定」把全部正式候选剔除**，所以最终仍为 0。`querySolutionCandidates` 里 `rejectedSourceCount` 随即标记 `SOURCE_NOT_VERIFIABLE`。

### 9.3 结论

- 路由断点已按预期修好（此前根本不会进入候选查询）。
- 但用户可见的「查询后没有可选方案」**仍未解决**，下一处阻断在来源绑定（`emitReferencePages` / 页面可消费性 / 正式行 `source_page_id` 与页面版本的对应）。
- 该问题同样解释了 DESIGN-012 T1：4 行匹配、只读事实能出，但正式候选 0。
- 因此本轮的**上线建议不变**：只读冒烟可以，完整 C 端回归仍会被「查询→候选」卡住。

### 9.4 处理结论：路由改动已回退（不发布半成品）

按「不改既有安全用例」的原则，`referenceQueryNeedsCandidates` 与其路由改动**整体回退**，`reference-query.service.ts` 恢复为「带 pageQuery 即不刷新候选」。回退后相关用例全绿（`confirmed-page-query-readonly` / `reference-query.service` / `reference-followup-p0.audit` / `reference-query-diagnostic-propagation` 共 13 例），`tsc --noEmit` 通过。

回退理由有两条，都不是风格问题：

1. **改了也解决不了问题**：真实阻断在来源绑定。绕过语义层直接调用候选查询时，4 行全部通过硬条件（`afterAllHard=4`），却在来源绑定被剔除（`SOURCE_NOT_VERIFIABLE`），候选仍为 0。
2. **撞上既有不变量**：`confirmed-page-query-readonly.test.ts` 明确要求「确认页事实查询不调用正式 Candidate 查询或发布，不刷新已有候选/方案」。为让方案 UAT 通过而修改它，等于放宽既有约束。

### 9.5 下一步的正确顺序

1. **先修来源绑定**：查清正式行 `source_page_id` / `source_document_id` 与页面版本、`isReferencePageConsumable` 判定为何不一致（隔离库里页面明明可被只读事实读取，但正式候选绑定失败）。这是「查询→候选」的真正阻断。
2. **再决定候选刷新口径**：若要「找方案」类查询刷新候选，用**显式语义字段**（例如 `lookupPurpose=FIND_OPTIONS`）由模型声明，而不是靠「有指标就刷新」的启发式——后者会覆盖上面那条只读不变量。缺省值保持「不刷新」，保证没有模型输出时行为与今天一致。
3. 两项都完成后，用 13 轮方案 UAT 作为放行门槛（当前 0/13，且此前从未成功跑通）。

---

## 10. 用户新报告的会话（17:12）：已修一处，另两处仍在但原因已锁定到「被兜底文案掩盖」

### 10.1 复现到的明确缺陷（已修）

会话：

```text
用户：保温薄抹灰0.3传热系数方案
AI：想确认一下：0.3未说明是整墙传热系数K、整构造热阻R还是产品热阻。
用户：产品热阻
AI：想确认一下：部分明确指标条件未被完整解析，请确认。   ← 用户已明确回答却被拒
```

纯函数复现（`applySemanticQuery`）：

```text
本轮只给 PRODUCT_R 0.3 时 unresolved =
  [{field:"systemId",reason:"明确指定的对象未被完整保留…"},
   {field:"metric",reason:"部分明确指标条件未被完整解析…"}]
```

根因：澄清回复把「上一轮原问 + 本轮」拼成一段文本传给 `applySemanticQuery`，而三处**覆盖校验**扫的是整段文本：

- `parseThermalLookupMessage(text).filters` → 把上一轮的 `K 0.3` 当成「模型本轮漏掉的指标」；
- `resolveQueryEntities(text)` → 把上一轮的「薄抹灰」当成「本轮必须保留的体系」；
- `mentionedParts` 部位扫描同理。

修法：`applySemanticQuery` 增加可选 `currentMessage`，三处覆盖校验只看**本轮原话**；拼接文本仅用于证据核验。调用方 `resolveDomainTurn` 传入当前消息。

回归 `clarification-coverage-scope.test.ts`（4 例）：修复后无 unresolved；**对照用例**不限定范围时旧口径仍会拒（证明不是放宽校验）；本轮真写了体系/两个指标而模型漏字段时仍然拒绝。

### 10.2 仍存在的问题（真实回放，4 轮全部退回澄清）

隔离库 + 真实模型，按用户原话顺序回放：

```text
有保温0.3的材料么        → 澄清指标（可接受）
导热系数                 → “请指定这轮要讨论的保温体系或实际基层”      ← 答非所问
保温薄抹灰0.3传热系数方案 → 又追问 K/R/产品R；并说薄抹灰名称不完整      ← 用户已明确写“传热系数”
产品热阻                 → “请指定…体系或实际基层”                     ← 又回到同一条兜底
```

判断：这三轮都是在 Domain Policy / validate 阶段就被拒，再由 `targetedDomainFallback` 的通用文案答复。**真实拒绝原因（policyReason）没有透出**，所以用户看到的是与问题无关的「请指定体系」，我们也无法从回答反推是哪条校验。

本轮已加两条语义合同（传热系数即 K、λ 不属于查表指标要说明），但真实回放未生效——说明模型提案先被上游规则拒了，提示词还没轮到起作用。

### 10.3 下一步（有明确顺序）

1. **先把拒绝原因暴露出来**：`targetedDomainFallback` 的澄清文案要带上可读的具体原因（或至少写入消息 metadata 的 policyReason，供排查），否则同类问题只能靠猜。
2. 再按真实 reason 逐条修：λ 目标应有专属说明（图集按 K/R 读取，λ 属产品参数），不能落到「请指定体系」；「传热系数」不得再追问指标。
3. 修完用同一段 4 轮脚本复跑，作为该链路的验收（当前 0/4 通过）。

### 10.4 与线上版本的关系

线上（16:58 发布）**不包含**本节修复。10.1 的修复已通过 109 例定向测试与 `tsc`，但 10.2 的链路仍未通，建议与下一步一起验证后再发布。
