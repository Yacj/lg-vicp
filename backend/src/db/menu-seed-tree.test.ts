import { describe, expect, it } from "vitest";
import {
  buildMenuSeedTree,
  DEPRECATED_MENU_ROUTE_PATHS,
  HIDDEN_MENU_ROUTE_PATHS,
  LEGACY_MENU_ROUTE_PATHS,
  type MenuSeedNode
} from "./menu-seed-tree.js";

type FlatItem = { node: MenuSeedNode; parentRoutePath: string | null };

const flattenSeedTree = (nodes: readonly MenuSeedNode[], parentRoutePath: string | null = null): FlatItem[] =>
  nodes.flatMap((node) => [
    { node, parentRoutePath },
    ...flattenSeedTree(node.children ?? [], node.routePath)
  ]);

const flat = (nodes?: readonly MenuSeedNode[]) => flattenSeedTree(nodes ?? buildMenuSeedTree());

describe("buildMenuSeedTree（B 端菜单信息架构 2026-09 瘦身）", () => {
  it("顶层可见一级只保留 7 个（工作台由 Admin-Web 静态首页承担，不入库）", () => {
    const tree = buildMenuSeedTree();
    const topVisible = tree.filter((node) => node.visible !== false);
    expect(topVisible.map((node) => node.name)).toEqual(["项目管理", "知识中心", "采集管理", "报告管理", "AI 配置", "AI 运营", "系统管理"]);
    // AI 对话保留为隐藏路由，不再是可见一级入口
    const aiEntry = tree.find((node) => node.routePath === "/ai");
    expect(aiEntry?.visible).toBe(false);
  });

  it("全树 routePath 唯一（seed 以 routePath 作 upsert 冲突键，重复会互相覆盖）", () => {
    const paths = flat().map((item) => item.node.routePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("废弃的旧一级目录不再出现在菜单树中", () => {
    const paths = new Set(flat().map((item) => item.node.routePath));
    for (const deprecated of DEPRECATED_MENU_ROUTE_PATHS) {
      expect(paths.has(deprecated)).toBe(false);
    }
  });

  it("已被替代 / 残留的菜单路径（/system/ai、/monitor/ai、/ai-config/prompt、/report/index、/projects）不再出现在菜单树中", () => {
    const paths = new Set(flat().map((item) => item.node.routePath));
    for (const legacy of LEGACY_MENU_ROUTE_PATHS) {
      expect(paths.has(legacy)).toBe(false);
    }
  });

  it("隐藏路由清单与树中 visible=false 节点一一对应", () => {
    const hiddenInTree = flat()
      .filter((item) => item.node.visible === false)
      .map((item) => item.node.routePath)
      .sort();
    expect(hiddenInTree).toEqual([...HIDDEN_MENU_ROUTE_PATHS].sort());
  });

  it("旧 → 新入口映射：各领域叶子挂到正确的新父目录", () => {
    const parentByRoutePath = new Map(flat().map((item) => [item.node.routePath, item.parentRoutePath]));
    // 产品中心六个二级目录
    expect(parentByRoutePath.get("/products/catalog")).toBe("/products");
    expect(parentByRoutePath.get("/products/series")).toBe("/products/catalog");
    expect(parentByRoutePath.get("/products/specs")).toBe("/products/catalog");
    expect(parentByRoutePath.get("/products/parameters")).toBe("/products/catalog");
    expect(parentByRoutePath.get("/products/attachments")).toBe("/products/catalog");
    expect(parentByRoutePath.get("/masterdata/materials")).toBe("/products/materials");
    expect(parentByRoutePath.get("/masterdata/parameter-versions")).toBe("/products/materials");
    expect(parentByRoutePath.get("/construction/systems")).toBe("/products/construction");
    expect(parentByRoutePath.get("/construction/schemes")).toBe("/products/construction");
    expect(parentByRoutePath.get("/thermal/sets")).toBe("/products/thermal");
    expect(parentByRoutePath.get("/thermal/calc-rules")).toBe("/products/thermal");
    expect(parentByRoutePath.get("/nodes/drawings")).toBe("/products/nodes");
    expect(parentByRoutePath.get("/comparison/versions")).toBe("/products/comparison");
    expect(parentByRoutePath.get("/products")).toBe(null);
    // 采集管理独立一级
    expect(parentByRoutePath.get("/collection")).toBe(null);
    expect(parentByRoutePath.get("/collection/manual")).toBe("/collection");
    expect(parentByRoutePath.get("/collection/sources")).toBe("/collection");
    expect(parentByRoutePath.get("/collection/tasks")).toBe("/collection");
    // 标准政策并入知识中心/标准规范，热工标准限值一并归入
    expect(parentByRoutePath.get("/knowledge/standards")).toBe("/knowledge");
    expect(parentByRoutePath.get("/standard/documents")).toBe("/knowledge/standards");
    expect(parentByRoutePath.get("/standard/indicators")).toBe("/knowledge/standards");
    expect(parentByRoutePath.get("/standard/replacements")).toBe("/knowledge/standards");
    expect(parentByRoutePath.get("/standard/sources")).toBe("/knowledge/standards");
    expect(parentByRoutePath.get("/thermal/standard-limits")).toBe("/knowledge/standards");
    // 企业内容并入系统管理/企业信息
    expect(parentByRoutePath.get("/system/enterprise")).toBe("/system");
    expect(parentByRoutePath.get("/content/profile")).toBe("/system/enterprise");
    expect(parentByRoutePath.get("/content/certificates")).toBe("/system/enterprise");
    expect(parentByRoutePath.get("/content/add")).toBe("/system/enterprise");
    // 系统监控拆分：操作日志挂系统管理，其余挂高级设置
    expect(parentByRoutePath.get("/monitor/audit")).toBe("/system");
    expect(parentByRoutePath.get("/system/advanced")).toBe("/system");
    expect(parentByRoutePath.get("/monitor/online")).toBe("/system/advanced");
    expect(parentByRoutePath.get("/monitor/job")).toBe("/system/advanced");
    expect(parentByRoutePath.get("/monitor/cache")).toBe("/system/advanced");
    // AI 配置 / AI 运营恢复为独立一级菜单，叶子挂各自目录
    expect(parentByRoutePath.get("/ai-config")).toBe(null);
    expect(parentByRoutePath.get("/ai-config/providers")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-config/models")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-config/quick-prompts")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-config/scenes")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-config/prompts")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-config/filters")).toBe("/ai-config");
    expect(parentByRoutePath.get("/ai-ops")).toBe(null);
    expect(parentByRoutePath.get("/ai-ops/conversations")).toBe("/ai-ops");
    expect(parentByRoutePath.get("/ai-ops/feedbacks")).toBe("/ai-ops");
    expect(parentByRoutePath.get("/ai-ops/debug")).toBe("/ai-ops");
    // 计算记录从项目详情进入；审核队列从报告管理/工作台待办进入
    expect(parentByRoutePath.get("/thermal/calc-records")).toBe("/project");
    expect(parentByRoutePath.get("/review-center/queue")).toBe("/reports");
  });

  it("通俗化命名快照：叶子改名后 routePath 不变", () => {
    const nameByRoutePath = new Map(flat().map((item) => [item.node.routePath, item.node.name]));
    const renames: ReadonlyArray<readonly [string, string]> = [
      ["/masterdata/materials", "保温材料库"],
      ["/masterdata/parameter-versions", "材料性能参数"],
      ["/thermal/sets", "图集热工参考表"],
      ["/nodes/drawings", "节点大样图"],
      ["/comparison/versions", "对比规则"],
      ["/products/comparison", "材料对比"],
      ["/standard/documents", "标准文件"],
      ["/standard/indicators", "节能指标"],
      ["/standard/replacements", "新旧标准替代"],
      ["/standard/sources", "标准采集源"],
      ["/knowledge/crawlers", "资料采集源"],
      ["/collection", "采集管理"],
      ["/collection/manual", "手动采集"],
      ["/collection/sources", "自动采集源"],
      ["/collection/tasks", "采集任务"],
      ["/knowledge/quality", "质量与调试"],
      ["/content/certificates", "企业资质"],
      ["/reports/center", "报告列表"],
      ["/reports/settings", "报告设置"],
      ["/monitor/audit", "操作日志"],
      ["/ai-config", "AI 配置"],
      ["/ai-config/providers", "服务商管理"],
      ["/ai-config/prompts", "提示词管理"],
      ["/ai-ops", "AI 运营"],
      ["/ai-ops/conversations", "会话运营"],
      ["/ai-ops/debug", "运营调试"],
      ["/reports", "报告管理"]
    ];
    for (const [routePath, expectedName] of renames) {
      expect(nameByRoutePath.get(routePath)).toBe(expectedName);
    }
  });

  it("权限码回归快照：MENU/BUTTON 的 routePath → permissionCode 迁移前后不变", () => {
    const actual = new Map(
      flat()
        .filter((item) => item.node.menuType !== "DIRECTORY")
        .map((item) => [item.node.routePath, item.node.permissionCode ?? null])
    );
    const expected = new Map<string, string | null>([
      // 项目管理
      ["/project", "project.create"],
      ["/thermal/calc-records", "system:thermal:list"],
      // 产品管理（system:md:product:*）
      ["/products/series", "system:md:product:list"],
      ["/products/specs", "system:md:product:list"],
      ["/products/parameters", "system:md:product:list"],
      ["/products/attachments", "system:md:product:list"],
      ...["series", "specs", "parameters", "attachments"].flatMap((leaf) =>
        ["add", "edit", "remove", "approve", "publish"].map((action) =>
          [`/products/${leaf}/${action}`, `system:md:product:${action}`] as const
        )
      ),
      // 材料与参数（system:md:material:*）
      ["/masterdata/materials", "system:md:material:list"],
      ["/masterdata/parameter-versions", "system:md:material:list"],
      ...["materials", "parameter-versions"].flatMap((leaf) =>
        ["add", "edit", "remove", "approve", "publish"].map((action) =>
          [`/masterdata/${leaf}/${action}`, `system:md:material:${action}`] as const
        )
      ),
      // 构造体系（system:construction:*）
      ["/construction/systems", "system:construction:list"],
      ["/construction/schemes", "system:construction:list"],
      ...["systems", "schemes"].flatMap((leaf) =>
        ["add", "edit", "remove", "approve", "publish"].map((action) =>
          [`/construction/${leaf}/${action}`, `system:construction:${action}`] as const
        )
      ),
      // 热工数据（system:thermal:*）
      ["/thermal/sets", "system:thermal:list"],
      ...["add", "edit", "import", "remove", "approve", "publish"].map((action) =>
        [`/thermal/sets/${action}`, `system:thermal:${action}`] as const
      ),
      ["/thermal/calc-rules", "system:thermal:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/thermal/calc-rules/${action}`, `system:thermal:${action}`] as const
      ),
      // 节点图（system:node:*）
      ["/nodes/drawings", "system:node:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/nodes/drawings/${action}`, `system:node:${action}`] as const
      ),
      // 材料对比（system:comparison:*）
      ["/comparison/versions", "system:comparison:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/comparison/versions/${action}`, `system:comparison:${action}`] as const
      ),
      // 知识资料 / 分类 / 采集源 / 质量与调试（system:knowledge:*）
      ["/knowledge/documents", "system:knowledge:doc:list"],
      ...["add", "edit", "upload", "parse", "approve", "publish", "remove"].map((action) =>
        [`/knowledge/documents/${action}`, `system:knowledge:doc:${action}`] as const
      ),
      ["/knowledge/public-library", "system:knowledge:doc:list"],
      ["/knowledge/categories", "system:knowledge:category:list"],
      ...["add", "edit", "remove"].map((action) =>
        [`/knowledge/categories/${action}`, `system:knowledge:category:${action}`] as const
      ),
      ["/knowledge/crawlers", "system:knowledge:crawler:list"],
      ...["add", "edit", "run", "remove"].map((action) =>
        [`/knowledge/crawlers/${action}`, `system:knowledge:crawler:${action}`] as const
      ),
      ["/collection/manual", "system:collection:manual:create"],
      ["/collection/sources", "system:collection:auto:list"],
      ["/collection/sources/add", "system:collection:auto:create"],
      ["/collection/sources/edit", "system:collection:auto:update"],
      ["/collection/sources/enable", "system:collection:auto:toggle"],
      ["/collection/sources/disable", "system:collection:auto:toggle"],
      ["/collection/tasks", "system:collection:list"],
      ["/collection/tasks/view", "system:collection:task:view"],
      ["/collection/tasks/import", "system:collection:task:import"],
      ["/knowledge/search-test", "system:knowledge:search:answer"],
      ["/knowledge/search-test/answer", "system:knowledge:search:answer"],
      ["/knowledge/search-test/eval-add", "system:knowledge:eval:add"],
      ["/knowledge/search-test/eval-list", "system:knowledge:eval:list"],
      ["/knowledge/search-test/eval-judge", "system:knowledge:eval:judge"],
      ["/knowledge/search-test/chunk-edit", "system:knowledge:debug"],
      ["/knowledge/search-test/chunk-split", "system:knowledge:debug"],
      ["/knowledge/search-test/chunk-merge", "system:knowledge:debug"],
      ["/knowledge/parsing-jobs", "system:knowledge:doc:parse"],
      ["/knowledge/search-test/evaluations", "system:knowledge:eval:list"],
      ["/knowledge/debug", "system:knowledge:debug"],
      // 标准规范（system:standard:*）
      ["/standard/documents", "system:standard:list"],
      ...["add", "edit", "approve", "publish", "remove"].map((action) =>
        [`/standard/documents/${action}`, `system:standard:${action}`] as const
      ),
      ["/standard/indicators", "system:standard:list"],
      ["/standard/indicators/approve", "system:standard:approve"],
      ["/standard/indicators/publish", "system:standard:publish"],
      ["/standard/replacements", "system:standard:list"],
      ["/standard/replacements/add", "system:standard:add"],
      ["/standard/replacements/approve", "system:standard:approve"],
      ["/standard/replacements/remove", "system:standard:remove"],
      ["/standard/sources", "system:standard:list"],
      ["/standard/sources/add", "system:standard:add"],
      ["/standard/sources/edit", "system:standard:edit"],
      ["/standard/sources/run", "system:standard:run"],
      ["/standard/sources/remove", "system:standard:remove"],
      // 标准限值（热工权限码不变）
      ["/thermal/standard-limits", "system:thermal:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/thermal/standard-limits/${action}`, `system:thermal:${action}`] as const
      ),
      // 报告管理（system:report:*）
      ["/reports/center", "system:report:generate"],
      ["/reports/center/review", "system:report:review"],
      ["/reports/settings", "system:report:settings"],
      ["/reports/templates", "system:report:template:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/reports/templates/${action}`, `system:report:template:${action}`] as const
      ),
      // 审核队列（system:review:*）
      ["/review-center/queue", "system:review:list"],
      ["/review-center/queue/approve", "system:review:approve"],
      // AI 配置（独立一级，system:ai:*）
      ["/ai-config/providers", "system:ai:provider:list"],
      ["/ai-config/providers/test-connection", "system:ai:provider:test"],
      ["/ai-config/models", "system:ai:model:list"],
      ["/ai-config/quick-prompts", "system:ai:quick-prompt:list"],
      ["/ai-config/quick-prompts/add", "system:ai:quick-prompt:create"],
      ["/ai-config/quick-prompts/edit", "system:ai:quick-prompt:update"],
      ["/ai-config/quick-prompts/remove", "system:ai:quick-prompt:delete"],
      ["/ai-config/scenes", "system:ai:scene:list"],
      ["/ai-config/prompts", "system:ai:prompt:list"],
      ["/ai-config/prompts/publish", "system:ai:prompt:publish"],
      ["/ai-config/filters", "system:ai:filter:list"],
      // AI 运营（独立一级）
      ["/ai-ops/conversations", "system:ai:conversation:list"],
      ["/ai-ops/feedbacks", "system:ai:feedback:list"],
      ["/ai-ops/feedbacks/handle", "system:ai:feedback:handle"],
      ["/ai-ops/debug", "system:ai:debug:use"],
      // 系统管理
      ["/system/user", "system:user:list"],
      ["/system/role", "system:role:list"],
      ["/system/menu", "system:menu:list"],
      ["/system/dept", "system:dept:list"],
      ["/system/post", "system:post:list"],
      ["/system/dict", "system:dict:list"],
      // 企业信息（普通：查看/编辑/资质 CRUD；审核发布按钮隐藏，权限码保留兼容）
      ["/content/profile", "system:md:enterprise:list"],
      ["/content/certificates", "system:md:enterprise:list"],
      ...["add", "edit", "remove", "approve", "publish"].map((action) =>
        [`/content/${action}`, `system:md:enterprise:${action}`] as const
      ),
      // 高级设置（monitor:*）
      ["/monitor/audit", "monitor:audit:list"],
      ["/monitor/online", "monitor:online:list"],
      ["/monitor/job", "monitor:job:list"],
      ["/monitor/cache", "monitor:cache:list"],
      // AI 对话
      ["/ai", "ai.chat"]
    ]);
    const missing = [...expected.keys()].filter((routePath) => !actual.has(routePath));
    const extra = [...actual.keys()].filter((routePath) => !expected.has(routePath));
    expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    for (const [routePath, permissionCode] of expected) {
      expect({ routePath, permissionCode: actual.get(routePath) }).toEqual({ routePath, permissionCode });
    }
  });

  it("目录权限码不变：系统管理 platform.manage、质量与调试知识检索权限，其余新目录不设权限码", () => {
    const directories = flat().filter((item) => item.node.menuType === "DIRECTORY");
    const withPermission = directories
      .filter((item) => item.node.permissionCode)
      .map((item) => [item.node.routePath, item.node.permissionCode]);
    expect(withPermission).toEqual([
      ["/knowledge/quality", "system:knowledge:search:answer"],
      ["/system", "platform.manage"]
    ]);
  });

  it("MENU 叶子 component 遵循 routePath 约定（除显式特例）", () => {
    const exceptions = new Set(["/project", "/knowledge/search-test/evaluations"]);
    const mismatches = flat()
      .filter((item) => item.node.menuType === "MENU" && !exceptions.has(item.node.routePath))
      .filter((item) => item.node.component !== `${item.node.routePath.slice(1)}/index`)
      .map((item) => `${item.node.routePath} -> ${item.node.component}`);
    expect(mismatches).toEqual([]);
    // 显式特例：检索效果复用 search-test 目录组件；项目管理挂前端真实页面 projects/index
    // AI 配置 / AI 运营叶子 routePath 与前端静态路由一一对应（前端 STATIC_OWNED_PATHS 复用静态页面），component 遵循约定
    expect(flat().find((item) => item.node.routePath === "/knowledge/search-test/evaluations")?.node.component).toBe("knowledge/search-test/evaluations");
    expect(flat().find((item) => item.node.routePath === "/project")?.node.component).toBe("projects/index");
  });
});
