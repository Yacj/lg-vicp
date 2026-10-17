# 阶段 3：B 端 / App / 报告三端展示绑定 —— 执行报告

日期：2026-10-17
范围：`./admin-web`、`./app`、`./backend`（报告渲染）
前置：阶段 2 已完成（见 `thermal-phase2-2026-10-17.md`）

---

## 1. 结论摘要

| 编号 | 问题 | 严重度 | 状态 |
|---|---|---|---|
| C1 | B 端构造层表「层热阻 R」按数组下标兜底，层数≠步骤数时 R 贴到错误的层 | **P0** | 已修复 + 已测 |
| C2 | 「保温层厚度」标签把产品层总厚度说成单层板厚 | P1 | 已修复 + 已测 |
| C3 | 层表不显示层类型，无法区分产品层/基层/固定层 | P1 | 已修复 + 已测 |
| C4 | 报告表头「板厚 / 产品 R / 总 R₀」用简称，产品 R 易被读成总 R | P2 | 已修复 + 已测 |
| — | 硬编码「外墙主断面」在展示层 | — | 阶段 2 已清（B3）；本轮确认前端剩余处均为**原页列名**，不改 |

**真实浏览器测试**：开发服务器可正常启动并返回页面（HTTP 200），但 Chromium 内核下载被网络阻断（`storage.googleapis.com` 三次超时），**浏览器端人工验证记为 BLOCKED**；改用 jsdom 真实挂载渲染测试替代，见 §5。

---

## 2. C1：层表 R 错位（P0）

### 2.1 缺陷

`admin-web/src/utils/thermal-calc.ts` 原实现：

```ts
const layerStepValues = steps
  .filter(step => step.key.startsWith('layer_'))
  .sort(...)
  .map(step => asNumber(step.rounded) ?? asNumber(step.value))
const byOrder = new Map<number, number | null>()
layerStepValues.forEach((value, index) => byOrder.set(index + 1, value))   // ← 按下标
...
rValue: byOrder.get(order) ?? layerStepValues[index] ?? null,             // ← 再按下标兜底
```

`steps` 的 key 本身带层序（后端 `thermal-calculator.ts:285/298` 写入 `layer_${layer.layerOrder}`，EQUIVALENT 下产品层写 `product_${layer.layerOrder}`），但前端丢掉了 key 里的层序，改成按数组位置推断。

### 2.2 两种真实触发场景

| 场景 | 后端行为 | 前端旧行为 |
|---|---|---|
| EQUIVALENT（整体当量法） | 产品层步骤 key 是 `product_N`，不进 `layer_*` | `byOrder` 缺该层 → 落到 `layerStepValues[index]`，把**第一个非产品层**的 R 贴到产品层 |
| `includeNonProductLayers=false` | 非产品层不产生步骤 | 步骤数 < 层数，后续所有层 R 整体前移一位 |

甲方 Excel 的「整体当量法 25mm」正好走第一种。

### 2.3 修复

```ts
const rByOrder = new Map<number, number | null>()
for (const step of steps) {
  const matched = typeof step.key === 'string' ? /^(?:layer|product)_(\d+)$/.exec(step.key) : null
  if (!matched) continue
  rByOrder.set(Number(matched[1]), asNumber(step.rounded) ?? asNumber(step.value))
}
...
rValue: rByOrder.get(order) ?? null,
```

同时把 `layer_*` 与 `product_*` 都认（两者都是「这一层的热阻」），并**取消下标兜底**：没有对应步骤就留空，不得用相邻层的数值顶替。

### 2.4 测试（`thermal-calc.test.ts` 新增 4 例）

- LAYERED：三层各取到自己的 R；
- EQUIVALENT：`product_1` 正确绑定到产品层；
- `includeNonProductLayers=false`：无步骤的层为 `null`（旧实现会给 3.5，即产品层 R 贴到基层）；
- 层序不连续（2、5）：按 key 取，不平移。

---

## 3. C2 / C3：厚度与子层绑定

### 3.1 C2 标签

`ThermalCalcResultSummary` 新增 `productLayerCount`，并新增：

```ts
export function thermalCalcThicknessLabel(summary: ThermalCalcResultSummary): string {
  return summary.productLayerCount > 1 ? `产品总厚度（${summary.productLayerCount} 个子层）` : '产品厚度'
}
```

| 位置 | 原标签 | 现标签 |
|---|---|---|
| `ThermalCalcResultCard.vue` 指标卡 | 保温层厚度 | `thermalCalcThicknessLabel(summary)` |
| `views/thermal/calc/index.vue` 表单 | 保温层厚度 (mm) | 产品厚度 (mm) |
| `app/src/utils/aiSolution.ts` 指标卡 | 保温层厚度 | 产品厚度 |
| `app/.../AiThermalSolutionCard.vue` | 保温层厚度 | 产品厚度 |

甲方分层例（10+15+10）在 B 端会显示「产品总厚度（3 个子层）」，不会被读成 10mm 单层。

### 3.2 C3 层类型

`ThermalCalcLayerRow` 新增 `layerType` / `layerTypeLabel`，层表新增首列「层类型」：

