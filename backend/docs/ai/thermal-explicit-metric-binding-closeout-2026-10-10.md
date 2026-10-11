# VICP 热工查询：显式指标自然语义绑定 + False Negative 查询链路最终修复（2026-10-10）

> 目标（本轮唯一目标，收敛范围，不再扩面）：
> **用户说清楚了 → 系统就不要再问；资料里有 → 系统就必须查得到；条件明确 → 系统就不能串条件；新问题 → 系统不能带着旧条件跑。**
>
> 本轮**只解决两个已确认根因**：
> - **P0-1**：用户已明确说了指标，`targetValue` 却因自然语序没绑上 → 错误澄清。
> - **P0-2**：正式资料明明有匹配方案，却被 QueryState / Entity / Candidate Filter 杀掉 → False Negative。
>
> **本轮明确不做**：不继续优化回答文案、不新增 System Prompt 规则、不扩大修改范围。
> 不修改：知识库 / Recognition / PDF / 热工公式 / B 端 / C 端 / Solution Workflow。

---

## 1. Root Cause

### P0-1：显式指标 + 自然语序 → `targetValue` 丢失 → 错误澄清

用户输入：`保温板自身热阻 有传热8.3的保温板么`

期望：`PRODUCT_R ≈ 8.3`（用户已明确说「保温板自身热阻」=产品层热阻），不得再问「您说的是产品层热阻吗」。

实际：系统问「您是指产品层热阻…吗？」 —— 即指标已经解析出来了，但 **8.3 没绑到 PRODUCT_R 上**，于是 `unresolved = true` 触发了指标澄清。

根因三层叠加：

| 层次 | 问题 |
| --- | --- |
| 指标词典 | `热阻` / `自身R` / `板自身热阻` 这类**不含「产品层」字样**的自然说法不在 `THERMAL_LOOKUP_METRIC_PATTERN` 里 → 指标没被识别 |
| 数字-指标连接判定 | `TARGET_BRIDGE` 要求指标词与数字之间的片段**全是纯连接词**。`有传热8.3` 的中间片段是「有传热」——`有`、`传热` 都是**冗余/倒装词而非连接词**，判定失败 → 8.3 被丢弃 |
| 兜底缺失 | 即使只有一个已解析指标 + 句子里只有一个待归属数字，也没有「唯一指标 + 唯一数字 → 绑定」的语义兜底 |

### P0-2：资料里有，却查不到（False Negative）

用户输入：`保温薄抹灰传热系数0.3方案有么`

资料里实际存在：
- `I 型 VICP 薄抹灰外保温系统 · A1-3 · 18mm · K=0.303`
- `II 型 VICP 薄抹灰外保温系统 · A2-1 · 30mm · K=0.302`

实际：返回「没有匹配方案」。

已定位的可能杀掉点（本轮**不猜测**，改为**可观测**）：
1. **Entity 层**：`薄抹灰` 若被要求唯一 `systemId`，而 DB 里薄抹灰家族有多个正式体系 → 解析失败或只命中一个；
2. **指标过滤层**：`K≈0.3` 的容差窗口若按 EXACT（严格 0.3）判定，`0.303 / 0.302` 会被判不等 → 全杀；
3. **串条件层**：上一轮若有 `PRODUCT_R≈8.3` 残留，被当成追问继承，与新问题叠加 → 全杀。

在隔离探针中，匹配器 / Entity / 会话三层**均可正确命中 0.303、0.302，且 `薄抹灰` 可解析为 systemIds 集合**。因此生产环境的 False Negative 更可能出现在 **DB 命名 / 实体词典形态** 上（无生产数据无法复现）。本轮策略：**不赌某一层，而是给整条链路装上分阶段计数 + 拒绝原因**，让「到底是哪一层把候选杀到 0」直接可读，同时用与真实数据同构的 fixture（A1-3 / A2-1）把「正确链路行为」钉死。

---

