import { eq } from "drizzle-orm";
import type { Database } from "./client.js";
import {
  catalogProducts,
  constructionLayers,
  constructionSchemes,
  insulationSystems,
  materialParameterVersions,
  materials,
  productParameters,
  productSeries,
  productSpecs,
  schemeProductOptions,
  thermalCalcRules,
  thermalReferenceRows,
  thermalReferenceSets
} from "./schema.js";

const evidence = {
  evidenceSource: "VICP热工计算表格公式",
  evidenceRef: "Sheet1",
  evidenceLevel: "A" as const
};
const published = {
  ...evidence,
  status: "PUBLISHED" as const,
  publishedAt: new Date()
};

const MATERIALS = [
  { code: "VICP-MORTAR", name: "混合砂浆", lambda: 0.87, correction: 1 },
  { code: "VICP-CONCRETE", name: "钢筋混凝土", lambda: 1.87, correction: 1 },
  { code: "VICP-LEVELING", name: "找平层", lambda: 0.93, correction: 1 },
  { code: "VICP-BOND", name: "粘结砂浆", lambda: 0.93, correction: 1 },
  { code: "VICP-PLASTER", name: "抹面胶浆", lambda: 0.93, correction: 1 },
  { code: "VICP-COATING", name: "包裹浆料", lambda: 0.08, correction: 1.25 },
  { code: "VICP-VACUUM", name: "真空绝热板", lambda: 0.0025, correction: 1.25 }
] as const;

