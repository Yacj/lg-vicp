import { describe, expect, it } from "vitest";
import { clientProjectListQuerySchema, createProjectBodySchema, updateVisibilityBodySchema } from "./project.schemas.js";

describe("C 端项目列表查询", () => {
  it("默认使用第一页和默认分页大小", () => {
    expect(clientProjectListQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
  });

  it("支持部门可见、私有和关键词组合筛选", () => {
    expect(clientProjectListQuerySchema.parse({
      page: "2",
      pageSize: "10",
      visibility: "DEPARTMENT",
      keyword: "  办公楼  "
    })).toEqual({
      page: 2,
      pageSize: 10,
      visibility: "DEPARTMENT",
      keyword: "办公楼"
    });
    expect(clientProjectListQuerySchema.safeParse({ visibility: "PRIVATE" }).success).toBe(true);
    expect(clientProjectListQuerySchema.safeParse({ visibility: "PUBLIC" }).success).toBe(true);
  });

  it("拒绝非法可见性和过长关键词", () => {
    expect(clientProjectListQuerySchema.safeParse({ visibility: "ALL" }).success).toBe(false);
    expect(clientProjectListQuerySchema.safeParse({ keyword: "项".repeat(121) }).success).toBe(false);
  });
});

describe("项目创建参数", () => {
  it("私有项目不要求部门", () => {
    const parsed = createProjectBodySchema.parse({ name: "办公楼项目", visibility: "PRIVATE" as const });
    expect(parsed).toEqual({ name: "办公楼项目", visibility: "PRIVATE" });
  });

  it("部门可见必须选择部门", () => {
    expect(createProjectBodySchema.safeParse({ name: "共享项目", visibility: "DEPARTMENT" }).success).toBe(false);
    expect(createProjectBodySchema.parse({
      name: "共享项目",
      visibility: "DEPARTMENT",
      visibleDepartmentId: "11111111-1111-4111-8111-111111111111",
      includeChildDepartments: true
    })).toMatchObject({ visibility: "DEPARTMENT", includeChildDepartments: true });
  });

  it("新建不再接受历史 PUBLIC", () => {
    expect(createProjectBodySchema.safeParse({ name: "公开项目", visibility: "PUBLIC" }).success).toBe(false);
  });
});

describe("项目可见性切换", () => {
  it("私有项目不能带可见部门", () => {
    expect(updateVisibilityBodySchema.safeParse({
      visibility: "PRIVATE",
      visibleDepartmentId: "11111111-1111-4111-8111-111111111111"
    }).success).toBe(false);
    expect(updateVisibilityBodySchema.parse({ visibility: "PRIVATE" })).toMatchObject({ visibility: "PRIVATE" });
  });
});
