import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { referenceRowsStillCurrent } from "./reference-candidate-source.service.js";
const candidate = { id: "row", schemeId: "scheme", productSpecId: "spec", systemId: "system", schemeCode: "A3-2",
  substrateMaterial: "混凝土空心砌块", substrateThickness: 190, specClass: "III" as const, thicknessMm: 45,
  productThermalResistance: 3.0, totalThermalResistance: 3.398, kValue: .294, sourcePageId: "page", sourceDocumentId: "doc" };
function database(rows: unknown[]) {
  const where = vi.fn(async (_predicate: unknown) => rows);
  const builder: any = { from: () => builder, innerJoin: () => builder, where };
  return { db: { select: () => builder } as any, where };
}
const fresh = () => ({ row: { ...candidate }, scheme: { systemId: "system", schemeCode: "A3-2", substrateMaterial: candidate.substrateMaterial, substrateThickness: 190 }, spec: { specClass: "III" } });
describe("只读按身份核验正式发布关系", () => {
  it("参数化限定引用ID，保留四种正式关系发布/有效性/软删门禁", async () => {
    const { db, where } = database([fresh()]);
    expect(await referenceRowsStillCurrent(db, [candidate])).toBe(true);
    const sql = new PgDialect().sqlToQuery(where.mock.calls[0]![0] as any);
    expect(sql.params).toContain("row"); expect(sql.sql).toContain('"thermal_reference_rows"."id"');
    for (const table of ["thermal_reference_sets", "construction_schemes", "insulation_systems", "product_specs"])
      expect(sql.sql).toContain(`"${table}"."status"`);
  });
  it.each(["absent", "kValue", "substrateMaterial", "substrateThickness", "productSpecId"])("%s改变时拒绝冻结旧事实", async key => {
    const current = fresh();
    if (key === "substrateMaterial") current.scheme.substrateMaterial = "加气混凝土砌块";
    else if (key === "substrateThickness") current.scheme.substrateThickness = 200;
    else (current.row as any)[key] = "changed";
    expect(await referenceRowsStillCurrent(database(key === "absent" ? [] : [current]).db, [candidate])).toBe(false);
  });
});
