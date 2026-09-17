import { describe, expect, it } from "vitest";
import { resolveMaterialFacts, resolveThermalParameter, resolveStandardLimit } from "./knowledge-fact-resolver.js";
import { factHasSource } from "./knowledge-fact.service.js";

function makeDb(rows: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  const next = () => rows[i++] ?? [];
  const chain = () => ({
    limit: async () => next(),
    orderBy: () => chain(),
    then: (resolve: (value: unknown) => void) => Promise.resolve(next()).then(resolve)
  });
  return {
    select: () => ({
      from: () => ({
        where: () => chain()
      })
    })
  };
}

describe("Knowledge Fact resolver", () => {
  it("优先使用 VERIFIED Knowledge Fact，并保留 source", async () => {
    const fact = {
      id: "fact-1",
      factType: "MATERIAL",
      subject: "mat-1",
      status: "VERIFIED",
      data: { thermalConductivity: 0.032, correctionFactor: 1.1, materialId: "mat-1" },
      sourceDocumentId: "doc-1",
      sourceVersionId: "ver-1",
      sourcePageLabel: "P12",
      sourcePhysicalPageNumber: 12,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const db = makeDb([[fact]]);
    const rows = await resolveMaterialFacts(db as never, { materialId: "mat-1" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resolverSource: "KNOWLEDGE_FACT",
      thermalConductivity: 0.032,
      sourceDocumentId: "doc-1",
      sourcePageLabel: "P12"
    });
    expect(factHasSource(fact)).toBe(true);
  });

  it("没有 VERIFIED Fact 时 fallback Legacy Product Data", async () => {
    const legacy = {
      id: "mp-1", materialId: "mat-1", version: 2, thermalConductivity: 0.04, correctionFactor: null,
      evidenceSource: "图集", evidenceRef: "P1", evidenceLevel: "A"
    };
    const db = makeDb([[], [legacy]]);
    const rows = await resolveMaterialFacts(db as never, { materialId: "mat-1" });
    expect(rows[0]).toMatchObject({ resolverSource: "LEGACY_PRODUCT", id: "mp-1", thermalConductivity: 0.04 });
  });

  it("导热系数优先 VERIFIED THERMAL_PARAMETER", async () => {
    const fact = {
      id: "fact-t",
      factType: "THERMAL_PARAMETER",
      subject: "spec-1",
      status: "VERIFIED",
      data: { parameterCode: "lambda_eq", value: 0.03, paramSource: "ATLAS" },
      sourceDocumentId: "doc-2",
      sourcePageLabel: "表3.1",
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const db = makeDb([[fact]]);
    const rows = await resolveThermalParameter(db as never, { specId: "spec-1", parameterCode: "lambda_eq" });
    expect(rows[0]).toMatchObject({
      resolverSource: "KNOWLEDGE_FACT",
      value: 0.03,
      sourceDocumentId: "doc-2"
    });
  });

  it("标准限值优先 VERIFIED Fact，否则 fallback legacy 限值表", async () => {
    const factDb = makeDb([[{
      id: "fact-l", factType: "STANDARD_LIMIT", subject: "310000", status: "VERIFIED",
      data: { kValue: 0.5, clauseRef: "3.2.1" }, sourceDocumentId: "doc-std", sourcePageLabel: "P8",
      createdAt: new Date(), updatedAt: new Date()
    }]]);
    const fromFact = await resolveStandardLimit(factDb as never, { regionCode: "310000" });
    expect(fromFact).toMatchObject({ resolverSource: "KNOWLEDGE_FACT", limitKValue: 0.5, sourceDocumentId: "doc-std" });

    const legacyDb = makeDb([[], [{
      id: "limit-1", regionCode: "310000", version: 1, regionName: "上海", basisCode: "GB", basisName: "规范",
      clauseRef: "3.2.1", limitKValue: 0.6, evidenceSource: "GB", evidenceRef: "表1", evidenceLevel: "A"
    }]]);
    const fromLegacy = await resolveStandardLimit(legacyDb as never, { regionCode: "310000" });
    expect(fromLegacy).toMatchObject({ resolverSource: "LEGACY_PRODUCT", limitKValue: 0.6, sourceDocumentId: null });
  });
});
