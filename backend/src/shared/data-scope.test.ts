import { describe, expect, it } from "vitest";
import { resolveDataScope } from "./data-scope.js";

describe("resolveDataScope", () => {
  it("SUPER_ADMIN 永远 ALL", () => {
    expect(resolveDataScope({ role: "SUPER_ADMIN", dataScope: "SELF" })).toBe("ALL");
    expect(resolveDataScope({ role: "SUPER_ADMIN", dataScope: null })).toBe("ALL");
  });

  it("渠道用户未配置动态角色范围时使用 SELF", () => {
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: null })).toBe("SELF");
  });

  it("保留部门、项目创建者、自定义和全量范围", () => {
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "DEPT" })).toBe("DEPT");
    expect(resolveDataScope({ role: "CHANNEL_USER", dataScope: "DEPT_AND_CHILDREN" })).toBe("DEPT_AND_CHILDREN");
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "PROJECT_OWNER" })).toBe("PROJECT_OWNER");
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "CUSTOM" })).toBe("CUSTOM");
    expect(resolveDataScope({ role: "NORMAL_USER", dataScope: "ALL" })).toBe("ALL");
  });
});
