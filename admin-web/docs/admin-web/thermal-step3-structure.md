# VICP B 端 · Step 3 热工参考 + 热工计算重构

日期：2026-10-08
范围：热工候选方案试算（`/thermal/candidates`）、热工计算（`/thermal/calc`）、计算记录详情（`/thermal/calc-records`）。
原则：数值一律来自后端冻结快照；前端不重算 K / R；不伪实现后端缺口；`../backend/` 只读，零改动。

---

## 一、结构性 / 契约问题与处理

| 问题 | 现状 | 处理 |
|---|---|---|
| **图集查表结果投影失效（真实缺陷）** | `thermalCalcResultSummary()` 只读 `result.productResistance / totalResistance / kValue`；但 `REFERENCE_TABLE` 的 `resultJson` **没有顶层数值**，结果只存在于 `result.candidates[]`（后端 `thermal-execute` 按参考集 priority 排序）。因此图集查表模式下，计算页双 R / K / 厚度全部显示「—」 | 新增 `thermalCalcReferenceCandidates()`；`thermalCalcResultSummary()` 增加查表分支（取 `candidates[0]`，优先舍入值），`limitKValue` 从 `result.limitKValue ?? standard.limitKValue` 兜底；新增 `candidateCount` |
| **计算方式文案双份实现** | `utils/thermal-calc.ts` 写「当量导热」，`ThermalCalcRecordPanel.vue` 自建 `modeOptions/modeLabels` 写「等效热阻」——同一后端 enum 两套文案 | 统一到 `THERMAL_CALC_MODE_OPTIONS` 单一事实源，文案按后端语义改为**整体当量法**（后端 `thermal-calc.service.ts` 用语「整体当量法」）；记录面板删除本地副本 |
| **计算记录列表「结果摘要」是原始 JSON 键值对** | `resultSummary()` 直接遍历 `Object.entries(row.result)` 取前 3 个标量，查表模式会显示 `valid: true；mode: REFERENCE_TABLE` | 改用 `thermalCalcResultSummary()`，输出 `R=… · R₀=… · K=… · 满足/不满足限值` |
| **查询条件构造不可复用、无匹配语义回显** | 条件行 UI 硬编码在候选面板内；`lookupMode / effectiveTolerance / toleranceAdjusted` 三个后端回显字段未消费 | 抽出 `ThermalConditionBuilder`；新增匹配语义回显行，确认「接近」与「上限」未被混淆、容差是否被后端收敛 |
| **来源回溯重复实现** | 候选面板内联 dialog + 取图逻辑 | 抽出 `ThermalSourceViewer`，统一加载 / 有图 / 空态三态，含竞态保护 |
| **原始 JSON 直接暴露给业务用户** | 计算页用无门控的 `t-collapse` 展示 `record.result`；记录详情同样 | 抽出 `ThermalDebugPanel`，`canDebug` 门控（`system:knowledge:debug`，超管自动放行），无权限整块不渲染；分块展示 input / layers / parameters / rule / standard / formulas / steps / result |
| **计算页无空态、无来源与依据区** | 未计算时页面只有参数卡；结果区无规则版本 / 限值版本 / 图集依据 | 新增 `AppEmptyState` 未计算空态；结果卡补「依据 / 快照版本」；页尾补规则与限值版本标签 |
| **图集无匹配行时用户无出路** | 仅一条后端 note | 新增无结果区块：去候选方案试算（带 `regionCode` + `thicknessMm` 预填）/ 改用整体当量法 / 改用分层计算（一键切模式重算） |

---

## 二、新增 / 修改 / 删除文件

**新增**

| 文件 | 职责 |
|---|---|
| `src/components/business/thermal/condition-model.ts` | 条件编辑模型（`ThermalConditionDraft` / `ThermalConditionPayload` / `ThermalThicknessMode` / `createThermalConditionDraft` / `THERMAL_CONDITION_MAX_ROWS`） |
| `src/components/business/thermal/ThermalConditionBuilder.vue` | 多指标 AND 条件构造（≤12 条）+ 厚度档（不限 / 精确档 / 区间）+ 生效条件预览；纯 UI 不发请求 |
| `src/components/business/thermal/ThermalCalcResultCard.vue` | 计算结果主视图：双 R（产品层热阻 R / 总热阻 R₀）+ K + 限值 + 判定 + 依据 + 快照版本 |
| `src/components/business/thermal/ThermalSourceViewer.vue` | 来源回溯查看器（原始页面图片） |
| `src/components/business/thermal/ThermalDebugPanel.vue` | 高级调试（原始快照 JSON），debug 权限门控 |
| `src/utils/thermal-calc.test.ts` | 11 个单测，锁定查表投影 / 双 R / 证据回溯 / 模式文案 |

