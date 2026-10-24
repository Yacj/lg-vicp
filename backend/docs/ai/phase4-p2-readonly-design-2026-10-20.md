# 阶段 4 · P2 只读设计：正式图集候选的身份、绑定与发布

- 状态：**设计稿，未执行任何 DDL/DML**
- 依据：`docs/ai/phase4-data-relationship-2026-10-20.md`、`docs/ai/evidence/phase4-2026-10-20/reference-source-audit.json`
- 约束：不自动给两条 Excel 示例绑定图集页；不覆盖 λ/R/R₀/K/厚度/公式版本；不批量发布 890 档

---

## 1. Excel 计算示例与图集正式参考构造的身份分离

### 1.1 现状事实

| 对象 | 值 | 含义 |
| --- | --- | --- |
| 参考集 | `VICP-SHEET-1` v1《VICP热工计算表格公式示例》 | 描述字段已注明 `CALC_EXAMPLE` |
| 构造 | `VICP-OVERALL`（整体法）、`VICP-LAYERED`（分层法） | 甲方 Excel 两种算法演示 |
| 原页绑定 | `source_document_id/page_id/label = NULL`，`atlas_document_id = NULL` | 与图集无来源关系 |
| 证据 | `evidence_source=VICP热工计算表格公式`，`evidence_ref=Sheet1`，`level=A` | 来源真实、可核验 |

结论：**身份分离在数据语义上已经正确，缺的是"机器可判定的类型字段"和"查询准入"。** 现在任何按 K/R 查询都会把这两条示例行当成图集正式候选返回，这才是问题。

### 1.2 方案（建议）

1. 新增参考集用途枚举列：`thermal_reference_sets.purpose` ∈ `CALC_EXAMPLE | ATLAS_REFERENCE`，默认 `CALC_EXAMPLE`（保守默认，避免历史数据被误升格）。
2. 回填规则（一次性，人工确认后执行）：`code = 'VICP-SHEET-1'` → `CALC_EXAMPLE`；其余有 `atlas_document_id` 或全部行有 `source_page_id` 的集 → `ATLAS_REFERENCE`；两者都不满足 → 保持 `CALC_EXAMPLE` 并标记 `PENDING_REVIEW`。
3. 查询准入（代码）：
   - 产品/方案/合规候选路径只读 `purpose = ATLAS_REFERENCE` 且行有 `source_page_id`；
   - `CALC_EXAMPLE` 只用于 `thermal_calc_rules` 的公式回归与"公式示例"说明，不得进入 Candidate/Confirm/Final；
   - 若用户明确问"公式示例"，答案必须标注"计算示例，非图集档位，不能作为选型依据"。
4. 反向保护：不允许把 `CALC_EXAMPLE` 行通过"补来源"升级为 `ATLAS_REFERENCE`；升级必须新建 ATLAS 集并重新录入，保留审计链。

### 1.3 影响范围

- `thermal-candidate.service.ts` / `thermal-read.service.ts` / `compare-solution.service.ts` / `reference-candidate-source.service.ts`
- 报表与文档渲染：`solution-document-model.ts` 已对 `VICP-SHEET-1` 做特殊判断，需要在 purpose 落地后改为按字段判断
- B 端热工参考集管理页（list/detail/发布）

### 1.4 只读核验

```sql
-- 分离后应为：CALC_EXAMPLE 2 行、ATLAS_REFERENCE 0 行（迁移前）
SELECT s.code, s.purpose, count(r.id) rows, count(r.source_page_id) page_bound
FROM thermal_reference_sets s LEFT JOIN thermal_reference_rows r ON r.set_id = s.id
GROUP BY 1,2 ORDER BY 1;
```

### 1.5 回滚

- 代码回滚：查询准入开关 `REFERENCE_PURPOSE_GATE`（默认 off）→ 立即恢复旧行为；
- 数据回滚：`purpose` 列保留但不再参与判断；不清空、不改历史行。

---

## 2. 890 档的稳定身份、来源绑定、去重与版本

### 2.1 现状

- 890 档全部有厚度；794 档 R/R₀/K 齐全；**0 档有 `productSpecId`**
- `optionId` 是渲染派生：`shared/knowledge-page-render.ts:79` 用 `${constructionId}-o${index}`（**位置序号**）
- `constructionId` 本身也含 `kp-${revision}-${index}`
- 156 个构造中 38 个无编码；`A1-1` / `外墙A1-1` 并存；97 档页码标签 `51` 对应两个物理页

### 2.2 身份方案（不依赖序号、不依赖可能重复的编码）

