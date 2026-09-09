/**
 * B 端菜单种子纯数据（信息架构 2026-09 瘦身版）。
 *
 * 目标一级菜单：工作台（Admin-Web 静态首页 `/`，不入库）+ 项目管理 / 产品中心 / 知识中心 / 报告管理 / 系统管理。
 * 旧「企业内容 / 基础数据 / 系统构造 / 热工中心 / 材料对比 / 标准政策 / 节点图库 / 系统监控 / 审核中心」一级目录全部废弃。
 *
 * 迁移安全约定：
 * - 叶子 routePath 全部保留（seed 按 routePath upsert，menuId 不变），菜单可见性由 permissionCode 经角色权限关联决定，
 *   移动挂载 / 改名 / 隐藏对角色权限零损失；
 * - 权限码全部沿用各领域原码（system:md:* / system:construction:* / system:thermal:* 等），不做 product:* 重命名；
 * - 后端业务模块（masterdata/construction/thermal/comparison/standard/nodes/review-center/reports/knowledge）保持独立，不合并。
 */

export type MenuSeedNode = {
  menuType: "DIRECTORY" | "MENU" | "BUTTON";
  name: string;
  routePath: string;
  component?: string;
  icon?: string;
  sortOrder: number;
  permissionCode?: string;
  /** 仅隐藏路由设为 false；默认 true */
  visible?: boolean;
  children?: MenuSeedNode[];
};

/** 废弃的旧一级目录 routePath（seed 先迁移 children 到新父目录，再整批删除） */
export const DEPRECATED_MENU_ROUTE_PATHS = [
  "/content",
  "/masterdata",
  "/construction",
  "/thermal",
  "/comparison",
  "/standard",
  "/nodes",
  "/monitor",
  "/review-center"
] as const;

/** 隐藏路由（visible=false、enabled=true，routePath 保留；由工作台待办 / 项目详情等业务入口进入，或待前端补页面后开启） */
export const HIDDEN_MENU_ROUTE_PATHS = [
  "/ai",
  "/thermal/calc-records",
  "/review-center/queue",
  "/monitor/audit",
  "/monitor/online",
  "/monitor/job",
  "/monitor/cache",
  "/monitor/ai"
] as const;

const actionButtons = (
  routePrefix: string,
  actions: ReadonlyArray<{ suffix: string; name: string; permissionCode: string }>
): MenuSeedNode[] =>
  actions.map((action, index) => ({
    menuType: "BUTTON",
    name: action.name,
    routePath: `${routePrefix}/${action.suffix}`,
    sortOrder: (index + 1) * 10,
    permissionCode: action.permissionCode
  }));

/** 常规 CRUD 按钮：add/edit/remove/approve/publish */
const crudButtons = (routePrefix: string, permissionPrefix: string, label: string): MenuSeedNode[] =>
  actionButtons(routePrefix, [
    { suffix: "add", name: `${label}新增`, permissionCode: `${permissionPrefix}:add` },
    { suffix: "edit", name: `${label}编辑`, permissionCode: `${permissionPrefix}:edit` },
    { suffix: "remove", name: `${label}删除`, permissionCode: `${permissionPrefix}:remove` },
    { suffix: "approve", name: `${label}审核`, permissionCode: `${permissionPrefix}:approve` },
    { suffix: "publish", name: `${label}发布`, permissionCode: `${permissionPrefix}:publish` }
  ]);

/** 业务叶子页：component 约定为 `${routePath 去掉首斜杠}/index` */
const leaf = (
  name: string,
  routePath: string,
  sortOrder: number,
  permissionCode: string,
  options: { component?: string; visible?: boolean; children?: MenuSeedNode[] } = {}
): MenuSeedNode => ({
  menuType: "MENU",
  name,
  routePath,
  component: options.component ?? `${routePath.slice(1)}/index`,
  sortOrder,
  permissionCode,
  ...(options.visible === undefined ? {} : { visible: options.visible }),
  ...(options.children === undefined ? {} : { children: options.children })
});

const directory = (
  name: string,
  routePath: string,
  sortOrder: number,
  options: { icon?: string; permissionCode?: string; visible?: boolean; children?: MenuSeedNode[] } = {}
): MenuSeedNode => ({
  menuType: "DIRECTORY",
  name,
  routePath,
  sortOrder,
  ...(options.icon === undefined ? {} : { icon: options.icon }),
  ...(options.permissionCode === undefined ? {} : { permissionCode: options.permissionCode }),
  ...(options.visible === undefined ? {} : { visible: options.visible }),
  ...(options.children === undefined ? {} : { children: options.children })
});

