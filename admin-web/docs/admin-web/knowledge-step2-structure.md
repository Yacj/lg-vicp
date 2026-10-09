# Step 2 · 知识库业务组件 / 页面 IA 重构说明

> 范围：`admin-web` 知识库模块（`src/components/business/knowledge/**`、`src/views/knowledge/documents/detail.vue`、`src/composables/useKnowledgeLifecycle.ts`、`src/utils/knowledge-lifecycle.ts`、`src/utils/knowledge-user.ts`）。
> 后端（`../backend`）零改动；热工计算模块留待 Step 3。

---

## 1. 本次要解决的 6 个结构问题

| # | 原状况 | 问题 | 本次做法 |
| --- | --- | --- | --- |
| 1 | detail.vue 自持 workspace 轮询；KnowledgeOverviewPanel 自持 index 轮询；KnowledgeRecognitionReview 自持页面列表轮询 | 同页最多 3 个 setInterval，互不知情，请求风暴且难以统一收敛 | 收敛为**页面级唯一 3s 定时器**（`useKnowledgeLifecycle`），硬 120s 上限 |
| 2 | 状态栏只显示「文本解析 / 页面生成 / 共 N 页」 | 用户看不到识别进度与发布门禁，必须切 Tab 才知道卡在哪 | 新增 `KnowledgeLifecycleBar`，常显于 Tab 之上：页数 + 识别六分项 + 索引状态 + 发布状态与阻断原因 |
| 3 | 概览的流程语义把「AI 识别完成」等同于「全部已确认」 | 识别完成但未校验时，流程条显示自相矛盾 | 语义拆开：识别完成 = 已出结果；内容校验完成 = 全部已确认 |
| 4 | 图库卡片以「上移/下移」为主操作，缺筛选与批量能力 | 页数多时无法定位、无法批量处理；日常调页序挤占主操作位 | 改为缩略图工作台：状态筛选 + 搜索 + 多选批量识别/删除；页序调整收进「高级页序调整」Drawer |
| 5 | 识别校验是单文件巨型表单，保存/识别/确认按钮散落在表单底部 | 长表单下操作按钮滚出视口；告警、映射、草稿编辑混在一起 | 拆为 5 个 Section；**固定底部操作栏**；正式数据映射独立成区 |
| 6 | Knowledge Test 的「高级调试信息」折叠面板对所有人可见 | 无 `system:knowledge:debug` 权限的用户也能看到检索调试细节 | 常规测试 / 高级调试 显式模式分离，调试模式由 `canDebug` 门控 |

---

## 2. 新增 / 删除文件

### 新增

| 文件 | 职责 |
| --- | --- |
| `src/composables/useKnowledgeLifecycle.ts` | 页面级唯一生命周期轮询：workspace / 知识索引 / 识别汇总 |
| `src/utils/knowledge-lifecycle.ts` | 生命周期展示语义纯函数（索引状态、识别分项、流程步骤） |
| `src/components/business/knowledge/KnowledgeLifecycleBar.vue` | 常显生命周期状态条 |
| `src/components/business/knowledge/recognition/types.ts` | 识别草稿类型（`RecognitionDraft` 等）+ 规格类型选项 |
| `src/components/business/knowledge/recognition/RecognitionBasicSection.vue` | 资料页码 / 页面标题 |
| `src/components/business/knowledge/recognition/RecognitionTextSection.vue` | 页面全文 |
| `src/components/business/knowledge/recognition/RecognitionThermalSection.vue` | 构造块 / 构造层 / 参考方案编辑 |
| `src/components/business/knowledge/recognition/RecognitionMappingSection.vue` | 正式构造方案 / 正式产品规格人工映射 |
| `src/components/business/knowledge/recognition/RecognitionWarningsSection.vue` | 识别失败 / 重识别提示 / 映射歧义 / 热工集锁定 / 确认未同步 |

### 删除

| 文件 | 原因 |
| --- | --- |
| `src/components/business/knowledge/KnowledgePageStatusBar.vue` | 由 `KnowledgeLifecycleBar` 取代（并清理 `src/types/components.d.ts` 中的残留声明） |

---

## 3. 轮询架构（后续阶段需沿用）

```
detail.vue
  └── useKnowledgeLifecycle({ documentId, onWorkspace })
        ├── workspace        ← GET documents/:id/workspace
        ├── index            ← GET versions/:id/index
        ├── recognitionSummary ← GET versions/:id/pages?page=1&pageSize=1 → pageRecognitionSummary
        └── 单一 3s 定时器（isBusy 驱动，硬 120s 上限，onUnmounted 清理）

  ├── KnowledgeLifecycleBar       ← :workspace :index :recognition-summary
  ├── KnowledgeOverviewPanel      ← 同上 + :can-rebuild-index，emit('refresh') 触发父层刷新
  ├── KnowledgePageGallery        ← :poll-tick :polling（复用同一节拍刷新自身页面列表）
  └── KnowledgeRecognitionReview  ← :poll-tick :polling + emit('refresh')（提交识别/确认后请求父层刷新）
```

**关键约定**

- 子面板**不得**再自建 `setInterval`；需要跟随刷新时 `watch(() => props.pollTick)`。
- `isBusy` 由三处状态推导（解析中 / 页图生成中 / 索引构建中 / 识别排队或处理中），无进行中任务时自动停机。
- 定时器上限只在窗口开启时设置一次，刷新**不重置**，保证「最多轮询 120s」是硬上限（旧实现每次刷新都重置，实际等于无限轮询）。

---

## 4. 流程语义修正对照

