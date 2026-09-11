# 文件与异步任务

文件使用预签名直传：申请凭证、上传对象、确认上传、核验大小和真实类型、创建 BullMQ 任务。数据库只保存元数据，不保存二进制。

MinIO 内部连接地址与返回浏览器的预签名公开地址必须分开配置，禁止向客户端返回 Docker 内部主机名。

源文件权限始终为创建者和超级管理员，不随项目公开而公开。删除为逻辑删除，维护任务延迟清理存储对象。

## 文件资产中心（File Center）

`files` 表是唯一文件资产表；业务表只存 `fileId`，文件中心负责"文件本身"，业务模块负责"文件怎么被使用"。详见 `docs/files/README.md`：

- 上传去重：`POST /api/v1/files/upload-intent`（别名 `/upload-intents`）带可选 `sha256`，命中 READY 同哈希文件返回 `{ mode: "REUSE", fileId }`；`/:id/complete` 发现重复内容兜底合并（本次文件标 DELETED，返回 `duplicateOfFileId`），不阻塞上传。只按 SHA-256 判重，不按文件名。
- B_ADMIN FilePicker：`GET /api/v1/files` 全平台 READY 列表（keyword/mimeType/extension/source/sort/分页 + `referenceCount` 轻字段）；`GET /recent` 最近使用；`GET /:id` 详情；`GET /:id/preview` 内联短期签名 URL（`createPreviewUrl`，PDF/图片）或 DOWNLOAD 模式；C 端/PC AI 端同路径保持"我的源文件"口径。
- 引用聚合：`file-reference.service.ts` 只读 UNION 各业务关系表（knowledge_document_assets、report_artifacts、enterprise、product_attachments、construction_schemes、node_drawings、thermal_import_jobs），业务表是唯一事实源，不建统一引用表；回收/永久删除前引用数 > 0 抛 `FILE_IN_USE`（`error.details.references`）。
- 回收站：`fileStatusEnum` 增加 `RECYCLED`（recycledAt/recycledById），`/:id/recycle`、`/:id/restore`、`DELETE /:id/permanent` 走 `file:center:manage` 权限码；FilePicker 列表/详情/预览只需 B_ADMIN 登录。
- 知识中心接入：版本创建可带 `originalFileId`/`searchSourceFileId`（可同一 fileId），`versions/:id/upload-intent` 支持 `existingFileId` 复用，`upload-complete` 对 READY 文件直接绑定；换文件不删旧文件，历史版本引用可追溯。B 端普通新建走 `POST /platform/knowledge/documents/create-with-file`（只收 READY `fileId`，自动 PARSE）；绑定 SEARCH_SOURCE 后在 `NO_TEXT_LAYER`/`SEARCH_SOURCE_REQUIRED` 且已有页面时自动 UPGRADE_PARSE。

文档 Worker：

- PDF 使用 UnPDF，DOCX 使用 Mammoth，XLSX 使用 ExcelJS（每工作表一个页面，表格按行产出结构化 TABLE 分块，metadata 保留行列与合并单元格）；`.doc`/`.xls` 老格式不支持，标记 `OCR_REQUIRED` 并提示转换后重传。
- 保存文档版本、页码、章节和切片序号。
- 可提取文本进入 PostgreSQL 全文索引。
- 图片或无有效文本的 PDF 标记 `OCR_REQUIRED`。
- OCR 适配器未配置前不得伪造文本或标记为成功。
- 知识库版本化链路（`parsing_jobs` + `knowledge_document_versions`）：任务数据含 `parsingJobId` 时走新链路（先删当前版本旧页面/分块再写入，历史版本不动），否则走旧 `async_tasks` 链路兼容存量任务；`CHUNK_REBUILD` 只读页面原文重切，不重读对象存储。`pipelineStatus` 沿 PARSING → CHUNKING → REVIEW_PENDING（失败 FAILED）推进。

知识库多来源入库统一走 `src/modules/knowledge/knowledge-ingest.service.ts`：B 端单文件预签名直传、批量导入（`/imports/batch`）、爬虫（`knowledge_crawler_sources` + maintenance 队列 `knowledge_crawler` 任务）、内部受控 API（`/api/v1/internal/knowledge/ingest`，`x-internal-key` 服务密钥，未配置 `INTERNAL_API_KEY` 时整体禁用）。插入 `files` 前按 SHA-256 查重：命中已发布版本抛 409，命中未发布草稿提示先处理，服务端直写场景幂等跳过。

任务必须具备幂等 Job ID、最多三次指数退避、进度落库、中文错误信息和最终状态。API 不能等待解析或报告导出完成。
