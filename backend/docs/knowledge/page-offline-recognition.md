# 离线页面切片 + 视觉识别 + 人工确认

正式 DOCX 知识资料默认链路：

```text
Word 原件（Mammoth 全文 RAG 兜底）
+ 本地高保真页面 PNG/JPG（批量或 ZIP）
  → knowledge_pages（幂等 upsert）
  → page-recognition 队列视觉结构化识别（候选）
  → B 端 Draft / Confirm
  → page-aware chunks + thermal_reference_rows（确认后）
  → 版本发布
```

LibreOffice（`DOCX_RENDER_ENABLED`，**默认 false**）仅作 fallback，不是正式入库必经步骤，生产可不装 soffice。

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
| POST | `/versions/:versionId/test-inspect` | `system:knowledge:doc:test` |

既有 `GET /versions/:versionId/pages`、`/pages/window` 继续使用，不另造 page API。

## 识别状态机（`knowledge_pages.metadata`）

`PENDING → PROCESSING → REVIEW_REQUIRED → CONFIRMED`（失败 `FAILED` 可重试）

- 识别完成只写候选 `structuredData`，**不**写正式 `thermal_reference_rows`
- Draft：改候选，不进正式查询
- Confirm：写 page-aware chunks；可选 `thermalSetId` 同步热工行（`sourcePageId`/`sourcePageLabel`）
- Re-recognize：保留 `confirmedStructuredData`，新结果进候选，直到再次 Confirm

## ZIP

- 允许 `page-021.png` 等；可选 `manifest.json`
- 无 manifest：按文件名提 label，physicalPageNumber 按排序序号
- 仅 PNG/JPEG；单图 ≤15MB；宽度 <1200 给 warning

## C 端

不暴露 ZIP/OCR/识别状态。继续消费 `reference_pages` / `sources` / 报告链中的 `pageImageObjectKey`。
