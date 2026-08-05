import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, lte, or, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DbExecutor } from "../../db/client.js";
import {
  constructionLayers,
  constructionSchemes,
  materials,
  productSpecs,
  schemeProductOptions
} from "../../db/schema.js";
import { ConstructionError } from "../../shared/construction-errors.js";

/**
 * 构造方案结构校验器（submit 与 publish 前强制调用）。
 * 职责：层序连续、基层/产品层唯一且位置正确、产品层厚度落在产品选项区间内、
 * 选项区间合法、引用（产品规格/材料）已发布且生效、生效区间合法。
 * 校验失败抛 CONSTRUCTION_STRUCTURE_INVALID（带中文 details），不改写任何数据。
 */

export interface StructureViolation {
  field: string;
  message: string;
}

function violationsError(details: StructureViolation[]): never {
  const summary = details.map((d) => d.message).join("；");
  throw new ConstructionError("CONSTRUCTION_STRUCTURE_INVALID", `构造方案结构校验未通过：${summary}`);
}

/** 引用的产品规格/材料必须为 PUBLISHED 且生效中（禁止引用草稿/已停用/失效数据） */
async function assertReferencePublished(
  db: DbExecutor,
  table: typeof productSpecs | typeof materials,
  id: string,
  label: string
): Promise<void> {
  const now = new Date();
  const [row] = await db.select({ id: table.id, status: table.status, effectiveAt: table.effectiveAt, expiresAt: table.expiresAt })
    .from(table).where(eq(table.id, id)).limit(1);
  if (!row) {
    throw new ConstructionError("CONSTRUCTION_REFERENCE_NOT_PUBLISHED", `${label}不存在或已删除`);
  }
  const effective = (row.effectiveAt === null || row.effectiveAt <= now) && (row.expiresAt === null || row.expiresAt >= now);
  if (row.status !== "PUBLISHED" || !effective) {
    throw new ConstructionError("CONSTRUCTION_REFERENCE_NOT_PUBLISHED", `${label}未发布或已失效，不能引用`);
  }
}

/**
 * 校验单个方案的结构。scheme 为已加载的方案行（调用方负责查行与状态守卫）。
 * 返回 violations 数组（测试可直接断言；路由层统一包装抛错）。
 */
export async function collectSchemeStructureViolations(
  app: FastifyInstance,
  schemeId: string
): Promise<StructureViolation[]> {
  const violations: StructureViolation[] = [];

  const layers = await app.db.select().from(constructionLayers)
    .where(eq(constructionLayers.schemeId, schemeId))
    .orderBy(asc(constructionLayers.layerOrder));

  // 1. layerOrder 从 1 连续递增（外到内）
  const orders = layers.map((l) => l.layerOrder);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      violations.push({ field: "layers.layerOrder", message: `构造层序号不连续：应为 ${i + 1}，实际为 ${orders[i]}` });
      break;
    }
  }

  // 2. 基层层唯一且为最内层（order 最大）；产品层唯一
  const baseLayers = layers.filter((l) => l.layerType === "BASE_LAYER");
  const productLayers = layers.filter((l) => l.layerType === "PRODUCT_LAYER");
  if (baseLayers.length !== 1) {
    violations.push({ field: "layers.baseLayer", message: `基层层必须且只能有 1 个，当前 ${baseLayers.length} 个` });
  } else if (layers.length > 0 && baseLayers[0]!.layerOrder !== layers[layers.length - 1]!.layerOrder) {
    violations.push({ field: "layers.baseLayer", message: "基层层必须是构造的最内层（序号最大）" });
  }
  if (productLayers.length !== 1) {
    violations.push({ field: "layers.productLayer", message: `产品层必须且只能有 1 个，当前 ${productLayers.length} 个` });
  }

  // 3. 产品层厚度必填且 > 0，且落在产品选项允许区间内
  const options = await app.db.select().from(schemeProductOptions).where(eq(schemeProductOptions.schemeId, schemeId));
  const productLayer = productLayers[0];
  if (productLayer) {
    if (productLayer.thickness === null || productLayer.thickness <= 0) {
      violations.push({ field: "layers.thickness", message: "产品层厚度必填且必须大于 0" });
    } else if (options.length === 0) {
      violations.push({ field: "productOptions", message: "方案未配置任何产品选项，无法校验产品层厚度范围" });
    } else {
      const matched = options.find(
        (o) => productLayer.thickness! >= o.minThickness && productLayer.thickness! <= o.maxThickness
      );
      if (!matched) {
        violations.push({
          field: "layers.thickness",
          message: `产品层厚度 ${productLayer.thickness}mm 不在任何产品选项的允许区间内`
        });
      }
    }
  }

  // 4. 选项区间合法：min <= max，default 若填写必须落在 [min, max]
  for (const option of options) {
    if (option.minThickness > option.maxThickness) {
      violations.push({
        field: "productOptions",
        message: `产品选项 ${option.productSpecId} 的最小厚度（${option.minThickness}）大于最大厚度（${option.maxThickness}）`
      });
    }
    if (option.defaultThickness !== null &&
        (option.defaultThickness < option.minThickness || option.defaultThickness > option.maxThickness)) {
      violations.push({
        field: "productOptions.defaultThickness",
        message: `产品选项 ${option.productSpecId} 的默认厚度（${option.defaultThickness}）不在允许区间 [${option.minThickness}, ${option.maxThickness}] 内`
      });
    }
  }

  // 5. 引用的产品规格/材料必须已发布且生效
  for (const option of options) {
    await assertReferencePublished(app.db, productSpecs, option.productSpecId, "产品规格");
  }
  for (const layer of layers) {
    if (layer.materialId) {
      await assertReferencePublished(app.db, materials, layer.materialId, "材料");
    }
  }

  // 6. 生效区间合法（两者均填时）
  const [scheme] = await app.db.select({ effectiveAt: constructionSchemes.effectiveAt, expiresAt: constructionSchemes.expiresAt })
    .from(constructionSchemes).where(eq(constructionSchemes.id, schemeId)).limit(1);
  if (scheme?.effectiveAt && scheme?.expiresAt && scheme.effectiveAt > scheme.expiresAt) {
    violations.push({ field: "effectiveAt/expiresAt", message: "生效时间晚于失效时间" });
  }

  return violations;
}

