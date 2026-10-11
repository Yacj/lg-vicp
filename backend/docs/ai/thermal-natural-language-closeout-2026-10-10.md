# VICP 热工问答：恢复自然对话 + 保留事实硬约束（2026-10-10）

> 目标：**事实正确性由代码保证，自然表达交给 LLM**。  
> 本轮只收口 5 件事：自然语言理解、QueryState 生命周期、Candidate 过滤、LLM 最终表达、Fact Validation。  
> 未改动：知识库上传 / Recognition / Index / Thermal Engine 公式 / B 端 / C 端 / PDF / Human-in-the-loop。

---

## 1. Root Cause

问题不是「模型不够聪明」，而是**链路把自然语言理解、事实校验、最终表达三件事混在了一起**，导致两个方向同时坏掉：

| 症状                                                                | 真实原因                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| 用户问「有传热 8.3 的保温板么」，系统答不上来                                         | Parser 要求「指标词 + 数值」紧挨着；`板自身R`、`板子热阻`、`主断面传热阻` 等自然说法不在词典里           |
| 追问「那 20 以内呢」丢掉了上一轮的 K≈0.3                                         | 所有轮次都当成「继承上一轮 QueryState」，没有 NEW / CONTINUE / REFINE / COMPARE 的区分 |
| 上一轮问「产品层 R≈8.3」，下一轮问「薄抹灰传热系数 0.3 方案有么」仍带着 R≈8.3                   | 同上：新问题被当成追问，旧条件被错误继承                                               |
| 「薄抹灰有方案吗」被要求给唯一 systemId                                          | 实体只有 EXACT 一级；族名没有解析成 systemIds 集合硬约束                              |
| 回答被 `answer === canonicalAnswer` 卡死                               | Fact Validator 是**全文严格相等**：模型换一种说法（哪怕数字全对）也判 INVALID_FACT          |
| 用户只问 K≈0.3，回答必须把 R、R₀、页码、来源全念一遍                                   | 校验以「整段文本」为单位，而不是「真正出现的事实」为单位                                       |
| `resolveReferenceQueryWithoutAgent` 直接 `fullText = resolved.text` | REFERENCE_LOOKUP 根本没过 LLM，用户看到的是固定模板                               |
| 澄清文案是「请确认：请补充尚未明确的目标值或条件关系……」                                     | `unresolved[].reason` 里塞了完整引导句，Renderer 再拼一次前缀，出现内部系统口吻            |

一句话：**旧链路用「全文相等」代替了「事实相等」，用「继承一切」代替了「理解追问」，于是模型既不能自然说话，也没有真正被约束。**

---

## 2. 新的 Query Lifecycle

```
用户自然语言
  → Semantic Normalizer        （词典 / Alias + 规则 Parser + 轻量语义归一）
  → Structured QueryState      （唯一真源，含 lifecycle / entities / family hints / unresolved）
  → Constraint Engine          （HARD_CONSTRAINT vs SOFT_PREFERENCE，缺数据不能证明满足）
  → Deterministic Candidate Set（matched / nearby 三态：matched / unmatched / missing）
  → Allowed Fact Set           （query + matched + nearby + sourcePages + canonicalAnswers + calculation）
  → LLM Natural Language Generation
  → Semantic Fact Validation   （只校验真正出现的工程事实）
  → 最终回答（失败 → 重试一次 → 仍失败 → deterministic fallback）
```

关键变化：**「候选集合」与「允许说的事实集合」是两个不同的东西**。

- 候选集合是「哪些行满足条件」；
- Allowed Fact Set 是「模型可以引用哪些原子事实」。`nearbyCandidates` 也进事实集，所以模型可以说「最接近的是 X」，但不得称它为「命中」。

生命周期判定独立成一个纯函数 `classifyQueryLifecycle`，不依赖任何 IO，也不依赖关键词单点命中。

---

## 3. NEW / CONTINUE 判定

