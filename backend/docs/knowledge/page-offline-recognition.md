# 离线页面切片 + 视觉识别 + 人工确认 + 版本级正式索引

页面驱动知识版本（`uploadSource ∈ BATCH/ZIP/MANUAL`）的正式链路：

```text
Word 原件（Mammoth 全文 RAG 兜底，可选）
+ 完整页面 PNG/JPG（批量或 ZIP）
  → knowledge_pages（幂等 upsert，recognitionStatus=PENDING）
  → page-recognition 队列视觉结构化识别（候选 draftStructuredData）
  → B 端 Review / Confirm（confirmedStructuredData）
  → 版本级正式索引重建 rebuildPageDrivenVersionIndex
      （knowledge_sections / knowledge_page_blocks / knowledge_chunks）
  → Approve → Publish（indexReady + 完整性校验通过）
  → AI 检索（只读正式索引）→ 原页溯源（chunk.metadata.pageId）
```

LibreOffice（`DOCX_RENDER_ENABLED`，**默认 false**）仅作 fallback，不是正式入库必经步骤，生产可不装 soffice。

> **关键心智模型**：识别完成 ≠ 正式知识可用；单页 Confirm ≠ 正式发布索引。
> 单页 Confirm 只产出「即时 page-aware chunk」用于人工即时测试，并把版本索引置脏；
> 正式发布索引由版本级重建统一产出。

## 接口（B 端 `/api/v1/platform/knowledge`）

| 方法 | 路径 | 权限 |
| --- | --- | --- |
| POST | `/versions/:versionId/pages/batch-upload` | `system:knowledge:page:upload` |
| POST | `/versions/:versionId/pages/import-zip` | `system:knowledge:page:upload` |
| POST | `/pages/:pageId/recognize` | `system:knowledge:page:recognize` |
| POST | `/pages/:pageId/re-recognize` | `system:knowledge:page:recognize` |
| GET | `/pages/:pageId/recognition` | `system:knowledge:doc:list` |
| PUT | `/pages/:pageId/recognition-draft` | `system:knowledge:page:review` |
| POST | `/pages/:pageId/confirm-recognition` | `system:knowledge:page:confirm` |
| POST | `/versions/:versionId/pages/batch-confirm` | `system:knowledge:page:confirm` |
| POST | `/versions/:versionId/index/rebuild` | `system:knowledge:doc:parse` |
| POST | `/versions/:versionId/index/maintenance-rebuild` | `system:knowledge:doc:parse` |
| GET | `/versions/:versionId/index` | `system:knowledge:doc:list` |
| POST | `/versions/:versionId/pages/reconcile-recognition` | `system:knowledge:page:recognize` |
| POST | `/versions/:versionId/test-inspect` | `system:knowledge:doc:test` |

既有 `GET /versions/:versionId/pages`、`/pages/window` 继续使用，不另造 page API。

## 识别状态机（`knowledge_pages.metadata`）

`PENDING → PROCESSING → REVIEW_REQUIRED → CONFIRMED`（失败 `FAILED` 可重试）

- 识别完成只写候选 `structuredData` / `draftStructuredData`，**不**写正式 chunks / `thermal_reference_rows`
- Draft：改候选，不进正式查询；若该页原为 `CONFIRMED`，保存草稿等同识别重置（`CONFIRMED → REVIEW_REQUIRED`），登记 Page Mutation
- Confirm：写 page-aware chunks（即时测试用）；可选 `thermalSetId` 同步热工行（`sourcePageId`/`sourcePageLabel`）；并登记 Page Mutation（`contentRevision++` / `indexDirty=true`）
- Re-recognize：保留 `confirmedStructuredData`，新结果进候选，直到再次 Confirm；若该页原为 `CONFIRMED`，重新识别同样登记 Page Mutation
- 批量确认：**逐页结果**（`success` / `failed` / `skipped`），不存在 all-or-nothing；`confirmSafeOnly=true`（默认）只确认无风险页，风险页进 `skipped`；`false` 尝试确认全部 `REVIEW_REQUIRED` 页，失败页进 `failed`，已成功页不回滚

## 正式正文唯一来源

`resolveFormalPageText(page)`：

- 页面驱动页（离线页图 / 已进入识别流程）：只取 `confirmedStructuredData.fullText`；未确认返回 `null`
- 传统文本页：取 `parsedText`

AI draft / 识别原始输出永不进入正式索引。

## 版本级正式索引重建

`rebuildPageDrivenVersionIndex(versionId)`（`POST /versions/:versionId/index/rebuild`）：