```ts
export const THERMAL_LAYER_TYPE_LABELS: Record<string, string> = {
  PRODUCT_LAYER: '产品层', BASE_LAYER: '基层', FIXING_LAYER: '固定层', VARIABLE_LAYER: '可变层',
}
```

快照缺 `layerType` 时留空，不猜。

---

## 4. C4：报告表头

`backend/src/modules/reports/solution-document-render.ts`

| 位置 | 原 | 现 |
|---|---|---|
| `solutionTable` 表头 | 产品 / 板厚 mm；产品 R；总 R₀ | 产品 / 产品厚度 mm；产品层热阻 R；总热阻 R₀ |
| `renderFrozenReferenceTables` 表头 | 板厚 mm；产品 R；总 R₀ | 产品厚度 mm；产品层热阻 R；总热阻 R₀ |
| 「热工参数与依据」正文 | 产品 R=…；总 R₀=… | 产品层热阻 R=…；总热阻 R₀=… |

报告**没有**「外墙主断面」字样（原本就是中性的「总 R₀」），本轮确认无需改动。

### 4.1 保留不改的「外墙主断面」

| 位置 | 为什么保留 |
|---|---|
| `knowledge-page-renderer.ts:108` | 图集**原页列名**，原文就写「外墙主断面总热阻 R₀」 |
| `page-recognition.ts` / `types/knowledge.ts` | 页识别字段契约，同上 |
| `admin-web/src/utils/complex-atlas.ts`、`app/src/utils/complexAtlas.ts` 的 `thermalGroupHeader` | 渲染原页表头 |
| `thermal-answer-semantics.ts:46` | 用户输入的**同义词解析**，不是输出 |

判断标准：**描述原页时保留原文；描述计算结果时用中性名。**

---

## 5. 验证证据

### 5.1 单元 / 组件测试

```
admin-web  src/utils/thermal-calc.test.ts              18 passed（原 13，+5）
admin-web  ThermalCalcResultCard.test.ts                 4 passed（新增，jsdom 真实挂载）
app        node scripts/run-tests.mjs                  150 passed / 0 failed（含新增标签断言）
backend    src/modules/reports                         72 passed（10 files）
backend    npx vitest run（全量）                       见 §5.3
admin-web  npx vue-tsc --noEmit                        EXIT 0
```

### 5.2 真实渲染（DOM）断言

`ThermalCalcResultCard.test.ts` 用 jsdom 真实挂载组件，断言的是**用户看到的文本**：

| 断言 | 结果 |
|---|---|
| 「产品层热阻 R」与「总热阻 R₀」分别出现 | ✅ |
| R 用 `m²·K/W`、K 用 `W/(m²·K)`，不串用 | ✅ |
| 单产品层显示「产品厚度」、不含「保温层厚度」 | ✅ |
| 三子层显示「产品总厚度（3 个子层）」 | ✅ |
| 不含「外墙主断面」 | ✅ |

### 5.3 浏览器验证（BLOCKED，如实记录）

| 步骤 | 结果 |
|---|---|
| 启动 `vite`（`node node_modules/vite/bin/vite.js --port 5178`） | ✅ `VITE v8.3.4 ready in 15875 ms` |
| `curl http://127.0.0.1:5178/` | ✅ HTTP 200，返回正确 `<title>蓝格智配管理系统（开发环境）</title>` |
| 安装 `agent-browser` | ✅ |
| `agent-browser install`（下载 Chrome 155） | ❌ 三次重试后 `operation timed out`（`storage.googleapis.com` 不可达） |

**结论**：环境可启动、可返回页面，但**没有可用的浏览器内核**，无法完成「登录 → 热工计算页 → 结果卡片」的人工视觉确认。该维度记为 **BLOCKED**，不计为通过。

同时说明：登录需要生产 API 的真实账号，而约束明确禁止修改生产数据，因此即使内核可用，也只能验证到登录页为止。要完成真正的端到端浏览器验收，需要一个已授权的测试账号 + 可访问的测试环境，这属于阶段 4 交付条件。

---

## 6. 未改动项（有意保留）

| 项 | 原因 |
|---|---|
| 热阻单位两种写法 `m²·K/W` 与 `(m²·K)/W` 并存 | 两者物理等价，全仓既有约定分裂（知识页标签与报告用括号式，计算卡片与 AI 回答用斜杠式）。统一属纯装饰性改动，涉及大量断言且无工程意义，本轮不做。每个数值仍各自带正确单位。 |
| `app` 端组件视觉验证 | uni-app 测试运行器无 DOM，标签正确性已由 `aiSolution.test.ts` 断言覆盖 |
| 阶段 1 的 P0-A1（分层产品 R 4.8 vs 5.0） | 等甲方确认产品边界后派生 VICP-CALC-2，本轮不动 CALC-1 |

---

## 7. 阶段 3 结束

三端展示的「单位 / 符号 / 构造身份 / 厚度与子层」绑定已完成并通过测试；真实浏览器验收因环境（浏览器内核下载失败 + 无测试账号）记为 BLOCKED，需在阶段 4 交付条件中补齐。