`src/modules/thermal/thermal-query-lifecycle.ts`

四种模式：`NEW_QUERY` / `CONTINUE_QUERY` / `REFINE_QUERY` / `COMPARE_SELECTED`。

判定规则（自上而下，命中即返回）：

1. 没有上一轮 → `NEW_QUERY`
2. 引用上一轮候选（第一个 / 第三个 / 这两个）且没有新条件 → `COMPARE_SELECTED`（只读冻结候选，不重查全库）
3. 重新给出新 metric+target **且** 带完整独立问题标记（`方案|系统|体系|构造|图集|选用表|Ⅰ/Ⅱ/Ⅲ型|有没有|有么|有吗|哪些|几个|推荐`）**且** 没有任何追问/指代标记 → `NEW_QUERY`
4. 显式移除 / 改写条件（`改成|改为|换成|调到|放宽|收紧|取消|不限制|去掉|删掉|移除|不要了`）→ `REFINE_QUERY`
5. 其余（含「总R3.3左右」这类省略式增改）→ `CONTINUE_QUERY`，继承后增量更新

设计要点：

- **默认偏向 CONTINUE**。拿不准时宁可继承，也不能把追问误判成新问题而丢条件。
- 第 3 条要求**同时**满足「新 metric+target」+「独立问题标记」+「无追问标记」三个条件，避免把「总R降到3.4左右」这种省略式增改当成新问题。
- `REWRITE_MARKER` 由分类器**自己从原文识别**，不只依赖调用方传入的 `hasRemoval`（省略式追问时调用方未必算得出来）。
- 判定结果落到 `normalizeConversationLookupQuery` 的返回值 `lifecycle` 字段，用于诊断（Query Debug）。

实测：

| 输入                           | 判定                                        |
| ---------------------------- | ----------------------------------------- |
| `那20mm以内呢？`                  | `CONTINUE_QUERY`                          |
| `总R改成3.5以上`                  | `REFINE_QUERY`                            |
| `保温薄抹灰传热系数0.3方案有么`（上一轮问产品层R） | `NEW_QUERY`（不继承旧 R）                       |
| `第一个和第三个哪个好`                 | `COMPARE_SELECTED`                        |
| `总R3.3左右`（上一轮 K≤0.3）         | `CONTINUE_QUERY`（保留 K≤0.3，新增 TOTAL_R≈3.3） |
| `这个再薄一点`                     | `REFINE_QUERY` + `preferThinner`          |

---

## 4. Entity Family / Exact 设计

`src/modules/thermal/thermal-entity-resolver.ts` + `thermal-query-state.ts`

```ts
export type EntityMatchStrength = "EXACT" | "FAMILY" | "CATEGORY" | "ALIAS" | "TEXT_HINT";

export interface EntityConstraint {
  kind: EntityMatchStrength;
  ids?: string[];
  normalizedName?: string;
  rawText?: string;
}
```

| 级别          | 含义                                     | 落地方式                 |
| ----------- | -------------------------------------- | -------------------- |
| `EXACT`     | 完整正式名称 / 编码（「I型 VICP薄抹灰外保温系统」）         | 唯一 `systemId`        |
| `FAMILY`    | 体系族名（「薄抹灰」）                            | 解析为 **systemIds 集合** |
| `CATEGORY`  | 体系类别（`insulation_systems.system_type`） | 语义同族提示               |
| `ALIAS`     | 启用中的 GLOBAL 别名词典命中                     | 同 EXACT              |
| `TEXT_HINT` | 只有自由文本，未匹配正式名称                         | 进入澄清，禁止用模型猜测替代       |

关键设计：

- **Family Hint 也是 Hard Constraint，并且在 Candidate Matcher 层执行**，不放给 LLM。  
  `validateCandidateAgainstQueryState` 新增：`if (query.systemIds) check("systemIds", candidate.systemId ∈ query.systemIds)`。
