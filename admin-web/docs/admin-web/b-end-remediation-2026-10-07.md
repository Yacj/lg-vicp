# VICP B 端 · 知识库 + 热工 定向收口报告

日期：2026-10-07
范围：仅知识库（图片驱动主链）与热工（参考 / 计算）两条链路，对照最新 Backend 契约。
原则：以后端真实 API 为准；不伪实现后端缺口；不扩大修改范围。

---

## 一、Gap Matrix（Audit 结论）

| 模块 | 当前 B 端 | Backend 现状 | 问题 | 是否修改 |
|---|---|---|---|---|
| 创建知识库 | 强制上传 PDF/DOCX | `POST /documents` 支持无文件创建，同事务自动建首个 DRAFT 版本 | 旧 UI 强制文件，`createKnowledgeDocument` 接口存在但从未调用 | 是 |
| 页面图库 | 网格 + 多图/ZIP 可用 | `batch-upload` / `import-zip` 支持多图与 ZIP | 无上传进度、无总大小/预计页数聚合 | 是 |
| Recognition Review | 两列 + 映射 UI 完整 | `confirm-recognition` 返回 `thermal.{upserted,skipped,warnings,mappingIssues}` | 无批量确认 UI；单页确认忽略 `skipped/warnings` | 是 |
| Batch Confirm | 缺失 | `POST /versions/:id/pages/batch-confirm` 返回 `success/failed/skipped` | 前端未消费 | 是 |
| Version Index | 完全缺失 | `GET /versions/:id/index`、`POST .../index/rebuild`、`.../index/maintenance-rebuild` | 无状态展示、无重建入口 | 是 |
| Publish Gate | 按钮 `v-if="canPublish"` 隐藏 | `workspace.summary.publishBlockers / publishBlockerCodes` 已返回中文原因 | 不展示阻断原因，只提示「发布失败」 | 是 |
| 资料概览 | 无该 Tab | workspace summary + `pageRecognitionSummary` + index | 识别计数前端本地重算；索引/canAskAi 未展示 | 是 |
| Knowledge Test | QA / inspect 已分离，技术字段折叠 | `test-qa`(SSE) / `test-inspect` | 无（本轮未动） | 否 |
| Source 预览 | 多个各自实现的查看器 | `pages/:n/reference-rows`、`ai/knowledge/source-detail` | 无统一 Viewer（本轮未做，见「仍缺」） | 否 |
| 热工计算页 | 选择器齐全，但地区为手输文本 | `POST /thermal/calc`，`regionCode` 可选 | 有原始 JSON；无构造层表；结果卡缺厚度；未标来源类型；地区手输 | 是 |
| 热工参考集 | Draft/Published + 编辑/删除门控正确 | `assertThermalReferenceSetEditable` 仅 DRAFT 可写 | 无（本轮未动） | 否 |
| 热工计算记录 | 列表 + 详情 + raw 快照 | `GET /thermal/calc-records` | 无操作人姓名（后端仅 `createdById`）；项目 ID 为文本输入 | 否（见 Backend Gap） |

---

## 二、Audit Summary

| 链路 | 已有 | 修改 | 仍缺 |
|---|---|---|---|
| 知识库 | 列表/创建/详情/版本/资产/TOC/映射 | 创建支持无文件；新增资料概览 Tab | — |
| Recognition | 两列校验、草稿/确认/重识别、映射下拉 | 批量确认 + 结果三段消费 + 状态筛选 + 失败页跳转 | 快捷键（可选，未做） |
| Index | 无 | 索引状态 + dirty 提示 + 重建（含已发布维护式重建） | — |
| Publish | 门控按钮 | 常显按钮 + 阻断原因面板 | — |
| Knowledge Test | 完整 | — | — |
| Thermal Reference | 参考集/参考行 CRUD 与工作流 | — | 参考集列表未展示来源知识版本（后端 DTO 无字段，见 Backend Gap） |
| Thermal Calculate | 参数选择器 + 结果 | 结果卡（含厚度）、构造层表、计算依据、来源类型、地区选择器 | — |

---

## 三、修改文件

**Types / API**
- `src/types/knowledge.ts` — 新增 `KnowledgeVersionPagesResult`、`KnowledgePageRecognitionSummary`、`KnowledgeVersionIndex`、`KnowledgeIndexRebuildResult`、`BatchConfirmResult`、`BatchConfirmPageResult`、`KnowledgeContentSource`、`KnowledgeIndexStatus`；`workspace.summary` 扩展 `publishBlockers / publishBlockerCodes / contentSource`；`KnowledgePage` 增 `versionEditable / thermalSetEditable`。
- `src/api/modules/knowledge.ts` — 新增 `batchConfirmVersionPages`、`fetchVersionIndex`、`rebuildVersionIndex`、`rebuildVersionIndexMaintenance`；`fetchVersionPages` 返回类型改为 `KnowledgeVersionPagesResult`。

