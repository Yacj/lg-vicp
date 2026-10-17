# 阶段 0：热工计算 / AI 查询 / 三端展示 只读审计

- 日期：2026-10-17
- 范围：`backend`（thermal、ai）、`admin-web`、`app`
- 性质：**只读审计**。本阶段未修改任何源码、未连接业务库、未部署、未跑迁移。
- 基准：当前工作区真实源码（`src/**` 与 `dist/**` 时间戳一致：dist 10:33 > src 10:23，dist 可用于只读探针）。

---

## 1. 结论摘要

| ID | 结论 | 等级 | 状态 |
| --- | --- | --- | --- |
| A1 | 分层法把「包覆浆料 + 真空绝热板 + 包覆浆料」中的两层包覆记为 `FIXING_LAYER`，`productResistance` 只得到芯材 **4.8**，甲方 Excel 的**产品整体 R = 5.0** 少算 0.2（4%） | P0 | 已证实（探针 + Excel 原值） |
| A2 | `calculateThermal` 在 EQUIVALENT 下对每个 `PRODUCT_LAYER` 用 `productResistance = r` **赋值而非累加**，多层时静默只保留最后一层（探针：期望 4.0，实得 2.4） | P0 | 已证实（探针）；当前 DB 不可达（唯一索引拦截） |
| A3 | 「产品层厚度」存在两套口径：`productOptions` 区间 15–35 与参考行 `thicknessMm=35`，而分层计算把输入厚度**整体写给唯一的 PRODUCT_LAYER（芯材）**。同一物理样例在 15mm 和 35mm 两个数字上分别成立 | P0 | 已证实（探针） |
| A4 | 同一组已发布输入（分层方案 + 规格 + 35mm）：`REFERENCE_TABLE` 给 productR=5 / R₀=5.3068 / K=0.1884；`LAYERED` 给 productR=11.2 / R₀=11.7068 / K=0.0854 | P0 | 已证实（探针复现） |
| B1 | 候选匹配把「该行没有该指标值」和「该行指标不满足」都记成 `unmatched`，无法区分「无字段 / 无匹配」 | P1 | 已证实（读码） |
| B2 | 澄清回复可把上一轮的数字绑到本轮澄清出的指标上；`0.3` 被绑成 `PRODUCT_R` 后无任何行命中，直接输出「当前已发布参考表中没有找到…正式方案」，即用户所说的「错误的无档位话术」 | P0 | 代码路径已证实；端到端需隔离 UAT |
| B3 | AI 回答层把 TOTAL_R 一律写成「**外墙主断面**总热阻 R₀」，屋面构造同样输出 | P1 | 已证实（读码）；前端表头已改为保守标签，前后端不一致 |
| B4 | 产品咨询回答模板对任何用户都输出 λ / α / 可选板厚，不区分「非工程师想了解产品」与「工程师要参数」 | P1 | 已证实（读码） |
| C1 | B 端 `thermalCalcLayerRows` 按「过滤后的层步骤下标」映射层序号，EQUIVALENT 下产品层行拿到的是下一层的 R，末层拿到 `null` | P1 | 静态已证实；待 UI 实测 |
| C2 | B 端表单与结果卡标签为「保温层厚度」，分层构造下该数字实为芯材厚度（15），与参考行 35 不同义 | P1 | 已证实（读码） |
| C3 | 报告打印「产品 R=…」直接取冻结快照，A1 的口径错误会原样进入 PDF | P1 | 已证实（读码，随 A1 传导） |
| D1 | 甲方 Excel 样例集以 `PUBLISHED` + 证据等级 A 参与正式查表（集描述写了 `CALC_EXAMPLE`，但读取服务不过滤该标记） | P2 | 已证实（读码）；需甲方确认口径 |

> 说明：A2 在当前数据模型下**不可达**——`construction_layers` 上有部分唯一索引 `construction_layers_product_unique (scheme_id) WHERE layer_type='PRODUCT_LAYER'`，且 `collectSchemeStructureViolations` 要求「产品层必须且只能有 1 个」。因此它的正确处置是**显式拒绝并返回可解释错误**，而不是靠唯一索引兜底。