- 族名是**从正式名称确定性派生**的：`normalizeSystemFamily("I型 VICP薄抹灰外保温系统") → "薄抹灰"`。  
  词典同时补充 `family`（来自 `insulation_systems.name`）与 `category`（来自 `system_type`），因此族/类别命中不依赖名称格式。
- 命中数 == 1 → 写 `systemId`；命中数 > 1 → 写 `systemIds` 集合，**不要求唯一 systemId**。
- 族命中时清掉方案 / 规格依赖（`schemeId/schemeCode/productSpecId/catalogProductId/systemHint`），避免旧的具体对象约束污染族查询。
- 族约束的继承与清除：本轮未触碰体系时沿用历史 `systemIds`；`removedFields` 含 `systemId` 时清空 `systemIds`。

实测：`"薄抹灰，K0.3左右"` → `systemIds = [sys-i, sys-ii, sys-iii]`，`sys-roof` 候选被判 `passed=false`；`"屋面，K0.3左右"`（单体系族）→ 唯一 `systemId = sys-roof`。

---

## 5. Semantic Normalizer

原则：**词典 / Alias + 规则 Parser + 轻量语义归一，不做无限正则，也不要求 metric 和 value 紧挨。**

`src/modules/thermal/thermal-lookup-mode.ts` — `THERMAL_LOOKUP_METRIC_PATTERN` 补充自然说法：

```
product_r | 产品层?热阻 | 保温板(?:自身)?热阻 | 板自身(?:热阻|r) | 板子(?:自身)?(?:热阻|r)
| vicp热阻 | 产品r | total_r | 整墙热阻 | 总热阻(?:r[0₀]?)? | 总r | r[0₀]
| (?:外墙)?主断面(?:传)?热阻 | 传热系数(?:k值?)? | k(?:值)?
```

同时修掉两个真实解析缺陷：

1. `主断面(?:传热)?热阻` 永远匹配不到 `主断面传热阻`——因为「传热阻」是 **传 + 热阻**，`(?:传热)?` 会先吃掉「传热」导致后面的 `热阻` 失配。改为 `(?:传)?热阻`。
2. 指标词后紧跟分隔符时目标值丢失。`"墙体R0 3.3"` 会被「数字-空格-数字 → 逗号」的归一规则变成 `"墙体R0,3.3"`，指标 `R0` 的切片变成 `",3.3"`，按逗号切分后首个片段为空 → 目标值丢失。修复：切片前先剥掉前导分隔符。

`src/modules/ai/thermal-answer-semantics.ts` — `METRIC_LABELS` 同步覆盖回答侧的自然说法（`板子热阻|板子R|板子`、`R0` 零宽边界保护）。

`src/modules/ai/thermal-answer-facts.ts` — 歧义表达（`传热` 不带「系数」、`保温板`+数字、裸 `R=数字`、`差不多数字`）在**没有明确指标上下文**时进入澄清，不按数值大小猜工程指标。

验收（全部通过）：

| 说法                                               | 归一结果           |
| ------------------------------------------------ | -------------- |
| `传热系数0.3` / `K值0.3` / `K0.3` / `K做到0.3`          | K              |
| `产品热阻2.8` / `板自身R2.8` / `保温板自身热阻2.8` / `板子热阻2.8` | PRODUCT_R      |
| `总热阻3.3` / `整墙热阻3.3` / `主断面热阻3.3` / `墙体R0 3.3`   | TOTAL_R        |
| `保温板自身热阻，有传热8.3的么`                               | 指标歧义 → 澄清，不猜 K |

---

## 6. Fact Validator 改造

从「全文匹配」改成「事实匹配」。

### 6.1 事实抽取（`thermal-answer-semantics.ts`）

只抽取**带语义标签**的原子事实，裸数字不参与判定：

