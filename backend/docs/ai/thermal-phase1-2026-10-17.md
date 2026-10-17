# 阶段 1：甲方 Excel 回归与 P0 算法语义

- 日期：2026-10-17
- 前置：`docs/ai/thermal-audit-phase0-2026-10-17.md`（阶段 0 只读审计）
- 范围：仅 `backend/src/modules/thermal` + `backend/fixtures/thermal-regression`
- 未触及：已发布规则口径、历史快照、`thermal_calc_records`、数据库迁移、前端、部署

---

## 1. 本阶段结论

| 项                                                | 处理           | 说明                                                 |
| ------------------------------------------------ | ------------ | -------------------------------------------------- |
| Excel 左右两例落成 Golden fixture                      | ✅ 完成         | 断言 ΣR / R₀ / K / 判定，且**单独**断言产品整体 R                |
| 右例 `productResistance=5.0` 与芯材 4.8 的区别           | ✅ 完成         | 两条独立用例：芯材 4.8（当前事实）+ 产品整体 5.0（目标，expected-to-fail） |
| 「包覆浆料记为 FIXING_LAYER」归属是否错误                      | ✅ 已判定为**错误** | 见第 3 节；已提出 3 个可审查设计，**未实施**                        |
| EQUIVALENT 覆写前层结果                                | ✅ 已修复        | `=` → `+=`；单产品层结果完全不变                              |
| Service 多 PRODUCT_LAYER 写全厚度                     | ✅ 已改为显式拒绝    | `CALC_PRODUCT_LAYER_INVALID`，不落库                   |
| 单位 / λ / α / 表面热阻 / include* / 缺 α / 取整 / 合规阈值边界 | ✅ 完成         | 新增 24 个边界用例                                        |
| 修改已发布计算口径                                        | ❌ 未做         | 产品整体 R 语义变更需甲方确认 + `VICP-CALC-2` 版本治理              |

---

## 2. 会失败的 Golden tests（先失败，再固定为 expected-to-fail）

### 2.1 新增 fixture

| 文件                                                    | 内容                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `fixtures/thermal-regression/vicp-sheet-overall.json` | Excel 左例：EQUIVALENT，产品 25mm，ΣR=4.156822097834988，R₀=4.3068220978349885，K=0.23218976249394965，产品 R=4.0                    |
| `fixtures/thermal-regression/vicp-sheet-layered.json` | Excel 右例：LAYERED，产品组 35mm（10+15+10），ΣR=5.156822097834988，R₀=5.3068220978349885，K=0.18843669178357564，产品整体 R=5.0，芯材 R=4.8 |

两个 fixture 都带 `expected.sumResistance`，回归时用 `totalResistance - Ri - Re` 与 12 位精度核对 ΣR，**不靠 K 反推**。

### 2.2 失败证据（修复前）

```
vicp-sheet-layered.json：产品整体热阻（Excel 原值）
  expected 5   received 4.8
```

原因：`calculateThermal` 的 LAYERED 分支只累加 `layerType === "PRODUCT_LAYER"`，  
两层「包覆浆料」是 `FIXING_LAYER`，因此 `productResistance` 只有真空芯材的 4.8。

### 2.3 不把已知缺陷静默放过

`thermal-regression.test.ts` 增加了 `knownGap` 机制：

- fixture 带 `knownGap` → 该 fixture 的「产品整体热阻」断言以 `it.fails` 运行；
- 断言**必须失败**，测试才算通过（vitest 显示 `1 expected fail`）；
- 一旦有人把语义改对，这条用例会变成「意外通过」而报错，强制移除 `knownGap`。

这样做的目的：缺口被显式记账，不会被后续「测试全绿」误判为已修复。

### 2.4 芯材与产品整体必须分开断言

`vicp-sheet-layered.json` 额外给出 `expected.coreResistance: 4.8`，并有独立用例：

```ts
it(`${file}：芯材自身热阻与产品整体热阻是两个事实`, () => {
  expect(outcome.productResistance).toBeCloseTo(4.8, 12);   // 当前事实
  expect(fixture.expected.productResistanceRounded).not.toBe(4.8); // 目标 5.0
});
```

即：**4.8 与 5.0 同时被固定住**，任何一方被改写都会失败。

---

## 3. 「包覆浆料记为 FIXING_LAYER」的判定

### 3.1 判定：归属错误（需甲方确认后修正）

证据链：

1. 甲方 Excel 右例把 `包覆浆料 10 / 真空绝热板 15 / 包覆浆料 10` 写在 **同一个「VICP复合保温板」条目下**，并把三者热阻之和 5.0 作为**产品 R**（O11 行合计前的产品段）。
2. 种子数据 `src/db/thermal-default-data.ts:167-177` 把两层包覆写成 `FIXING_LAYER`，只有真空板是 `PRODUCT_LAYER`。
3. 因此 `includeNonProductLayers=false` 时包覆层被整体丢弃，产品 R 与总 R 各少 0.2；  
   `includeNonProductLayers=true`（当前默认）时总 R 恰好正确，掩盖了产品 R 的错误。