```
optionKey = sha256(
  pageId | versionId |
  constructionKey(编码归一化 + 基层 + 基层厚度 + 屋面形态 + 部位 + 构造名兜底) |
  thicknessMm | productThermalResistance | totalThermalResistance | kValue | sourceRowLabel
)
```

- 已实现于 `src/modules/ai/knowledge-option-identity.ts`（`constructionKey` + `optionFingerprint`），本阶段只读比较已在用；
- 建议将其**物化**为 `knowledge_page_options` 表，`optionId = uuidv5(namespace, optionKey)`，使 C 端、AI、报告引用同一稳定 ID；
- 物化表只做投影，**不改确认快照**；快照仍是唯一事实源。

表结构建议（新增，不修改现有表）：

| 列 | 说明 |
| --- | --- |
| `id` (uuid, PK) | `uuidv5(optionKey)` |
| `page_id` / `version_id` / `document_id` | 来源身份 |
| `construction_key` | 内容键（含基层/厚度/屋面/部位） |
| `option_fingerprint` | 数值指纹 |
| `thickness_mm` / `product_thermal_resistance` / `total_thermal_resistance` / `k_value` | 事实投影 |
| `source_row_label` | 原表行标签 |
| `revision` | 快照指纹（v2 快照有值） |
| `qualification` | `READ_ONLY` / `CANDIDATE_ELIGIBLE` / `CONFLICT` |
| `state` | `ACTIVE` / `DEPRECATED` |
| 唯一键 | `(page_id, construction_key, option_fingerprint)` |

### 2.3 去重与歧义

- 唯一键冲突且数值一致 → 合并为一条（重复渲染行）；
- 唯一键相同但数值不同 → `CONFLICT`，**不自动挑选**，进入人工裁定队列；
- 构造键相同（同编码同基层同厚度）但快照中确有多条 → 比较入口已返回 `AMBIGUOUS`，物化后保持同样行为。

### 2.4 版本

- 物化行绑定 `version_id + revision`；新版本发布后重新派生，旧行 `state=DEPRECATED`，不删除；
- 引用历史结论时必须带 `version_id + revision`，否则不认为可核验（现阶段 76/79 页无 revision，见 §3.3）。

---

## 3. 794 档完整参数与正式候选资格的缺项

### 3.1 数量关系

| 项目 | 数量 |
| --- | ---: |
| 已发布可读档位 | 890 |
| 四项数值齐全（厚度+R+R₀+K） | 794 |
| 有目录规格绑定 | 0 |
| 有正式构造方案绑定（图集） | 0（2 条为 Excel 示例） |
| 有快照指纹（schemaVersion=2） | 0（仅 3 页 DRAFT 有，78/79 页无） |

### 3.2 资格分级（建议）

| 等级 | 条件 | 允许能力 |
| --- | --- | --- |
| L0 只读 | 页已确认+已发布+有权访问+有厚度 | 展示、追溯、只读比较 |
| L1 数值完整 | L0 + R/R₀/K 齐全 | 只读比较可核验三项口径 |
| L2 身份稳定 | L1 + 物化 optionId | 跨端引用同一档位 |
| L3 候选可确认 | L2 + ATLAS 参考集 + 构造方案 + 目录规格 + 原页绑定 | Candidate / Confirm / Final / PDF |
| L4 合规结论 | L3 + 正式地区标准快照 | 合规判断（当前 0 条） |

现状：L0 890、L1 794、L2 0（未物化）、L3 0、L4 0。

### 3.3 缺项清单

1. **规格绑定**：`product_specs` 仅 1 条 25mm；目录只登记 1 款。
2. **构造方案**：`construction_schemes` 仅 2 条 Excel 示例。
3. **快照指纹**：v1 快照无 `schemaVersion`，`confirmedRevision` 不存在 → 无法判断"引用是否过期"。
4. **页码唯一性**：标签 `51` 重复、`31` 缺失；`page_label_verified=true` 不可作证据。
5. **构造编码**：38 个系统无编码；`外墙` 前缀不统一。

---

## 4. 35mm 示例错绑 `VICP-BOARD-25` 的根因与安全修正

### 4.1 根因（代码级）

`src/db/thermal-default-data.ts`：

- 第 73-88 行：只创建 **一个**规格 `VICP-BOARD-25`（`thicknessMm: 25`）；
- 第 214-235 行：两条参考行（25mm / 35mm）**都使用同一个 `spec!.id`**；
- 唯一索引是 `(schemeId, productSpecId, thicknessMm)`，两条行 `schemeId` 不同（OVERALL / LAYERED），因此**数据库不会报冲突**，错误被静默接受。

即：不是导入时被覆盖，而是**种子数据本身就少建了一个 35mm 规格**。