- 读取全部正式可索引页面，按 `physicalPageNumber ASC` 跨页统一解析（章节可跨页延续）
- 生成三层索引：`knowledge_sections` / `knowledge_page_blocks` / `knowledge_chunks`，`chunkIndex` 全局连续
- chunk 关联 `metadata.pageId / physicalPageNumber / pageLabel / documentId / versionId`，`pageAware=true`
- section/block 用 `stableUuid(versionId, kind, key)`，重跑身份稳定
- 仅 DRAFT / APPROVED 版本可重建；`indexStatus`：`INDEX_PENDING → INDEXING → INDEX_READY`（失败 `INDEX_FAILED`）
- **并发一致性（CAS）**：重建开始记录 `startRevision = contentRevision`；最终写入 `INDEX_READY` 使用
  `WHERE id = ? AND content_revision = startRevision`。重建期间发生任何 Page Mutation → 影响行数为 0 →
  本次重建结果整体回滚并置 `INDEX_PENDING + indexDirty=true`，绝不误标 `INDEX_READY`
- 成功时 `indexRevision = contentRevision`（记录「索引基于哪个内容版本构建」）、`indexBuiltAt`、`indexDirty=false`
- `maintenance-rebuild`：内部维护通道，允许对 PUBLISHED / DISABLED 版本重建派生索引；只重建索引，不改 PUBLISHED 正文 / 页面内容字段
- 发布前必须 `indexReady`，且 `indexRevision === contentRevision`

## 页面正式内容 Mutation（统一入口）

`markPageContentMutation(db, versionId)`：`contentRevision += 1`、`indexDirty = true`、
`INDEX_READY / INDEX_FAILED → INDEX_PENDING`（`INDEXING` 保持不降级）。
以下入口全部必须调用，禁止各 Service 各写一套：
`createManualPage`、`deleteManualPage`、`updateManualPage`、`upsertPageImage`、`confirmPageRecognition`、
`batchConfirmPageRecognition`、识别重置（re-recognize / 已确认页保存草稿）、正式正文修改、`reorderManualPages`。

## 失效与一致性

- 换图 / 删页 → `purgePageDerivedIndex`（删该页 chunks、page_blocks、DRAFT 集 thermal rows）→ `markPageContentMutation`
- 改正式正文分两类语义（`textChangeMode`）：
  - `DISPLAY`（默认，只修正错字 / 标点 / 排版）→ 只重建普通索引，**保留** thermal rows 与 `CONFIRMED`
  - `STRUCTURE`（可能改动 system / scheme / productSpec / thickness / productR / totalR / K）→ 旧 thermal row 失效，
    页面回到 `REVIEW_REQUIRED`，必须重新 Review / Confirm 后重新生成热工行
- 禁止出现「`recognitionStatus = CONFIRMED` 但本页应有 Thermal Row 而已被 purge」的中间态
- 换图时 busy 判定统一复用 `isPageRecognitionBusy()`（`PROCESSING`，或 `PENDING + recognitionRunId`）：
  busy 时返回 `PAGE_RECOGNITION_BUSY`（"当前页面正在排队或识别，请稍后重试。"），不依赖 stale reconcile 兜底
- 已发布热工集不可变，其引用行只统计为 `lockedThermalRows`；删页时 `lockedThermalRows > 0` 抛 `PAGE_IN_USE`
- `validatePageDrivenKnowledgeIntegrity(versionId)`：检查 pageCount>0 与 `pageCount` 一致、缺图、未确认、
  孤儿 chunk/block、**真 orphan thermal row**（`sourcePageId` 指向的 `knowledge_pages.id` 已不存在）、
  `indexReady`、`indexRevision === contentRevision`、可检索内容；返回可读中文原因
- Thermal row 跨版本不判 orphan：Document A 的 V1 页留有 thermal row，验证 V2 时 `V1-P22` 不属于 V2 但并非 orphan；
  Version 级热工完整性用 `JOIN knowledge_pages ON p.id = thermal_reference_rows.sourcePageId WHERE p.version_id = ?` 统计
- `reconcilePageRecognitionJobs`：stale 恢复（`PENDING/PROCESSING` 超时 + 队列无 Job → 回退可重新入队）；worker 每 10 分钟自动调度
- `enqueueRecognitionWithRecovery`：逐页入队，失败页回退 `PENDING + recognitionRunId=null`

## 批量上传保护与页序

- `PAGE_BATCH_MAX_ITEMS`（默认 200）、`PAGE_BATCH_MAX_TOTAL_BYTES`（默认 300MB）、`PAGE_BATCH_READ_CONCURRENCY`（默认 4）
- 预检先读文件行（不读 Buffer），再受限并发读取 + 校验 + 上传，读完即释放
- 页序：显式 `physicalPageNumber` 优先；未指定的按 `naturalPageSort()` 文件名自然排序（`page-1 < page-2 < page-10`）
- ZIP：有 `manifest.json` 以 manifest 顺序为显式顺序；无 manifest 自然排序；重复 `physicalPageNumber` 一律 400 拒绝，不静默覆盖
- 仅 PNG/JPEG；单图 ≤15MB；宽度 <1200 给 warning

## C 端

不暴露 ZIP/OCR/识别状态/索引状态。继续消费 `reference_pages` / `sources` / 报告链中的 `pageImageObjectKey`。
