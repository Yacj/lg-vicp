import "dotenv/config";
import { describe, expect, it } from "vitest";
import {
  constructionSchemes,
  productSpecs,
  schemeProductOptions,
  thermalReferenceSets
} from "../../db/schema.js";
import { assessBatchConfirmMapping, syncThermalRowsFromConfirmedPage } from "./knowledge-page-recognition.service.js";

const actor = { id: "00000000-0000-4000-8000-000000000099" } as any;
const page = {
  id: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002",
  versionId: "00000000-0000-4000-8000-000000000003",
  physicalPageNumber: 22,
  pageLabel: "22"
} as any;
const set = { id: "set-1", status: "DRAFT", atlasDocumentId: page.documentId };
const scheme = {
  id: "00000000-0000-4000-8000-000000000010",
  systemId: "00000000-0000-4000-8000-000000000011",
  schemeCode: "A1-3",
  name: "方案 A",
  version: 1,
  status: "PUBLISHED"
};
const spec = {
  id: "00000000-0000-4000-8000-000000000020",
  catalogProductId: "00000000-0000-4000-8000-000000000021",
  specCode: "I-18",
  version: 1,
  specClass: "I",
  thicknessMm: 18,
  status: "PUBLISHED"
};

function structured(overrides: Record<string, unknown> = {}) {
  return {
    fullText: "A1-3 I 型 18mm",
    systems: [{
      constructionCode: "A1-3",
      specClass: "I" as const,
      options: [{
        thicknessMm: 18,
        productThermalResistance: 2.88,
        totalThermalResistance: 3.297,
        kValue: 0.303,
        ...overrides
      }]
    }]
  };
}

function makeDb(fixtures: {
  schemes?: any[];
  specs?: any[];
  options?: any[];
}) {
  const inserts: any[] = [];
  const tableRows = (table: unknown) => {
    if (table === thermalReferenceSets) return [set];
    if (table === constructionSchemes) return fixtures.schemes ?? [];
    if (table === productSpecs) return fixtures.specs ?? [];
    if (table === schemeProductOptions) return fixtures.options ?? [];
    return [];
  };
  const db: any = {
    select: () => {
      let table: unknown;
      const query: any = {
        from: (value: unknown) => { table = value; return query; },
        where: () => query,
        limit: async () => tableRows(table),
        then: (resolve: (value: unknown) => void) => Promise.resolve(tableRows(table)).then(resolve)
      };
      return query;
    },
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async (value: unknown) => { inserts.push(value); } })
  };
  return { db, inserts };
}

describe("Recognition 正式映射", () => {
  it("一键核对在缺参考集或正式映射不完整时跳过，完整映射才允许", async () => {
    const { db: emptyDb } = makeDb({});
    expect((await assessBatchConfirmMapping(emptyDb, page, structured(), null)).join(" ")).toContain("热工参考集");
    expect((await assessBatchConfirmMapping(emptyDb, page, structured(), set.id)).join(" ")).toContain("未匹配到已发布方案");
    const { db: mappedDb } = makeDb({ schemes: [scheme], specs: [spec], options: [{ schemeId: scheme.id, productSpecId: spec.id }] });
    expect(await assessBatchConfirmMapping(mappedDb, page, structured(), set.id)).toEqual([]);
  });
  it("0 个方案候选标记 NOT_FOUND 语义并跳过正式写入", async () => {
    const { db, inserts } = makeDb({});
    const result = await syncThermalRowsFromConfirmedPage(db, actor, page, structured(), set.id);
    expect(result).toMatchObject({ upserted: 0, skipped: 1 });
    expect(result.mappingIssues).toContainEqual(expect.objectContaining({ mappingStatus: "NOT_FOUND", kind: "SCHEME" }));
    expect(result.warnings.join(" ")).toContain("未找到已发布构造方案");
    expect(inserts).toEqual([]);
  });

  it("唯一方案和唯一规格自动绑定", async () => {
    const { db, inserts } = makeDb({
      schemes: [scheme],
      specs: [spec],
      options: [{ schemeId: scheme.id, productSpecId: spec.id }]
    });
    const result = await syncThermalRowsFromConfirmedPage(db, actor, page, structured(), set.id);
    expect(result.upserted).toBe(1);
    expect(inserts[0]).toMatchObject({
      schemeId: scheme.id,
      productSpecId: spec.id,
      catalogProductId: spec.catalogProductId,
      sourcePageId: page.id
    });
  });

  it("多个方案候选返回 AMBIGUOUS，禁止静默取第一条", async () => {
    const second = { ...scheme, id: "00000000-0000-4000-8000-000000000012", systemId: "00000000-0000-4000-8000-000000000013", name: "方案 B" };
    const { db } = makeDb({ schemes: [scheme, second] });
    await expect(syncThermalRowsFromConfirmedPage(db, actor, page, structured(), set.id))
      .rejects.toMatchObject({
        code: "PAGE_RECOGNITION_MAPPING_AMBIGUOUS",
        details: expect.objectContaining({ mappingStatus: "AMBIGUOUS", schemeCandidates: expect.any(Array) })
      });
  });

  it("多个规格候选返回 AMBIGUOUS，禁止静默取第一条", async () => {
    const second = { ...spec, id: "00000000-0000-4000-8000-000000000022", specCode: "I-18-B" };
    const { db } = makeDb({
      schemes: [scheme],
      specs: [spec, second],
      options: [
        { schemeId: scheme.id, productSpecId: spec.id },
        { schemeId: scheme.id, productSpecId: second.id }
      ]
    });
    await expect(syncThermalRowsFromConfirmedPage(db, actor, page, structured(), set.id))
      .rejects.toMatchObject({
        code: "PAGE_RECOGNITION_MAPPING_AMBIGUOUS",
        details: expect.objectContaining({ mappingStatus: "AMBIGUOUS", productSpecCandidates: expect.any(Array) })
      });
  });

  it("显式 schemeId/productSpecId 校验通过后使用人工选择", async () => {
    const input = structured({ productSpecId: spec.id });
    input.systems[0]!.schemeId = scheme.id;
    const { db, inserts } = makeDb({
      schemes: [scheme],
      specs: [spec],
      options: [{ schemeId: scheme.id, productSpecId: spec.id }]
    });
    await syncThermalRowsFromConfirmedPage(db, actor, page, input, set.id);
    expect(inserts[0]).toMatchObject({ schemeId: scheme.id, productSpecId: spec.id });
  });

  it("显式产品规格不属于方案时拒绝", async () => {
    const input = structured({ productSpecId: spec.id });
    input.systems[0]!.schemeId = scheme.id;
    const { db } = makeDb({ schemes: [scheme], specs: [spec], options: [] });
    await expect(syncThermalRowsFromConfirmedPage(db, actor, page, input, set.id))
      .rejects.toMatchObject({ code: "PAGE_RECOGNITION_MAPPING_INVALID" });
  });
});