**页面 / 组件**
- `src/components/business/knowledge/KnowledgeCreateDrawer.vue` — 文件改为可选；无文件走 `createKnowledgeDocument`；确认按钮文案随状态变化。
- `src/components/business/knowledge/KnowledgeOverviewPanel.vue`（新增）— 资料概览：流程状态导航、资料状态、识别进度、知识索引（含重建）、发布与 AI 可用性。
- `src/views/knowledge/documents/detail.vue` — 新增「资料概览」Tab 并设为默认；空知识库判定（无文件/无页/无任务）直接进入工作区；发布对话框常显按钮 + 阻断原因面板。
- `src/components/business/knowledge/KnowledgeRecognitionReview.vue` — 批量确认、成功/失败/跳过结果面板与失败页跳转、页面状态筛选、单页确认消费 `skipped/warnings`。
- `src/components/business/knowledge/KnowledgePageGallery.vue` — 批量上传进度条、文件数/预计页数/总大小聚合、空状态 CTA。
- `src/views/thermal/calc/index.vue` — 结果卡（厚度/产品层 R/总热阻 R₀/K）、构造层表、计算依据、来源类型 Badge、地区选择器、JSON 降级为高级折叠。
- `src/utils/thermal-calc.ts` — 新增 `thermalCalcLayerRows`、`thermalCalcSourceLabel`；summary 增 `thicknessMm / interiorSurfaceResistance / exteriorSurfaceResistance`。

---

## 四、Backend API 对接清单（本轮实际使用）

| 用途 | 接口 |
|---|---|
| 无文件创建 | `POST /api/v1/platform/knowledge/documents` |
| 带文件创建 | `POST /api/v1/platform/knowledge/documents/create-with-file` |
| 工作区（summary/canPublish/canAskAi/publishBlockers） | `GET /documents/:id/workspace` |
| 页面列表 + 识别汇总 | `GET /versions/:versionId/pages`（消费 `pageRecognitionSummary`） |
| 单页识别详情 / 草稿 / 确认 | `GET /pages/:pageId/recognition`、`PUT .../recognition-draft`、`POST .../confirm-recognition` |
| 批量确认 | `POST /versions/:versionId/pages/batch-confirm` |
| 识别 / 重识别 | `POST /pages/:pageId/recognize`、`POST .../re-recognize` |
| 页面批量上传 / 排序 / 删除 | `POST /versions/:versionId/pages/batch-upload`、`POST .../pages/reorder`、`DELETE .../pages/:physicalPageNumber` |
| 索引状态 / 重建 | `GET /versions/:versionId/index`、`POST .../index/rebuild`、`POST .../index/maintenance-rebuild` |
| 发布 / 审核 / 停用 | `POST /versions/:versionId/publish`、`/approve`、`/disable` |
| 知识测试 | `POST /versions/:versionId/test-qa`(SSE)、`POST .../test-inspect` |
| 热工计算 | `POST /api/v1/platform/thermal/calc` |
| 地区限值（构造地区选择器） | `GET /api/v1/platform/thermal/standard-limits?status=PUBLISHED` |
| 构造方案 / 产品规格选择器 | `GET /construction`（published schemes）、`GET /masterdata`（published specs） |

未使用（后端存在但前端仍无 UI）：`pages/reconcile-recognition`、`pages/import-zip`（ZIP 目前在前端解包后走 batch-upload）、`index/maintenance-rebuild` 之外无遗漏。

---

## 五、UI / UX 修改说明

1. **普通运营人员的完整闭环**：创建知识库（可不选文件）→ 直接进入详情「资料概览」→ 按流程导航看到「上传资料 → AI 识别 → 内容校验 → 知识索引 → 发布」当前位置 → 页面图库上传图片（有进度、有预计页数）→ 识别校验按状态筛选、批量确认 → 概览里点「重新构建索引」→ 发布按钮此时可用。
2. **为什么这样改**：把「我现在还需要做什么」放在第一屏（流程导航 + 阻断原因），而不是让用户去猜按钮为什么点不动。
3. **发布按钮常显**：隐藏按钮会让用户失去方向；改为常显 + 禁用 + 中文阻断清单。
4. **批量确认**：几十页场景下必须能一次确认安全页，并明确区分成功/失败/跳过，失败页一键跳转。
5. **热工结果分层**：结果卡（4 个关键指标）→ 构造层表 → 计算依据 → 计算过程 → 高级 JSON，公式不再是第一视觉层。