---

## 2. 证据与核对

### 2.1 甲方 Excel 原值（附件 `VICP热工计算表格公式(1).xls`，Sheet1，xlrd 读取缓存值）

| 项 | 整体计算（左，B–G 列） | 分层计算（右，J–P 列） |
| --- | --- | --- |
| 构造层数 | 6 层 | 8 层（含产品内 3 个子层） |
| 总厚度 | 270 mm | 280 mm |
| 产品厚度口径 | 25 mm（单层板） | 10 + 15 + 10 = **35 mm**（子层合计） |
| ΣR | 4.156822097834988 | 5.156822097834988 |
| R₀（+0.11+0.04） | 4.3068220978349885 | 5.3068220978349885 |
| K = 1/R₀ | 0.23218976249394965 | 0.18843669178357564 |
| 产品 R | **4.0** | **5.0**（= 包覆 0.1 + 芯材 4.8 + 包覆 0.1） |
| 芯材 R | 不适用（当量均质） | **4.8** |

结论：**左右两例厚度不同（25 vs 35）、构造层不同（6 vs 8），不是同厚度同条件的方法对比**。任何「同厚度比较」的默认行为都必须在实现前经甲方确认。

### 2.2 只读探针（导入 `dist`，不改代码）

```
=== EQUIVALENT（Excel 左） ===
productR 4 / totalR 4.3068220978349885 / K 0.23218976249394965   → 与 Excel 完全一致
=== LAYERED（Excel 右，芯材 15mm） ===
productR 4.8 / totalR 5.3068220978349885 / K 0.18843669178357564
                                  ↑ Excel 产品整体 R = 5.0（差 0.2）
=== LAYERED + thicknessMm=35（DB 参考行声明值） ===
productR 11.2 / totalR 11.706822097834989 / K 0.08542027816284455
参考行：productR 5 / totalR 5.306822098 / K 0.1884366918          → 同输入、两套结果
=== EQUIVALENT + 两个 PRODUCT_LAYER（10mm + 15mm） ===
productR 2.4（steps 里 product_1=1.6、product_2=2.4，只保留后者）
期望（累加）4.0
```

### 2.3 测试实跑（本阶段真实执行，非引用历史结论）

```
npx vitest run thermal-calculator / thermal-regression / thermal-calc.service
  → 3 files / 32 tests 全通过

npx vitest run thermal-lookup.tool / thermal-lookup / search-knowledge-thermal-clarification
             thermal-lookup-semantics / thermal-target-binding / thermal-answer-validation
             ai-domain-turn-decision
  → 7 files / 352 tests 全通过
```

**结论：现有 384 个用例全绿，但上面 A1–C2 无一被覆盖**——说明这些是覆盖缺口，不是回归。特别注意 `thermal-calculator.test.ts` 的「客户热工表回归」只断言了 `totalResistance` 与 `kValue`，**从未断言 `productResistance`**，正好放过了 A1。

---

## 3. 逐文件审计清单

### 3.1 `src/modules/thermal/thermal-calculator.ts`

**已证实**
1. `EQUIVALENT` 分支 `productResistance = r`（第 256 行）为赋值，多层产品时覆写前层；`productResistanceFormula`、`productLambdaLabel` 同样被覆写。
2. `LAYERED` 分支 `productResistance += r` 只累加 `layerType === "PRODUCT_LAYER"` 的层；`FIXING_LAYER` 的包覆层进入 `nonProductResistance`，因此 `productResistance` 语义是「产品层热阻」而非「产品整体热阻」。
3. `includeNonProductLayers=false` 时，非产品层既不进 total 也不进 product → 分层构造的产品整体 R 会再少 0.2。
4. `layerResistance` 对 `correctionFactor === null` 静默按 1 处理（文档化行为）。
5. 无任何「产品组 / 子层」概念；`CalcLayer` 无 parent/group 字段。

**待实测**：无（纯函数，探针已覆盖主要分支）。

