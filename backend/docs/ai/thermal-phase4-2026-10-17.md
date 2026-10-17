# 阶段 4：真实隔离 UAT 与交付 —— 执行报告

日期：2026-10-17
范围：`./backend` 隔离 UAT（`scripts/run-ai-uat.ts`）
前置：阶段 2（查表/多轮一致性）、阶段 3（三端展示）已完成

---

## 1. 结论摘要

| 项 | 结果 |
|---|---|
| UAT 环境 | ✅ 可运行（随机隔离库 + 独立 Redis 命名空间 + 固定 fixture + 真实模型 deepseek-chat） |
| 结构检查 | ✅ 45 场景 / 138 轮 |
| 本轮执行 | 3 场景 / 10 轮（SALES-017、SALES-002、DESIGN-020） |
| 结果 | 0 通过 / 2 警告 / 8 失败 / **18 hard fail** |
| 条件解析层 | ✅ 参数维度 100% / 100% / 75% |
| 路由与来源层 | ❌ 主导失败原因，**非本阶段改动引入** |
| 交付判定 | **未通过验收**，条件见 §6 |

**核心结论**：阶段 2 修好的条件层在多轮真实对话中生效（同问题对比基线，旧条件残留消失、回答从「没找到」变成正确列出候选）；但当前 REFERENCE_LOOKUP 被路由到 Knowledge 已确认页路径，而不是正式热工参考集（`thermal` 工具），导致阶段 2 的 B2/B6 修复在 UAT 中被绕过，`SOURCE` hard fail 持续存在。

---

## 2. UAT 环境（真实执行）

```
[UAT] 准备随机隔离数据库、独立Redis键/队列、固定正式fixture和测试页图。
```

- 库名 `vicp_ai_uat_<uuid>`，迁移只在随机库执行，`finally` 清理；
- Redis key 与 BullMQ 队列使用 UUID 命名空间，生产 Worker 不会消费测试队列；
- 每场景独立 `NORMAL_USER + CLIENT` 会话，走真实鉴权/配额；
- 固定 fixture：A1-3 / I型 / 18mm / 产品R 2.880 / 总R 3.297 / K 0.303 / 印刷页 22；A1-4 / I型 / 20mm / 产品R 3.200 / 总R 3.390 / K 0.295 / 印刷页 23；B1-1 / II型 / 18mm / 产品R 2.500 / 总R 2.917 / K 0.343 / 印刷页 24；
- 模型：`deepseek-chat`（每次调用有 `responseFormat not supported` 告警，属该模型结构化输出的已知限制，不影响 JSON 解析结果，但会降低语义层稳定性）。

**没有直接调用 Parser / Matcher / Service 生成回答**，全部走真实 HTTP + SSE。

---

## 3. 执行结果

| 场景 | 轮数 | 通过 | 警告 | 失败 | hard fail | intent | 参数 | 事实 | 多轮状态 | 来源 |
|---|---|---|---|---|---|---|---|---|---|---|
| SALES-017 真实传热8.3保温板问句 | 3 | 0 | 1 | 2 | 5 | 0% | **100%** | 33.3% | 33.3% | 100% |
| SALES-002 严格上限无结果 | 3 | 0 | 1 | 2 | 3 | 0% | **100%** | 33.3% | 33.3% | 100% |
| DESIGN-020 多轮指标修改/取消/恢复 | 4 | 0 | 0 | 4 | 10 | 0% | 75% | 0% | 25% | 100% |

报告原文：`logs/ai-uat/phase4-sales017/`、`phase4-sales002/`、`phase4-design020/`。

---

## 4. 关键证据：同问题对比基线

SALES-017 Turn 2 的问题完全相同（`我说的是传热系数K，改查0.3左右`），可直接对比。

### 4.1 基线（`logs/ai-uat/access-recheck-2026-10-13/report.md:932`）

```
filters: [ {TOTAL_R 8.3 APPROX}, {K 0.3 APPROX} ]     ← 旧条件残留
parserSource: FAST_PATH / queryParserSource: LEGACY_FALLBACK
回答：本次参考资料中，未找到总热阻 R₀接近 8.3、传热系数 K接近 0.3 且同时符合其他查询条件的参考方案。
结果：FAIL / 55，含 PARSER [HARD]
```

### 4.2 现在

```
filters: [ {K 0.3 APPROX, tolerance 0.02} ]           ← 旧条件已清除
parserSource: LLM / queryParserSource: LLM
回答：有，以下参考方案的传热系数 K接近 0.3：
     - A1-3：I型 VICP薄抹灰外保温系统；18mm，K=0.303 W/(m²·K)。第22页。
     - A1-4：I型 VICP薄抹灰外保温系统；20mm，K=0.295 W/(m²·K)。第23页。
结果：FAIL / 40，PARSER [HARD] 消失
```

