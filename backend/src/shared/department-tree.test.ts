import { describe, expect, it } from "vitest";
import { buildDepartmentAncestorMap, departmentPathName, departmentScopeIds, isDepartmentVisibleToUser } from "./department-tree.js";

const tree = [
  { id: "root", parentId: null },
  { id: "east", parentId: "root" },
  { id: "west", parentId: "root" },
  { id: "east-a", parentId: "east" }
];

describe("部门树可见范围", () => {
  it("计算祖先链与用户范围 ID", () => {
    const ancestors = buildDepartmentAncestorMap(tree);
    expect(ancestors.get("east-a")).toEqual(["east", "root"]);
    expect(departmentScopeIds(["east-a"], ancestors).sort()).toEqual(["east", "east-a", "root"]);
  });

  it("不含子部门时仅本部门可见", () => {
    expect(isDepartmentVisibleToUser({
      visibleDepartmentId: "east",
      includeChildDepartments: false,
      userDepartmentIds: ["east-a"],
      userDepartmentScopeIds: ["east-a", "east", "root"]
    })).toBe(false);
    expect(isDepartmentVisibleToUser({
      visibleDepartmentId: "east",
      includeChildDepartments: false,
      userDepartmentIds: ["east"],
      userDepartmentScopeIds: ["east", "root"]
    })).toBe(true);
  });

  it("含子部门时下级部门用户可见", () => {
    expect(isDepartmentVisibleToUser({
      visibleDepartmentId: "east",
      includeChildDepartments: true,
      userDepartmentIds: ["east-a"],
      userDepartmentScopeIds: ["east-a", "east", "root"]
    })).toBe(true);
  });

  it("拼出用户可选部门路径，不把整棵树当作返回值", () => {
    const named = [
      { id: "root", parentId: null, name: "集团" },
      { id: "east", parentId: "root", name: "华东" },
      { id: "east-a", parentId: "east", name: "上海" }
    ];
    const ancestors = buildDepartmentAncestorMap(named);
    const byId = new Map(named.map((row) => [row.id, row]));
    expect(departmentPathName("east-a", byId, ancestors)).toBe("集团 / 华东 / 上海");
  });
});