**需甲方确认**
- 产品整体 R 是否**必须**包含包覆浆料（Excel 右例给出 5.0，倾向「是」）。
- 缺 α 时按 1 计算是否可接受，还是应拒绝计算。
- 公式版本治理：若把包覆层改为产品子层，`productResistance` 定义发生变化 → 属于计算口径变更，必须派生新 `formulaVersion`（如 `VICP-CALC-2`），**不得就地改 `VICP-CALC-1` 影响历史快照**。

### 3.2 `src/modules/thermal/thermal-calc.service.ts`

**已证实**
1. `const productLayer = scheme.layers.find(l => l.layerType === "PRODUCT_LAYER")`（第 618 行）只取第一个产品层（用于 EQUIVALENT 参数校验），但第 693–731 行对**所有**产品层都写入 `input.thicknessMm / 1000`。一旦出现多产品层，每个子层都会拿到全产品厚度 → 数量级错误（35mm 芯材 → R=11.2）。
2. 快照 `layersSnapshot` 同样把全厚度写到每个产品层，并把当量 λ/α 写进产品层行，导致快照无法区分「芯材参数」与「当量参数」。
3. `REFERENCE_TABLE` 用 `eq(thermalReferenceRows.thicknessMm, input.thicknessMm)` 精确匹配，不插值；分层方案的行在 35mm，而 `LAYERED` 计算把 35mm 当芯材厚度 → 两模式互斥（A4）。
4. 计算失败返回字段级 `errors`（`CALC_THICKNESS_OUT_OF_RANGE`、`CALC_PARAM_MISSING` 等），未吞错——这部分设计是好的，可直接复用为「可解释拒绝」。

**待实测**：`includeNonProductLayers=false` 的已发布规则是否真实存在（需查隔离库 `thermal_calc_rules`）。

**需甲方确认**：`productOptions.min/maxThickness` 的语义是「芯材厚度」还是「产品组总厚」；这决定 15/35 二义如何收敛。

### 3.3 `thermal-calculator.test.ts` / `thermal-regression.test.ts`

**已证实**
1. 「客户热工表回归」两例使用默认 `FIXING_LAYER` 标注两个「包裹浆料」，与种子数据一致，但**只断言 totalR / K**；`productResistance` 未断言（A1 漏检点）。
2. `thermal-regression.test.ts` 的 fixture 只有两个自检样例（`basic-layered`、`basic-equivalent`），**没有甲方 Excel 两例**；文件头注释「当前无甲方样例」与 `fixtures/` 实际内容一致，但甲方样例其实已经存在（附件），只是没落成 fixture。
3. fixture 断言 `productResistanceRounded`，但两个 fixture 都只有单产品层，无法暴露 A2。

**建议（阶段 1 执行，不在本阶段）**：新增 `fixtures/thermal-regression/vicp-sheet-overall.json` 与 `vicp-sheet-layered.json`，`expected` 必须包含 `productResistanceRounded: 5.0` 与 `4.0`，并额外断言 `芯材 R=4.8 ≠ 产品 R=5.0`。

### 3.4 `thermal-lookup-mode.ts`

**已证实**
1. 指标优先级注释与实现一致（PRODUCT_R > TOTAL_R > K）；`THERMAL_LOOKUP_METRIC_PATTERN` 把「产品层热阻 / 产品R / 保温板自身热阻」映射到 PRODUCT_R，「整墙/主断面/总热阻/R₀」映射到 TOTAL_R。
2. `inferThermalLookupMode` 对「裸 0.3」返回 `APPROX`（第 75 行正则），不会默认成 MAX_LIMIT——符合约束。
3. `PRODUCT_R` 容差窗口 `approximate 0.05 / maximum 0.2`，与 K 的 0.02 不同；`matchesMetric` 对 MAX/MIN 为单边，APPROX/EXACT 为双边。
4. 探针：`"保温0.3的材料有么"` → `filters=[]`、`needsClarification=false`（确定性层**不澄清**，交给 LLM 层）；`"产品热阻"` → `metric=PRODUCT_R`、`needsClarification=true`。

**待实测**：多轮组合「保温0.3有吗 → 产品热阻 → 不，我指K → 不超过0.3」的真实 LLM 输出（需隔离 UAT）。