const MENU_SEED_TREE: MenuSeedNode[] = [
  // ===== 项目管理（计算记录作为隐藏路由，从项目详情/智能计算进入）=====
  {
    menuType: "MENU",
    name: "项目管理",
    routePath: "/project",
    component: "project/index",
    sortOrder: 20,
    permissionCode: "project.create",
    children: [
      leaf("计算记录", "/thermal/calc-records", 10, "system:thermal:list", { visible: false })
    ]
  },

  // ===== 产品中心（收纳产品 / 材料 / 构造 / 热工 / 节点 / 对比六类维护入口）=====
  directory("产品中心", "/products", 30, {
    icon: "tdesign:app",
    children: [
      directory("产品管理", "/products/catalog", 10, {
        children: [
          leaf("产品系列", "/products/series", 10, "system:md:product:list", { children: crudButtons("/products/series", "system:md:product", "产品数据") }),
          leaf("产品规格", "/products/specs", 20, "system:md:product:list", { children: crudButtons("/products/specs", "system:md:product", "产品数据") }),
          leaf("产品参数", "/products/parameters", 30, "system:md:product:list", { children: crudButtons("/products/parameters", "system:md:product", "产品数据") }),
          leaf("产品附件", "/products/attachments", 40, "system:md:product:list", { children: crudButtons("/products/attachments", "system:md:product", "产品数据") })
        ]
      }),
      directory("材料与参数", "/products/materials", 20, {
        children: [
          leaf("保温材料库", "/masterdata/materials", 10, "system:md:material:list", { children: crudButtons("/masterdata/materials", "system:md:material", "材料数据") }),
          leaf("材料性能参数", "/masterdata/parameter-versions", 20, "system:md:material:list", { children: crudButtons("/masterdata/parameter-versions", "system:md:material", "材料数据") })
        ]
      }),
      directory("构造体系", "/products/construction", 30, {
        children: [
          leaf("保温系统", "/construction/systems", 10, "system:construction:list", { children: crudButtons("/construction/systems", "system:construction", "构造数据") }),
          leaf("构造方案", "/construction/schemes", 20, "system:construction:list", { children: crudButtons("/construction/schemes", "system:construction", "构造数据") })
        ]
      }),
      directory("热工数据", "/products/thermal", 40, {
        children: [
          leaf("图集热工表", "/thermal/sets", 10, "system:thermal:list", {
            children: actionButtons("/thermal/sets", [
              { suffix: "add", name: "图集热工表新增", permissionCode: "system:thermal:add" },
              { suffix: "edit", name: "图集热工表编辑", permissionCode: "system:thermal:edit" },
              { suffix: "import", name: "图集热工表导入", permissionCode: "system:thermal:import" },
              { suffix: "remove", name: "图集热工表删除", permissionCode: "system:thermal:remove" },
              { suffix: "approve", name: "图集热工表审核", permissionCode: "system:thermal:approve" },
              { suffix: "publish", name: "图集热工表发布", permissionCode: "system:thermal:publish" }
            ])
          }),
          leaf("计算规则", "/thermal/calc-rules", 20, "system:thermal:list", { children: crudButtons("/thermal/calc-rules", "system:thermal", "计算规则") })
        ]
      }),
      directory("节点图", "/products/nodes", 50, {
        children: [
          leaf("节点大样图", "/nodes/drawings", 10, "system:node:list", { children: crudButtons("/nodes/drawings", "system:node", "节点图") })
        ]
      }),
      directory("对比配置", "/products/comparison", 60, {
        children: [
          leaf("对比规则", "/comparison/versions", 10, "system:comparison:list", { children: crudButtons("/comparison/versions", "system:comparison", "对比规则") })
        ]
      })
    ]
  }),

  // ===== 知识中心（标准政策并入标准规范；文件中心待 Admin-Web 实现后接入）=====
  directory("知识中心", "/knowledge", 40, {
    icon: "tdesign:book",
    children: [
      leaf("知识资料", "/knowledge/documents", 10, "system:knowledge:doc:list", {
        children: actionButtons("/knowledge/documents", [
          { suffix: "add", name: "知识资料新增", permissionCode: "system:knowledge:doc:add" },
          { suffix: "edit", name: "知识资料编辑", permissionCode: "system:knowledge:doc:edit" },
          { suffix: "upload", name: "知识资料上传", permissionCode: "system:knowledge:doc:upload" },
          { suffix: "parse", name: "知识资料解析", permissionCode: "system:knowledge:doc:parse" },
          { suffix: "approve", name: "知识资料审核", permissionCode: "system:knowledge:doc:approve" },
          { suffix: "publish", name: "知识资料发布", permissionCode: "system:knowledge:doc:publish" },
          { suffix: "remove", name: "知识资料删除", permissionCode: "system:knowledge:doc:remove" }
        ])
      }),
      directory("标准规范", "/knowledge/standards", 20, {
        children: [
          leaf("标准文件", "/standard/documents", 10, "system:standard:list", { children: crudButtons("/standard/documents", "system:standard", "标准文件") }),
          leaf("节能指标", "/standard/indicators", 20, "system:standard:list", {
            children: actionButtons("/standard/indicators", [
              { suffix: "approve", name: "节能指标审核", permissionCode: "system:standard:approve" },
              { suffix: "publish", name: "节能指标发布", permissionCode: "system:standard:publish" }
            ])
          }),
          leaf("新旧标准替代", "/standard/replacements", 30, "system:standard:list", {
            children: actionButtons("/standard/replacements", [
              { suffix: "add", name: "替代关系新增", permissionCode: "system:standard:add" },
              { suffix: "approve", name: "替代关系确认", permissionCode: "system:standard:approve" },
              { suffix: "remove", name: "替代关系删除", permissionCode: "system:standard:remove" }
            ])
          }),
          leaf("数据来源", "/standard/sources", 40, "system:standard:list", {
            children: actionButtons("/standard/sources", [
              { suffix: "add", name: "数据来源新增", permissionCode: "system:standard:add" },
              { suffix: "edit", name: "数据来源编辑", permissionCode: "system:standard:edit" },
              { suffix: "run", name: "触发站点抓取", permissionCode: "system:standard:run" },
              { suffix: "remove", name: "数据来源删除", permissionCode: "system:standard:remove" }
            ])
          }),
          leaf("标准限值", "/thermal/standard-limits", 50, "system:thermal:list", { children: crudButtons("/thermal/standard-limits", "system:thermal", "标准限值") })
        ]
      }),
      leaf("公开文库", "/knowledge/public-library", 30, "system:knowledge:doc:list"),
      leaf("资料分类", "/knowledge/categories", 40, "system:knowledge:category:list", {
        children: actionButtons("/knowledge/categories", [
          { suffix: "add", name: "资料分类新增", permissionCode: "system:knowledge:category:add" },
          { suffix: "edit", name: "资料分类编辑", permissionCode: "system:knowledge:category:edit" },
          { suffix: "remove", name: "资料分类删除", permissionCode: "system:knowledge:category:remove" }
        ])
      }),
      leaf("数据源管理", "/knowledge/crawlers", 50, "system:knowledge:crawler:list", {
        children: actionButtons("/knowledge/crawlers", [
          { suffix: "add", name: "数据源新增", permissionCode: "system:knowledge:crawler:add" },
          { suffix: "edit", name: "数据源编辑", permissionCode: "system:knowledge:crawler:edit" },
          { suffix: "run", name: "手动同步数据源", permissionCode: "system:knowledge:crawler:run" },
          { suffix: "remove", name: "数据源删除", permissionCode: "system:knowledge:crawler:remove" }
        ])
      }),
      directory("质量检查", "/knowledge/quality", 60, {
        permissionCode: "system:knowledge:search:answer",
        children: [
          leaf("AI 问答测试", "/knowledge/search-test", 10, "system:knowledge:search:answer", {
            children: actionButtons("/knowledge/search-test", [
              { suffix: "answer", name: "知识检索问答", permissionCode: "system:knowledge:search:answer" },
              { suffix: "eval-add", name: "提交检索评测", permissionCode: "system:knowledge:eval:add" },
              { suffix: "eval-list", name: "查看检索评测", permissionCode: "system:knowledge:eval:list" },
              { suffix: "eval-judge", name: "判定检索评测", permissionCode: "system:knowledge:eval:judge" },
              { suffix: "chunk-edit", name: "调整知识分块元数据", permissionCode: "system:knowledge:debug" },
              { suffix: "chunk-split", name: "拆分知识分块", permissionCode: "system:knowledge:debug" },
              { suffix: "chunk-merge", name: "合并知识分块", permissionCode: "system:knowledge:debug" }
            ])
          }),
          leaf("解析异常", "/knowledge/parsing-jobs", 20, "system:knowledge:doc:parse"),
          leaf("检索效果", "/knowledge/search-test/evaluations", 30, "system:knowledge:eval:list", { component: "knowledge/search-test/evaluations" }),
          leaf("高级调试", "/knowledge/debug", 40, "system:knowledge:debug")
        ]
      })
    ]
  }),

  // ===== 报告管理（审核队列保留真实路由，隐藏，从工作台待办进入）=====
  directory("报告管理", "/reports", 50, {
    icon: "tdesign:file-copy",
    children: [
      leaf("报告列表", "/reports/center", 10, "system:report:generate", {
        children: actionButtons("/reports/center", [
          { suffix: "review", name: "报告审核", permissionCode: "system:report:review" }
        ])
      }),
      leaf("报告模板", "/reports/templates", 20, "system:report:template:list", { children: crudButtons("/reports/templates", "system:report:template", "报告模板") }),
      leaf("审核队列", "/review-center/queue", 30, "system:review:list", {
        visible: false,
        children: actionButtons("/review-center/queue", [
          { suffix: "approve", name: "审核决议", permissionCode: "system:review:approve" }
        ])
      })
    ]
  }),

  // ===== 系统管理（企业内容并入企业信息；系统监控并入操作日志 + 高级设置）=====
  directory("系统管理", "/system", 200, {
    icon: "settings",
    permissionCode: "platform.manage",
    children: [
      leaf("用户管理", "/system/user", 10, "system:user:list"),
      leaf("角色管理", "/system/role", 20, "system:role:list"),
      leaf("菜单管理", "/system/menu", 30, "system:menu:list"),
      leaf("部门管理", "/system/dept", 40, "system:dept:list"),
      leaf("岗位管理", "/system/post", 50, "system:post:list"),
      leaf("字典管理", "/system/dict", 60, "system:dict:list"),
      directory("企业信息", "/system/enterprise", 70, {
        children: [
          leaf("企业简介", "/content/profile", 10, "system:md:enterprise:list"),
          leaf("企业资质证书", "/content/certificates", 20, "system:md:enterprise:list"),
          ...crudButtons("/content", "system:md:enterprise", "企业信息")
        ]
      }),
      leaf("AI 配置", "/system/ai", 80, "system:ai:provider:list", {
        component: "ai-config/providers/index",
        children: actionButtons("/system/ai", [
          { suffix: "test-connection", name: "测试服务商连接", permissionCode: "system:ai:provider:test" },
          { suffix: "prompt-publish", name: "提示词发布", permissionCode: "system:ai:prompt:publish" },
          { suffix: "debug", name: "AI 调试", permissionCode: "system:ai:debug:use" },
          { suffix: "filter", name: "对话围栏", permissionCode: "system:ai:filter:list" }
        ])
      }),
      leaf("操作日志", "/monitor/audit", 90, "monitor:audit:list", { visible: false }),
      directory("高级设置", "/system/advanced", 100, {
        children: [
          leaf("在线用户", "/monitor/online", 10, "monitor:online:list", { visible: false }),
          leaf("定时任务", "/monitor/job", 20, "monitor:job:list", { visible: false }),
          leaf("缓存监控", "/monitor/cache", 30, "monitor:cache:list", { visible: false }),
          leaf("AI 运行情况", "/monitor/ai", 40, "system:ai:conversation:list", {
            visible: false,
            children: actionButtons("/monitor/ai", [
              { suffix: "feedback-handle", name: "反馈处理", permissionCode: "system:ai:feedback:handle" }
            ])
          })
        ]
      })
    ]
  }),

  // ===== AI 对话（B 端不再提供一级入口；保留隐藏路由，由权限控制）=====
  leaf("AI 对话", "/ai", 230, "ai.chat", { component: "ai/index", visible: false })
];

/** 返回 B 端菜单种子树（新副本，调用方可安全修改） */
export function buildMenuSeedTree(): MenuSeedNode[] {
  return structuredClone(MENU_SEED_TREE);
}