## 2. Metric Target Binding 修复（P0-1）

核心文件：`src/modules/thermal/thermal-lookup-mode.ts`

### 2.1 指标词典补自然说法（顺序敏感，防「总传热系数」被 TOTAL_R 抢）

```ts
export const THERMAL_LOOKUP_METRIC_PATTERN =
  /product_r|产品层?热阻|产品r
  |保温板(?:自身|本身)?热阻
  |板(?:子|材)?(?:自身|本身)?的?(?:热阻|r)(?![a-z])
  |自身(?:热阻|r)(?![a-z])
  |vicp热阻
  |total_r|整墙(?:总)?热阻|总热阻(?:r[0₀]?)?|总r|r[0₀]|(?:外墙)?主断面(?:传)?热阻
  |传热系数(?:k值?)?|传热(?:做到|是|为|大概|约|左右)|k值|k(?![a-z])/gi;
```

`metricFromWord` 改为**顺序敏感**（先判 PRODUCT_R，再 TOTAL_R，最后 K）：

```ts
if (/product_r|产品层?|保温板|板自身|板子|板材|自身热阻|自身r|vicp/i.test(word)) return "PRODUCT_R";
if (/total_r|整墙|主断面|总热阻|总r|r[0₀]/i.test(word)) return "TOTAL_R";
return "K";
```

- 去掉了裸 `总`，避免「**总**传热系数」落到 `TOTAL_R`；
- `k(?![a-z])`（而不是 `(?![a-z0-9])`）：允许 `K0.3`、`K做到0.3`、`K要0.3左右`；
- 「传热阻系数」「保温系数」**从主词典移除**——它们本身歧义（既可指 R 也可指 K），必须澄清，不能猜。

### 2.2 数字-指标连接判定：`isMetricBridge`

把「纯连接词白名单」升级为「连接词 + 冗余/倒装词 + 本指标同义词」判定：

```ts
export function isMetricBridge(bridge: string, metricWord: string): boolean {
  if (!bridge) return true;
  if (TARGET_BRIDGE.test(bridge)) return true;
  // 去掉本指标同义词中的字后，剩余仍须全部是连接/冗余词
  const metricChars = new Set([...metricWord.toLowerCase()].filter((ch) => /[\u4e00-\u9fa5a-z]/.test(ch)));
  const residual = [...bridge].filter((ch) => !metricChars.has(ch)).join("");
  return TARGET_BRIDGE.test(residual);
}
```

`METRIC_NUMBER_BRIDGE`（= `TARGET_BRIDGE`）扩展纳入 `有 / 有没有 / 有么 / 能 / 可以 / 传热 / 自身 / 板子? / 热阻 / 系数 / 值 / 对应 / 那个 / 档 / 级别 / 要 / 能到` 等**冗余/倒装词**。

效果：`保温板自身热阻 有传热8.3` → bridge = 「有传热」，剔掉 metricWord「自身热阻」中的字后剩「有」，属连接词 → **8.3 绑定 PRODUCT_R** ✅

### 2.3 通用 target 绑定兜底（语义层）

当主循环因 bridge 过严而没绑到数字时，只要满足：

- 只有 **一个** 已解析指标（soleMetric）；
- 句子里有 **唯一一个** 尚未归属、且角色为 `THERMAL_TARGET / UNKNOWN` 的数值；
- 本句不是纯「取消/保留条件」语句（`!removedMetrics.length`）；

…就把它绑定给该指标，并把 `unresolved` 复位为 `false`（**消除错误澄清**）。

```ts
if (!filters.length && actionableMentions.length && !removedMetrics.length) {
  const soleMetric = new Set(actionableMentions.map((m) => m.metric)).size === 1 ? actionableMentions[0]!.metric : undefined;
  if (soleMetric) {
    const numbers = /* 未被主循环绑定、且角色 ∈ {UNKNOWN, THERMAL_TARGET} 的数值 */;
    if (numbers.length === 1) { /* 绑定 + inferThermalLookupMode + unresolved = false */ }
    else unresolved = true; // 多个可能值 → 必须澄清
  }
}
```

