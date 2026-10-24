# 阶段 5 · M1 / M2 变更方案（待批准，不执行）

- 状态：**仅方案。当前不批准生产数据变更，本文件不构成执行授权。**
- 依据：`phase4-data-relationship-2026-10-20.md`、`phase5-candidate-path-design-2026-10-20.md`、`evidence/phase4-2026-10-20/reference-source-audit.json`
- 只读复核脚本：`scripts/audit-reference-source-binding.mjs`、`scripts/audit-candidate-readiness.mjs`

---

## M1：修正 35mm 示例行错绑 25mm 规格

### M1.1 现况（只读核对）

| 对象 | 值 |
| --- | --- |
| 行 | `da25c17b-dc57-4f21-948d-44c168cdb609`，厚度 **35.00mm**，R=5.0000，R₀=5.3068，K=0.1884 |
| 现绑规格 | `e994f2c0-f59d-40c8-b4ff-046186dd9f7d` / `VICP-BOARD-25`，厚度 **25.00mm** |
| 同集另一行 | `5f1c8f80-…`，25.00mm，绑同一规格（正确） |
| 唯一索引 | `(set_id, scheme_id, product_spec_id, thickness_mm)`，因 `scheme_id` 不同（OVERALL / LAYERED）故未报冲突 |

### M1.2 修正依据

1. 甲方 Excel `Sheet1` 分层法：35mm 总厚 = 15mm 芯材（R=4.8）+ 两侧包覆各 0.1 → 产品层 R=5.0；25mm 整体法 R=4.0。两行不是同一产品规格。
2. 种子代码 `src/db/thermal-default-data.ts` 只创建一个 `VICP-BOARD-25` 规格，两条行都引用 `spec!.id`，属种子缺建。
3. 该行若被计算/报告引用，会输出"35mm 板 = 25mm 规格"的矛盾事实。

### M1.3 方案 A（推荐，需甲方先确认分层产品当量参数）

> 只修"绑定错误"，不伪造 λ_eq / α。新规格不写 `product_parameters`，任何依赖参数的推算会因缺参数而失败关闭（fail closed）。

```sql
BEGIN;

-- 0) 预检：确认仍是错误绑定（0 行则终止）
SELECT r.id, r.thickness_mm, s.spec_code, s.thickness_mm AS spec_thickness
FROM thermal_reference_rows r
JOIN product_specs s ON s.id = r.product_spec_id
WHERE r.id = 'da25c17b-dc57-4f21-948d-44c168cdb609'
  AND r.product_spec_id = 'e994f2c0-f59d-40c8-b4ff-046186dd9f7d'
  AND r.thickness_mm = 35.00;

-- 1) 新建 35mm 分层规格（无参数、无型号；依据为 Excel 分层法示例）
INSERT INTO product_specs (
  series_id, catalog_product_id, spec_code, version, spec_class, thickness_mm,
  production_status, standard_type, supply_regions, status,
  evidence_source, evidence_ref, evidence_level, change_note, published_at
) VALUES (
  '3395e68f-b921-4627-bf21-5b40af6b57e0',
  '9ad81f3f-a11c-479a-9587-7e0b05ec734a',
  'VICP-BOARD-35-LAYERED', 1, NULL, 35,
  'PRODUCING', 'STANDARD', '[]'::jsonb, 'PUBLISHED',
  'VICP热工计算表格公式', 'Sheet1', 'A',
  '修正35mm分层法示例行误绑25mm规格；当量导热系数/修正系数待甲方确认后另行登记',
  now()
)
RETURNING id;   -- 记为 :new_spec_id

-- 2) 仅改这一行，并带旧值条件防误改
UPDATE thermal_reference_rows
SET product_spec_id = :new_spec_id, updated_at = now()
WHERE id = 'da25c17b-dc57-4f21-948d-44c168cdb609'
  AND product_spec_id = 'e994f2c0-f59d-40c8-b4ff-046186dd9f7d';

COMMIT;
```

**影响数据**：新增 1 行 `product_specs`；更新 1 行 `thermal_reference_rows`（`product_spec_id`、`updated_at`）。不触碰 R/R₀/K/厚度/公式版本。

**验证（只读）**：

```sql
SELECT r.thickness_mm, s.spec_code, s.thickness_mm AS spec_thickness
FROM thermal_reference_rows r JOIN product_specs s ON s.id = r.product_spec_id
ORDER BY r.sort_order;   -- 期望 25/25、35/35

SELECT count(*) FROM product_parameters WHERE spec_id = :new_spec_id;   -- 期望 0（不伪造参数）
```

**回滚**：