/** 把客户热工表已确认的 Ri/Re、材料参数和两套结果写入现有表。已存在同编码则不覆盖管理员修改。 */
export async function seedThermalDefaults(db: Database) {
  const [existing] = await db.select({ id: insulationSystems.id }).from(insulationSystems)
    .where(eq(insulationSystems.code, "VICP-SHEET")).limit(1);
  if (existing) return;

  const materialIds = new Map<string, string>();
  for (const item of MATERIALS) {
    const [material] = await db.insert(materials).values({
      code: item.code,
      name: item.name,
      ...published
    }).returning({ id: materials.id });
    materialIds.set(item.code, material!.id);
    await db.insert(materialParameterVersions).values({
      materialId: material!.id,
      thermalConductivity: item.lambda,
      correctionFactor: item.correction,
      ...published
    });
  }

  const [catalog] = await db.insert(catalogProducts).values({
    name: "VICP复合保温板",
    productType: "复合保温板",
    thermalConductivity: 0.005,
    correctionFactor: 1.25,
    thicknessOptionsMm: [25],
    status: "ACTIVE"
  }).returning({ id: catalogProducts.id });

  const [series] = await db.insert(productSeries).values({
    code: "VICP-BOARD",
    name: "VICP复合保温板",
    ...published
  }).returning({ id: productSeries.id });
  const [spec] = await db.insert(productSpecs).values({
    seriesId: series!.id,
    catalogProductId: catalog!.id,
    specCode: "VICP-BOARD-25",
    /** 客户 XLS 无 I/II/III 型号语义；禁止写成 "I" 以免误命中型号筛选 */
    specClass: null,
    thicknessMm: 25,
    ...published
  }).returning({ id: productSpecs.id });
  await db.insert(productParameters).values([
    {
      specId: spec!.id,
      parameterCode: "lambda_eq",
      parameterName: "当量导热系数",
      paramSource: "ATLAS",
      value: 0.005,
      unit: "W/(m·K)",
      ...published
    },
    {
      specId: spec!.id,
      parameterCode: "a_eq",
      parameterName: "修正系数",
      paramSource: "ATLAS",
      value: 1.25,
      ...published
    }
  ]);

  const [system] = await db.insert(insulationSystems).values({
    code: "VICP-SHEET",
    name: "VICP复合保温板外墙",
    systemType: "外墙外保温",
    ...published
  }).returning({ id: insulationSystems.id });

  const [overall] = await db.insert(constructionSchemes).values({
    systemId: system!.id,
    schemeCode: "VICP-OVERALL",
    name: "热阻整体计算",
    substrateMaterial: "钢筋混凝土",
    substrateThickness: 200,
    ...published
  }).returning({ id: constructionSchemes.id });
  const [layered] = await db.insert(constructionSchemes).values({
    systemId: system!.id,
    schemeCode: "VICP-LAYERED",
    name: "热阻分层计算",
    substrateMaterial: "钢筋混凝土",
    substrateThickness: 200,
    ...published
  }).returning({ id: constructionSchemes.id });

  const shared = [
    { order: 1, type: "FIXING_LAYER" as const, name: "混合砂浆", code: "VICP-MORTAR", thickness: 20 },
    { order: 2, type: "BASE_LAYER" as const, name: "钢筋混凝土", code: "VICP-CONCRETE", thickness: 200 },
    { order: 3, type: "FIXING_LAYER" as const, name: "找平层", code: "VICP-LEVELING", thickness: 15 },
    { order: 4, type: "FIXING_LAYER" as const, name: "粘结砂浆", code: "VICP-BOND", thickness: 5 }
  ];
  for (const schemeId of [overall!.id, layered!.id]) {
    for (const layer of shared) {
      await db.insert(constructionLayers).values({
        schemeId,
        layerOrder: layer.order,
        layerType: layer.type,
        layerName: layer.name,
        materialId: materialIds.get(layer.code)!,
        thickness: layer.thickness,
        ...evidence
      });
    }
  }
  await db.insert(constructionLayers).values({
    schemeId: overall!.id,
    layerOrder: 5,
    layerType: "PRODUCT_LAYER",
    layerName: "VICP复合保温板",
    thickness: 25,
    ...evidence
  });
  await db.insert(constructionLayers).values({
    schemeId: overall!.id,
    layerOrder: 6,
    layerType: "FIXING_LAYER",
    layerName: "抹面胶浆",
    materialId: materialIds.get("VICP-PLASTER")!,
    thickness: 5,
    ...evidence
  });
  await db.insert(constructionLayers).values([
    {
      schemeId: layered!.id, layerOrder: 5, layerType: "FIXING_LAYER", layerName: "包裹浆料",
      materialId: materialIds.get("VICP-COATING")!, thickness: 10, ...evidence
    },
    {
      schemeId: layered!.id, layerOrder: 6, layerType: "PRODUCT_LAYER", layerName: "真空绝热板",
      materialId: materialIds.get("VICP-VACUUM")!, thickness: 15, ...evidence
    },
    {
      schemeId: layered!.id, layerOrder: 7, layerType: "FIXING_LAYER", layerName: "包裹浆料",
      materialId: materialIds.get("VICP-COATING")!, thickness: 10, ...evidence
    },
    {
      schemeId: layered!.id, layerOrder: 8, layerType: "FIXING_LAYER", layerName: "抹面胶浆",
      materialId: materialIds.get("VICP-PLASTER")!, thickness: 5, ...evidence
    }
  ]);
  await db.insert(schemeProductOptions).values([
    { schemeId: overall!.id, productSpecId: spec!.id, minThickness: 25, maxThickness: 25, defaultThickness: 25, ...evidence },
    { schemeId: layered!.id, productSpecId: spec!.id, minThickness: 15, maxThickness: 35, defaultThickness: 15, ...evidence }
  ]);

  await db.insert(thermalCalcRules).values({
    code: "VICP-CALC-1",
    name: "VICP热工计算表格公式",
    formulaVersion: "VICP-CALC-1",
    interiorSurfaceResistance: 0.11,
    exteriorSurfaceResistance: 0.04,
    precision: 8,
    roundingMode: "NONE",
    parameterCodes: { equivalentConductivity: "lambda_eq", correctionFactor: "a_eq" },
    ...published
  });

  const [set] = await db.insert(thermalReferenceSets).values({
    code: "VICP-SHEET-1",
    name: "VICP热工计算表格公式示例",
    /** 客户 XLS 仅作计算回归样例，不是正式图集 I/II/III 参考方案 */
    description: "CALC_EXAMPLE：客户热工表默认计算参数与公式回归样例；正式图集参考方案由客户 Word 图集 / B 端人工维护。",
    ...published
  }).returning({ id: thermalReferenceSets.id });
  await db.insert(thermalReferenceRows).values([
    {
      setId: set!.id,
      schemeId: overall!.id,
      productSpecId: spec!.id,
      catalogProductId: catalog!.id,
      thicknessMm: 25,
      productThermalResistance: 4,
      totalThermalResistance: 4.306822098,
      kValue: 0.2321897625,
      /** 计算样例不绑定正式图集页，避免被当成 ATLAS_REFERENCE */
      sourceDocumentId: null,
      sourcePageId: null,
      sourcePageLabel: null,
      rawThickness: "25",
      rawProductResistance: "4",
      rawTotalResistance: "4.306822098",
      rawKValue: "0.2321897625",
      ...evidence,
      sortOrder: 1
    },
    {
      setId: set!.id,
      schemeId: layered!.id,
      productSpecId: spec!.id,
      catalogProductId: catalog!.id,
      thicknessMm: 35,
      productThermalResistance: 5,
      totalThermalResistance: 5.306822098,
      kValue: 0.1884366918,
      sourceDocumentId: null,
      sourcePageId: null,
      sourcePageLabel: null,
      rawThickness: "35",
      rawProductResistance: "5",
      rawTotalResistance: "5.306822098",
      rawKValue: "0.1884366918",
      ...evidence,
      sortOrder: 2
    }
  ]);
}