```ts
type SemanticFact =
  | { kind: "metric";    metric: "K"|"PRODUCT_R"|"TOTAL_R"|"LAMBDA"|"ALPHA"; value: number }
  | { kind: "thickness"; value: number }
  | { kind: "page";      label: string }
  | { kind: "code";      code: string };
```

- 出现方案 / 规格编码即**切段**，编码本身作为该段首个 fact；
- 段内事实必须由**同一条候选**同时满足 → 天然阻断「把 A 的厚度拼到 B 的热阻上」；
- 无编码片段的事实只要候选池中任意一条满足即可。

### 6.2 校验逻辑（`thermal-answer-validation.ts` → `validateAnswerFacts`）

1. 与任一 deterministic fallback 文本完全一致 → 通过（快路径）；
2. 没有任何事实上下文 → 只接受 deterministic 答案（保持旧调用方语义）；
3. 出现未授权断言 → 拒绝；
4. 逐片段校验真正出现的工程事实（见 6.1）；
5. 有候选池却一个可核验事实都没有（纯空话）→ 拒绝。

### 6.3 数值容差按指标量级（不是一刀切）

| 指标        | 绝对下限     | 相对   |
| --------- | -------- | ---- |
| K         | 0.0005   | 2%   |
| PRODUCT_R | 0.0005   | 0.2% |
| TOTAL_R   | 0.0005   | 0.2% |
| LAMBDA    | 0.000001 | 2%   |
| ALPHA     | 0.0005   | 1%   |

既允许「3.297 写成 3.3」这类同精度四舍五入，又必须挡住「8.000 写成 8.300」。

### 6.4 未授权断言

`answerHasForbiddenClaim(answer, { complianceAuthorized })`：

- 恒拒绝：`最高|最低|最大|最小|唯一|全部|所有|没有其他|仅此|绝无|排名第一`
- 条件放行：`达标|合规|符合…标准/规范/限值|满足…标准/规范/限值` —— 只有 `calculation.complianceAuthorized === true`（后端已证明地区 / 建筑类型 / 标准版本全部适用范围）才允许。

### 6.5 覆盖的工程事实种类

`scheme / system / productSpec / thickness / lambda / alpha / PRODUCT_R / TOTAL_R / K / sourcePageLabel / standardLimit / complianceResult`

### 6.6 验收矩阵（已自动测试）

| 回答                                        | 结果                         |
| ----------------------------------------- | -------------------------- |
| `60mm双层方案，板自身R=8.000，整墙R₀=8.313，K=0.120。` | ✅ VALID_FACTS              |
| `有一个比较接近的方案：60mm，产品层热阻8.000，总热阻8.313。`    | ✅ VALID_FACTS              |
| `A4-1 的 60mm 双层方案总热阻约8.313。`              | ✅ VALID_FACTS              |
| `产品层热阻是8.300。`                            | ❌ INVALID_FACT             |
| `板自身R=8.3。` / `整墙R₀=8.0。` / `K=0.3。`      | ❌ INVALID_FACT             |
| `A4-1，厚度 18 mm，产品层热阻 8.000。`（跨候选拼字段）      | ❌ INVALID_FACT             |
| `方案 A9-9，K=0.120。` / `印刷页码 7 的方案。`        | ❌ INVALID_FACT             |
| `这是全部方案里最高的 K 值。` / `该方案符合上海标准。`          | ❌ INVALID_FACT             |
| 只问 K≈0.3，回答只说 `A1-3，18mm，K=0.303`         | ✅ VALID_FACTS（未出现的字段不强制输出） |

---

## 7. REFERENCE_LOOKUP 恢复 LLM 表达

### 7.1 改造前

```ts
// reference-query.service.ts
const facts = buildAllowedAnswerFacts(...);
return { text: facts.canonicalAnswers[0]!, sources: pages.sources };

// ai-generation.service.ts
fullText = resolved.text;                       // ← 固定模板
writeSse(reply, "delta", { text: resolved.text });
```

