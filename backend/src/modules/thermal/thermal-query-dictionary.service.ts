import { and, eq } from "drizzle-orm";
import type { DbExecutor } from "../../db/client.js";
import { catalogProducts, constructionSchemes, insulationSystems, knowledgeAliases, productSpecs, standardApplicability, standardDocuments, thermalReferenceSets, thermalStandardLimits } from "../../db/schema.js";
import { publishedReferenceConditions } from "../construction/construction-structure.service.js";
import { type ConstraintCandidate } from "./thermal-query-state.js";
import type { QueryEntity } from "./thermal-entity-resolver.js";
import { publishedCalculationModels } from "../ai/calculation-models.js";

/** 名称目录独立于选用表命中范围：没有参考行的体系也不能丢掉用户条件。 */
export async function loadThermalQueryDictionary(db: DbExecutor) {
  const [systems, schemes, specs, products, sets, limits, aliases, scopes] = await Promise.all([
    db.select().from(insulationSystems).where(and(...publishedReferenceConditions(insulationSystems))),
    db.select().from(constructionSchemes).where(and(...publishedReferenceConditions(constructionSchemes))),
    db.select().from(productSpecs).where(and(...publishedReferenceConditions(productSpecs))),
    db.select().from(catalogProducts).where(eq(catalogProducts.status, "ACTIVE")),
    db.select().from(thermalReferenceSets).where(and(...publishedReferenceConditions(thermalReferenceSets))),
    db.select().from(thermalStandardLimits).where(and(...publishedReferenceConditions(thermalStandardLimits))),
    db.select({ term: knowledgeAliases.term, alias: knowledgeAliases.alias }).from(knowledgeAliases)
      .where(and(eq(knowledgeAliases.enabled, true), eq(knowledgeAliases.scope, "GLOBAL"))),
    db.select({ buildingTypes: standardApplicability.buildingTypes, structureTypes: standardApplicability.structureTypes }).from(standardApplicability)
      .innerJoin(standardDocuments, eq(standardApplicability.documentId, standardDocuments.id))
      .where(and(...publishedReferenceConditions(standardApplicability), ...publishedReferenceConditions(standardDocuments)))
  ]);
  const entities: QueryEntity[] = [
    // 尚无经业务确认的familyCode；名称与自由systemType不签发正式族身份。
    // 全名/编码/配置别名仍可唯一定位，局部族名称缺映射时必须澄清。
    ...systems.map(item => ({ field: "systemId" as const, value: item.id, names: [item.name, item.code],
      family: undefined, category: undefined })),
    ...schemes.flatMap(item => [
      { field: "schemeId" as const, value: item.id, names: [item.name, item.schemeCode], systemId: item.systemId },
      { field: "substrateMaterial" as const, value: item.substrateMaterial, names: [item.substrateMaterial] }
    ]),
    ...specs.map(item => ({ field: "productSpecId" as const, value: item.id, names: [item.specCode] })),
    ...[...new Set(specs.map(item => item.specClass).filter((value): value is "I" | "II" | "III" => !!value))]
      .map(value => ({ field: "specClass" as const, value, names: [value, `${value}型`, `${{ I: "Ⅰ", II: "Ⅱ", III: "Ⅲ" }[value]}型`,
        `${{ I: "一", II: "二", III: "三" }[value]}型`, `${{ I: "1", II: "2", III: "3" }[value]}型`] })),
    ...products.map(item => ({ field: "catalogProductId" as const, value: item.id, names: [item.name] })),
    ...sets.flatMap(item => item.buildingTypes.map(name => ({ field: "buildingType" as const, value: name, names: [name] }))),
    ...scopes.flatMap(item => [...item.buildingTypes.map(name => ({ field: "buildingType" as const, value: name, names: [name] })),
      ...item.structureTypes.map(name => ({ field: "structureType" as const, value: name, names: [name] }))]),
    ...limits.flatMap(item => [
      { field: "regionCode" as const, value: item.regionCode, names: [item.regionCode, item.regionName] },
      { field: "standardLimitId" as const, value: item.id, names: [item.basisCode, item.basisName] }
    ])
  ];
  const selectionFacts: Array<ConstraintCandidate & { specCode?: string }> = [
    ...systems.map(item => ({ systemId: item.id, systemName: item.name })),
    ...schemes.map(item => ({ schemeId: item.id, schemeCode: item.schemeCode, systemId: item.systemId,
      substrateMaterial: item.substrateMaterial, substrateThickness: item.substrateThickness })),
    ...specs.map(item => ({ productSpecId: item.id, catalogProductId: item.catalogProductId, specClass: item.specClass ?? undefined, specCode: item.specCode }))
  ];
  const calculationModels = schemes.length ? await publishedCalculationModels(db) : [];
  return { entities, aliases, selectionFacts, calculationModels,
    sourceSets: sets.map(set => ({ id: set.id, code: set.code, name: set.name, source: set.evidenceSource, reference: set.evidenceRef })), hasPublishedLimits: limits.length > 0 };
}