### 2.4 EXACT 语义修正

```ts
// before: 正好是
// after : 正好
const EXACT_PATTERN = /精确|恰好|正好|等于|就是|(?<![<>≤≥])=(?!=)/;
```

`正好8.3`（不带「是」）现在正确判为 `EXACT`；`8.3左右 / 有8.3的么 / 做到8.3` 仍为默认 `APPROX`。

### 2.5 指标优先级（不改 DB，只改解析）

| 用户说法 | 解析指标 |
| --- | --- |
| 传热系数 / K值 / K | `K` |
| 产品热阻 / 产品层 R / 保温板热阻 / 保温板自身热阻 / 板子热阻 / 自身 R / VICP 热阻 | `PRODUCT_R` |
| 总热阻 / 整墙热阻 / 主断面传热阻 / R0 / 总 R | `TOTAL_R` |

> 指标一旦明确 → **禁止再次就指标澄清**（本轮通过 `unresolved=false` 落地）。
> 指标与数字**不要求相邻**（通过 `isMetricBridge` + 兜底落地）。

---

## 3. Entity Family 修复（P0-2 实体侧）

`薄抹灰` 必须解析为一个 **system family（体系族）**，而**不是**唯一 `systemId`。族本身也是 **Hard Constraint**：候选必须属于该族集合，但集合内可有多个正式体系。

- `EntityConstraint.kind`：`EXACT | FAMILY | CATEGORY | ALIAS`（新增 `SystemEntityResolution` 诊断）。
- `薄抹灰` → `FAMILY`，`familyIds` 含同族正式体系（I 型 / II 型 VICP 薄抹灰外保温系统）；
- **必须排除**：`复合保温装饰板`、`预制夹心外墙板`（同 K 也不得命中）。
- 完整体系全名 → `EXACT`，解析唯一 `systemId`；
- 未匹配正式名称 → `NONE`（不得凭文本猜测）。

`resolveQueryEntities` 已支持 `FAMILY → systemIds` 集合；候选服务通过 `systemIds` 集合做硬约束：

```ts
interface CandidateQueryInput extends ThermalLookupQuery, Omit<ThermalQueryState, "filters"> {
  systemId?: string;
  /** 体系族/类别命中：候选必须属于该集合（硬约束，不唯一） */
  systemIds?: string[];
  ...
}
```

新增诊断函数（`thermal-entity-resolver.ts`）：

```ts
export function describeSystemEntityResolution(message: string, entities: ThermalEntity[]): SystemEntityResolution[] {
  // 输出 matchType / resolvedName / family / familyIds / systemId，用于排查「族名到底解析成了什么」
}
```

---

## 4. Query Reset / Inheritance 修复

| 场景 | 判定 | 行为 |
| --- | --- | --- |
| 独立新问题（指标/实体与前一轮不同） | `NEW_QUERY` | **不继承**旧条件（不串 `PRODUCT_R≈8.3`） |
| 追问（「那20mm以内呢」「换成8.5呢」） | `CONTINUE_QUERY` | **继承**旧指标与条件 |
| 仅改一个目标值 | `REFINE_QUERY` | 继承其余条件 |
| 对比已选 | `COMPARE_SELECTED` | 走对比链路 |

关键点：`NEW_QUERY` 使用**全量重算**，不带上一轮 `filters`；`CONTINUE_QUERY` 沿用 `taskState.lastReferenceLookup.query`。

验收：
- 上一轮 `PRODUCT_R≈8.3` → 下一轮独立问「薄抹灰传热系数0.3方案有么」 → **NEW_QUERY，不串条件**；
- 上一轮 `薄抹灰 K≈0.3` → 追问「那20mm以内呢」 → **CONTINUE，保留 K≈0.3 并新增厚度上限**。