**修改**

| 文件 | 变更 |
|---|---|
| `src/utils/thermal-calc.ts` | 模式文案改「整体当量法」；新增 `thermalCalcReferenceCandidates` / `thermalCalcEvidence` / `thermalCalcEvidenceLabel`；`ThermalCalcResultSummary` 增 `ruleCode` / `candidateCount`；查表分支 |
| `src/utils/thermal-presentation.ts` | 新增指标 / 匹配语义文案单一事实源（`THERMAL_LOOKUP_METRIC_OPTIONS` / `THERMAL_LOOKUP_MODE_OPTIONS` / `thermalLookupMetricUnit` / `thermalLookupConditionText` / `thermalLookupConditionSummary`） |
| `src/components/business/thermal/ThermalCandidatePanel.vue` | 接入 `ThermalConditionBuilder` + `ThermalSourceViewer`；条件摘要改为「后端 filters 回显 + 本地厚度载荷」；新增匹配语义回显；参考集优先级 / 基层信息展示；无结果区改用 `AppEmptyState` 并给「放宽厚度 / 清除全部条件」 |
| `src/components/business/thermal/ThermalCalcRecordPanel.vue` | 模式文案改用单一事实源；列表摘要改双 R；详情抽屉接入 `ThermalCalcResultCard` + `ThermalDebugPanel`；清理 6 组失效样式 |
| `src/views/thermal/calc/index.vue` | 整页重排（见下） |
| `src/views/thermal/candidates/index.vue` | 页面描述改为多指标 + 厚度档 + 来源回溯口径 |

**删除**：无（本轮无组件删除）。

---

## 三、热工计算页 IA

```
计算参数（t-card）
  ├ 计算方式（图集查表 / 整体当量法 / 分层计算）
  ├ 构造方案 · 产品规格 · 保温层厚度 · 地区（选填，仅解析标准限值）
  ├ 执行计算 / 重置参数
  └ 模式说明（该模式的适用前提与数据依赖）

未计算 → AppEmptyState「还没有计算结果」

计算结果（t-card）
  ├ 计算未通过 → t-alert(error)，展示后端字段级错误
  ├ 后端 notes → t-alert(info)
  ├ ThermalCalcResultCard
  │   ├ 来源标签（图集参考值 / 系统计算结果）+ 说明 + 命中 N 条图集参考行
  │   ├ 4 张 AppMetricCard：保温层厚度 / 产品层热阻 R / 总热阻 R₀ / 传热系数 K
  │   └ 限值 · 是否满足要求 · 计算方式 · 使用规则 · 依据 · 快照版本
  ├ 图集参考表无精确匹配行 → 无结果区块（去候选试算 / 改用整体当量法 / 改用分层计算）
  ├ 命中参考行表（参考集 / 版本 / 厚度 / R / R₀ / K / 限值判定 / 图集依据）
  ├ 构造层表（材料 / 厚度 / λ / 修正系数 α / 热阻 R）
  ├ 计算依据（Ri / Re / R₀ = Ri + ΣR + Re / K = 1 / R₀）——仅整体当量法与分层计算
  ├ 计算过程（有序步骤）· 公式
  ├ 页尾标签：计算方式 · 规则 vN · 限值 vN
  └ ThermalDebugPanel（canDebug 门控）
```

支持从候选试算 / 项目详情带参进入：
`/thermal/calc?mode=…&schemeId=…&productSpecId=…&thicknessMm=…&regionCode=…&projectId=…`
（`mode` 按 `THERMAL_CALC_MODE_OPTIONS` 白名单校验，非法值回落 `REFERENCE_TABLE`）

---

## 四、双 R 与来源回溯

- **双 R 语义**：产品层热阻 R = `productThermalResistance`（仅产品层），总热阻 R₀ = `totalThermalResistance`（含基层、非产品层与内外表面换热阻）。两者在候选卡、结果卡、记录列表摘要、记录详情四处使用同一文案与单位（`(㎡·K)/W`），不再出现只显示总热阻的情况。
- **来源回溯三层**：
  1. 候选卡：图集依据（`evidence.source + evidence.ref`）+ 参考集编码 / 版本 / 优先级 + 来源资料印刷页码（无则回落 `scheme.atlasPage`）+ 适用建筑类型；
  2. 候选卡「查看原始页面」→ `ThermalSourceViewer`（依赖 `system:knowledge:doc:list`）；
  3. 计算页 / 记录详情：`thermalCalcEvidence()` 统一取「图集证据 → 标准限值 → 计算规则」优先级，输出「依据 + 快照版本」。