| 步骤 | 旧判定 | 新判定 |
| --- | --- | --- |
| AI 识别 | `confirmed === total` | `pending === 0 && processing === 0 && missingImage === 0`（全部页面已出结果） |
| 内容校验 | `confirmed === total` | `confirmed === total`（不变） |
| 知识索引 | `INDEX_READY && !indexDirty && indexRevision === contentRevision` | 同上，抽为 `isKnowledgeIndexReady()` 供状态条 / 概览 / 门禁共用 |
| 发布 | `summary.canPublish` | 同上（阻断原因只消费后端 `publishBlockers`，前端不自行推断） |

---

## 5. 文案与错误码统一

`src/utils/knowledge-user.ts` 新增：

- `KNOWLEDGE_ERROR_CODE_MESSAGES`：按后端 `error.details.errorCode` 给出确定性文案（`PAGE_RECOGNITION_BUSY`、`KNOWLEDGE_VERSION_NOT_EDITABLE`、`KNOWLEDGE_INDEX_STALE`、`THERMAL_SET_NOT_EDITABLE` 等 13 项）。
- `knowledgeErrorCode(error)`：从 `BusinessError.details.errorCode` 取稳定业务码。
- `knowledgeUserError(error)`：优先按错误码映射，缺失时回退到原有 message 术语替换。

`knowledgeMessageReplacements` 扩充：识别 / 索引状态枚举（`REVIEW_REQUIRED`、`INDEX_READY`、`INDEXING`、`INDEX_PENDING`、`INDEX_FAILED`、`PROCESSING`）与常见业务码裸串。

Step 2 已切换的错误提示：`detail.vue`、`KnowledgePageGallery.vue`、`KnowledgeRecognitionReview.vue`、`KnowledgeOverviewPanel.vue`、`KnowledgeTestPanel.vue`。其余知识库文件（抽屉 / 面板）留待 Step 4 统一迁移。

---

## 6. 交互改动明细

### 6.1 生命周期状态条（常显）

- 资料页数、已确认 / 待校验 / 识别中 / 待识别 / 识别失败 / 缺页面图（全部取自后端 `pageRecognitionSummary`，前端不自行统计）
- 知识索引状态（待构建 / 构建中 / 已就绪 / 需要更新 / 构建失败）+ 过期提示
- 发布状态（已发布 / 可以发布 / 暂不可发布）+ 阻断原因（最多列 3 项，超出显示「等 N 项」）

### 6.2 资料概览

- 五步流程条（上传资料 → AI 识别 → 内容校验 → 知识索引 → 发布）
- 首屏 8 项指标卡：当前版本 / 资料来源 / 资料页数 / 待校验 / 已确认 / 识别失败 / 知识索引 / 发布状态
- 识别进度卡、知识索引卡（含「重新构建索引」）、发布与 AI 可用性卡（含完整阻断原因清单）

### 6.3 页面图库（缩略图工作台）

- 卡片信息：缩略图、系统页序、印刷页码、页面标题、识别状态标签、识别告警 / 失败原因
- 工具条：关键词搜索（标题 / 资料页码 / 页序）、识别状态筛选、全选本页、已选计数
- 批量操作：批量识别（仅未确认页，4 并发）、批量删除（串行，失败即停并汇报已删数）
- 「高级页序调整」Drawer：上移 / 下移后保存，重排系统页序（印刷页码与识别结果不受影响）
- 上传弹窗：明确展示「文件 N 个 · 预计 M 页 · 共 X MB」；ZIP 走 `import-zip` 由后端解包

### 6.4 识别校验

- 五段结构：告警区 → 基础信息 → 页面全文 → 热工结构 → 正式数据映射 → 热工参考集同步
- 固定底部操作栏：保存修改 / 开始识别（或 重试识别 / 重新识别）/ 确认本页 / 确认并下一页
- 批量确认结果：成功 N 页 · 失败 N 页 · 跳过 N 页，可「查看失败页面」「只看待处理页面」

### 6.5 知识库测试

- 常规测试：AI 回答 / 检索类型 / 匹配方案（双 R）/ 引用来源 / 原始页面
- 高级调试（需 `system:knowledge:debug`）：命中文段 / 命中热工行 / 引用页面数；无 AI 回答属正常

---

## 7. 验证结果

| 门禁 | 结果 |
| --- | --- |
| `vue-tsc --noEmit` | ✅ 0 error |
| `vitest run` | ✅ 92 files / 653 tests passed |
| `vite build --no-emptyOutDir` | ✅ built in 2m 08s |
| Step 2 改动文件 ESLint | ✅ 0 error（detail.vue 保留 2 个既有基线 error） |
| 后端改动 | ✅ `git status -- backend` = 0 |

**顺带修复的既有 lint 基线**：`KnowledgePageGallery.vue` 27 → 0，`KnowledgeRecognitionReview.vue` 96 → 0，`detail.vue` 3 → 2。

---

## 8. 遗留与下一阶段

- **后端 Gap（沿用 Step 1 结论）**：`files/upload-intents` 的 mimeType 白名单不含 zip，ZIP 仍走「版本 upload-intent + `upload-complete(PREVIEW)`」取 fileId 再 `import-zip`。建议后端补 ZIP 直传通道。
- 其余知识库文件（`KnowledgeTestDrawer`、`KnowledgeVersionDrawer`、`KnowledgeWorkspaceHeader`、`KnowledgeStructuredDataPanel` 等）的既有 lint 基线与错误提示统一，留待 **Step 4（文案 / 状态 / 空态 / 错误 / 视觉统一）**。
- **Step 3** 将处理热工参考 + 热工计算：`ThermalConditionBuilder`、结果卡双 R、来源回溯、无结果 UX、计算页重排、原始 JSON 收进高级调试。