```sql
BEGIN;
UPDATE thermal_reference_rows
SET product_spec_id = 'e994f2c0-f59d-40c8-b4ff-046186dd9f7d', updated_at = now()
WHERE id = 'da25c17b-dc57-4f21-948d-44c168cdb609';
DELETE FROM product_specs WHERE id = :new_spec_id
  AND NOT EXISTS (SELECT 1 FROM thermal_reference_rows WHERE product_spec_id = :new_spec_id)
  AND NOT EXISTS (SELECT 1 FROM product_parameters WHERE spec_id = :new_spec_id);
COMMIT;
```

**残留风险**：新规格无参数，若有人把它用于厚度换算会拿不到 λ_eq/α。建议同时加代码校验（`row.thickness_mm = spec.thickness_mm`，不符即拒绝发布），该改动属代码，不在 M1 数据变更内。

### M1.4 方案 B（甲方不认可新建规格时）

不写库，只加代码诊断：读取时若 `row.thickness_mm ≠ spec.thickness_mm` → 标记 `SPEC_THICKNESS_MISMATCH`，该行不进入候选、不参与计算。缺点：错误绑定仍留在库里，只是被拦住。

**建议：先执行方案 A 的预检 SQL（只读），由甲方确认 35mm 分层产品的当量参数口径，再决定 A/B。**

---

## M2：给参考集增加"用途"字段（区分计算示例 / 图集正式）

### M2.1 依据

- `VICP-SHEET-1` 的 `description` 已写明 `CALC_EXAMPLE`，但只是文本，代码无法据此过滤；
- 34 处读取 `thermal_reference_rows` 的模块无法区分"示例"与"图集"，导致示例行被当候选返回；
- 需要机器可判定的字段，才能做到"示例永不进入 Candidate"。

### M2.2 变更 SQL

```sql
BEGIN;

-- 1) 加列：保守默认 CALC_EXAMPLE，历史数据不会被误升格
ALTER TABLE thermal_reference_sets
  ADD COLUMN purpose varchar(24) NOT NULL DEFAULT 'CALC_EXAMPLE';

-- 2) 约束与索引
ALTER TABLE thermal_reference_sets
  ADD CONSTRAINT thermal_reference_sets_purpose_check
  CHECK (purpose IN ('CALC_EXAMPLE', 'ATLAS_REFERENCE'));

CREATE INDEX thermal_reference_sets_purpose_status_idx
  ON thermal_reference_sets (purpose, status);

-- 3) 显式回填（当前只有 1 条集，与默认一致，仅作审计留痕）
UPDATE thermal_reference_sets
SET purpose = 'CALC_EXAMPLE', updated_at = now()
WHERE code = 'VICP-SHEET-1';

COMMIT;
```

**影响数据**：`thermal_reference_sets` 1 行新增列值（默认值），DDL 期间短锁；不改行/集的其他字段。

**验证（只读）**：

```sql
SELECT code, purpose, status, count(r.id) AS rows
FROM thermal_reference_sets s LEFT JOIN thermal_reference_rows r ON r.set_id = s.id
GROUP BY 1,2,3;
-- 期望：VICP-SHEET-1 / CALC_EXAMPLE / PUBLISHED / 2
```

**回滚**：

```sql
BEGIN;
DROP INDEX IF EXISTS thermal_reference_sets_purpose_status_idx;
ALTER TABLE thermal_reference_sets DROP CONSTRAINT IF EXISTS thermal_reference_sets_purpose_check;
ALTER TABLE thermal_reference_sets DROP COLUMN IF EXISTS purpose;
COMMIT;
```

**说明**：加列本身**不改变任何查询结果**；真正的过滤要靠后续代码开关（`REFERENCE_PURPOSE_GATE`，默认 off）。这样 M2 可以先落地、零行为变化，再灰度打开。

---

## 3. 执行前置条件（全部满足才可提交执行申请）

1. 甲方书面确认 35mm 分层产品的当量参数口径（λ_eq、α），或明确选择 M1-B；
2. 确认 M2 只加列、不启用过滤；
3. 变更窗口 + 数据库备份点（`pg_dump` 或快照）已确认；
4. 执行人、复核人、回滚决策人已指定；
5. 先跑只读预检，输出"变更前快照"存档。

## 4. 明确不在本次范围

- 不批量创建 794/890 个规格；
- 不写 `source_page_id/page_label`（来源绑定属后续 M3/M4）；
- 不改 λ、R、R₀、K、厚度、`VICP-CALC-1` 公式版本；
- 不启用任何候选过滤开关；
- 不改历史确认快照与页码。

## 5. 变更后仍需的代码跟进（不在本方案内）

1. 发布/写入时校验 `row.thickness_mm = spec.thickness_mm`；
2. 候选读取按 `purpose = 'ATLAS_REFERENCE'` 过滤（开关控制）；
3. `BINDING_MISSING_OPTION` 缺口在 B 端工作台可视化；
4. 每日失效重验任务。
