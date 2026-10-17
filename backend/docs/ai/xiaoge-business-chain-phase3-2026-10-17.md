# 小格 AI 业务理解、检索与热工问答：阶段 3（Thermal Tool 与事实契约）

执行日期：2026-10-17（Asia/Hong_Kong）。本阶段只做阶段 3，完成后停止。

## 1. 问题的真实根因与触发条件

### E2-a（P1）：Tool 用关键词覆盖已验证的 Semantic 引用作用域

**根因**：`thermal-calculate.tool.ts` 的 CALCULATE 分支不看 Semantic，直接用
`/已选|选中的|保留的/` 决定 `referenceScope`。

- 触发条件 A：Semantic 判定 `CURRENT_SELECTED`，但用户原话是「帮我算这个方案」「按刚才那个算」——没有「已选」字样，作用域被降级成 `LATEST_VISIBLE`，可能算到列表里任意一条。
- 触发条件 B：Semantic 判定 `LATEST_VISIBLE`（用户只是看见列表），原话恰好含「已选」二字（例如「已选过的都不要」），作用域被强行提升成 `CURRENT_SELECTED`。
- 这是「已验证决策被下游关键词覆盖」的实例，与本轮强制规定直接冲突。

### E2-b（P1）：是否做合规核验由关键词决定，且无法表达「明确不要求」

**根因**：同一分支用 `/达标|合规|符合.*标准/` 决定是否调用 `resolveScopedThermalStandard`。

- Semantic 契约里没有表达「本轮是否要达标判定」的字段，所以 Tool 只能猜；
- 用户在只读查询或解释里提到「达标」也会触发一次标准范围核验；反过来，语义明确要求判定但原话措辞不同（如「能不能满足节能要求」已有 intent 覆盖、但计算分支不看 intent）就漏掉。
- 触发条件：任何进入 CALCULATE 且原话含上述字样的请求。

### E1（P1）：产品层热阻被当成产品整体热阻往下游传

**根因**：Calculator 已经知道 LAYERED 只累加 `PRODUCT_LAYER` 行（源码注释直接写明「不等于产品整体热阻」），但这个知识**没有进入运行时事实**：

- `thermal-calc.service` 的 `resultJson` 只存 `productResistance`，没有口径；
- `thermal-calculate.tool` 把它直接写进 `calculationFacts.productThermalResistance`；
- `renderAllowedFactsForModel` / `normalizeThermalForModel` 把数值交给模型时没有任何范围说明；
- 结果：模型完全可以合法地把 4.8 说成「产品整体热阻 4.8」，而甲方口径是 5.0。
- 触发条件：任何 LAYERED 多子层产品（包覆 + 芯材 + 包覆）的正式计算。

### E1-标签（P1）：构造层总热阻统一被叫成「整墙总热阻」

**根因**：`thermal-answer-validation.ts` 的 `factLine()` 固定输出「整墙总热阻 R₀=」，`REFERENCE_LOOKUP_ANSWER_SYSTEM_PROMPT` 的示例也写「整墙总热阻」。

- 触发条件：任何非外墙构造（屋面、装饰板）的参考查询。屋面 K/R 被称成「整墙」，属于工程事实错误。
- 已确认前端不存在同样问题：App 列头走 `thermalColumnHeader()`，优先使用源表头 `sourceColumns`，缺列才回退通用标签。

**不改变的部分**：VICP-CALC-1 的公式、系数、取整、判定全部未改；历史 `resultJson`、Snapshot、PDF 未重算、未回写。

## 2. 涉及的文件、函数与调用关系

```text
calculateThermal (thermal-calculator.ts)
  → CalcOutcome.productResistanceScope（新增，纯元数据）
  → executeThermalCalc (thermal-calc.service.ts) resultJson 冻结 scope
  → thermal-calculate.tool.execute
       ├─ resolveThermalToolReferenceScope(decision, message)   ← 结构化优先
       ├─ thermalToolWantsCompliance(decision, message)         ← 结构化优先
       ├─ calculationFacts.productThermalResistanceScope
       └─ normalizeThermalForModel({ productResistance, productResistanceScope })
  → buildAllowedAnswerFacts / renderAllowedFactsForModel
       ├─ CalculationFacts.productThermalResistanceScope → 口径声明行
       └─ factLine() → 「整构造总热阻 R₀」
```