4. 参考行 `productThermalResistance = 5`（`thermal-default-data.ts:234`）与计算得到的 4.8 **不一致**——  
   同一发布数据在 `REFERENCE_TABLE` 与 `LAYERED` 两条路径上给出不同产品 R。

### 3.2 影响量化

| 场景                       | 产品 R | 偏差                |
| ------------------------ | ---- | ----------------- |
| Excel 分层例（期望）            | 5.0  | —                 |
| 当前实现（include 非产品层=true）  | 4.8  | −4.0%             |
| 当前实现（include 非产品层=false） | 4.8  | −4.0%，且总 R 再少 0.2 |

### 3.3 三个可审查设计（**均未实施**）

#### 方案 A：新增层类型 `PRODUCT_SUBLAYER`

- 迁移：`construction_layer_type` 枚举加值；部分唯一索引改为「每个 product_group 一个主产品层」。
- 优点：语义最清晰，B 端构造编辑器可直接区分「产品子层」与「施工固定层」。
- 代价：枚举迁移 + 识别审核 / 导入 / 报告 / 前端全部要认新值；影响面最大。

#### 方案 B：`construction_layers.product_group_id`（推荐）

- 迁移：新增 nullable 列（uuid 或短字符串），不新增枚举、不改唯一索引。
- 计算：产品整体 R = Σ(同 group 的层热阻)；group 为 null 时退回「只算 PRODUCT_LAYER」的旧行为。
- 优点：向后兼容（旧行 group 为 null，结果不变）；不触碰枚举与唯一索引；导入与识别可按「产品组」标注。
- 代价：B 端构造设置要新增「属于产品组」勾选；`includeNonProductLayers` 的语义需重新定义  
  （建议：产品组内层不受该开关影响）。

#### 方案 C：`construction_layers.part_of_product`（boolean）

- 迁移：新增 nullable boolean。
- 计算：产品整体 R = Σ(PRODUCT_LAYER) + Σ(part_of_product=true)。
- 优点：改动最小。
- 代价：无法表达「两个不同产品组」，且与 `FIXING_LAYER` 语义重叠，后续仍要升级到 B。

**建议**：采用方案 B。但无论哪个方案，`productResistance` 的定义都会从  
「PRODUCT_LAYER 之和」变成「产品组之和」——这是**计算口径变更**，必须：

1. 派生新 `formulaVersion = "VICP-CALC-2"`，`VICP-CALC-1` 保持冻结；
2. 新规则只对新计算生效，**不回填、不重算**历史 `thermal_calc_records`；
3. 已确认 Snapshot / 已生成 PDF 一律不动；
4. 修正后删除 `vicp-sheet-layered.json` 的 `knownGap`，用例自动转为强断言。

---

## 4. 代码改动（逐条）

### 4.1 `thermal-calculator.ts`：EQUIVALENT 不再覆写前层

```diff
-        productResistance = r;
+        // 当量导热系数属于整个产品规格，不区分产品内部子层：
+        // 多个 PRODUCT_LAYER 行时按厚度累加（等价于「产品总厚 / (λ_eq × a_eq)」），
+        // 不得用赋值覆写前一层，否则只保留最后一层的热阻。
+        // 单产品层时 += 与 = 结果完全相同，因此不改变任何已发布单层规则的历史结果。
+        productResistance += r;
```

**安全性论证**：当产品层数量为 1 时，`+=` 与 `=` 的累加初值为 0，结果逐位相同。  
已发布规则均只允许 1 个产品层（唯一索引 + 结构校验），因此**不改变任何可达结果**。  
已用用例固定：

```
✓ 单产品层时累加与覆写结果完全一致（不影响已发布单层规则）
✓ 两个产品层按厚度累加，等价于「产品总厚 / (λ_eq × a_eq)」
```

同时给 `CalcOutcome.productResistance` 增加字段注释，明确「修正前不等于产品整体热阻，  
对外展示不得标成产品整体 R」。

### 4.2 `thermal-calc.service.ts`：产品层唯一性显式拒绝

```ts
const productLayers = scheme.layers.filter((l) => l.layerType === "PRODUCT_LAYER");
if (input.mode !== "REFERENCE_TABLE" && productLayers.length !== 1) {
  return { valid: false, errors: [{ field: "schemeId", code: "CALC_PRODUCT_LAYER_INVALID",
    message: productLayers.length === 0 ? "…没有产品层…" : `…有 ${n} 个产品层，当前计算只支持 1 个…` }],
    notes, record: null };
}
```

- 位置在方案加载之后、产品选项校验之前，**不消耗规则/限值/材料查询**，失败即返回；
- `REFERENCE_TABLE` 不受限制（查表不读构造层），避免误伤图集查表；
- 失败不落库、不写审计（未发生计算）；
- 把原来的 `scheme.layers.find(...)` 改为复用 `productLayers[0]`，避免两处口径分叉。

