# 文件与异步任务

文件使用预签名直传：申请凭证、上传对象、确认上传、核验大小和真实类型、创建 BullMQ 任务。数据库只保存元数据，不保存二进制。

MinIO 内部连接地址与返回浏览器的预签名公开地址必须分开配置，禁止向客户端返回 Docker 内部主机名。

源文件权限始终为创建者和超级管理员，不随项目公开而公开。删除为逻辑删除，维护任务延迟清理存储对象。

文档 Worker：

- PDF 使用 UnPDF，DOCX 使用 Mammoth，XLSX 使用 ExcelJS（每工作表一个页面，表格按行产出结构化 TABLE 分块，metadata 保留行列与合并单元格）；`.doc`/`.xls` 老格式不支持，标记 `OCR_REQUIRED` 并提示转换后重传。
- 保存文档版本、页码、章节和切片序号。
- 可提取文本进入 PostgreSQL 全文索引。
- 图片或无有效文本的 PDF 标记 `OCR_REQUIRED`。
- OCR 适配器未配置前不得伪造文本或标记为成功。
- 知识库版本化链路（`parsing_jobs` + `knowledge_document_versions`）：任务数据含 `parsingJobId` 时走新链路（先删当前版本旧页面/分块再写入，历史版本不动），否则走旧 `async_tasks` 链路兼容存量任务；`CHUNK_REBUILD` 只读页面原文重切，不重读对象存储。`pipelineStatus` 沿 PARSING → CHUNKING → REVIEW_PENDING（失败 FAILED）推进。

知识库多来源入库统一走 `src/modules/knowledge/knowledge-ingest.service.ts`：B 端单文件预签名直传、批量导入（`/imports/batch`）、爬虫（`knowledge_crawler_sources` + maintenance 队列 `knowledge_crawler` 任务）、内部受控 API（`/api/v1/internal/knowledge/ingest`，`x-internal-key` 服务密钥，未配置 `INTERNAL_API_KEY` 时整体禁用）。插入 `files` 前按 SHA-256 查重：命中已发布版本抛 409，命中未发布草稿提示先处理，服务端直写场景幂等跳过。

任务必须具备幂等 Job ID、最多三次指数退避、进度落库、中文错误信息和最终状态。API 不能等待解析或报告导出完成。
