# 阶段 2：查表 / 正式计算 / 语义多轮一致性 —— 执行报告

日期：2026-10-17
范围：`./backend`（本轮只改后端；阶段 3 才动 `./admin-web`、`./app`）
前置口径（用户已确认）：5.0 为甲方 Excel 案例目标回归值；4.8 保留为芯材热阻；不改已发布的 VICP-CALC-1；如甲方确认产品边界则新增 VICP-CALC-2 只用于新计算；不动历史 Snapshot / 已生成 PDF / 计算记录。

---

## 1. 结论摘要

阶段 2 发现并修复了 **4 个真实缺陷**，其中 2 个会直接造成用户看到错误结论：

| 编号 | 缺陷 | 严重度 | 状态 |
|---|---|---|---|
| B1 | 「指标列缺失」与「有值但不达标」被合并成同一诊断 | P1 | 已修复 + 已测 |
| B2 | 零命中一律说「没有满足条件的方案」，把「档位有哪些」说成「资料里没有」 | P0 | 已修复 + 已测 |
| **B5** | **语义层已给出的完整指标条件被上一轮旧指标覆盖**（「不，我指K」被静默改回 PRODUCT_R） | **P0** | 已修复 + 已测 |
| B3 | 回答层硬编码「外墙主断面总热阻 R₀」，非外墙构造被套用 | P1 | 已修复 + 已测 |
| B4 | 产品介绍类问题只回目录技术字段（无回答形式指引） | P1 | 已修复 + 已测 |
| B6 | REFERENCE_TABLE 与 Knowledge 图集页两个来源不可区分、冲突静默择一 | P1 | 已修复 + 已测 |

**B5 是本阶段最重要的发现**：它解释了用户真实失败链的后半段。修复前，即使用户明确说「不，我指K」，会话状态里的指标仍是 `PRODUCT_R`，于是紧接着的「不超过0.3」也落到产品层热阻上，最终按产品层热阻口径回答「没有档位」。

---

## 2. B5：指标纠正被历史条件覆盖（根因）

### 2.1 复现（修复前，真实执行）

```
输入：lastQuery = { filters:[{metric:"PRODUCT_R", targetValue:0.3, mode:"APPROX"}], metric:"PRODUCT_R" }
本轮：input = { filters:[{metric:"K", targetValue:0.3, mode:"APPROX"}] }，原话「不，我指K」

输出：needsClarification = true
      metric = "PRODUCT_R"          ← 被覆盖回旧指标
      filters = [{ PRODUCT_R, 0.3, APPROX }]   ← 语义层给的 K 条件被丢弃
```

### 2.2 根因

`backend/src/modules/ai/tools/thermal-lookup.ts` 原第 253 行：

```ts
if (last && !parsed.filters.length && !parsed.removedMetrics.length) input = { ...input,
  filters: previousLookup.filters, metric: previousLookup.metric, targetValue: previousLookup.targetValue,
  targetK: last.query.targetK, targetR: last.query.targetR };
```

条件只判断了「**本轮文本**里有没有解析出数值」，没有判断「**调用方**有没有已经给出完整条件」。「不，我指K」本身没有数字（数字在上一轮），所以 `parsed.filters` 为空，于是把 `input.filters`（语义层已补全的 K 0.3）整段覆盖成上一轮的 PRODUCT_R。

### 2.3 修复

```ts
// 本轮调用方已给出完整指标条件时（典型：「不，我指K」由语义层从上下文补出 K 0.3），
// 它就是本轮权威条件：不得被上一轮的旧指标覆盖，否则「纠正指标」会被静默改回旧指标，
// 后续「不超过0.3」也会跟着落到错误指标上。
const suppliedFilters = input.filters?.length ? input.filters : undefined;
if (last && !parsed.filters.length && !parsed.removedMetrics.length && !suppliedFilters) input = { ...input, ... };
```

同时收窄澄清判定，避免「条件已完整还要再问一遍」：

```ts
const suppliedComplete = Boolean(suppliedFilters?.every((filter) => Number.isFinite(filter.targetValue) && filter.targetValue > 0));
const parserClarification = parsed.needsClarification && !(suppliedComplete && !/或者|或|\bor\b/i.test(message));
```

`或 / 或者` 的关系歧义**不在**抑制范围内，仍然必须澄清。

### 2.4 修复后（真实执行）

| 轮次 | 原话 | metric | filters | needsClarification |
|---|---|---|---|---|
| 1 | 保温0.3的材料有么 | — | [] | false（由语义层决定，见 §2.5） |
| 2 | 产品热阻 | PRODUCT_R | R≈0.3 (APPROX, ±0.05) | false |
| 3 | 不，我指K | **K** | **K≈0.3 (APPROX, ±0.02)** | **false** |
| 4 | 不超过0.3 | K | **K≤0.3 (MAX_LIMIT)** | false |

