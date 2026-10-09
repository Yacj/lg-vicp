# VICP B 端 · 知识库 + 热工 Gap Matrix（Step 1 审计）

日期：2026-10-08
范围：知识库（图片驱动主链）与热工（参考 / 计算）两条链路，对照最新 Backend 契约逐项核对。
原则：以后端真实 routes / DTO / enum / error code / permission 为准；不伪实现后端缺口；不扩大修改范围。
后端代码仅只读对照，未做任何修改。

---

## 一、Gap Matrix

| 模块 | 当前前端实现 | Backend 现状 | 问题 | 变更 |
|---|---|---|---|---|
| 页面图库 · ZIP 上传 | `KnowledgePageGallery.vue` 用 `fflate.unzipSync` 在浏览器解 ZIP，自行解析 `manifest.json`、自然排序、伪图/路径校验，再逐张走 `batch-upload` | `POST /versions/:versionId/pages/import-zip`（body `{zipFileId, enqueueRecognition?}`，权限 `PAGE_UPLOAD`）已负责 zip bomb / 路径穿越 / manifest / 自然排序 / 重复页码 / 图片校验 | 前端重复实现后端安全校验；主业务链依赖浏览器解包 | 移除 `fflate` 主链；新增 `importVersionPagesFromZip()`；ZIP 直接上传后交后端解包 |
| 页面图库 · 上传后识别 | `batchUploadVersionPages(versionId, items, false)` —— 显式关闭入队，普通用户需再点「批量识别未识别页面」 | `batch-upload` / `import-zip` 的 `enqueueRecognition` 缺省即入队 | 多一次人工操作，违反「上传成功 → 自动入识别队列」 | 默认 `enqueueRecognition: true`；上传后提示已入队 |
| 页面图库 · 识别状态 | `load()` 先拉全量页面，再按每批 8 个并发逐页 `GET /pages/:pageId/recognition`（92 页 = 92 次请求） | `GET /versions/:versionId/pages` 已返回每页 `recognitionStatus / recognitionWarnings / lastRecognitionError` 及 `pageRecognitionSummary` | N+1 请求风暴 | 删除逐页拉取，直接用列表返回字段 |
| 识别校验 · 识别状态 | 同上（`KnowledgeRecognitionReview.load()` 第二处 N+1） | 同上 | N+1 请求风暴 | 删除逐页拉取 |
| 识别校验 · 进度计数 | 前端按 `pages.filter(...)` 自行统计 6 类计数，与概览页口径不一致 | `pageRecognitionSummary` 为唯一事实源 | 口径不一致 | 改用 `pageRecognitionSummary`；「未识别」改为后端口径「缺页面图」 |
| 识别校验 · 热工参考集 | 列出 DRAFT 参考集但不自动选中 | `confirm-recognition` / `batch-confirm` 接受 `thermalSetId` | 唯一参考集仍需人工选择 | 唯一 DRAFT 集自动选中；0 个时明确提示「仅可用于普通知识问答」 |
| 资料概览 · 索引重建权限 | `detail.vue` 传 `:can-rebuild-index="canEdit"`（`system:knowledge:doc:edit`） | `POST /index/rebuild` 与 `/index/maintenance-rebuild` 要求 `KNOWLEDGE_PERMISSIONS.DOC_PARSE`（`system:knowledge:doc:parse`） | 权限码错误：有 edit 无 parse 的用户会看到按钮但 403；有 parse 无 edit 的用户反而看不到 | 改为 `canParse` |
| 知识库测试 / 调试 | 测试 tab 由 `canTest` 门控；调试内容未单独门控 | `test-qa` / `test-inspect` = `DOC_TEST`；chunk 调试 = `DEBUG` | 调试信息可能对普通测试用户可见 | 测试用 `canTest`；高级调试用 `canDebug`（Step 2 落地到面板内） |
| 热工候选 · 查询协议 | `ThermalCandidateQuery` 只发 `targetK`；`buildQuery()` 仅单指标 | `filters[]`（`metric: K\|TOTAL_R\|PRODUCT_R` × `mode: APPROX\|MAX_LIMIT\|MIN_LIMIT\|EXACT` × `targetValue` × `tolerance`，AND，1–12 条）已支持 | 无法表达「K ≤ 0.30 且 总热阻 ≥ 3.30」 | 类型补 `filters/metric/targetValue/mode/tolerance/schemeId/schemeCode/productSpecId/catalogProductId`；面板改为多条件构造 |
| 热工候选 · 来源追踪 | 类型无来源字段；卡片只显示「参考页 atlasPage」 | 候选 DTO 返回 `sourceDocumentId / sourcePageId / sourcePageLabel / catalogProductId` | 无法回溯原始页面 | 类型补来源字段；卡片展示来源资料 + 印刷页码 + 「查看原始页面」 |
| 热工候选 · 多标准 | 只显示 `limit`，`limitCandidates` 未消费 | 多份生效限值时返回 `limitCandidates[]`，须由用户选择 `standardLimitId` | 用户无法选择适用标准 | 面板新增标准选择，选定后以 `standardLimitId` 重查 |
| 热工候选 · 地区 | `regionCode` 为自由文本 `t-input` | `regionCode` 仅用于解析标准限值 | 用户需手输地区编码 | 改为已发布标准限值选择器（`regionName（regionCode）`） |
| 热工候选 · 双 R | 卡片只显示「总热阻」，无「产品层热阻 R」 | `result.productThermalResistance` / `totalThermalResistance` 均返回 | 双 R 混淆 | 卡片区分「产品层热阻 R」与「总热阻 R₀」 |
| 热工候选 · 无结果 | 仅 `t-empty description="没有满足条件的候选方案…"` | `missingConditions` / `NEIGHBOR` 候选已返回 | 无下一步操作 | 无结果给「放宽厚度 / 清除部分条件」；`NEIGHBOR` 明确标注「接近方案（差 N 档）」 |
| 热工计算 · 模式标签 | `utils/thermal-calc.ts` 为「当量导热」，`ThermalCalcRecordPanel.vue` 自建选项为「等效热阻」 | 后端 enum `REFERENCE_TABLE / EQUIVALENT / LAYERED` | 同一 enum 两套文案 | Step 3 统一到单一事实源 |
| 页面查看器 | 图库、识别校验、知识测试各自实现查看器，能力不一致（图库无全屏） | `pages/:n/reference-rows`、`ai/knowledge/source-detail` | 三份重复实现 | Step 3 抽 `KnowledgePageViewer` / `ReferencePageViewer` |
| 类型安全 | 知识库模块无 `any`；热工快照层用 `unknown` / `Record<string, unknown>` 由 `asRecord/asNumber/asText` 收口 | — | 无新增 `any` | 保持；新增类型不引入 `any` |