**需甲方确认**：PRODUCT_R 的 APPROX 窗口 0.05 是否合理（图集产品 R 多在 2.8–8.3，0.05 约等于 1%）。

### 3.5 `thermal-candidate-matcher.ts`

**已证实**
1. `evaluateConditions` 对指标条件只调用 `matchesMetric`，`undefined` 值与「不满足」同样落入 `unmatched`；`missing` 只覆盖 `substrateThickness` / `buildingType`（B1）。
2. `globalMissingConditions` 只汇总上述两项，指标缺失不参与。
3. 排序：EXACT 优先 → 命中数 → 指标距离 → 厚度升序 → 集 priority → 集版本降序；`isClosestToTarget` 只做标记，不宣称全量极值——符合既有约束。
4. 相邻档只在「精确厚度查询且组内无该档」时产生，区间/无厚度条件不产生相邻。

**待实测**：真实库中是否存在「productThermalResistance 为 null」的参考行（若存在，B1 会把它报成「不满足」而不是「缺字段」）。

### 3.6 `src/modules/ai/tools/thermal-calculate.tool.ts`

**已证实**
1. 计算前重验：`isReferenceRead` 分流只读；`operation=CALCULATE` 要求 `decision.intent === "THERMAL_CALCULATE"`；`answerContract === "REFERENCE_LOOKUP"` 时拒绝计算。授权链未被放宽。
2. 引用绑定：`resolveCandidateReference` → 必须唯一候选；`schemeId/productSpecId/thicknessMm` 与冻结候选不一致即 `THERMAL_INPUT_NOT_GROUNDED`。注意第 322 行用 `/厚度\s*(?:mm)?/` 类似正则放行「本轮原话写了该厚度」的情形。
3. 查表未命中时追加两条 notes（`当前正式参考数据里没有找到同时满足…`、`选用表未命中不等于知识库没有该方案`），并返回 `toolOk` 而非错误——这是 B2 话术的来源之一。
4. 计算成功时把 `productResistance` 原样放进 `calculationFacts.productThermalResistance`，因此 A1 的 4.8 会进入回答事实集。

**待实测**：`ctx.answerContract` 在真实会话中的取值分布（决定是否频繁触发 `REFERENCE_LOOKUP_ONLY`）。

### 3.7 `src/modules/ai/product-read.service.ts`

**已证实**
1. `resolveProductConsultation` 的回答模板固定拼接 `可选板厚 …mm；λ=…；α=…`（第 61 行），与用户身份/目标无关（B4）。
2. `searchProductCatalog` 的 `keyword` / `productType` / `specClass` 都必须能在本轮原话里找到（防模型编造），这一点是好的。
3. `resolveProductConsultation` 在 `types.length > 1` 或目录 > 500 条时要求澄清；单产品目录不会澄清，直接输出技术字段列表。
4. 只读性：仅 `status=ACTIVE` 目录 + 已发布规格 + 可消费资料，未越权。

**待实测**：`"你们VICP产品主要有什么？我不是工程师"` 的实际 intent 归类（PRODUCT_DISCOVERY 还是 PRODUCT_DETAIL）——决定是否走 `needIdentity` 分支。

### 3.8 `src/modules/ai/ai-domain-turn-decision.service.ts`

**已证实**
1. `DOMAIN_SEMANTIC_PROMPT` 已含「缺指标的口语保温查询只澄清指标含义」「裸指标无目标需澄清查看还是设置新目标」「旧 PRODUCT_R 改 K 用 REPLACE」等约束。
2. `validate()` 会二次校验：`queryResultMode === "FACTS_ONLY"` 且无约束、无 prior → `QUERY_NOT_UNDERSTOOD` 回退；`applySemanticQuery` 返回 `unresolved` → `PAGE_QUERY_CONSTRAINTS_INVALID` 回退。只读与副作用分离未被破坏。
3. 提示词是**单条巨型字符串**（77 行数组），没有按「用户目标/受众」分支；B4 的根因不在语义层而在回答模板层。
4. 无关键词正则/`includes()` 路由新增（符合约束 6）；`decideDomainTurn` 只剩封闭命令与问候两个快路径。

