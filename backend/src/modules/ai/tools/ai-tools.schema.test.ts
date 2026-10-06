import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { searchKnowledgeInput } from "./search-knowledge.tool.js";
import { getProjectStateInput } from "./get-project-state.tool.js";
import { getProductDataInput } from "./get-product-data.tool.js";
import { thermalInput } from "./thermal-calculate.tool.js";
import { compareProductsInput } from "./compare-products.tool.js";
import { compareSolutionsInput } from "./compare-solutions.tool.js";
import { generateReportInput } from "./generate-report.tool.js";

vi.hoisted(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/test";
  process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters";
  process.env.AI_CONFIG_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef";
  process.env.STORAGE_ACCESS_KEY = "test";
  process.env.STORAGE_SECRET_KEY = "test-secret";
  process.env.BOOTSTRAP_ADMIN_PASSWORD = "test-admin-password";
});

describe("Chat Agent Tool inputSchema", () => {
  it("search_knowledge 拒绝过短 query，并默认 scope=ALL", () => {
    expect(searchKnowledgeInput.safeParse({ query: "K" }).success).toBe(false);
    const parsed = searchKnowledgeInput.parse({ query: "窗洞口怎么做" });
    expect(parsed.scope).toBe("ALL");
    expect(searchKnowledgeInput.safeParse({ query: "窗洞口做法", scope: "ATLAS" }).success).toBe(true);
    expect(searchKnowledgeInput.shape.query.description).toContain("具体技术问题");
    expect(searchKnowledgeInput.shape.scope.description).toContain("STANDARD");
  });

  it("get_project_state 默认同时读取记忆", () => {
    expect(getProjectStateInput.parse({}).includeMemories).toBe(true);
  });

  it("get_product_data 至少 1 个产品", () => {
    expect(getProductDataInput.safeParse({ productIds: [] }).success).toBe(false);
    expect(getProductDataInput.parse({ productIds: ["p1"] }).productIds).toEqual(["p1"]);
  });

  it("thermal LOOKUP 不要求 schemeId，CALCULATE 仍强制方案/规格/厚度", () => {
    expect(thermalInput.safeParse({
      operation: "LOOKUP_CANDIDATES",
      targetK: 0.3,
      systemHint: "薄抹灰"
    }).success).toBe(true);
    expect(thermalInput.safeParse({
      operation: "LOOKUP_CANDIDATES"
    }).success).toBe(true);
    expect(thermalInput.safeParse({
      operation: "CALCULATE",
      mode: "LAYERED",
      schemeId: "00000000-0000-4000-8000-000000000001",
      productSpecId: "00000000-0000-4000-8000-000000000002",
      thicknessMm: 25
    }).success).toBe(true);
    expect(thermalInput.safeParse({
      operation: "CALCULATE",
      mode: "LAYERED",
      schemeId: "bad",
      productSpecId: "00000000-0000-4000-8000-000000000002",
      thicknessMm: 0
    }).success).toBe(false);
    expect(thermalInput.safeParse({
      operation: "LOOKUP_CANDIDATES",
      schemeId: "00000000-0000-4000-8000-000000000001",
      targetK: 0.3
    }).success).toBe(true);
    const lookup = thermalInput.parse({
      operation: "LOOKUP_CANDIDATES",
      schemeId: "00000000-0000-4000-8000-000000000001",
      targetK: 0.3
    });
    expect(lookup.operation).toBe("LOOKUP_CANDIDATES");
    expect(lookup.targetK).toBe(0.3);
    expect(thermalInput.safeParse({
      mode: "LAYERED",
      schemeId: "00000000-0000-4000-8000-000000000001",
      productSpecId: "00000000-0000-4000-8000-000000000002",
      thicknessMm: 25
    }).success).toBe(false);
  });

  it("thermal 使用单一 object schema，避免 oneOf 卡住兼容网关", () => {
    const json = z.toJSONSchema(thermalInput);
    const encoded = JSON.stringify(json);
    expect(encoded).not.toContain("oneOf");
    expect(encoded).not.toContain("anyOf");
    expect(encoded).not.toContain("discriminatedUnion");
  });

  it("compare_products 只要求产品 ID 和可选关注点，不强制 targetK", () => {
    expect(compareProductsInput.safeParse({ productIds: ["p1"] }).success).toBe(false);
    expect(compareProductsInput.parse({
      productIds: ["p1", "p2"],
      focus: ["性能"]
    }).focus).toEqual(["性能"]);
    expect("targetK" in compareProductsInput.shape).toBe(false);
  });

  it("compare_solutions 兼容产品对比，且不要求 targetK", () => {
    expect(compareSolutionsInput.safeParse({}).success).toBe(false);
    expect(compareSolutionsInput.safeParse({ productIds: ["p1", "p2"] }).success).toBe(true);
    expect(compareSolutionsInput.safeParse({ solutionIds: ["s1", "s2"], targetK: 0.35 }).success).toBe(true);
  });

  it("generate_report 允许 snapshotId，且允许缺省 reportType", () => {
    expect(generateReportInput.safeParse({}).success).toBe(true);
    expect(generateReportInput.safeParse({ snapshotId: "snap-1" }).success).toBe(true);
    expect(generateReportInput.safeParse({ reportType: "technical_scheme" }).success).toBe(true);
  });
});