---

## 六、文案调整（技术 → 用户）

| 技术 | 用户侧 |
|---|---|
| `INDEX_PENDING` | 待构建 |
| `INDEXING` | 构建中 |
| `INDEX_READY` | 已就绪 |
| `INDEX_FAILED` | 构建失败 |
| `indexDirty = true` | 页面内容已发生变化，需要更新知识索引。 |
| `REVIEW_REQUIRED` | 待校验 |
| `PAGE_RECOGNITION_BUSY` | 当前页面正在排队或识别，请稍后再试。（由 `knowledgeUserMessage` 统一翻译） |
| `THERMAL_REFERENCE_SET_NOT_EDITABLE` | 当前热工参考集已发布，本次确认不会修改正式热工数据… |
| `publishBlockers[]`（原始 message 已是中文） | 「暂时无法发布 / 还需要完成：• …」 |
| 原始 JSON（热工） | 「技术详情（高级）」折叠 |
| 地区手输 `regionCode`（如 110000） | 地区选择器（显示 `regionName（regionCode）`） |
| `REFERENCE_TABLE` 结果 | Badge「图集参考值」+「直接读取已发布图集参考行，未做插值或重复计算」 |
| `EQUIVALENT / LAYERED` 结果 | Badge「系统计算结果」+「基于当前构造参数和热工规则计算」 |
| `pageLabel` / `physicalPageNumber` | 资料页码 / 文件页序 |

---

## 七、Backend Gap（本轮未伪实现）

1. **参考集来源知识版本**：`thermalSetDto` 只有 `atlasDocumentId`，未返回来源 Knowledge Version / 版本号，B 端无法展示「来源资料版本」。来源页码只在参考行层（`sourcePageLabel`）。→ 需后端在 set 或 row 层补 `sourceVersionId / sourceVersionNo`。
2. **计算记录操作人**：`thermalCalcRecordDto` 仅 `createdById`（UUID），无 `createdByName`，B 端无法展示操作人姓名。→ 需后端 join 用户表补 `createdByName`。
3. **地区字典**：无独立「地区」字典接口，本轮以已发布标准限值的 `regionCode/regionName` 作为选择器数据源（真实数据驱动，非造字段）。若后续需要未设限值的地区，需后端提供地区主数据接口。
4. **发布阻断码**：`workspace.summary.publishBlockers` 已是中文可读字符串（直接消费），`publishBlockerCodes` 为稳定码。未发现 `PUBLISH_BLOCKED` 字面码（发布拦截使用 `KNOWLEDGE_*` 码）。

---

## 八、未修改模块（明确未扩大范围）

工作台、用户管理、组织管理、角色权限、项目管理、普通产品管理、消息、轮播图、财务、订单、报告整体模块、系统设置其他模块、登录、菜单体系、C 端公开文库读取链路、`../backend/` 全部未改动。

---

## 九、验证结果

| 命令 | 结果 |
|---|---|
| `pnpm typecheck`（vue-tsc --noEmit） | ✅ 通过（0 error） |
| `pnpm test`（vitest run） | ✅ 92 files / 653 tests 全部通过 |
| `pnpm build` | ⚠️ 模块转换成功（5169 modules），但 `vite:prepare-out-dir` 清空 `dist/` 时被本机沙箱的批量删除保护拦截（2661 个文件 > 50 阈值）。改用 `vite build --no-emptyOutDir` 验证：✅ 构建成功（41.3s）。沙箱外/CI 正常执行 `pnpm build` 不受影响。 |
| `pnpm lint` | ⚠️ 仓库基线即失败（全库 2467 problems，`system/user`、`system/role`、`system/post` 等与本轮无关文件均报错）。本轮修改文件经 `--quiet` 复核：新增/改动文件已无新增 error（`api/modules/knowledge.ts` 已 `--fix` 至 0 error；`KnowledgeOverviewPanel.vue` 0 error）。`detail.vue`、`KnowledgePageGallery.vue` 残留 error 经 `git show HEAD` 比对确认为改动前既有。 |

---

## 十、本轮仍缺（未做，需确认后再排期）

- 统一 `ReferencePageViewer` 组件（缩放/contain/拖拽/全屏）——当前图库、识别校验、知识测试各自实现，能力不一致（图库预览无全屏）。
- Recognition Review 快捷键（Ctrl/Cmd+S 保存）——可选增强。
- 页面图库网格/列表视图切换。
- 参考集列表展示来源知识版本（依赖 Backend Gap #1）。
- 热工计算记录展示操作人（依赖 Backend Gap #2）。