**待实测**：真实模型对「产品热阻」这一裸指标回复的 `intent`（CLARIFY vs REFERENCE_QUERY）与 `relation`。

### 3.9 补充发现（不在原始清单，但直接影响本轮失败）

| 文件 | 发现 |
| --- | --- |
| `ai/thermal-answer-validation.ts:125` | `!facts.length` 时输出「当前已发布参考表中没有找到同时满足「…」的正式方案」——B2 的最终话术。`describeQuery` 会回显「产品层热阻 R≈0.3」，但**不告诉用户当前档位实际是 4.0 / 5.0**。`identityMatchedButMetricFailed` 分支只在有方案+厚度条件时才可能触发。 |
| `ai/query-clarification-context.ts:18` | `groundClarificationMetricEvidence` 允许把**上一轮原话**的数值写进本轮 METRIC 约束的 evidence；配合 `parseSemanticQuery` 的 `queryEvidenceText = 上一轮 + 本轮`，`0.3` 可被合法绑到 `PRODUCT_R`。 |
| `ai/tools/tool-result-normalizer.ts:234` | `metricLabel` 硬编码「外墙主断面总热阻 R₀」（B3）。 |
| `ai/conversation-task.ts:320` | 上下文摘要同样硬编码「外墙主断面总热阻 R₀」。 |
| `db/thermal-default-data.ts:207-247` | 甲方样例以 `PUBLISHED` + `evidenceLevel: "A"` 落库；分层行 `thicknessMm=35`、`productThermalResistance=5`（D1、A3）。 |
| `construction/construction-structure.service.ts:81` | 「产品层必须且只能有 1 个」——A2 不可达的守门人，但错误码 `layers.productLayer` 面向管理员，不面向终端用户。 |

### 3.10 `admin-web`

| 文件 | 已证实 |
| --- | --- |
| `utils/thermal-calc.ts` | 只读快照、不重算（符合约束 1）。**C1**：`thermalCalcLayerRows` 先 `filter(key.startsWith("layer_"))` 再按 `index+1` 当层序号，EQUIVALENT 的 `product_5` 被过滤后整列左移。 |
| `utils/thermal-calc.ts` | `thermalCalcSourceLabel` 区分「图集参考值 / 系统计算结果」；`thermalCalcComplianceLabel` 缺限值时输出「未判定（缺少地区限值）」——符合「无正式限值不承诺合规」。 |
| `ThermalCalcRulePanel.vue` | 暴露「含非产品层 / 含表面热阻 / 精度 / 舍入」开关；在当前层建模下关掉「含非产品层」会静默少 0.2（A1 的放大器）。 |
| `views/thermal/calc/index.vue:312` | 标签「保温层厚度 (mm)」（C2）。 |
| `ThermalCalcResultCard.vue:75` | 结果卡「保温层厚度」（C2）。 |
| `knowledge/ThermalOptionTable.vue` | 表头来自 `thermalColumnHeader/thermalGroupHeader`，缺失时回退「整构造传热阻（源文符号待核）」，**未硬编码外墙**；命中高亮按 `constructionId + optionId + fieldKeys` 定位，正确。 |
| `utils/knowledge-thermal-labels.ts` | fallback 标签保守，与后端 AI 层硬编码「外墙主断面」不一致（B3）。 |

### 3.11 `app`

| 文件 | 已证实 |
| --- | --- |
| `utils/thermalPageTable.ts:49` | 层热阻**不做**「产品整体 R 补位」（符合「层热阻和产品整体热阻互不补位」）；但 `thicknessMm` 在缺 per-layer 证据时回退到 `option.thicknessMm`——多子层产品会把全厚显示到芯材行（A3 的前端表现）。 |
| `components/ai/ThermalPageTable.vue` | 列由 `hasProduct` 动态增删；表头/组名来自来源字段；高亮绑定 `optionId + fieldKeys`。 |
| `components/ai/ThermalOptionCard.vue` | 固定展示 厚度 + 产品R + 总R + K 四项，不随用户所问指标裁剪（与「回答形式随目标变化」相关，属 P2）。 |
| `utils/thermalSourceLabels.ts` | 与 B 端同源的保守 fallback，未硬编码外墙。 |

