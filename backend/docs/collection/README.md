# 采集管理（独立 Domain）

Collection 负责获取外部候选资料，Knowledge 负责管理正式知识资料。二者独立，不把 Collection 做成 Knowledge 子模块。

```
外部资料 / 图集 / 标准
        ↓
    Collection
        ↓
     待确认 WAITING_CONFIRM
        ↓
    Knowledge（DRAFT，走现有解析/审核/发布）
```

P0 仅两类：`MANUAL` / `AUTO`。不开放 XPath、CSS Selector、Cookie、Header、Proxy、分页规则、Cron、字段映射。自动采集频率由 Backend 固定 24 小时，不给业务管理员配置。

## 数据模型

- `collection_sources`：自动采集来源，字段仅名称、来源地址、启用状态、最近采集时间。
- `collection_tasks`：采集任务。自动任务禁止直接 `PUBLISHED`，也不能被 C 端 AI 正式检索。

## API（前缀 `/api/v1/platform/collection`，标签 `B端 / 平台 / 采集管理`）

- `POST /manual`：手动采集，创建任务后异步下载，完成进入 `WAITING_CONFIRM`。
- `GET/POST /sources`、`PUT /sources/:id`、`POST /sources/:id/enable|disable`：自动来源。
- `GET /tasks`、`GET /tasks/:id`：任务列表/详情，筛选 `mode/status/keyword`。
- `POST /tasks/:id/import-to-knowledge`：管理员确认后导入 Knowledge，复用 `create-with-file` 默认值，产物始终 `DRAFT`。

权限码：`system:collection:list|manual:create|auto:{list,create,update,toggle}|task:{view,import}`。

旧知识库抓取源 `/api/v1/platform/knowledge/crawler-sources` 与 `knowledge_crawler_sources` 仅 Legacy 兼容，普通菜单已隐藏。
