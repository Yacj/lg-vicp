import "dotenv/config";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { ConstructionError } from "../../shared/construction-errors.js";
import {
  assertEffectiveRange,
  assertOptionRange,
  collectSchemeStructureViolations,
  validateSchemeStructure
} from "./construction-structure.service.js";

/**
 * 只读桩：rows 中每个元素是"一次查询调用应返回的数组"，按调用顺序消耗（未配置时返回空数组）。
 * collectSchemeStructureViolations 查询顺序：
 *   layers(orderBy) -> options -> 每个 option 的 productSpecs(limit) -> 每个带 materialId 的层 materials(limit) -> scheme(limit)
 */
function makeDb(rows: Array<Array<Record<string, unknown>>>): { db: any } {
  let i = 0;
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    returning: async () => next(),
    orderBy: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  const db = {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    })
  };
  return { db };
}

const app = (db: any) => ({ db }) as unknown as FastifyInstance;

const PUBLISHED_REF = { status: "PUBLISHED", effectiveAt: null, expiresAt: null };

const layer = (overrides: Record<string, unknown>) => ({
  layerOrder: 1,
  layerType: "FIXING_LAYER",
  thickness: null,
  materialId: null,
  ...overrides
});

const option = (overrides: Record<string, unknown>) => ({
  productSpecId: "ps-1",
  minThickness: 10,
  maxThickness: 30,
  defaultThickness: null,
  ...overrides
});

describe("构造方案结构校验器 collectSchemeStructureViolations", () => {
  it("层序必须从 1 连续递增（外到内）", async () => {
    const layers = [layer({ layerOrder: 1 }), layer({ layerOrder: 3 })];
    const { db } = makeDb([layers, [], [{}]]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations.some((v) => v.message.includes("序号不连续"))).toBe(true);
    expect(violations.some((v) => v.message.includes("应为 2，实际为 3"))).toBe(true);
  });

  it("基层层必须是构造的最内层（序号最大）", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "BASE_LAYER" }),
      layer({ layerOrder: 2, layerType: "PRODUCT_LAYER", thickness: 20 })
    ];
    const { db } = makeDb([layers, [], [{}]]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations.some((v) => v.message.includes("基层层必须是构造的最内层"))).toBe(true);
  });

  it("产品层厚度必须落在某个产品选项的允许区间内", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 50 }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const options = [option({ productSpecId: "ps-1", minThickness: 10, maxThickness: 30 })];
    const { db } = makeDb([layers, options, [PUBLISHED_REF], [{}]]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations.some((v) => v.field === "layers.thickness" && v.message.includes("50mm"))).toBe(true);
  });

  it("产品选项 defaultThickness 必须落在 [min, max] 内", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 20 }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const options = [option({ minThickness: 10, maxThickness: 30, defaultThickness: 60 })];
    const { db } = makeDb([layers, options, [PUBLISHED_REF], [{}]]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations.some((v) => v.field === "productOptions.defaultThickness")).toBe(true);
  });

  it("引用的产品规格未发布时直接抛 CONSTRUCTION_REFERENCE_NOT_PUBLISHED", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 20 }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const options = [option({ productSpecId: "ps-1" })];
    const { db } = makeDb([layers, options, [{ status: "DRAFT", effectiveAt: null, expiresAt: null }]]);
    await expect(collectSchemeStructureViolations(app(db), "scheme-1"))
      .rejects.toThrow("产品规格未发布或已失效，不能引用");
  });

  it("引用的材料未发布时直接抛 CONSTRUCTION_REFERENCE_NOT_PUBLISHED", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 20, materialId: "mat-1" }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const { db } = makeDb([layers, [], [{ status: "PUBLISHED", effectiveAt: new Date("2099-01-01"), expiresAt: null }]]);
    await expect(collectSchemeStructureViolations(app(db), "scheme-1"))
      .rejects.toThrow("材料未发布或已失效，不能引用");
  });

  it("生效区间不合法（effectiveAt 晚于 expiresAt）时报告违规", async () => {
    const { db } = makeDb([
      [],
      [],
      [{ effectiveAt: new Date("2026-06-01"), expiresAt: new Date("2025-01-01") }]
    ]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations.some((v) => v.message.includes("生效时间晚于失效时间"))).toBe(true);
  });

  it("层序/基层/产品层/区间/引用全部合法时无违规", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 20, materialId: "mat-1" }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const options = [option({ minThickness: 10, maxThickness: 30, defaultThickness: 20 })];
    const { db } = makeDb([layers, options, [PUBLISHED_REF], [PUBLISHED_REF], [{}]]);
    const violations = await collectSchemeStructureViolations(app(db), "scheme-1");
    expect(violations).toEqual([]);
  });
});

describe("validateSchemeStructure 包装", () => {
  it("存在违规时抛 CONSTRUCTION_STRUCTURE_INVALID（中文汇总）", async () => {
    const layers = [layer({ layerOrder: 1 }), layer({ layerOrder: 3 })];
    const { db } = makeDb([layers, [], [{}]]);
    await expect(validateSchemeStructure(app(db), "scheme-1"))
      .rejects.toThrow(ConstructionError);
    await expect(validateSchemeStructure(app(db), "scheme-1"))
      .rejects.toThrow("构造方案结构校验未通过");
  });

  it("全部合法时不抛错", async () => {
    const layers = [
      layer({ layerOrder: 1, layerType: "PRODUCT_LAYER", thickness: 20 }),
      layer({ layerOrder: 2, layerType: "BASE_LAYER" })
    ];
    const options = [option({ minThickness: 10, maxThickness: 30 })];
    const { db } = makeDb([layers, options, [PUBLISHED_REF], [{}]]);
    await expect(validateSchemeStructure(app(db), "scheme-1")).resolves.toBeUndefined();
  });
});

describe("assertOptionRange / assertEffectiveRange", () => {
  it("min 大于 max 抛错", () => {
    expect(() => assertOptionRange(50, 30)).toThrow("最小厚度不能大于最大厚度");
  });

  it("defaultThickness 越界抛错，区间内通过", () => {
    expect(() => assertOptionRange(10, 30, 60)).toThrow("默认厚度必须在允许厚度区间内");
    expect(() => assertOptionRange(10, 30, 20)).not.toThrow();
    expect(() => assertOptionRange(10, 30, null)).not.toThrow();
  });

  it("生效区间：有效时间晚于失效时间抛错，其余通过", () => {
    expect(() => assertEffectiveRange(new Date("2026-01-01"), new Date("2025-01-01")))
      .toThrow("生效区间不合法");
    expect(() => assertEffectiveRange(new Date("2025-01-01"), new Date("2026-01-01"))).not.toThrow();
    expect(() => assertEffectiveRange(null, null)).not.toThrow();
  });
});