---

## 5. Candidate Filter Trace（分阶段计数）

`src/modules/thermal/thermal-candidate.service.ts` 新增 `stageCounts`（纯统计，**不改变任何匹配行为**）：

```ts
stageCounts?: {
  beforeAll: number;        // 正式行全量
  afterFamily: number;      // 只叠体系族约束
  afterMetric: number;      // 体系族 + 指标
  afterThickness: number;   // 体系族 + 指标 + 厚度
  afterAllHard: number;     // 全部硬条件
};
```

实现方式：依次构造「去掉某一维约束」的 QueryState，逐层累加硬条件：

```ts
const withoutMetric    = { ...queryState, filters: [], metric: undefined, targetValue: undefined, targetK: undefined, targetR: undefined };
const withoutThickness = { ...withoutMetric, thicknessMm: undefined, thicknessMin: undefined, thicknessMax: undefined };
const withoutFamily    = { ...queryState, systemIds: undefined, systemId: undefined, systemHint: undefined };
```

于是任意一次查询都能直接读出「**N 在哪一步掉到 0**」：

```
beforeAll=126 → afterFamily=6 → afterMetric=2 → afterThickness=2 → afterAllHard=2   ✅ 命中
beforeAll=126 → afterFamily=0 → …                                              ❌ 体系过滤误杀
beforeAll=126 → afterFamily=6 → afterMetric=0 → …                              ❌ 指标过滤误杀
```

> ⚠️ `stageCounts` 只出现在**诊断返回值**中，不进入业务判定；`candidateCountAfterFilter / selectedCandidateIds` 改由 `constraintMatch.passed` 计算，与最终 `candidates` 口径一致。

---

## 6. Rejected Reasons（拒绝原因，可读）

`src/modules/thermal/thermal-query-debug.ts` 新增 `RejectedReason` 与 `classifyRejection(field)`，把「失败字段」翻译成稳定原因码：

| 原因码 | 触发字段 |
| --- | --- |
| `SYSTEM_FAMILY_MISMATCH` | `systemIds` / `systemId` / `systemHint` |
| `SCHEME_MISMATCH` | `schemeId` / `schemeCode` |
| `METRIC_OUT_OF_RANGE` | `K` / `TOTAL_R` / `PRODUCT_R`（`K:0` 形态亦覆盖） |
| `THICKNESS_MISMATCH` | `thicknessMm` / `thicknessMin` / `thicknessMax` |
| `PRODUCT_SPEC_MISMATCH` | `productSpecId` / `specClass` / `catalogProductId` |
| `REGION_MISMATCH` | `regionCode` |
| `STANDARD_MISMATCH` | `standardLimitId` / `structureType` |
| `BUILDING_TYPE_MISMATCH` | `setBuildingTypes` |
| `SUBSTRATE_MISMATCH` | `substrateMaterial` / `substrateThickness` |
| `SOURCE_MISMATCH` | `sourceDocumentId` / `sourceVersionId` |
| `OTHER` | 兜底 |

快照扩展：

```ts
interface ThermalQueryDebugSnapshot {
  rawText: string;                 // 原始用户输入
  queryMode?: QueryLifecycle;      // NEW / CONTINUE / REFINE / COMPARE
  resolvedMetric / targetValue / mode;
  entity / family;
  queryState;
  toolFilters;
  stageCounts;                     // ← 第 5 节
  rejectedByReason: Record<RejectedReason, number>;
  matchedIds: string[];
  rejectedCandidates: Array<{ id; reasons: RejectedReason[] }>;
  nearestFailure;
}
```

`thermal-calculate.tool.ts` 已把 `rawText: ctx.userMessage`、`stageCounts` 传入 `buildThermalQueryDebug`。

---

