# DOCX 页面视觉渲染（LibreOffice Headless）

> **正式知识入库默认已切换为离线页图上传**，见 [`page-offline-recognition.md`](./page-offline-recognition.md)。  
> LibreOffice 链路保留为 **fallback**（`DOCX_RENDER_ENABLED`，默认 `false`），不作为生产必经步骤，不要求服务器安装 soffice。

部署环境（仅在启用 fallback 时）：**Linux 宿主机 + PM2**（非 Docker）。LibreOffice 安装在宿主机，Worker 通过 `soffice --headless` 调用。

## 双通道（fallback）

```text
DOCX（ORIGINAL 仍是 .docx）
├─ Mammoth → parsedText / chunks / RAG（textParsing）
└─ LibreOffice → 临时 PDF → unpdf + pdf-page-renderer
   → knowledge_pages + pageImageObjectKey（pageRendering）
```

正式推荐链路：

```text
DOCX + 离线高保真 PNG
→ Mammoth 文本 +批次/ZIP 页图
→ 视觉识别候选 → 人工确认 → chunks / thermal_reference_rows
```

- Mammoth 成功 + LibreOffice 失败/关闭 → 文档仍可检索；`parsing_jobs.result` 记 `textParsing=READY`、`pageRendering=FAILED|SKIPPED`。
- 页面图强制 **PNG**。

## 环境变量

```env
# 正式入库默认关闭；仅排查/兼容时临时打开
DOCX_RENDER_ENABLED=false
SOFFICE_PATH=/usr/bin/soffice
DOCX_RENDER_TIMEOUT_MS=60000
```

## 代码入口

| 文件 | 职责 |
| --- | --- |
| `src/workers/docx-to-pdf.ts` | soffice 转换 |
| `src/shared/docx-render-errors.ts` | 错误码 |
| `src/workers/document.worker.ts` | `parseDocxDualChannel`（关闭时 SKIPPED） |
| `docs/knowledge/page-offline-recognition.md` | 正式离线页图 + 视觉识别 |

## 验收要点

1. `DOCX_RENDER_ENABLED=true` 且 soffice 可用：DOCX → 文本 + 页图
2. `DOCX_RENDER_ENABLED=false`：文本 READY、`pageRendering=SKIPPED`，需离线上传页图
