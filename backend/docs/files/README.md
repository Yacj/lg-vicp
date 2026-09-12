# 文件资产中心（File Center）

## 定位

文件中心负责"文件本身"（存储、元数据、SHA-256、上传、预览、引用、生命周期），业务模块负责"文件怎么被业务使用"。**不新建第二套文件系统**：`files` 表就是唯一的统一文件资产表（storageProvider/bucket/objectKey 唯一、sha256 索引、source、status、软删除），知识库、企业、产品、构造、节点、热工导入、报告产物等业务表一律只存 `fileId` 引用。

## 统一上传与 SHA-256 去重

- `POST /api/v1/files/upload-intent`（`/upload-intents` 别名）：请求带可选 `sha256`、`purpose`（`GENERAL`/`CHAT_IMAGE`）；命中同哈希且 `status=READY` 的未删除文件时返回 `{ mode: "REUSE", fileId, file }`，不创建 files 行、不预签名；`CHAT_IMAGE` 仅复用 READY 的 JPG/PNG。否则返回 `{ mode: "UPLOAD", uploadUrl, ... }` 走预签名直传。
- `POST /api/v1/files/:id/complete`：校验大小/SHA-256/真实 MIME；`purpose=CHAT_IMAGE` 完成后直接 `READY`，不进入文档/知识/PDF 解析队列。若发现同 SHA-256 的 READY 文件已存在（去重兜底，前端未传哈希场景），本次文件标记 DELETED 并返回 `duplicateOfFileId`，不阻塞、不报错。
- 只按 SHA-256 判重（小写），不按文件名；非交互通道（批量导入/爬虫/内部 API）沿用 `knowledge-ingest.service.assertNoDuplicateSha256` 的拒绝/幂等语义。

## 文件中心 API（B_ADMIN）

| 接口 | 权限 | 说明 |
|---|---|---|
| `GET /api/v1/files` | 登录 B_ADMIN | FilePicker/中心列表：keyword/mimeType/extension/source/status/projectId/createdFrom/createdTo/sort/includeRecycled，轻字段 + `referenceCount`；C 端/PC AI 端同路径保持"我的源文件"口径 |
| `GET /api/v1/files/recent` | B_ADMIN | 最近使用（本人上传时间倒序 READY 文件，≤50） |
| `GET /api/v1/files/:id` | B_ADMIN | 详情（含引用计数），不返回 objectKey/永久 URL |
| `GET /api/v1/files/:id/references` | `file:center:view` | 引用关系聚合（各业务关系表 UNION，业务表仍是唯一事实源） |
| `GET /api/v1/files/:id/preview` | B_ADMIN | PDF/图片内联短期签名 URL（`createPreviewUrl`，inline disposition）；其他类型 `{ mode: "DOWNLOAD" }` |
| `POST /api/v1/files/:id/recycle` | `file:center:manage` | 引用数 > 0 时返回 `error.details.errorCode = "FILE_IN_USE"` + 引用摘要；否则 READY → RECYCLED |
| `POST /api/v1/files/:id/restore` | `file:center:manage` | RECYCLED → READY |
| `DELETE /api/v1/files/:id/permanent` | `file:center:manage` | 仅 RECYCLED 且无引用；一期仅落库标记，OSS 对象由维护任务延迟清理 |

## 引用聚合（FileReferenceService）

`src/modules/files/file-reference.service.ts` 只读聚合以下权威关系表（不建统一 file_references 表、不做第二真相源）：`knowledge_document_assets`（ORIGINAL/SEARCH_SOURCE/OCR_SOURCE/PREVIEW）、`knowledge_document_versions.fileId`（历史版本主文件）、`report_artifacts`、`enterprise_profiles.logoFileId`、`enterprise_certificates`、`product_attachments`、`construction_schemes.drawingFileId`、`node_drawings`（image/cadFileId）、`thermal_import_jobs`、`ai_message_attachments`。列表页引用计数用一次 UNION ALL 分组统计（避免 N+1）。

## 与知识中心的一体化

- 版本创建 `POST /platform/knowledge/documents/:id/versions` 可直接带 `originalFileId` / `searchSourceFileId`（可同一个 fileId，禁止复制 OSS 对象）。
- `POST /versions/:versionId/upload-intent` 支持 `existingFileId`（REUSE，跳过预签名）；随后的 `upload-complete` 对 READY 文件直接绑定（不再重复下载校验哈希），对未就绪文件保持原校验与本人限制。
- 更换正式文件 / AI 识别文件仍走 `bindVersionAsset`（role 级资产行），旧文件不删除，历史版本引用与 AI/报告来源天然可追溯。
- 发布门禁不变：`files.READY ≠ 知识版本 PUBLISHED`；AI_ENABLED 需可检索文本源、TOC/映射校验照旧。

## 尚未切换 FilePicker 的业务

标准管理（爬虫原文存自有 objectKey，非 files 表资产）、主数据/构造/节点的上传入口前端本期未切换（后端已只存 fileId，切换 FilePicker 无需后端改动）。
