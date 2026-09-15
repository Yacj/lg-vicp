import { describe, expect, it } from "vitest";
import { buildMenuSeedTree, type MenuSeedNode } from "../../db/menu-seed-tree.js";
import { REPORT_PERMISSIONS } from "../../shared/report-permissions.js";
import { buildMenuTreeForPermissions, pruneMenuTree, type MenuTreeItem, type MenuTreeRow } from "./menu.service.js";

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

// ===== buildMenuTreeForPermissions：基于 2026-09 瘦身菜单种子的角色差异模拟 =====
// （与真实 getMenuTree 行为一致：DB 层已过滤 enabled=true && visible=true，隐藏路由不进入 rows）

type FlatItem = { node: MenuSeedNode; parentRoutePath: string | null };

const flattenSeedTree = (nodes: readonly MenuSeedNode[], parentRoutePath: string | null = null): FlatItem[] =>
  nodes.flatMap((node) => [
    { node, parentRoutePath },
    ...flattenSeedTree(node.children ?? [], node.routePath)
  ]);

const toRows = (): MenuTreeRow[] =>
  flattenSeedTree(buildMenuSeedTree())
    .filter((item) => item.node.visible !== false)
    .map((item) => ({
      id: item.node.routePath,
      parentId: item.parentRoutePath,
      menuType: item.node.menuType,
      name: item.node.name,
      routePath: item.node.routePath,
      component: item.node.component ?? null,
      icon: item.node.icon ?? null,
      sortOrder: item.node.sortOrder,
      isExternal: false,
      permissionCode: item.node.permissionCode ?? null
    }))
    // 与真实 getMenuTree 的 orderBy(sortOrder, name) 保持一致
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-Hans-CN"));

const collectMenuTreeIds = (items: readonly MenuTreeItem[]): string[] =>
  items.flatMap((item) => [item.id, ...collectMenuTreeIds(item.children)]);

describe("buildMenuTreeForPermissions（瘦身菜单 × 三类角色）", () => {
  const rows = toRows();
  const allPermissionCodes = new Set(rows.map((row) => row.permissionCode).filter((code): code is string => code !== null));
  // CHANNEL_USER：seed 中 channel_operator 角色显式绑定的权限码
  const channelUserCodes = new Set(["project.create", "ai.chat", REPORT_PERMISSIONS.GENERATE, REPORT_PERMISSIONS.REVIEW]);
  // NORMAL_USER：seed 中 normal_user 角色显式绑定的权限码
  const normalUserCodes = new Set(["project.read_public", "ai.chat"]);

  it("SUPER_ADMIN（全量权限）：可见一级恰好 5 个，产品中心二级齐全且无空壳目录", () => {
    const tree = buildMenuTreeForPermissions(rows, allPermissionCodes);
    expect(tree.map((item) => item.name)).toEqual(["项目管理", "产品中心", "知识中心", "报告管理", "AI 配置", "AI 运营", "系统管理"]);
    const products = tree.find((item) => item.routePath === "/products");
    expect(products?.children.map((child) => child.name)).toEqual([
      "产品管理", "材料与参数", "构造体系", "热工数据", "节点图", "材料对比"
    ]);
    const reports = tree.find((item) => item.routePath === "/reports");
    expect(reports?.children.map((child) => child.name)).toEqual(["报告列表", "报告设置"]);
    // 隐藏路由不出现在任何角色菜单树中
    const allIds = collectMenuTreeIds(tree);
    expect(allIds).not.toContain("/ai");
    expect(allIds).not.toContain("/thermal/calc-records");
    expect(allIds).not.toContain("/review-center/queue");
    expect(allIds).not.toContain("/monitor/audit");
    expect(allIds).not.toContain("/reports/templates");
  });

  it("CHANNEL_USER：只看到项目管理与报告管理（报告模板为隐藏路由，报告设置需独立权限）", () => {
    const tree = buildMenuTreeForPermissions(rows, channelUserCodes);
    expect(tree.map((item) => item.name)).toEqual(["项目管理", "报告管理"]);
    const reports = tree.find((item) => item.routePath === "/reports");
    expect(reports?.children.map((child) => child.name)).toEqual(["报告列表"]);
  });

  it("NORMAL_USER：无后台业务权限，菜单树为空且无空壳", () => {
    expect(buildMenuTreeForPermissions(rows, normalUserCodes)).toEqual([]);
  });

  it("三种角色输出均无幽灵父子关系、无空壳目录", () => {
    for (const codes of [allPermissionCodes, channelUserCodes, normalUserCodes]) {
      const tree = buildMenuTreeForPermissions(rows, codes);
      const flatten = (items: readonly MenuTreeItem[], parentId: string | null = null): MenuTreeItem[] =>
        items.flatMap((item) => [
          Object.assign(item, { parentId }),
          ...flatten(item.children, item.id)
        ]);
      const flatItems = flatten(tree);
      const ids = new Set(flatItems.map((item) => item.id));
      // 幽灵节点：每个节点的父级都在树中（根节点 parentId 为 null）
      for (const item of flatItems) {
        if (item.parentId !== null) {
          expect(ids.has(item.parentId)).toBe(true);
        }
      }
      // 空壳目录：DIRECTORY 必须携带子节点（无可见 MENU 的目录已被裁剪）
      for (const item of flatItems) {
        if (item.menuType === "DIRECTORY") {
          expect(item.children.length).toBeGreaterThan(0);
        }
      }
    }
  });
});