---

## 五、权限与门控

| 能力 | 权限码 | 说明 |
|---|---|---|
| 候选试算 / 计算 / 记录 | `system:thermal:list` | 与后端 `THERMAL_PERMISSIONS.LIST` 一致 |
| 查看原始页面 | `system:knowledge:doc:list` | 后端 `GET /pages/:pageId/recognition` 要求 DOC_LIST |
| 高级调试（原始 JSON） | `system:knowledge:debug` | 后端 `system:thermal:*` **无专用 debug 码**，沿用知识库 debug 码；超管经 `hasAnyPermission` 自动放行 |

---

## 六、Backend Gap（本轮未伪实现）

1. **热工无专用 debug 权限码**：`THERMAL_PERMISSIONS` 只有 list/add/edit/remove/approve/publish/import，原始 JSON 调试区只能借 `system:knowledge:debug` 或超管门控。建议后端补 `system:thermal:debug`。
2. **`REFERENCE_TABLE` 计算结果的候选行不含来源字段**：候选查询 DTO（`thermalCandidateDto`）有 `sourceDocumentId / sourcePageId / sourcePageLabel`，但 `executeReferenceTable` 写入 `resultJson.candidates[]` 的对象**没有**这三个字段。因此计算页 / 记录详情无法「查看原始页面」，只能展示 `evidenceSource + evidenceRef` 文本。建议后端在快照候选行补来源字段（或在 presentation 层透出）。
3. **B 端无候选确认落库接口**：`POST /candidate-selections` 只存在于 `ai-thermal.routes.ts`（AI 端，需 `projectId`）；B 端 `thermal.routes.ts` 仅有 `GET /candidate-selections`。因此候选页**不提供**「确认候选方案」按钮（不编造接口）。建议后端为 B 端开放 `POST /candidate-selections`（`projectId` 可选）。
4. **计算记录无操作人姓名**：`thermalCalcRecordDto` 仅 `createdById`（沿用 2026-10-07 报告）。
5. **参考集无来源版本号**：`thermalSetDto` 只有 `atlasDocumentId`，无来源知识版本号；来源页码仅在参考行层（沿用 2026-10-07 报告）。

---

## 七、验证

| 项 | 结果 |
|---|---|
| `vue-tsc --noEmit` | ✅ 0 error |
| `vitest run` | ✅ 93 files / 664 tests passed（Step 3 新增 1 文件 / 11 用例） |
| `vite build --no-emptyOutDir` | ✅ 通过 |
| Step 3 改动文件 ESLint | ✅ 0 error / 0 warning |
| `git status -- backend` | ✅ 0 改动 |

> 备注 1：`pnpm build` 因沙箱 `SAFE_DELETE_BULK_CONFIRM_REQUIRED`（清空 `dist/` 超 50 文件阈值）失败，改用 `--no-emptyOutDir`，与 Step 1 / Step 2 一致，非代码问题。
>
> 备注 2：热工目录内 5 个**本轮未触碰**的面板（`ThermalSetPanel` / `ThermalReferenceRowsPanel` / `ThermalCalcRulePanel` / `ThermalStandardLimitPanel` / `ThermalWorkspace`）存在**重构前既有 lint 基线**（124 error / 38 warning，主要是 `antfu/consistent-list-newline`、`import/first`（双 `<script>` 块）、`vue/no-useless-v-bind`、`style/eol-last`）。这些文件不在 Step 3 范围内，按计划留到 Step 4 与知识库剩余文件一并清理，避免跨阶段扩大改动面。

---

## 八、下一步

**Step 4** 统一文案 / 状态 / 空态 / 错误 / 视觉：

- 把热工与知识库剩余文件的错误提示迁到统一入口（当前热工仍用 `normalizeFeedbackError`，知识库 Step 2 触及的 5 个文件用 `knowledgeUserError`）——建议先把 `knowledgeUserError` 重命名/提升为跨模块的 `businessUserError`；
- 清理 `KnowledgeTestDrawer` / `KnowledgeVersionDrawer` / `KnowledgeWorkspaceHeader` / `KnowledgeStructuredDataPanel` 的既有 lint 基线；
- 全模块空态 / 错误态文案与 `AppEmptyState` / `AppErrorState` 用法对齐；
- 清理页面散落样式值，统一到 Design Token。

**Step 5** B 端 E2E 验收与交付物。