---

## 二、Backend Gap（本轮未伪实现，需后端确认）

1. **ZIP 无直传通道**：`POST /api/v1/files/upload-intents` 的 `mimeType` 枚举（`file.schemas.ts` `supportedMimeTypes`）**不含 zip**，且 `POST /files/:id/complete` 亦按 `supportedMimeTypes` 校验真实类型（`files.routes.ts:223`）。因此 ZIP 无法经文件中心上传。
   当前前端经 **`POST /versions/:versionId/upload-intent`（接受任意 mimeType）+ `POST /versions/:versionId/upload-complete`（`assetRole: PREVIEW`，仅登记资产行、不改版本主文件）** 取得 READY 的 `zipFileId`，再调 `import-zip`。
   → 建议后端为知识页面 ZIP 提供专用直传通道（或在 `supportedMimeTypes` 放行 zip），避免 B 端依赖 `PREVIEW` 角色绕过。
2. **`import-zip` 为同步返回**：无进度流，大 ZIP 只能前端 loading + 结果提示；识别进度需轮询 `GET /versions/:id/pages` 的 `pageRecognitionSummary`。
3. **热工调试权限码**：后端 `system:thermal:*` 无专用 debug 码，热工原始 JSON 调试区需以 `system:knowledge:debug` 或超管门控（Step 3 落地并复核）。
4. **参考集来源知识版本**（沿用 2026-10-07 报告）：`thermalSetDto` 只有 `atlasDocumentId`，无来源版本号；来源页码仅在参考行层（`sourcePageLabel`）。
5. **计算记录操作人**（沿用 2026-10-07 报告）：`thermalCalcRecordDto` 仅 `createdById`，无 `createdByName`。

---

## 三、Step 1 修改文件

**Types / API**
- `src/types/knowledge.ts` — 新增 `KnowledgeBatchPageUploadResult`、`KnowledgeZipImportItem`、`KnowledgeZipImportResult`。
- `src/api/modules/knowledge.ts` — 新增 `importVersionPagesFromZip()`；`batchUploadVersionPages()` 返回类型补全 `enqueued / enqueueFailed`，`enqueueRecognition` 缺省改为 `true`。
- `src/types/thermal.ts` — 新增 `thermalLookupMetrics / thermalLookupModes / ThermalLookupFilter`；`ThermalCandidateQuery` 增 `filters` 等 9 个字段；`ThermalCandidate` 增来源字段与 `ranking.metric/metricGap`；`ThermalCandidateQueryResult` 补 `filters/lookupMode/kTolerance/...`。

**组件 / 页面**
- `src/components/business/knowledge/KnowledgePageGallery.vue` — 移除 `fflate` 浏览器解包；ZIP 改走后端 `import-zip`；多图上传默认入队；删除 N+1 逐页识别拉取；新增 ZIP 导入结果展示。
- `src/components/business/knowledge/KnowledgeRecognitionReview.vue` — 删除 N+1；计数改用 `pageRecognitionSummary`；唯一 DRAFT 热工参考集自动选中；无参考集提示改为「仅可用于普通知识问答」。
- `src/components/business/thermal/ThermalCandidatePanel.vue` — 条件构造改为多指标 AND → `filters[]`；地区改选择器；`limitCandidates` 标准选择；候选卡补双 R + 来源 + 查看原始页面；无结果给放宽/清除操作。
- `src/views/knowledge/documents/detail.vue` — 索引重建权限 `canEdit` → `canParse`。
- `package.json` — 移除 `fflate` 依赖。

---

## 四、Step 1 验收

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | 见执行记录 |
| `pnpm test` | 见执行记录 |
| `pnpm build` | 见执行记录 |
| `../backend/` 零改动 | 见执行记录 |