| 文件 | 改动 |
|---|---|
| `src/modules/thermal/thermal-calculator.ts` | `CalcOutcome.productResistanceScope`；无效返回 `null`；成功返回按 `mode` 标记 `PRODUCT_EQUIVALENT_TOTAL` / `PRODUCT_LAYER_ROWS_ONLY` |
| `src/modules/thermal/thermal-calc.service.ts` | `resultJson` 增加 `productResistanceScope`（新记录才有，旧记录按缺失处理） |
| `src/modules/ai/tools/thermal-calculate.tool.ts` | 新增 `resolveThermalToolReferenceScope` / `thermalToolWantsCompliance`；`calculationFacts` 与 `calculation` 携带口径；`normalizeThermalForModel` 传入口径 |
| `src/modules/ai/tools/tool-result-normalizer.ts` | `NormalizedThermal` 增加 `productResistance` / `productResistanceScope`；口径写入 `instruction` |
| `src/modules/ai/thermal-answer-validation.ts` | `CalculationFacts.productThermalResistanceScope`；事实清单输出口径声明；`factLine` 改「整构造总热阻 R₀」；回答 prompt 示例同改并禁止一律说「整墙」 |
| `src/modules/ai/ai-domain-semantic.ts` | 新增 `complianceCheck: { required, evidence } \| null` |
| `src/modules/ai/ai-domain-policy.ts` | `complianceCheck.evidence` 必须连续可核验，否则 `EVIDENCE_INVALID` |
| `src/modules/ai/ai-domain-turn-decision.service.ts` | 新增 complianceCheck 的语义合同说明 |
| `src/modules/ai/domain-semantic.fixture.ts` | fixture 补 `complianceCheck: null` |

## 3. 修改内容与理由

1. **口径做成元数据，不做公式改动**：`productResistanceScope` 只描述「这个数是怎么来的」，不参与任何运算，不改变 4.8、4.15、K 或判定。这样既不触犯「不得就地改 VICP-CALC-1」，又能让下游停止误标。无效计算返回 `null`，不产生可被误读的默认值。
2. **口径从产生点一路带到回答层**：Calculator → 落库快照 → Tool facts → 模型事实清单，四层都带同一个 tag。回答层据此输出「只累加产品层行，不得表述为产品整体热阻」，把「模型自觉」换成「事实合同约束」。
3. **Tool 只消费 Semantic，不重新判断**：作用域与合规目标都改为「有 Semantic 就用 Semantic」，仅在完全没有 Semantic（快速路径/模型不可用）时保留原封闭词表兜底。这样既不新增意图识别，也不会在语义缺失时丢掉原有能力。
4. **合规目标进入语义合同**：`complianceCheck` 让模型显式表达「本轮要不要达标判定」，并强制原话证据。它明确不授权标准与结论——标准、适用范围、限值仍由 `resolveScopedThermalStandard` 与既有规则核验。
5. **标签按实际构造表述**：`整墙` → `整构造`，屋面与装饰板不再被误称。只在事实清单与回答指引里改，不改 Clarify 文案（见第 7 节）。

## 4. 字符串/正则与兜底

| 位置 | 形式 | 为什么保留 / 边界 | 反例测试 |
|---|---|---|---|
| `resolveThermalToolReferenceScope` | `/已选\|选中的\|保留的/` | 仅在 `decision.semantic` 缺失时使用；有 Semantic 时永不执行 | 「选中的方案」+ Semantic=LATEST_VISIBLE → 仍 LATEST_VISIBLE |
| `thermalToolWantsCompliance` | `/达标\|合规\|符合.*标准/` | 同上；有 `complianceCheck` 时永不执行 | `required=false` + 原话「是否达标」→ 不核验 |
| `validateProductAnswer`（阶段 2） | 数值抽取 | 只校验已生成回答，不参与路由 | — |

没有新增任何自然语言意图识别；没有为「已选/达标」补充新的关键词分支；新增的都是**封闭语义字段**（`productResistanceScope`、`complianceCheck`）。

## 5. 测试结果

**定向（本轮实跑）**

`vitest run` 9 个文件：**165 passed / 1 expected fail（166）**

| 文件 | 用例 | 覆盖 |
|---|---:|---|
| `thermal-metric-scope.test.ts`（新） | 7 | LAYERED/EQUIVALENT 口径标记；无效计算无口径；数值不变（R₀=4.15、K=0.241）；LAYERED 禁止称产品整体；EQUIVALENT 才允许；「整墙」不再出现 |
| `thermal-tool-boundary.test.ts`（新） | 9 | Semantic 优先（正/反）；无 Semantic 时封闭词表兜底；`complianceCheck` 正/反/无语义三态；证据不连续 → `EVIDENCE_INVALID`；口径进入模型合同 |
| `thermal-answer-validation` / `thermal-answer-semantics` | 39 + 33 | 事实渲染与答案校验未回归 |
| `tool-result-normalizer` | 11 | DTO 形状与指令 |
| `thermal-calculator` / `.boundary` / `thermal-calc.service` / `thermal-regression` | 19 + 24 + 15 + 9(含 1 expected fail) | 公式与落库路径未变；分层案例 4.8/5.0 差异仍为 expected fail（未修复，符合本阶段要求） |

**全量（本轮实跑，证据 `docs/ai/evidence/xiaoge-business-chain-phase3-2026-10-17/tests-full.json`）**

`vitest run`：**2633 passed / 1 failed / 1 expected fail / 1 skipped**（228 文件）。

- 唯一失败仍是 `tests/report-runtime.test.ts`（`spawnSync` 返回 `status=null` + 临时目录 `EBUSY`）。阶段 2 已单独复现，本轮未触及该测试与部署脚本，**继续保留失败记录，未修改**。
- `1 expected fail` 是 E1 的 4.8 / 5.0 口径差，本阶段按要求只做标记与隔离。