对照（防止修复过宽）：

| 原话 | 结果 | 是否符合预期 |
|---|---|---|
| 那总热阻呢？ | 仍 PRODUCT_R，needsClarification=true | ✅ 只换指标不给值必须澄清，不搬旧值 |
| 语义层只给 `{metric:"K"}` 无值 | needsClarification=true | ✅ 没有目标值不能猜 |
| K0.3或者产品热阻0.3 | needsClarification=true | ✅ 关系歧义未被抑制 |
| 55mm能算吗 | thicknessMm=55，K≤0.3 保留 | ✅ 换厚度不丢指标 |

### 2.5 未处理项（需说明）

`保温0.3的材料有么` 在**确定性解析层**既不产生条件也不产生澄清（`needsClarification=false, filters=[]`），该轮的澄清由语义层（LLM）发起。本轮**没有**为此增加关键词规则——按约束 6，不能为几个句子堆关键字表。若后续要把它做成确定性能力，应走「数值角色分类 + 指标词缺失」的既有机制，而不是新增正则。

---

## 3. B1：缺列与不达标分开诊断

### 3.1 改动

`backend/src/modules/thermal/thermal-candidate-matcher.ts`

```ts
const value = getCandidateMetricValue(row, filter.metric);
// 该行没有记录这个指标（null/undefined）≠ 指标不满足：
// 前者是「数据缺失」，后者是「有值但不达标」，诊断必须分开（不得把缺列说成不达标）。
if (value == null) { missing.push(name); continue; }
matchesMetric(value, filter.targetValue, filter.mode, filter.tolerance)
  ? matched.push(name) : unmatched.push(name);
```

- 新增 `isMetricCondition` / `hasMissingMetric`：缺指标的行**不进入候选**（不得返回一条没有该指标的记录），但诊断归 `missing`。
- `globalMissingConditions` 增加整表缺列检测（区分「整表无该列」与「个别行缺值」）。

### 3.2 边界与可达性（如实说明）

`thermal_reference_rows` 的 `product_thermal_resistance / total_thermal_resistance / k_value` 三列在 schema 中是 **`notNull`**（`src/db/schema.ts:2531-2533`）。因此**在 REFERENCE_TABLE 链路上，「整表缺该指标列」实际不可达**；该分支的真实触发点是 AI 层候选池（`ReferenceLookupCandidate.productThermalResistance` 为 optional，Knowledge 已确认页可能没有该字段）。

`queryThermalCandidates` 里新增的 `absentMetrics` 提示因此是防御性的，当前不会被真实数据触发。这一点在测试里也已注明，没有伪造一个「会触发」的场景。

---

## 4. B2：零命中话术

### 4.1 三种情况三种说法

`backend/src/modules/ai/thermal-answer-validation.ts` `buildAllowedAnswerFacts` 分支顺序（缺列 > 身份命中 > 取值概览 > 通用无匹配）：

```ts
// 「无字段」优先于「无匹配」：表里根本没有这一列时，说「没有满足条件的方案」是误导。
else if (!facts.length && missingMetrics.length) answer = `当前已发布参考表没有记录… 字段，无法按该指标筛选。…`;
else if (!facts.length && identity.length) answer = `不满足所问热工指标条件。指定方案和厚度的实际正式值如下：…`;
// 只有指标条件、零命中：把「没有档位」改成「档位有哪些」
else if (!facts.length && metricScope) answer = [
  `按…查询：当前已发布参考表中没有接近该值的档位。`,
  `已发布档位在${THERMAL_METRIC_LABELS[metricScope.metric]}上的实际取值为 ${metricScope.values.join("、")}。`,
  "这条查询只限定了热工指标、没有限定构造或板厚；…"
].join("\n");
else if (!facts.length) answer = `当前已发布参考表中没有找到同时满足…的正式方案。…`;
```

### 4.2 `metricScope` 的产生（只读事实）

`backend/src/modules/thermal/thermal-candidate.service.ts`

```ts
if (candidates.length === 0 && lookup.filters.length === 1) {
  const scopedIds = new Set(scopedRows.map((row) => String(row.rowId)));
  const values = [...new Set(allRows.filter((row) => scopedIds.has(row.rowId))
    .map((row) => getCandidateMetricValue(row, filter.metric))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value)))]
    .sort((a, b) => a - b);
  if (values.length) metricScope = { metric: filter.metric, values: values.slice(0, 8), count: values.length };
}
```

约束：只在**单指标条件**、零命中时产生；只统计**身份范围内**的行；去重升序；不参与匹配、不产生候选、不据此推断用户想问哪个指标。

### 4.3 事实门禁同步

`validateAnswerFacts` 新增 `scopeFactMatches`：零命中时允许复述范围内的真实取值，**范围外数值仍拒绝**（测试已验证 `R=7` 在 `values:[4,5]` 下被拒）。

