import { describe, expect, it } from "vitest";
import { clientProjectListQuerySchema, createProjectBodySchema } from "./project.schemas.js";

describe("C 端项目列表查询", () => {
  it("默认使用第一页和默认分页大小", () => {
    expect(clientProjectListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("支持公开、私有和关键词组合筛选", () => {
    expect(clientProjectListQuerySchema.parse({
      page: "2",
      pageSize: "10",
      visibility: "PUBLIC",
      keyword: "  办公楼  "
    })).toEqual({
      page: 2,
      pageSize: 10,
      visibility: "PUBLIC",
      keyword: "办公楼"
    });
    expect(clientProjectListQuerySchema.safeParse({ visibility: "PRIVATE" }).success).toBe(true);
  });

  it("拒绝非法可见性和过长关键词", () => {
    expect(clientProjectListQuerySchema.safeParse({ visibility: "ALL" }).success).toBe(false);
    expect(clientProjectListQuerySchema.safeParse({ keyword: "项".repeat(121) }).success).toBe(false);
  });
});

describe("项目创建参数", () => {
  it("仅保留项目自身字段，不接受客户绑定字段", () => {
    const base = { name: "办公楼项目", visibility: "PRIVATE" as const };
    const parsed = createProjectBodySchema.parse({ ...base, customerId: "4b026520-2eef-4ce9-9ad7-fd538d2ce32f" });

    expect(parsed).toEqual(base);
    expect("customerId" in parsed).toBe(false);
  });
});