### 3.12 报告 / PDF

| 文件 | 已证实 |
| --- | --- |
| `reports/solution-document-render.ts:134` | 输出「产品 R=…；总 R₀=…；K=…」，标签通用，未硬编码外墙；数值全部来自冻结快照（C3：A1 会原样进入 PDF）。 |
| `reports/report-snapshot.service.ts` | 只读 `thermal_candidate_selections` + `thermal_calc_records` + `thermal_standard_limits`，按 `requestId + projectId` 绑定，未回读最新规则覆盖历史。 |

---

## 4. 调用图

```
用户消息
  │
  ├─ decideDomainTurn(message)                     ← 仅封闭命令 / 问候两个快路径
  │     └─ SEMANTIC_REQUIRED
  │          └─ resolveDomainTurn()  [LLM: DOMAIN_SEMANTIC_PROMPT]
  │                └─ applyDomainPolicy()  → intent / mutation / effectRequest
  │
  ├─ [只读] isReferenceRead → resolveReferenceRead() → facts（不写库）
  │
  └─ thermal tool (LOOKUP_CANDIDATES | CALCULATE)
        │
        ├─ LOOKUP
        │    ├─ parseSemanticQuery()
        │    │     ├─ parseSemanticFastPath()          （纯符号 K<=0.3）
        │    │     ├─ applySemanticQuery()             ← 语义 → ThermalQueryState
        │    │     │     ├─ resolveQueryEntities()     （目录/别名）
        │    │     │     ├─ parseThermalLookupMessage()（指标/数值/模式 completeness 校验）
        │    │     │     └─ parseThermalThicknessMessage()
        │    │     └─ groundClarificationMetricEvidence()  ← 澄清回复绑定上一轮数值
        │    │
        │    ├─ querySolutionCandidates()
        │    │     ├─ queryThermalCandidates()          ← thermal_reference_rows（正式集）
        │    │     │     ├─ matchThermalCandidates()    ← 纯函数匹配/排序
        │    │     │     └─ evaluateConditions()        ← 命中/未命中/缺失三态（B1 缺陷点）
        │    │     └─ querySelectedKnowledgeCandidates()← 仅正式集 0 命中时回退（确认图集页）
        │    │
        │    ├─ emitReferencePages()                    ← 权限/版本/页码重验 + 原图签名
        │    └─ buildAllowedAnswerFacts()               ← 事实集 + canonicalAnswers
        │          └─ thermal-answer-validation.ts:125  ← 「没有找到…正式方案」（B2 话术）
        │
        └─ CALCULATE
             ├─ resolveCandidateReference()             ← 必须唯一已核验候选
             ├─ resolveScopedThermalStandard()          ← 仅「达标/合规」才要求
             └─ executeThermalCalc()
                   ├─ getPublishedConstructionSchemeDetail()
                   ├─ resolveMaterialFacts() / resolveThermalParameter()
                   ├─ calcLayers: PRODUCT_LAYER.thickness = input.thicknessMm   ← A3
                   ├─ calculateThermal()                ← 纯函数（A1/A2 缺陷点）
                   └─ thermal_calc_records 快照 + 审计
```

**跨端读取路径**

```
admin-web  views/thermal/calc → api/modules/thermal.ts → 同一 REST（executeThermalCalc）
app        对话 → 同一 thermal tool → executeThermalCalc
报告        report-snapshot.service → thermal_calc_records（冻结） → solution-document-render
```

→ 三端**共用**同一计算服务与同一份快照，没有第二套计算器（`admin-web/utils/thermal-calc.ts` 只读快照）。约束 1 当前成立。

---

## 5. 影响矩阵