/** submit/publish 前置校验：不通过直接抛 CONSTRUCTION_STRUCTURE_INVALID */
export async function validateSchemeStructure(app: FastifyInstance, schemeId: string): Promise<void> {
  const violations = await collectSchemeStructureViolations(app, schemeId);
  if (violations.length > 0) violationsError(violations);
}

/** 选项级校验：min <= max、default 落在区间内（创建/更新产品选项时调用） */
export function assertOptionRange(
  minThickness: number,
  maxThickness: number,
  defaultThickness?: number | null
): void {
  if (minThickness > maxThickness) {
    throw new ConstructionError("CONSTRUCTION_STRUCTURE_INVALID", "最小厚度不能大于最大厚度");
  }
  if (defaultThickness !== undefined && defaultThickness !== null &&
      (defaultThickness < minThickness || defaultThickness > maxThickness)) {
    throw new ConstructionError("CONSTRUCTION_STRUCTURE_INVALID", "默认厚度必须在允许厚度区间内");
  }
}

/** 生效区间校验：effectiveAt <= expiresAt（两者均填时） */
export function assertEffectiveRange(effectiveAt?: Date | null, expiresAt?: Date | null): void {
  if (effectiveAt && expiresAt && effectiveAt > expiresAt) {
    throw new ConstructionError("CONSTRUCTION_EFFECTIVE_RANGE_INVALID");
  }
}

/** 生效区间过滤条件（已发布读取复用）：effective_at <= now <= expires_at（空视为不限制） */
export function effectiveRangeConditions<T extends { effectiveAt: AnyPgColumn; expiresAt: AnyPgColumn }>(table: T, now = new Date()) {
  return [
    or(isNull(table.effectiveAt), lte(table.effectiveAt, now)),
    or(isNull(table.expiresAt), gte(table.expiresAt, now))
  ] as const;
}

/** 已发布且生效中的产品规格/材料过滤条件（供引用校验复用） */
export function publishedReferenceConditions<T extends { status: AnyPgColumn; effectiveAt: AnyPgColumn; expiresAt: AnyPgColumn }>(
  table: T,
  now = new Date()
) {
  return [
    eq(table.status, "PUBLISHED"),
    ...effectiveRangeConditions(table, now)
  ] as const;
}