## 7. 自动测试

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` | ✅ 无错误 |
| `npx vitest run src/modules/thermal src/modules/ai` | ✅ **57 个文件 / 830 个用例通过** |
| `npx vitest run src/modules/thermal` | ✅ 18 个文件 / 435 个用例 |
| `npx vitest run src/modules/ai` | ✅ 39 个文件 / 395 个用例 |

### 本轮新增 / 扩展测试

| 文件 | 用例数 | 覆盖 |
| --- | --- | --- |
| `src/modules/thermal/thermal-target-binding.test.ts`（**新增**） | 22 | 显式指标自然语序绑定（P0-1）、Number Role Classification、模式推断、K≈0.3 薄抹灰命中/体系拒绝、容差边界读配置、Debug Trace + Rejected Reasons、Entity Resolver 诊断、NEW/CONTINUE 重置与继承 |
| `src/modules/ai/tools/thermal-lookup.tool.test.ts`（**扩展**） | +4（共 25） | 端到端验收：`保温薄抹灰传热系数0.3方案有么` → 命中 `a1-3` `K=0.303`；显式指标不澄清；新问题不串旧条件 |
| `src/modules/thermal/thermal-query-lifecycle.test.ts`（**修正陈旧断言**） | 13 | 「保温板自身热阻，有传热8.3的么」由「按指标歧义澄清」改为「指标已明确，绑定 `PRODUCT_R≈8.3`，不再澄清」 |

### 关键验收用例

| 输入 | 期望 | 结果 |
| --- | --- | --- |
| `有传热8.3的保温板么` | 指标未明确 → **允许澄清** | ✅ |
| `保温板自身热阻 有传热8.3的保温板么` | **不澄清**，绑定 `PRODUCT_R≈8.3` | ✅ |
| `保温薄抹灰传热系数0.3方案有么` | 命中真实薄抹灰 `K≈0.3`（`A1-3` 0.303 / `A2-1` 0.302） | ✅ |
| `A1-3` / `第21页` / `2026版` 里的数字 | **不得**绑给指标 | ✅ |
| 独立新问题 | 不继承旧条件 | ✅ |
| 追问「那20mm以内呢」 | 继承旧条件 + 新增厚度上限 | ✅ |
| `MAX_LIMIT`（≤0.3） | 0.303 **必须排除**（语义不混用） | ✅ |

> 容差边界（0.28 / 0.30 / 0.302 / 0.303 / 0.32）**读取集中配置**，非硬编码，避免配置变更后测试失真。

### 附带修复：测试套件稳定性

本机 `nproc=4`，项目原本**无 `vitest.config.ts`**，走 vitest 默认 5s 超时。大量测试用 `await import("./x.service.js")` 冷加载 Fastify / Drizzle / AI SDK 重型 module graph，并发文件下首次 transform 偶发超过 5s（`ai-conversation-state.test.ts` / `ai-project-memory.test.ts` / `report-context-snapshot.test.ts`），产生与本轮改动**无关的假失败**。

新增 `vitest.config.ts`：`testTimeout/hookTimeout = 30s`、`maxWorkers = "50%"`。加配置后 `src/modules/thermal + src/modules/ai` **57 文件 / 830 用例全绿**（此前偶发 1~3 个假失败）。

---

## 8. 修改文件

### 新增

| 文件 | 作用 |
| --- | --- |
| `src/modules/thermal/thermal-target-binding.test.ts` | 本轮绑定 / 角色分类 / 命中 / 诊断 / 生命周期测试（22 例） |
| `vitest.config.ts` | 统一测试超时与并发，消除冷加载假失败 |

### 修改

| 文件 | 改动 |
| --- | --- |
| `src/modules/thermal/thermal-lookup-mode.ts` | **核心**：`NumberRole` + `classifyNumberRole`；指标词典补自然说法；`metricFromWord` 改顺序敏感；`isMetricBridge` + `METRIC_NUMBER_BRIDGE`；通用 target 兜底绑定（复位 `unresolved`）；`EXACT_PATTERN` 支持「正好」；`THERMAL_LOOKUP_FALLBACK_METRIC_PATTERN`（裸「系数」兜底→K）；返回 `numberCandidates` |
| `src/modules/thermal/thermal-query-debug.ts` | `RejectedReason` + `classifyRejection`；`RejectedCandidateDebug.reasons`；快照新增 `rawText` / `stageCounts` / `rejectedByReason` |
| `src/modules/thermal/thermal-candidate.service.ts` | `stageCounts` 分阶段计数；`asConstraint` 映射；`CandidateQueryOutcome` 增 `queryState` / `matchedCandidates` / `nearbyCandidates` / `stageCounts` |
| `src/modules/thermal/thermal-entity-resolver.ts` | `SystemEntityResolution` + `describeSystemEntityResolution`（族名解析诊断） |
| `src/modules/ai/tools/thermal-calculate.tool.ts` | `lookupDecision` 带 `stageCounts`；`buildThermalQueryDebug` 传 `rawText` / `stageCounts` |
| `src/modules/thermal/thermal-query-lifecycle.test.ts` | 陈旧断言修正（显式指标 → 不澄清并绑定 PRODUCT_R） |
| `src/modules/ai/tools/thermal-lookup.tool.test.ts` | 追加「显式指标绑定 + False Negative」端到端验收（+4） |

> 未改动热工公式、未改动 `src/db/schema.ts`、未改 Recognition / PDF / B 端 / C 端。

---

## 9. 是否有 API / DB Breaking Change

### DB

**无 Migration。** 未改动 `src/db/schema.ts`，未新增/修改任何表、列、索引。
`QueryState` 仍存于现有 `ai_conversation_states.taskState.lastReferenceLookup.query` JSON；新增字段均为**可选**，旧快照可直接读取。

### API

**无 Breaking Change。**

| 面 | 变化 |
| --- | --- |
| B 端 / C 端 HTTP 路由 | 未改动 |
| SSE 协议 | 事件类型不变（`delta` / `reference_pages` / `sources` / `done` / `need_user_input`） |
| `CandidateQueryOutcome` | 只**新增可选**字段（`queryState` / `matchedCandidates` / `nearbyCandidates` / `stageCounts`），旧字段签名不变 |
| 内部函数 | `isMetricBridge` / `classifyNumberRole` / `describeSystemEntityResolution` / `classifyRejection` 均为**新增导出**，不删除旧导出 |
| 诊断日志 | 新增 `rawText` / `stageCounts` / `rejectedByReason`，仅在 `debug` 级别输出，不影响线上行为 |

### 行为变化（预期内，且是本轮目标）

1. **不再对已明确指标重复澄清**：`保温板自身热阻 有传热8.3的保温板么` 直接绑定 `PRODUCT_R≈8.3`。
2. **族名查询不要求唯一 systemId**：`薄抹灰` → `systemIds` 集合，同族多个正式体系均可参与。
3. **False Negative 可定位**：任一次「查不到」都能从 `stageCounts` / `rejectedByReason` 直接读出在哪一层、因何被杀。
4. **新问题不再串旧条件**：`NEW_QUERY` 全量重算。

### 剩余风险与后续建议

1. **P0-2 的生产根因尚未在真实库上复现**（无生产数据）。本轮已把链路做成**可观测**，建议拿到线上一次 `matched=0` 的 `debug` 快照后，直接读 `stageCounts` 定位是 `afterFamily` 还是 `afterMetric` 归零，再做针对性修复。
2. **`系数` 兜底只指向 K**：`系数0.3` 视为 `K`；而 `传热阻系数` / `保温系数` 仍走澄清（歧义不可猜）。若业务上确认这两个词固定含义，可后续收紧。
3. **通用兜底绑定阈值**：仅在「唯一指标 + 唯一可归属数字」时触发，宁可澄清也不误绑；多数字场景一律澄清。