LLM 完全不参与 REFERENCE_LOOKUP 的最终表达，用户看到的是后端模板。

### 7.2 改造后

`resolveReferenceQueryWithoutAgent` **不再产出最终文案**，只负责「查询 + 冻结事实」：

```ts
return { facts, sources: pages.sources, needsClarification: Boolean(query.unresolved?.length) };
```

`ai-generation.service.ts`（非 Agent 路径）：

```ts
const { facts } = resolved;
const factSystem = `${REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT}\n\n${renderAllowedFactsForModel(facts)}`;
const draft = await generateText({ model, system: factSystem, messages, ... });
checked = await validateOrRepairThermalAnswer(draft, facts.canonicalAnswers, retryOnce, facts);
// 通过 → 输出；失败 → 重试一次；仍失败 → fallback 到 canonicalAnswers[0]
```

`ai-agent.service.ts`（Agent 路径）的 `flushVisible` 同样把 `ctx.thermalAllowedFacts` 传进 `validateOrRepairThermalAnswer`，重试提示从「原样输出」改为「只用一个事实清单，换一种自然说法」。

### 7.3 事实清单与 System Prompt

`renderAllowedFactsForModel(facts)` 输出：

```
【本次已核验事实（唯一可用信息源）】
查询条件：薄抹灰，K≈0.3
命中候选（共 1 条，只可引用以下事实）：
1. …；方案编码 A1-3；厚度 18 mm；产品层热阻 R=2.88；整墙总热阻 R₀=3.297；传热系数 K=0.303；印刷页码 22
可引用的印刷页码：22
```

`REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT` 明确：只能用事实清单、允许自然口语化表达、数值必须完全一致、不得宣称极值/唯一、未授权不得说达标合规、清单标注需要澄清时只提问、命中为空时如实说明。

### 7.4 固定模板降级为 Fallback

只有两种情况使用 deterministic fallback：

1. LLM 调用失败（模型不可用 / 超时 / 中止以外异常）；
2. 生成 + 重试一次后事实校验仍失败。

同时把 `tool-result-normalizer.ts` 的指令从  
`事实门禁要求原样输出以下后端核验答案：…`  
改为  
`后端已核验以下事实，请基于它自然作答：数值、厚度、页码、方案编码必须与事实完全一致，不得新增、改写、换算或推算；允许使用自然的同义说法。参考表述：…`

### 7.5 计算结果也纳入同一套事实门禁

新增 `AllowedAnswerFacts.calculation`（K / R₀ / 产品层 R / 标准限值 / 合规授权 / 逐层 λ·α）。  
`calculationAsCandidates()` 把冻结结果展开成「汇总候选 + 每条构造层各一条伪候选」，  
使 K / R / λ / α / 厚度 / 页码 / 编码 走**同一套**事实匹配，且不会跨层拼参数。

---

## 8. 自动测试

| 命令                                                  | 结果                                |
| --------------------------------------------------- | --------------------------------- |
| `npx tsc -p tsconfig.json --noEmit`                 | ✅ 无错误                             |
| `npx tsc -p tsconfig.uat.json --noEmit`             | ✅ 无错误                             |
| `npx vitest run`（全量）                                | ✅ **153 个文件通过 / 1541 个用例通过，1 跳过** |
| `npx vitest run src/modules/thermal src/modules/ai` | ✅ 55 个文件 / 771 个用例                |

本轮新增 / 扩展的测试文件：

