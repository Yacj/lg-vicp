# B 端菜单信息架构（2026-09 瘦身版）

本次调整把 B 端左侧导航从 15 个一级收敛为 8 个一级（工作台由 Admin-Web 静态首页 `/` 承担，不入库；AI 配置与 AI 运营为独立一级菜单）。
后端业务模块（masterdata / construction / thermal / comparison / standard / nodes / review-center / reports / knowledge / files）保持独立，**不合并、不删除**；本次仅调整菜单信息架构。

- 种子数据：`src/db/menu-seed-tree.ts`（纯数据，含结构断言测试 `src/db/menu-seed-tree.test.ts`）
- 菜单树过滤：`src/modules/menus/menu.service.ts`（`getMenuTree` → `buildMenuTreeForPermissions` + `pruneMenuTree`）
- 生效方式：重跑 `pnpm db:seed`，seed 以 `routePath` 为 upsert 冲突键，叶子 routePath 不变即 menuId 不变

## 一、新菜单树

```
工作台（Admin-Web 静态首页 /，Backend 不建菜单）
项目管理 /project（component=projects/index，挂前端真实项目页）
└─ 计算记录 /thermal/calc-records（隐藏，项目详情/智能计算进入）
产品中心 /products
├─ 产品管理 /products/catalog
│  ├─ 产品系列 /products/series
│  ├─ 产品规格 /products/specs
│  ├─ 产品参数 /products/parameters
│  └─ 产品附件 /products/attachments
├─ 材料与参数 /products/materials
│  ├─ 保温材料库 /masterdata/materials
│  └─ 材料性能参数 /masterdata/parameter-versions
├─ 构造体系 /products/construction
│  ├─ 保温系统 /construction/systems
│  └─ 构造方案 /construction/schemes
├─ 热工数据 /products/thermal
│  ├─ 图集热工参考表 /thermal/sets
│  └─ 计算规则 /thermal/calc-rules
├─ 节点图 /products/nodes
│  └─ 节点大样图 /nodes/drawings
└─ 材料对比 /products/comparison
   └─ 对比规则 /comparison/versions
知识中心 /knowledge
├─ 知识资料 /knowledge/documents
├─ 标准规范 /knowledge/standards
│  ├─ 标准文件 /standard/documents
│  ├─ 节能指标 /standard/indicators
│  ├─ 新旧标准替代 /standard/replacements
│  ├─ 标准采集源 /standard/sources
│  └─ 标准限值 /thermal/standard-limits
├─ 公开文库 /knowledge/public-library
├─ 资料分类 /knowledge/categories
├─ 资料采集源 /knowledge/crawlers
└─ 质量与调试 /knowledge/quality（AI 问答测试 / 解析异常 / 检索效果 / 高级调试）
报告管理 /reports
├─ 报告列表 /reports/center
├─ 报告模板 /reports/templates
└─ 审核队列 /review-center/queue（隐藏，工作台待办进入）
AI 配置 /ai-config
├─ 服务商管理 /ai-config/providers（含「测试服务商连接」按钮）
├─ 模型管理 /ai-config/models
├─ 场景配置 /ai-config/scenes
├─ 提示词管理 /ai-config/prompts（含「提示词发布」按钮）
└─ 关键词过滤 /ai-config/filters
AI 运营 /ai-ops
├─ 会话运营 /ai-ops/conversations
├─ 反馈分析 /ai-ops/feedbacks（含「反馈处理」按钮）
└─ 运营调试 /ai-ops/debug
系统管理 /system
├─ 用户管理 /system/user
├─ 角色管理 /system/role
├─ 菜单管理 /system/menu
├─ 部门管理 /system/dept
├─ 岗位管理 /system/post
├─ 字典管理 /system/dict
├─ 企业信息 /system/enterprise
│  ├─ 企业简介 /content/profile
│  └─ 企业资质证书 /content/certificates
├─ 操作日志 /monitor/audit（隐藏，待前端补页面）
└─ 高级设置 /system/advanced
   ├─ 在线用户 /monitor/online（隐藏）
   ├─ 定时任务 /monitor/job（隐藏）
   └─ 缓存监控 /monitor/cache（隐藏）
AI 对话 /ai（隐藏路由，B 端不再提供一级入口）
```

## 二、旧菜单 → 新入口映射

| 旧入口（一级目录） | 新入口 |
| --- | --- |
| 企业内容 /content | 系统管理 / 企业信息 |
| 知识中心 /knowledge | 知识中心（保留，内部重组） |
| 产品中心 /products | 产品中心（新增 6 个二级目录收纳） |
| 基础数据 /masterdata | 产品中心 / 材料与参数 |
| 系统构造 /construction | 产品中心 / 构造体系 |
| 热工中心 /thermal | 图集热工参考表+计算规则 → 产品中心 / 热工数据；标准限值 → 知识中心 / 标准规范；计算记录 → 项目详情（隐藏路由） |
| 材料对比 /comparison | 产品中心 / 材料对比 |
| 标准政策 /standard | 知识中心 / 标准规范 |
| 节点图库 /nodes | 产品中心 / 节点图 |
| 报告中心 /reports | 报告管理（一级改名） |
| 审核中心 /review-center | 工作台待办入口（/review-center/queue 保留为隐藏路由） |
| 系统监控 /monitor | 审计日志 → 系统管理 / 操作日志；其余 → 系统管理 / 高级设置；AI 运营 → 独立一级菜单 /ai-ops |
| AI 对话 /ai | 隐藏路由（B 端不再提供一级入口） |
| AI 配置（原在系统管理下） | 独立一级菜单 /ai-config（服务商/模型/场景/提示词/关键词过滤；旧合并页 /system/ai 由 seed 清理） |

