import { describe, expect, it } from "vitest";
import { clientProjectListQuerySchema } from "./project.schemas.js";

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