| 文件                                                    | 用例数 | 覆盖内容                                                                                                     |
| ----------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------- |
| `src/modules/ai/thermal-answer-semantics.test.ts`     | 33  | 语义事实抽取、切段、自然改写通过、数字改写失败、跨候选拼接失败、未授权断言、事实清单渲染、计算结果事实集、合规授权                                                |
| `src/modules/thermal/thermal-query-lifecycle.test.ts` | 25  | NEW/CONTINUE/REFINE/COMPARE 分类、Entity EXACT/FAMILY（systemIds 集合 + 硬约束）、K/PRODUCT_R/TOTAL_R 自然变体归一、倒装口语澄清 |
| `src/modules/thermal/thermal-query-debug.test.ts`     | 5   | 诊断快照、nearestFailure 排序、单行摘要、logger 缺级别不崩                                                                 |
| `src/modules/ai/thermal-answer-sse.test.ts`（扩展）       | 5   | 事实门禁在首个 delta 之前；**有 Allowed Fact Set 时自然复述被放行且不触发重试**；数字被改写时仍回退确定性答案                                    |


回归保护（本轮修复的 8 个既有用例）：`thermal-interaction-closeout.test.ts`、`thermal-lookup.test.ts`、`thermal-lookup-semantics.test.ts`（`主断面传热阻` 别名）。

---

## 9. 修改文件

### 新增

| 文件                                                        | 作用                                                    |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `src/modules/thermal/thermal-query-lifecycle.ts`          | NEW/CONTINUE/REFINE/COMPARE 判定（纯函数）                   |
| `src/modules/thermal/thermal-query-debug.ts`              | 查询诊断快照 + 单行摘要 + 容错日志                                  |
| `src/modules/ai/thermal-answer-semantics.ts`              | 语义事实抽取 / 切段 / 未授权断言                                   |
| `src/modules/ai/thermal-answer-validation.ts`             | Allowed Fact Set / 事实校验 / 澄清渲染 / 事实清单 / System Prompt |
| `src/modules/thermal/thermal-entity-resolver.ts`          | 实体 EXACT/FAMILY/CATEGORY/ALIAS/TEXT_HINT 解析           |
| `src/modules/thermal/thermal-query-state.ts`              | QueryState（SSOT）+ Constraint Engine + systemIds 硬约束   |
| `src/modules/ai/reference-query.service.ts`               | 非 Agent 查表：只查询 + 冻结事实                                 |
| `src/modules/thermal/thermal-query-dictionary.service.ts` | 名称目录（含 family / category）                             |

### 修改