## 三、保留 / 隐藏 / 废弃清单

- **保留 routePath（menuId 不变）**：全部业务叶子与按钮，包括 /masterdata/*、/construction/*、/thermal/*、/comparison/*、/standard/*、/nodes/*、/content/*、/knowledge/*、/reports/*、/review-center/queue、/monitor/*、/system/*、/ai-config/*、/ai-ops/*。
- **隐藏路由（visible=false、enabled=true，7 条）**：/ai、/thermal/calc-records、/review-center/queue、/monitor/audit、/monitor/online、/monitor/job、/monitor/cache。前端静态注册后即可访问，页面补齐后由菜单管理开启 visible。
- **废弃菜单记录（seed 删除，9 条旧一级目录）**：/content、/masterdata、/construction、/thermal、/comparison、/standard、/nodes、/monitor、/review-center。删除前子项已在同事务内重挂到新父目录；另有旧按钮残留（/construction/add 等 19 条 2026-08 清理清单）继续由 seed 清除。
- **已被替代 / 残留菜单清理（seed 删除，`LEGACY_MENU_ROUTE_PATHS`）**：/report/index、/projects 为早期 seed 残留幽灵菜单（与新菜单重名、permissionCode 为空，曾导致 `/api/v1/auth/b/getRouters` 返回重复菜单）；/system/ai 为旧「AI 配置」合并页、/monitor/ai 为旧「AI 运行情况」隐藏页（AI 配置 /ai-config、AI 运营 /ai-ops 恢复为独立一级菜单，叶子挂 `system:ai:*` 权限码，修复早期对所有角色可见的问题）；/ai-config/prompt 为旧提示词路径（统一为 /ai-config/prompts，对齐前端静态路由）。seed 只删顶级节点，子菜单由悬空节点兜底清理移除。
- **悬空节点兜底清理**：seed 末尾循环删除 parentId 指向不存在菜单的节点（menus.parentId 无外键约束），同时兜住历史遗留孤儿节点与上述级联悬空，清理数量打印到 seed 日志。

## 四、menuId 与角色权限影响

- 本仓库无 role_menus 表：菜单可见性由 `menus.permissionCode` 经 `rolePermissions` 关联决定（`menu.service.getPermissionCodes`）。
- 叶子 routePath 不变 → seed upsert 后 menuId 不变 → 角色权限关联零损失。
- 权限码全部沿用（system:md:*、system:construction:*、system:thermal:*、system:comparison:*、system:standard:*、system:node:*、system:review:*、system:ai:* 等），未做 product:* 重命名。
- AI 配置 / AI 运营一级目录不设权限码，叶子按 `system:ai:*` 精确授权（仅平台管理员/超级管理员可见）；叶子 routePath 与 Admin-Web 静态路由（STATIC_OWNED_PATHS）一一对应，动态菜单直接复用静态页面。
- `pruneMenuTree` 已升级为子树递归判断：目录子树（含嵌套目录）中存在 MENU 即保留，杜绝三级结构下的空壳/误裁。

## 五、Migration / Seed 兼容

- 无 schema 变更，不需要 drizzle migration。
- 存量环境重跑 `pnpm db:seed` 即幂等生效；全程单事务（先删废弃目录与早期幽灵菜单 → 先父后子 upsert 新树 → 悬空节点兜底清理），失败自动回滚。
- 新目录（/products/catalog 等 9 个）为全新 routePath、新 menuId，自身无 permissionCode，无角色关联损失。

## 六、Admin-Web 同步清单

1. 静态注册隐藏路由（随页面实现逐个开启）：`/review-center/queue`、`/ai`、`/thermal/calc-records`、`/monitor/audit|online|job|cache`。
2. 系统监控页面（views/monitor/**）当前缺失，实现后由菜单管理开启 visible。
3. 文件中心页面实现后，在知识中心下新增 `/files` 菜单（permissionCode `file:center:view`；本次未 seed，避免不可用页面）。
4. 确认侧边栏支持三级目录渲染（产品中心下 6 个二级目录各带叶子）。
5. 页面内写死的标题/面包屑与新菜单名对齐：模板报告→报告列表、图集参考表→图集热工参考表、材料库→保温材料库、材料参数版本→材料性能参数、节点图纸→节点大样图、对比版本→对比规则、标准文档→标准文件、指标管理→节能指标、替代关系→新旧标准替代、采集来源→标准采集源、企业证书→企业资质证书、审计日志→操作日志、AI 运营→AI 运行情况、报告中心→报告管理。
6. 工作台"我的待办 / 待审核"需要 Dashboard 聚合 API（本次未实现，建议 `GET /api/v1/platform/dashboard/summary`：待审数、最近项目、最近报告、资料异常、AI 用量概览）。
7. AI 配置 / AI 运营页面已由静态路由承载（/ai-config/*、/ai-ops/*），后端菜单同名路径直接复用静态页面；工作台首页不再提供「AI 与系统」聚合面板，AI 入口经侧栏一级菜单进入；报告管理内嵌"报告审核"入口。

## 七、AI 辅助录入边界（本次信息架构调整配套约定）

- 标准规范：上传/采集 → AI 提取（地区/建筑类型/部位/指标/限值/生效日期/替代标准）→ 结构化草稿 → 人工校对 → 审核 → 发布 → 热工/推荐消费正式数据。AI 提取结果不得直接进入正式计算。
- 产品/图集：AI 辅助提取产品参数、图集热工参考表、构造信息草稿 → 人工确认 → 走既有产品/构造/热工审核发布流程。
- 材料对比：AI 可从已审核知识资料辅助生成对比规则草稿与证据引用；项目正式材料对比只消费已审核 + 已发布的 comparison 数据。