### 4.2 安全修正方案（需批准后执行）

1. 新建规格 `VICP-BOARD-35`（`thicknessMm=35`，`specClass=null`，`seriesId` 同 `VICP-BOARD`）；
2. `UPDATE thermal_reference_rows SET product_spec_id = <新规格> WHERE id='da25c17b-…'`；
3. 增加**服务层校验**：写入/发布参考行时断言 `row.thickness_mm = spec.thickness_mm`，否则拒绝（不新增 DB 约束，避免跨表 CHECK）；
4. 回归：`generate-thermal-template`、`thermal-read`、报告渲染各一条断言。

### 4.3 回滚

- 单行 `UPDATE` 可逆（记录原值）；
- 新规格删除前先确认无引用（`product_specs` 无外键引用即安全）；
- 校验逻辑加开关 `REFERENCE_SPEC_THICKNESS_CHECK`（默认 on，异常时可关闭，但报告会记录）。

---

## 5. 正式图集候选的审核、发布、失效与重新验证

### 5.1 状态机（建议）

```
DRAFT → REVIEWED(资料负责人) → PUBLISHED → DEPRECATED / EXPIRED
              ↓                      ↓
          REJECTED               REVALIDATION_FAILED（下架，不进候选）
```

### 5.2 审核门禁

- 必须有：页 + 版本 + 印刷页码（唯一）+ 完整数值 + 构造方案 + 目录规格；
- 页码必须来自"原图核对"记录，不能用 `page_label_verified` 自证；
- 数值必须与快照逐项一致（容差 5e-5，与现有 `sourceAssociations` 一致）。

### 5.3 失效与重新验证

- 每日任务（只读比对后写状态）：
  1. 快照 `revision` 是否变化；
  2. 页/版本是否仍 `PUBLISHED + AI_ENABLED + 当前版本`；
  3. 印刷页码是否仍唯一；
  4. 规格/构造是否仍 `PUBLISHED`。
- 任一不满足 → `REVALIDATION_FAILED`，候选立即不可 Confirm（已有 `referenceRowsStillCurrent` 入口，可复用）；
- 恢复需重新审核，不允许自动恢复。

---

## 6. 迁移设计（分步、可回滚、默认不启用）

| 步骤 | 类型 | 内容 | 风险 | 回滚 |
| --- | --- | --- | --- | --- |
| M1 | DML | 新建 `VICP-BOARD-35`；修正 35mm 行 `product_spec_id` | 低（2 行） | 记录原值，单条 UPDATE 还原 |
| M2 | DDL | `thermal_reference_sets.purpose` 加列 + 回填 | 低（加列默认值） | `DROP COLUMN`（无代码引用时可） |
| M3 | DDL | 新建 `knowledge_page_options`（物化身份） | 中（数据量 890） | `DROP TABLE`，快照不受影响 |
| M4 | 代码 | 查询准入按 `purpose` 过滤 + 级别门禁 | 中（改变候选集合） | 开关 `REFERENCE_PURPOSE_GATE` |
| M5 | 流程 | 审核/发布/失效任务 | 中（运营） | 任务停用即回退 |

**执行顺序**：M1 → 只读核验 → M2 → 只读核验 → M3 dry-run（只统计不写）→ M4 开关灰度 → M5。

---

## 7. 只读核验清单（每个迁移步骤后都跑）

1. `scripts/audit-reference-source-binding.mjs`：行来源、缺项、冲突、页码重复；
2. 890 档分级统计（L0/L1/L2/L3/L4 数量）；
3. 35mm 行规格厚度一致性；
4. 候选查询回归：K/R/厚度三类问题，确认 `CALC_EXAMPLE` 不再出现在候选；
5. 只读比较接口回归：同一页两档 → `comparisonOnly=true`、`confirmable=false`。

---

## 8. 影响范围

- 读取：`thermal-candidate.service.ts`、`thermal-read.service.ts`、`compare-solution.service.ts`、`reference-candidate-source.service.ts`、`ai-reference-pages.service.ts`
- 写入：`knowledge-admin.service.ts`、`knowledge-workflow.service.ts`、`thermal-default-data.ts`
- 渲染/报告：`solution-document-model.ts`、`solution-document-render.ts`
- C 端：只读比较接口（已加）与参考页渲染；无契约破坏（新增字段可选）

## 9. 明确不做

- 不把两条 Excel 示例升级为图集候选；
- 不批量创建 794 个规格、不批量发布 890 档；
- 不修改 λ/R/R₀/K/厚度/`VICP-CALC-1` 公式版本；
- 不改写历史确认快照与页码。

**以上为设计，等待批准后才进入实现。**
