import { describe, expect, it } from "vitest";
import { createCatalogProductBodySchema, productCompareBodySchema } from "./product.schemas.js";

describe("产品最小骨架契约", () => {
  it("只接受已确认字段", () => {
    expect(createCatalogProductBodySchema.parse({ name: "VICP 板" })).toMatchObject({ name: "VICP 板" });
    expect(createCatalogProductBodySchema.safeParse({ name: "" }).success).toBe(false);
  });

  it("对比至少 2 个产品", () => {
    expect(productCompareBodySchema.safeParse({ productIds: ["11111111-1111-1111-1111-111111111111"] }).success).toBe(false);
    expect(productCompareBodySchema.parse({
      productIds: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222"
      ]
    }).productIds).toHaveLength(2);
  });
});