**未执行**

- 未跑真实模型与 HTTP/SSE：`complianceCheck` 的真实模型输出稳定性、口径声明的实际措辞需阶段 4 验证。
- 未在隔离库执行正式计算、未生成 Snapshot/PDF、未核对报告中的口径显示。
- 未跑 lint（`pnpm semantic:check`）、build、db:check；未部署、未迁移、未 seed。
- 未改前端，未做三端页面验收。

## 6. 对知识库、热工计算、权限、Snapshot 与报告的影响

| 范围 | 影响 |
|---|---|
| 热工计算 | **公式、系数、取整、判定、`formulaVersion=VICP-CALC-1` 全部未改**；只在结果里多一个描述性字段。历史记录不重算、不回填，旧记录读不到该字段时按缺失处理 |
| 知识库 | 未触及；参考查询事实标签由「整墙」改为「整构造」，属措辞修正 |
| 权限 | 未改。`complianceCheck` 不产生授权；正式计算仍需 `THERMAL_CALCULATE` + 直接肯定请求；引用作用域仍由 `resolveCandidateReference` 校验 |
| 候选/方案 | 未改 |
| Snapshot / 报告 | 未生成、未改写；新计算记录多一个元数据字段，不影响既有快照与 PDF 读取 |
| Tool 行为 | 两处从「关键词决定」改为「Semantic 决定」；Semantic 缺失时行为与改动前一致 |

## 7. 未解决事项与下一阶段建议

### 7.1 计算口径升级（VICP-CALC-2）设计方案（本轮未实施）

**差异定义**：甲方分层案例中，芯材热阻 R=4.8，完整复合产品热阻 R=5.0，差额来自包覆浆料两个子层（0.1 + 0.1）。当前 LAYERED 只累加 `PRODUCT_LAYER` 行，因此输出的是芯材/产品层热阻。

**方案 A：数据分层修正（不改公式）**
- 把包覆子层登记为 `PRODUCT_LAYER` 并补齐 λ/α。
- 优点：零公式风险；缺点：属于资料治理，历史构造需逐条复核，且会同时改变 `totalResistance`/K（同一构造下与既有审核值可能不一致），需要甲方确认。

**方案 B：新公式版本 VICP-CALC-2（推荐）**
- 新增产品子层类型：`PRODUCT_CORE_LAYER` / `PRODUCT_SKIN_LAYER`（复用现有 `layerType` 枚举扩展）。
- `productResistance = Σ 全部产品子层`；同时单独输出 `coreResistance = Σ PRODUCT_CORE_LAYER`。
- 两个值都带口径标签：`PRODUCT_TOTAL` / `PRODUCT_CORE_ONLY`。
- 以**新增规则行**（`formulaVersion=VICP-CALC-2`）发布，`VICP-CALC-1` 保持可读、可重放、不可修改。

**迁移与兼容**
1. 历史 `resultJson` 保留原 `formulaVersion` 与原始数值；不重算、不回填。
2. 新计算默认走新规则；切换前用只读重放对同一批已确认构造跑双版本，输出差异清单（R、R₀、K、判定）交甲方确认。
3. Snapshot 与 PDF 只读冻结的 `formulaVersion` 与口径字段，不重新计算。
4. 回滚＝把默认规则指回 `VICP-CALC-1`，历史数据不动。

**验收标准**：分层案例得到芯材 4.8 / 产品整体 5.0；`totalResistance` 与 K 与现有审核值一致；历史记录重放逐位不变；报告与前端按口径显示不同标签。

### 7.2 其余未解决

1. **前端 DTO 未携带口径**：`candidateResultDto` 只透传 `productThermalResistance`。现有页面列头取源表头，不会误标；但「计算候选」这类无源表头的卡片若要展示口径，需要增量字段（不改现有字段语义），本轮按「不重构页面」暂不做。
2. **Clarify 文案仍用「整墙总热阻 R₀」**（`thermal-answer-facts.ts:36`、`thermal-answer-validation.ts:177-178`）。这是向用户提问时的指标俗称，不是已核验事实；改动会牵动多处对话文案与测试，建议与产品文案一起评审，不在本阶段顺手改。
3. **阶段 1 遗留**：`solution-candidate-query.service.ts` 仍在 Service 层拼用户可见文案（`formalAnswer` / `readOnlyAnswer` / `[[KP:...]]` 标记），`reference-query.service.ts` 覆盖 `canonicalAnswers[0]`。功能与测试成立，但违反「Service 只给事实」。建议单独立项迁移，本轮未动。
4. **阶段 1 结论文档仍缺失**（AGENTS.md 已引用）。
5. **`THERMAL_METRIC_LABELS.TOTAL_R = "总热阻 R₀"`** 全局标签未改：源表列可能是「R」也可能是「R₀」，全局改名会波及筛选、诊断与前端，需要与源表头读取策略统一后再动。

**阶段 3 到此停止，等待确认后再进入阶段 4（自动化与真实对话回归）。**
