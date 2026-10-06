# 采集管理（独立 Domain）

Collection 负责获取外部候选资料，Knowledge 负责管理正式知识资料。二者独立，不把 Collection 做成 Knowledge 子模块。

```
外部资料 / 图集 / 标准
        ↓
    Collection（手动 URL 或 Source + Skill + Agent Loop）
        ↓
     结构化 CollectedRecord（fingerprint 去重）
        ↓
     待确认 WAITING_CONFIRM（手动入库）
        ↓
    Knowledge（DRAFT，走现有解析/审核/发布）
```

P0 两类：`MANUAL` / `AUTO`。不向业务管理员开放 XPath、CSS Selector、Cookie、Header、Proxy、分页规则、Cron。自动采集频率由 Backend 固定，不给业务管理员配置。自动采集结果以结构化记录 + 看板 API 展示，不把静态 HTML 文件当主要展示方式。

## 数据模型

- `collection_skills`：采集技能。字段：名称、`keywordsJson`、`instruction`、启用状态。
- `collection_sources`：自动采集来源。字段：名称、来源 URL、启用状态、`skillId`、`lastRunAt`。
- `collection_runs`：一次 Agent Loop（`runType=COLLECTION`），含 maxSteps/maxPages、visitedUrl、stored/duplicate 计数。
- `collection_records`：结构化采集结果。`fingerprint` 唯一，用于内容去重，避免每日重复计数。
- `collection_tasks`：采集任务（手动下载或自动 Run 的任务壳）。自动任务禁止直接 `PUBLISHED`，也不能被 C 端 AI 正式检索。

## 自动采集 Agent

运行时必须拿到：来源 URL + Skill 关键词 + Skill instruction。

工具抽象（不向管理员暴露选择器；AI SDK `generateText` + `tool()` + `stepCountIs`）：

- `browse_page`：AI 选择下一 URL；Backend 强制同域 / visited / maxPages / 频率 / 重试，返回标题、正文摘要、同域未访问链接
- `save_record`：AI 决定是否保存及结构化字段；Backend 负责 fingerprint、唯一约束、去重和归属写入
- `finish_collection`：AI 决定何时结束

循环上限：`maxSteps`、`maxPages`、`overallTimeout`、单页 timeout。Agent Runtime 与对话共用限制思想，`runType` 区分为 `CHAT | COLLECTION`。AI 不决定跨域是否合法，也不自己做去重或事务。

## API（前缀 `/api/v1/platform/collection`，标签 `B端 / 平台 / 采集管理`）

- `POST /manual`：手动采集（名称、sourceUrl、备注），创建任务后异步下载，完成进入 `WAITING_CONFIRM`。
- `GET/POST /sources`、`PUT /sources/:id`、`POST /sources/:id/enable|disable`：自动来源（可绑 skillId）。
- `GET/POST /skills`、`PUT /skills/:id`：采集技能（关键词 + instruction）。
- `GET /tasks`、`GET /tasks/:id`：任务列表/详情。
- `POST /tasks/:id/import-to-knowledge`：管理员确认后导入 Knowledge，产物始终 `DRAFT`。
- `GET /records`：结构化采集记录（来源名称、关键词、发布时间、采集时间、摘要、状态，来自真实 `collection_records`）。
- `GET /dashboard`：累计总量、今日/本月/今年新增。
- `GET /trends?granularity=day|month|year`：Backend 聚合趋势，不让前端拉全量自行统计。

自动扫描：Worker 启动时用 `upsertJobScheduler` 注册 24h 周期 `scan_sources`，重启幂等，不产生重复 repeat job。来源 DTO 含 `lastRunAt` / `nextScanAt`。

权限码：`system:collection:list|manual:create|auto:{list,create,update,toggle}|skill:{list,create,update}|task:{view,import}|dashboard|record:list`。

旧知识库抓取源 `/api/v1/platform/knowledge/crawler-sources` 与 `knowledge_crawler_sources` 仅 Legacy 兼容，普通菜单已隐藏。