### 4.3 为什么 calculator 累加、Service 却拒绝

两者职责不同：

- **calculator 是纯函数**，`+=` 让它在数学上对任意产品层数都正确（当量 λ 作用于整组厚度）；
- **Service 负责把「输入厚度」分配给构造层**，而「多个产品层时厚度怎么分」在数据模型里没有定义  
  （每个子层都拿全厚度就是错的），所以必须拒绝，不能猜。

---

## 5. 边界测试（新增 24 例）

文件：`src/modules/thermal/thermal-calculator.boundary.test.ts`

| 分组            | 覆盖点                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 单位            | 0.025m → R=4.0；同一数值按 25 传入会放大 1000 倍（固定「calculator 不猜单位」）；0.001m 极小厚度不设静默下限                                               |
| λ             | null / 0 / 负数均 `CALC_VALUE_INVALID`；EQUIVALENT 下产品层不要求 λ 但其余层仍要求                                                          |
| α             | null 按 1（既有口径）；0 与负数拒绝（不得把 0 当 1）；α=1.25 时 R=4.8                                                                          |
| 表面换热阻         | Ri=Re=0 合法且等价于不计；负数 → `CALC_RULE_INVALID`；按规则原值并入不预先取整                                                                    |
| include* 开关   | 四种组合全部断言（含「关闭非产品层不会把固定层算进产品热阻」）                                                                                           |
| 取整            | 精度 0/8 合法、-1/9 拒绝；NONE 保留原值；HALF_UP / HALF_EVEN / TRUNCATE 差异；浮点误差校正（0.09999999999999999 → 0.1）                           |
| 合规阈值          | K 恰好等于限值；**K=0.54002 取整为 0.54 时按 0.54 判定**（报审口径，显式固定）；TOTAL_RESISTANCE + GTE 上下边界；无限值 → `compliant=null` 且不产生 judgment 步骤 |
| EQUIVALENT 多层 | 累加=4.0（覆写实现会得到 2.4）；单层不变                                                                                                  |

> 「K=0.54002 取整后判定合格」这条特意写成显式断言：它是既有报审口径，  
> 不能因为「直觉上更严格」而被悄悄改成用原始值判定——那会改变所有历史结论。

---

## 6. 测试与静态检查（本阶段真实执行）

```
npx vitest run src/modules/thermal src/modules/ai/tools \
  src/modules/ai/thermal-answer-validation.test.ts \
  src/modules/ai/thermal-answer-facts.test.ts \
  src/modules/ai/reference-fact-read.service.test.ts
→ 34 files passed | 741 passed | 1 expected fail (742)

npx tsc -p tsconfig.json --noEmit            → EXIT 0
node scripts/check-semantic-matching.mjs     → 语义匹配AST检查通过（10 个文件 / 31 个白名单表达式）
```

| 文件                                        | 用例数 | 结果                     |
| ----------------------------------------- | --- | ---------------------- |
| `thermal-calculator.test.ts`              | 19  | 全通过                    |
| `thermal-calculator.boundary.test.ts`（新增） | 24  | 全通过                    |
| `thermal-regression.test.ts`（重写）          | 9   | 8 通过 + 1 expected fail |
| `thermal-calc.service.test.ts`（+4）        | 15  | 全通过                    |

---

## 7. 发布前必须补的检查（未执行）

1. **查隔离库确认没有「0 个或 >1 个 PRODUCT_LAYER」的已发布方案**。  
   新增的 `CALC_PRODUCT_LAYER_INVALID` 会把这类方案从「静默算错」变成「明确报错」——  
   这是期望行为，但若线上存在这类历史方案，用户会从「得到错值」变成「得到错误提示」，  
   需要提前知道并准备文案/数据修正。
2. 确认没有已发布规则使用 `includeNonProductLayers=false`（否则包覆层会整体消失）。
3. 未跑前端（admin-web / app）单测与 build，未跑全量后端测试（见阶段 4）。

---

## 8. 本阶段未做（等确认）

- 未修改 `productResistance` 的事实语义（4.8 → 5.0）。
- 未新增数据库列 / 枚举 / 迁移。
- 未回填、未重算任何 `thermal_calc_records` 或 Snapshot。
- 未改 `thermal-default-data.ts` 的层归属（包覆浆料仍是 `FIXING_LAYER`）。
- 未改 AI 层话术（B2/B3/B4 属阶段 2）。

---

## 9. 进入阶段 2 的前置

阶段 2 要动 AI 查表/多轮语义，必须先定一件事：  
**产品整体 R 到底是不是 5.0**。因为它决定 `PRODUCT_R` 这个指标在图集档位上代表什么：

- 若确认含包覆层：参考行 `productThermalResistance=5` 正确，计算侧要改；
- 若确认只算芯材：参考行 5 要改成 4.8，且 Excel 的「产品 R」需要重新解释。

在这条确认下来之前，`PRODUCT_R` 的匹配与话术只能沿用现有列值，不能加任何「按数值大小猜指标」的补偿逻辑。