| ID | 缺陷 | 计算口径 | 查表 | AI 回答 | B 端展示 | App 展示 | PDF | 严重度 |
| --- | --- | :-: | :-: | :-: | :-: | :-: | :-: | --- |
| A1 | 分层产品 R 少算包覆层（4.8 vs 5.0） | ● | ○ | ● | ● | ● | ● | P0 |
| A2 | EQUIVALENT 多产品层覆写（静默 2.4） | ● | — | ○ | ○ | — | ○ | P0 |
| A3 | 产品层厚度 15/35 二义 | ● | ● | ● | ● | ● | ● | P0 |
| A4 | 同输入 REFERENCE_TABLE ≠ LAYERED | ● | ● | ● | ● | ● | ● | P0 |
| B1 | 指标缺失与不满足合并 | — | ● | ● | ○ | ○ | — | P1 |
| B2 | 澄清后绑旧值 → 「无档位」话术 | — | ● | ● | — | — | — | P0 |
| B3 | AI 层硬编码「外墙主断面 R₀」 | — | — | ● | — | — | — | P1 |
| B4 | 产品介绍固定输出 λ/α/板厚 | — | — | ● | — | ● | — | P1 |
| C1 | B 端层表 R 值错位（EQUIVALENT） | — | — | — | ● | — | — | P1 |
| C2 | 「保温层厚度」标签二义 | ● | ● | ● | ● | — | ● | P1 |
| C3 | 报告继承 A1 的产品 R | ● | — | — | — | — | ● | P1 |
| D1 | 甲方样例集参与正式查表 | — | ● | ● | ● | ● | ● | P2 |

● 直接受影响　○ 间接/条件性受影响　— 不受影响

---

## 6. 本阶段明确未做 / 未验证

- 未连接任何业务库、未执行 SQL、未查 `thermal_calc_rules` / `thermal_reference_rows` 的真实行。
- 未调用真实模型，B2 的端到端链路（LLM 提案 → 绑定 → 话术）**仅由代码路径推定**，标记为「待隔离 UAT 实测」。
- 未启动 B 端 / App，C1、C2、App 多子层厚度显示均为**静态读码结论**，未截屏验证。
- 未运行 `lint` / `build` / 全量测试（本阶段只跑了 384 个热工相关用例）。
- 未修改任何源码、未新增 fixture、未改快照、未部署。

---

## 7. 阶段 1 入口建议（仅建议，未实施）

1. **先写会失败的 Golden tests**：把甲方两例落成 fixture，`expected` 增加 `productResistanceRounded`（4.0 / 5.0），并单独断言 `芯材 R=4.8` 与 `产品整体 R=5.0` 是两个事实。
2. **产品组/子层设计（需甲方确认后再动）**：`CalcLayer` 增加可选 `productGroupId`（或新增 `PRODUCT_SUBLAYER` 层类型），使 `productResistance = Σ(同组层)`。这属于**计算口径变更**，必须派生 `VICP-CALC-2` 并保持 `VICP-CALC-1` 对历史快照可重放。
3. **多 PRODUCT_LAYER 的确定性拒绝**：在 `executeThermalCalc` 组装 `calcLayers` 前检测 >1 产品层 → 返回 `CALC_MULTI_PRODUCT_LAYER_UNSUPPORTED`（可解释），不要依赖唯一索引或 calculator 的覆写。
4. **厚度口径收敛**：明确 `productOptions.min/maxThickness` 指芯材还是产品组总厚，并在 B 端表单、AI tool 描述、参考行三处使用同一措辞。
5. **边界测试补齐**：mm/m 换算、λ、α、表面换热阻、`include*` 两个开关、缺 α、取整模式、合规阈值边界。

---

## 8. 需甲方确认清单（汇总）

1. 分层计算的产品整体 R 是否必须含两层包覆浆料（Excel 给 5.0）。
2. 包覆浆料在正式口径里属于「产品子层」还是「施工固定层」。
3. `productOptions` 厚度语义：芯材厚度 or 产品组总厚。
4. 25mm 与 35mm 两例是否需要在系统中做「同厚度比较」（当前物理上不可比）。
5. 缺修正系数 α 时应按 1 计算还是拒绝。
6. 甲方 Excel 样例集是否可作为正式参考表参与 C 端查表（当前是 PUBLISHED）。