`renderAllowedFactsForModel` 与 `REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT` 同步补「不得改口成『资料里没有方案』」。

### 4.4 指标中文名单一事实源

`thermal-lookup-mode.ts` 新增：

```ts
export const THERMAL_METRIC_LABELS: Record<ThermalLookupMetric, string> = {
  K: "传热系数 K",
  TOTAL_R: "总热阻 R₀",
  PRODUCT_R: "产品层热阻 R"
};
```

原先散在 `thermal-answer-validation.ts`（`describeQuery`）、`tool-result-normalizer.ts`、`thermal-candidate.service.ts` 的三份标签统一到此处。

---

## 5. B3：去除硬编码「外墙主断面」

| 文件 | 原内容 | 现内容 |
|---|---|---|
| `tools/tool-result-normalizer.ts:234` | `input.metric === "TOTAL_R" ? "外墙主断面总热阻 R₀"` | `THERMAL_METRIC_LABELS[input.metric]` |
| `conversation-task.ts:320` | `` `外墙主断面总热阻 R₀ ${item.totalThermalResistance}` `` | `` `总热阻 R₀ ${…}` `` |
| `thermal-answer-facts.ts:9` | 硬规则里的「外墙主断面总热阻 R₀」 | 「整构造总热阻 R₀」 |
| `thermal-answer-facts.ts:13` | 同上 | 「整构造总热阻 R₀」+ 新增「总热阻只在来源本身是外墙构造时才能说『外墙主断面』，屋面/地面等其他构造不得套用该说法」 |

**保留未改**（有意为之，不是遗漏）：

- `thermal-answer-semantics.ts:46` 的 `TOTAL_R` 词表含「外墙主断面总热阻」——那是**用户输入的同义词解析**，不是输出。
- `knowledge-page-renderer.ts:108`、`page-recognition.ts`、`types/knowledge.ts`——那是**图集原页列名**，图集本身写的就是「外墙主断面」，改成中性名反而会与原文不一致。
- `admin-web/src/utils/complex-atlas.ts`、`app/src/utils/complexAtlas.ts` 的 `thermalGroupHeader`——同上，渲染原页表头。

---

## 6. B4：产品介绍与技术查询共用事实、形式随目标变化

`normalizeProductDataForModel` 原先只回 `{products, missingNotes}`，没有任何表达指引，于是「你们VICP产品主要有什么？我不是工程师」被回成目录技术字段串。

新增 `instruction`（**只约束表达，不新增事实，技术字段一个不删**）：

```ts
instruction: [
  "用户问「有什么产品」「主要做什么」「我不是工程师」这类介绍性问题时，用业务语言说清这是什么产品、解决什么问题、适合什么场景，不要一上来罗列导热系数、修正系数、板厚和型号分类。",
  "用户明确问技术参数、型号或厚度时再展开对应字段，同一批事实可以有两种说法，但数值和名称必须与上面完全一致。",
  hasSummary ? "产品介绍只依据 name 与 summary；summary 没写的内容不要补。"
             : "这些产品当前没有已审核的介绍文案，只能说明名称和已有技术字段，并告知可查看原始资料。",
  "不要补充未审核的宣传结论（例如行业领先、节能百分之多少、寿命多少年、获奖或认证），也不要拿技术字段当卖点复述。"
].join("\n")
```

测试断言 `instruction` 中不含任何新数值（`not.toMatch(/\d+(?:\.\d+)?\s*(?:%|年|W\//)`）。

---

## 7. B6：两个热工来源的契约

### 7.1 差异（已确认）

| 维度 | REFERENCE_TABLE | KNOWLEDGE_PAGE |
|---|---|---|
| 数据表 | `thermal_reference_rows` | `knowledge_pages.metadata.confirmedStructuredData` |
| 审核链路 | 后台导入 → 审核 → 发布参考集 | 页面识别 → 人工确认 → 文档发布 |
| 生效判定 | `publishedReferenceConditions`（状态 + 生效窗） | `isReferencePageConsumable`（版本状态 + usageMode + 生效窗） |
| 范围 | 全部已发布参考集 | 本轮 `documentIds / knowledgeVersionIds` 且项目可见 |
| 页码 | `pageLabelVerified ? confirmedPageLabel : null` | `visiblePageLabel(page)` |
| 判别字段 | 无（缺省） | `referenceKind: "KNOWLEDGE_PAGE"` |

**两者不是「谁更准」的关系**，是两条不同授权路径。同一构造同一厚度可能给出不同数值。

### 7.2 契约（已实现）

`thermal-answer-validation.ts`：

```ts
export const REFERENCE_SOURCE_LABELS = {
  THERMAL_ROW: "正式热工参考集（已审核发布）",
  KNOWLEDGE_PAGE: "已确认图集页（页面识别确认）"
} as const;
```

