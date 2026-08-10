全部数据收集完毕，且已修复检索日志页面的权限码笔误。以下是完整清单。

## 已生成页面清单（28 页，VICP 一期）

**约定**
- 路由挂载：动态路由 `addRoute('AdminRoot', ...)`，component key 即 `src/views` 相对路径（`componentMap` 构建期白名单自动收录）
- 「菜单/列表权限」= 后端 seed 菜单码（也是列表访问码）；「动作权限」= 页面 `canAccess` 实际使用的码
- 全部端点前缀 `/api/v1/platform/*`，工作流统一 `POST /:id/{submit|approve|reject|publish|disable|new-version}`

### 1. 企业内容 `/content`（API `masterdata`，域 `system:md:enterprise`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 企业简介 | `/content/profile` | `content/profile/index` | `system:md:enterprise:list` | add / edit / remove / approve / publish |
| 企业证书 | `/content/certificates` | `content/certificates/index` | 同上 | 同上 |

### 2. 知识中心 `/knowledge`（API `knowledge`，域 `system:knowledge`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 文档资料 | `/knowledge/documents` | `knowledge/documents/index` | `system:knowledge:doc:list` | add / edit / remove（种子另有 upload / parse / approve / publish） |
| 分类管理 | `/knowledge/categories` | `knowledge/categories/index` | `system:knowledge:category:list` | add / edit / remove |
| 别名词典 | `/knowledge/aliases` | `knowledge/aliases/index` | `system:knowledge:alias:list` | add / edit / remove |
| 抓取源 | `/knowledge/crawlers` | `knowledge/crawlers/index` | `system:knowledge:crawler:list` | add / edit / **run** / remove |
| 检索日志 | `/knowledge/search-logs` | `knowledge/search-logs/index` | `system:knowledge:search-log:list` | view（只读） |

### 3. 产品中心 `/products`（API `masterdata`，域 `system:md:product`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 产品系列 | `/products/series` | `products/series/index` | `system:md:product:list` | add / edit / remove / approve / publish |
| 产品规格 | `/products/specs` | `products/specs/index` | 同上 | 同上 |
| 产品参数 | `/products/parameters` | `products/parameters/index` | 同上 | 同上 |
| 产品附件 | `/products/attachments` | `products/attachments/index` | 同上 | 同上 |

### 4. 基础数据 `/masterdata`（API `masterdata`，域 `system:md:material`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 材料库 | `/masterdata/materials` | `masterdata/materials/index` | `system:md:material:list` | add / edit / remove / approve / publish |
| 材料参数版本 | `/masterdata/parameter-versions` | `masterdata/parameter-versions/index` | 同上 | 同上 |

### 5. 系统构造 `/construction`（API `construction`，域 `system:construction`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 保温系统 | `/construction/systems` | `construction/systems/index` | `system:construction:list` | add / edit / remove / approve / publish |
| 构造方案 | `/construction/schemes` | `construction/schemes/index` | 同上 | 同上 |

### 6. 热工中心 `/thermal`（API `thermal`，域 `system:thermal`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 图集参考表 | `/thermal/sets` | `thermal/sets/index` | `system:thermal:list` | add / edit / remove / approve / publish（种子另有 **import**） |
| 计算规则 | `/thermal/calc-rules` | `thermal/calc-rules/index` | 同上 | add / edit / remove / approve / publish |
| 标准限值 | `/thermal/standard-limits` | `thermal/standard-limits/index` | 同上 | 同上 |
| 计算记录 | `/thermal/calc-records` | `thermal/calc-records/index` | `system:thermal:list` | view（只读） |

### 7. 材料对比 `/comparison`（API `comparison`，域 `system:comparison`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 对比版本 | `/comparison/versions` | `comparison/versions/index` | `system:comparison:list` | add / edit / remove / approve / publish |

### 8. 标准政策 `/standard`（API `standard`，域 `system:standard`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 采集来源 | `/standard/sources` | `standard/sources/index` | `system:standard:list` | add / edit / **run** / remove |
| 标准文档 | `/standard/documents` | `standard/documents/index` | 同上 | add / edit / approve / publish / remove |
| 指标管理 | `/standard/indicators` | `standard/indicators/index` | 同上 | approve / publish（只读列表） |
| 替代关系 | `/standard/replacements` | `standard/replacements/index` | 同上 | add / approve / remove |

### 9. 节点图库 `/nodes`（API `nodes`，域 `system:node`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 节点图纸 | `/nodes/drawings` | `nodes/drawings/index` | `system:node:list` | add / edit / remove / approve / publish |

### 10. 报告中心 `/reports`（API `report-templates` + `reports`，域 `system:report`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 报告模板 | `/reports/templates` | `reports/templates/index` | `system:report:template:list` | add / edit / remove / approve / publish |
| 模板报告 | `/reports/center` | `reports/center/index` | `system:report:generate` | review（`system:report:review`） |

### 11. 审核中心 `/review-center`（API `review-center`，域 `system:review`）

| 页面 | 路由 | 组件 key | 菜单/列表权限 | 动作权限 |
| --- | --- | --- | --- | --- |
| 审核队列 | `/review-center/queue` | `review-center/queue/index` | `system:review:list` | approve（`system:review:approve`，统一决议） |

---