**判定**：条件层从「残留旧指标 + 给出错误结论」变为「条件干净 + 结论正确」。分数仍不达标的原因是**另外两类**失败（见 §5），不是条件错误。

DESIGN-020 四轮（`K≤0.3 + 总R≥3.3 + 20mm以内` → `取消总R，厚度放宽到25` → `再加产品R做到2.9以上` → `不限制厚度，K改成0.3左右`）逐轮实际条件：

| 轮 | 实际 filters | 判断 |
|---|---|---|
| 1 | K≤0.3, TOTAL_R≥3.3, thicknessMax 20 | ✅ 与预期一致 |
| 2 | K≤0.3（TOTAL_R 已移除）, thicknessMax 25 | ✅ 取消生效 |
| 3 | K≤0.3, PRODUCT_R≥2.9 | ✅ 新增生效 |
| 4 | PRODUCT_R≥2.9, K≈0.3, thickness 清除 | ✅ 条件集合正确，仅**顺序**与预期不同 |

Turn 4 的 `PARSER [HARD]` 是**过滤条件顺序**差异（预期 `[K, PRODUCT_R]`，实际 `[PRODUCT_R, K]`），不是条件内容差异。该顺序由 `thermal-lookup.ts` 里「保持历史指标顺序」的既有逻辑决定，与本轮改动无关（本轮改动只在 `parsed.filters` 为空时生效，Turn 4 的 `parsed.filters` 非空）。

---

## 5. 主导性遗留问题（非本阶段引入）

### 5.1 现象

三个场景的每一轮都是：

```json
"toolRoute": ["backend:knowledge", "backend:reference_query"],
"toolUsage": { "report": false, "thermal": false, "knowledge": true },
"candidateSnapshotSource": ["REFERENCE:KNOWLEDGE_PAGE"]
```

而 UAT 契约要求：

```json
"toolsAny": ["thermal"], "operation": "LOOKUP_CANDIDATES"
```

由此产生两类失败：

| 失败 | 类型 | 说明 |
|---|---|---|
| `ROUTING：本轮实际工具须包含 thermal` | 非 hard | 走的是 Knowledge 已确认页，不是 `thermal` 工具 |
| `SOURCE [HARD]：候选体系/方案/规格/产品/原页ID均属于固定正式fixture` | hard | 候选 ID 来自 `KNOWLEDGE_PAGE` 快照，不是 `thermal_reference_rows` |

### 5.2 这正是阶段 2 §7 记录的两个来源问题

阶段 2 已经确认 REFERENCE_TABLE 与 KNOWLEDGE_PAGE 是两条不同审核链路，并做了「来源可区分 + 冲突不静默」的契约（`REFERENCE_SOURCE_LABELS` / `detectReferenceSourceConflicts`）。UAT 现在把这个契约的另一半暴露出来：**当两条链路都有同一构造时，路由器选了 Knowledge 那条，而验收契约只认正式参考集。**

也就是说：

- 阶段 2 的 B2（零命中话术）只在 REFERENCE_TABLE 路径生效，UAT 走 Knowledge 路径 → 看不到修复效果；
- 阶段 2 的 B6（来源标注）在 UAT 回答里可见：Turn 3 回答末尾出现「来源：CONFIRMED_PAGE（已确认图集页（页面识别确认））」，说明标注生效，但 `evidenceSource` 原文是 `CONFIRMED_PAGE`，导致标签嵌套，可读性差。

### 5.3 归因（重要）

路由文件在本轮之前**已有未提交改动**，非本次修改：

```
backend/src/modules/ai/ai-domain-policy.ts       | 15 ++++++++++++---
backend/src/modules/ai/ai-domain-semantic.ts     |  3 +++
backend/src/modules/ai/semantic-query.service.ts |  6 ++++--
```

其中 `ai-domain-policy.ts` 把查询置信度阈值从 `.9` 降到 `.8`、新增 `FACTS_ONLY` 结果模式，使语义层（LLM）接管了原本走 `FAST_PATH` 的查询，进而改变了工具路由。基线报告里 `parserSource: FAST_PATH`、`toolRoute: ["thermal", "search_knowledge"]`；现在 `parserSource: LLM`、`toolRoute: ["backend:knowledge", "backend:reference_query"]`。

按用户约束「不要大规模重构 AI Router、替换 Tool 架构」，**本轮没有修改路由**，只把它作为阻塞项记录。

### 5.4 顺带发现的展示问题

UAT 回答出现 `来源：CONFIRMED_PAGE（已确认图集页（页面识别确认））`。`evidenceSource` 已经是内部枚举值时，再拼来源类型标签会形成嵌套。属阶段 2 B6 的边界情况，修复很小（`evidenceSource` 命中内部枚举时不重复拼），但需要连同路由问题一起处理，否则改了也看不到。