| 文件                                                                                                                   | 改动                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/modules/ai/ai-generation.service.ts`                                                                            | REFERENCE_LOOKUP 分支改为 LLM 生成 → 校验 → fallback；新增 `generateText` 与事实模块导入                                 |
| `src/modules/ai/ai-agent.service.ts`                                                                                 | `flushVisible` 传入 `thermalAllowedFacts`；重试提示改为「从事实清单自然作答」                                              |
| `src/modules/ai/tools/thermal-calculate.tool.ts`                                                                     | 统一用 `setThermalAnswerFacts` 写入事实集；计算结果冻结 `calculation`；澄清文案自然化；接入查询诊断日志                                |
| `src/modules/ai/tools/compare-solutions.tool.ts`                                                                     | 已选候选对比写入事实集；指令允许自然表达                                                                                   |
| `src/modules/ai/tools/tool-result-normalizer.ts`                                                                     | 「原样输出」指令改为「数值一致、允许同义表达」                                                                                |
| `src/modules/ai/tools/tool-runtime.ts`                                                                               | `ToolRuntimeContext` 新增 `thermalAllowedFacts`（type-only 引入，无循环依赖）                                      |
| `src/modules/ai/tools/thermal-lookup.ts`                                                                             | 生命周期接入、`lifecycle` 返回值、`systemIds` 继承与签名                                                               |
| `src/modules/thermal/thermal-lookup-mode.ts`                                                                         | 指标词典补自然说法；修复 `主断面传热阻` 与「指标词后紧跟分隔符」两个解析缺陷                                                               |
| `src/modules/thermal/thermal-query-dictionary.service.ts`                                                            | 体系实体补 `family` / `category`                                                                            |
| `src/modules/ai/thermal-answer-facts.ts`                                                                             | 歧义表达（裸 R=数字 / 差不多数字）进入澄清                                                                               |
| `src/modules/thermal/thermal-candidate-matcher.ts` / `thermal-candidate.service.ts` / `thermal-candidate.schemas.ts` | `systemIds` 集合条件贯通                                                                                     |
| `src/modules/ai/conversation-task.ts`                                                                                | `LastReferenceLookup` 快照字段（query / candidates / selectedCandidateIds / matchedSystemHint / isFallback） |

> `thermal-calc.service.ts` 仅新增 `standardLimitId / buildingType / structureType` 透传，**未改动任何热工公式**。

---

## 10. 是否有 Breaking Change

### DB

**无 Migration。** 未改动 `src/db/schema.ts`，未新增 / 修改任何表、列、索引。  
QueryState 仍存放于现有 `ai_conversation_states.taskState.lastReferenceLookup.query` JSON，  
新增字段（`systemIds`、`lifecycle`）都是**可选**字段，旧快照可被直接读取。

### API

**无 Breaking Change。**

| 面                                       | 变化                                                                                                                                                                                                                                                       |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B 端 / C 端 HTTP 路由                       | 未改动                                                                                                                                                                                                                                                      |
| SSE 协议                                  | 事件类型不变（`delta` / `reference_pages` / `sources` / `done` / `need_user_input`）；REFERENCE_LOOKUP 由「一次性 delta」变为「校验后一次性 delta」，客户端无需改动                                                                                                                       |
| 内部函数签名                                  | `validateOrRepairThermalAnswer(answer, canonical, retry, allowedFacts?)`、`buildAllowedAnswerFacts(query, candidates, message, matchedCount?, options?)`、`validateAnswerFacts(answer, allowedFacts)` —— 新增参数**全部可选**，旧调用方行为不变（无事实上下文时仍走 deterministic 相等） |
| `resolveReferenceQueryWithoutAgent` 返回值 | `{ text, sources }` → `{ facts, sources, needsClarification }`。**这是内部函数**，全仓只有 `ai-generation.service.ts` 一个调用点，已同步改造；对外无影响                                                                                                                              |
| 新导出                                     | `setThermalAnswerFacts` / `renderAllowedFactsForModel` / `REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT` / `classifyQueryLifecycle` / `buildThermalQueryDebug` 等，均为新增，不删除旧导出                                                                                     |

### 行为变化（预期内，且是本次目标）

1. **回答文案会变**：REFERENCE_LOOKUP 从固定模板变为 LLM 自然表达。数值、厚度、页码、方案编码仍然与后端核验事实逐字一致；变化的是措辞。
2. **自然表达不再被判失败**：`answer === canonicalAnswer` 的约束解除，改为语义事实校验。
3. **多轮上下文更准**：独立新问题不再继承上一轮条件；追问仍然继承。
4. **族名查询不再要求唯一 systemId**：`薄抹灰` 解析为 systemIds 集合。
5. **新增诊断日志**：`logThermalQueryDebug` 在 `debug` 级别输出快照；当 `matched=0 且 nearby>0` 时额外输出一条 `warn`，含 `blockedBy=<候选>:<失败条件>`。

### 剩余风险与后续建议

1. `renderAllowedFactsForModel` 的清晰度直接决定 LLM 的发挥。已通过 System Prompt 约束，但建议在真实 UAT 中观察「事实清单被复述成什么样子」。
2. `nearbyCandidates` 进入事实池，意味着「最接近的候选」的数值也可以被引用。这是刻意设计（用户需要知道「差在哪」），但必须配合 Prompt 中「不得称为命中」的约束；当前由 `validateAnswerFacts` 的未授权断言规则兜底（不得说「全部/唯一/最高」）。
3. 澄清（`needsClarification`）目前仍以 deterministic 文案为准（本身已是自然问句），未强制走 LLM 重述，以避免澄清阶段被改写成语义漂移的提问。