1. **来源可区分**：`renderCandidate` 与 `factLine` 都输出来源类型，模型看到的事实清单带 `来源类型 …`。
2. **冲突不静默**：`detectReferenceSourceConflicts` 只比较「同一构造 + 同一厚度」上同一指标的取值，冲突时：
   - canonical answer 追加一段（**只追加、不替换结论**）：`注意：A1-3 35 mm的产品层热阻 R在两个来源上不一致：正式热工参考集（已审核发布）为 5，已确认图集页（页面识别确认）为 4.8。两处来源的审核链路不同，请以原始图集页核对后再用于正式计算。`
   - `renderAllowedFactsForModel` 单列「跨来源数值不一致」段。
   - 系统提示词新增「不得择一当作定论，也不得把两个来源的数字混着说」。
3. **不同厚度不比较**：甲方 Excel 的「整体 25mm」与「分层 35mm」**不会**被判成冲突（已测）。

### 7.3 未做（明确记录）

没有把两个来源合并成一个统一查询入口。原因：合并会改变权限与生效判定口径（§7.1 第 3、4 行），属于架构变更，超出本阶段「不新增大规模重构」的约束。当前做法是「各自查询 + 结果层标注来源 + 冲突提示」，是否合并需甲方确认产品边界后单独评估。

---

## 8. 测试与验证证据

### 8.1 新增/扩充用例

| 文件 | 变化 |
|---|---|
| `thermal-candidate-matcher.test.ts` | 26 → **33**（+7：缺列 vs 不达标、缺指标行不进候选、整表缺列、部分缺列不报无字段、PRODUCT_R 只读产品层字段、`isMetricCondition`） |
| `thermal-candidate.service.test.ts` | 27 → **31**（+4：metricScope 去重升序、有命中不产生、多指标不产生、只统计身份范围内） |
| `thermal-answer-validation.test.ts` | 28 → **39**（+5 B2 话术分支，+6 跨来源契约） |
| `tools/tool-result-normalizer.test.ts` | 9 → **11**（+2 产品介绍指引） |
| `thermal-phase2-dialogue.test.ts` | **新增 11 例**（指标纠正链、换厚度不丢指标、属性追问不改条件、API/Tool 数值逐位一致） |

### 8.2 真实执行结果

```
热工模块      npx vitest run src/modules/thermal
              20 files passed | 512 passed | 1 expected fail (513)

AI 模块       npx vitest run src/modules/ai
              79 files passed | 1018 passed

后端全量      npx vitest run
              217 passed | 1 failed | 1 skipped (219 files)
              2554 passed | 1 expected fail | 1 skipped | 1 failed (2557 tests)

类型检查      npx tsc -p tsconfig.json --noEmit        → EXIT 0

语义匹配      node scripts/check-semantic-matching.mjs
              语义匹配AST检查通过：10个关键文件，31个白名单表达式；开放意图规则禁止。
```

**唯一失败**：`tests/report-runtime.test.ts` —— `EBUSY: resource busy or locked, rmdir 'C:\Users\admin\AppData\Local\Temp\lg-report-deploy-test-*'`，且 `expect(result.status).toBe(1)` 收到 `null`。该文件与 `deploy/` 本轮均未改动（`git status` 可查），属 Windows 临时目录占用的既有环境问题，**非本次引入**，与阶段 1 报告记录一致。

`1 expected fail` 是阶段 1 用 `it.fails` 记账的 P0-A1（分层产品 R 少算包覆层 4.8 vs 5.0），按用户口径等 VICP-CALC-2 落地后转为正式通过。

### 8.3 未改动的不变量

- 公式仍只在确定性 Thermal Calculator 执行；本轮没碰 `thermal-calculator.ts`。
- 权限、版本、Revision、Snapshot/报告幂等未放宽。
- 未新增任何产品参数 / 图集 K 值 / 标准限值默认值。
- 未修改生产数据，未改历史 Snapshot / PDF / 计算记录。
- `check-semantic-matching.mjs` 白名单表达式数量未增加（31 → 31）。

---

## 9. 遗留与下一步

| 项 | 状态 | 说明 |
|---|---|---|
| P0-A1 分层产品 R（4.8 vs 5.0） | 待甲方确认产品边界 | 已用 `it.fails` 记账；确认后派生 VICP-CALC-2，不改 CALC-1 |
| 产品组 / 子层建模 | 设计已提，未实施 | 阶段 1 报告 §5 三个方案，推荐 `product_group_id` |
| `保温0.3的材料有么` 确定性澄清 | 未做 | 见 §2.5，需走数值角色分类而非新增正则 |
| 两来源合并查询 | 未做 | 见 §7.3，属架构变更，需单独评估 |

阶段 2 到此结束。