---

## 6. 交付判定与条件

### 6.1 判定

**不通过验收。** 依据：

- 10 轮中 0 通过、18 hard fail；
- 主导原因是路由/来源选择（§5），不是本轮修复的条件层（§4 已证明条件层正确）；
- 业务 UAT 文档本身也写明「Parser/Matcher 主结构冻结，不等同于已经通过真实业务验收」。

### 6.2 本轮可交付的部分

| 交付物 | 证据（真实执行输出） |
|---|---|
| 阶段 2 报告 | `docs/ai/thermal-phase2-2026-10-17.md` |
| 阶段 3 报告 | `docs/ai/thermal-phase3-2026-10-17.md` |
| 阶段 4 报告 | 本文件 |
| 后端全量测试 | `npx vitest run` → `218 files passed \| 1 skipped (219)`，`2555 passed \| 1 expected fail \| 1 skipped \| 0 failed` |
| 后端类型检查 | `npx tsc -p tsconfig.json --noEmit` → 无输出，`TSC_EXIT=0` |
| B 端类型检查 | `vue-tsc --noEmit` → `EXIT 0` |
| B 端热工单测 | `thermal-calc.test.ts` 18 通过；`ThermalCalcResultCard.test.ts` 4 通过（jsdom 真实挂载） |
| App 测试 | `node scripts/run-tests.mjs` → 150 通过 / 0 失败 |
| 报告渲染测试 | `npx vitest run src/modules/reports` → 72 通过 / 10 文件 |
| 语义匹配 AST | `node scripts/check-semantic-matching.mjs` → `语义匹配AST检查通过：10个关键文件，31个白名单表达式；开放意图规则禁止。`（本轮改动前后均为 31，未新增） |

以上最后一行（类型检查 + 语义 AST）为**最终代码状态下重跑确认**，在 `solution-document-render.ts` / `solution-document-render.test.ts` 的 C4 表头改动之后执行。

### 6.3 进入验收前必须解决（按优先级）

1. **REFERENCE_LOOKUP 的路由口径**（阻塞级）
   UAT 契约要求 `thermal` 工具（正式热工参考集），实际走 `backend:reference_query`（Knowledge 已确认页）。需要产品决策：是以正式参考集为准，还是允许 Knowledge 页作为等价来源并修改 UAT 契约。**二者必须选一，不能并存。**

2. **两来源同一构造的优先级规则**（阻塞级）
   阶段 2 §7 只做了「可区分 + 冲突提示」，没有定优先级。UAT 的 `SOURCE [HARD]` 要求候选必须来自固定正式 fixture，等价于要求正式参考集优先。

3. **`evidenceSource` 已是枚举值时不再拼来源标签**（体验级）
   见 §5.4。

4. **过滤条件顺序**（契约级）
   DESIGN-020 Turn 4 的 `PARSER [HARD]` 是顺序差异。要么改 UAT 契约按集合比较，要么统一排序规则。需要确认哪边是权威。

5. **浏览器端到端验收**（阶段 3 遗留 BLOCKED）
   需要：可用的 Chromium 内核（本环境 `storage.googleapis.com` 不可达）+ 已授权的测试账号 + 可访问测试环境。当前不具备。

### 6.4 未触碰的红线（复核）

- 未修改生产数据；UAT 只用随机隔离库，`finally` 清理；
- 未修改历史 Snapshot / 已生成 PDF / 计算记录；
- 未修改 VICP-CALC-1；
- 未放宽权限、作用域、版本、Revision、显式 Confirm、Snapshot/报告幂等；
- 未新增产品参数 / 图集 K 值 / 标准限值默认值；
- 未重构 AI Router / Tool 架构 / 新增第二套计算器；
- 未为几个句子堆关键词正则（`check-semantic-matching.mjs` 白名单表达式 31 → 31）。

---

## 7. 建议的下一步

1. 甲方/产品确认 §6.3 第 1、2 项口径（正式参考集优先 vs 两来源等价）；
2. 口径确认后，在 `ai-domain-policy.ts` / 工具路由层做**最小改动**把 REFERENCE_LOOKUP 指回 `thermal`，再复跑 SALES-017 / SALES-002 / DESIGN-020 三例，预期 `SOURCE [HARD]` 与 `ROUTING` 同时消失；
3. 复跑通过后，再跑全量 45 场景 138 轮，与基线 `access-recheck-2026-10-13`（18 通过 / 122 hard fail）对比；
4. 补齐浏览器验收环境（内核 + 测试账号），完成阶段 3 的 BLOCKED 项；
5. 甲方确认产品边界后派生 VICP-CALC-2，把阶段 1 的 `it.fails`（分层产品 R 4.8 vs 5.0）转为正式通过。
