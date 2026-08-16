import { describe, expect, it } from "vitest";
import type { MenuTreeItem } from "./menu.service.js";
import { pruneMenuTree } from "./menu.service.js";

const node = (overrides: Partial<MenuTreeItem>): MenuTreeItem => ({
  id: overrides.id ?? "n",
  parentId: overrides.parentId ?? null,
  menuType: overrides.menuType ?? "MENU",
  name: overrides.name ?? "节点",
  routePath: overrides.routePath ?? "/n",
  component: overrides.component ?? null,
  icon: null,
  sortOrder: 0,
  isExternal: false,
  visible: true,
  permissionCode: null,
  children: overrides.children ?? []
});

describe("pruneMenuTree", () => {
  it("保留有可见 MENU 子菜单的目录", () => {
    const tree = [
      node({
        id: "reports", menuType: "DIRECTORY", routePath: "/reports", name: "报告中心",
        children: [node({ id: "center", routePath: "/reports/center", name: "模板报告" })]
      })
    ];
    expect(pruneMenuTree(tree)).toHaveLength(1);
  });

  it("隐藏只有 BUTTON 子节点的空目录", () => {
    const tree = [
      node({
        id: "reports", menuType: "DIRECTORY", routePath: "/reports", name: "报告中心",
        children: [node({ id: "review", menuType: "BUTTON", routePath: "/reports/center/review", name: "审核" })]
      })
    ];
    expect(pruneMenuTree(tree)).toHaveLength(0);
  });

  it("隐藏完全没有子节点的目录，但保留无子按钮的 MENU", () => {
    const tree = [
      node({ id: "empty", menuType: "DIRECTORY", routePath: "/empty", name: "空目录" }),
      node({ id: "project", routePath: "/project", name: "项目管理" })
    ];
    const pruned = pruneMenuTree(tree);
    expect(pruned.map((item) => item.id)).toEqual(["project"]);
  });

  it("递归裁剪嵌套目录：父目录随子目录一起隐藏", () => {
    const tree = [
      node({
        id: "root", menuType: "DIRECTORY", routePath: "/root", name: "根目录",
        children: [
          node({
            id: "child", menuType: "DIRECTORY", routePath: "/root/child", name: "子目录",
            children: [node({ id: "button", menuType: "BUTTON", routePath: "/root/child/x", name: "按钮" })]
          })
        ]
      })
    ];
    expect(pruneMenuTree(tree)).toHaveLength(0);
  });

  it("目录内至少一个 MENU 可见时保留目录及其下 BUTTON", () => {
    const tree = [
      node({
        id: "reports", menuType: "DIRECTORY", routePath: "/reports", name: "报告中心",
        children: [
          node({ id: "templates", routePath: "/reports/templates", name: "报告模板" }),
          node({ id: "review", menuType: "BUTTON", routePath: "/reports/templates/approve", name: "审核" })
        ]
      })
    ];
    const pruned = pruneMenuTree(tree);
    expect(pruned).toHaveLength(1);
    expect(pruned[0].children.map((child) => child.id)).toEqual(["templates", "review"]);
  });
});