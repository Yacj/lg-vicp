import { describe, expect, it } from "vitest";
import { resolveScopedThermalStandard } from "./thermal-standard-scope.service.js";

function dbWith(limit: object | null, scopes: object[]) {
  let index = 0;
  const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain,
    limit: async () => limit ? [limit] : [], then: (resolve: (rows: object[]) => unknown) => Promise.resolve(index++ === 0 ? scopes : []).then(resolve) };
  return { select: () => chain } as any;
}
const limit = { id: "standard-A", regionCode: "region-A", standardDocumentId: "doc-A", limitKValue: 0.3, basisCode: "STD-A" };
const query = { regionCode: "region-A", buildingType: "建筑甲", standardLimitId: "standard-A" };

describe("正式标准适用范围证明", () => {
  it.each([{}, { regionCode: "region-A" }, { regionCode: "region-A", buildingType: "建筑甲" }])("缺必要条件不得默认标准或建筑类型", async input => {
    expect((await resolveScopedThermalStandard(dbWith(limit, []), input)).limit).toBeNull();
  });
  it("不能只凭地域限值或其他建筑类型宣称达标", async () => {
    expect((await resolveScopedThermalStandard(dbWith({ ...limit, standardDocumentId: null }, []), query)).limit).toBeNull();
    expect((await resolveScopedThermalStandard(dbWith(limit, [{ buildingTypes: ["建筑乙"], structureTypes: [] }]), query)).limit).toBeNull();
  });
  it("正式范围匹配才允许同一标准快照进入计算", async () => {
    expect((await resolveScopedThermalStandard(dbWith(limit, [{ buildingTypes: ["建筑甲"], structureTypes: [] }]), query)).limit)
      .toMatchObject({ id: "standard-A", regionCode: "region-A", limitKValue: 0.3, sourceDocumentId: "doc-A" });
  });
  it("有结构限制时，缺失或不符结构类型不得授权", async () => {
    const scopes = [{ buildingTypes: ["建筑甲"], structureTypes: ["结构甲"] }];
    expect((await resolveScopedThermalStandard(dbWith(limit, scopes), query)).limit).toBeNull();
    expect((await resolveScopedThermalStandard(dbWith(limit, scopes), { ...query, structureType: "结构乙" })).limit).toBeNull();
    expect((await resolveScopedThermalStandard(dbWith(limit, scopes), { ...query, structureType: "结构甲" })).limit).not.toBeNull();
  });
});
