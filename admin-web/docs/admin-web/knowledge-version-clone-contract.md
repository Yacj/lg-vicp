# 知识库版本继承（发布后修改）设计

> 目标：让已发布知识库在"发现数据有问题"时，不必从零重建版本，而是**一键派生草稿、只改差异**，同时保证线上问答不中断、审计可追溯、旧版本可回滚。
>
> 边界：不改变现有版本状态机语义（`DRAFT` 仍是唯一可编辑态）；不引入草稿叠加层（draft overlay）；不改识别算法与已确认数据；前端不 Mock 未落地接口。

## 0. 实现状态（2026-10-16）

**后端与前端均已落地。**

| 项 | 状态 |
| --- | --- |
| `POST /versions/:versionId/clone-as-draft` | 已实现（`knowledge-admin.service.ts` → `cloneVersionAsDraft`） |
| 发布顶替 | 既有能力，无需新增参数（见 §3.2） |
| 删除草稿的文件保护 | 已修（见 §4.3） |
| 前端入口 | 详情页「更多 → 修改内容」+ 历史版本抽屉「以此版本修改」 |
| 测试 | 后端 10 例（`knowledge-version-clone.test.ts`）；后端类型检查、知识库全量 391 例、前端类型检查与 760 例全量测试均通过 |

§3.2 / §3.3 / §10 已按实际实现更新，其余章节保留原始契约与决策记录。

## 1. 问题

### 1.1 现状（代码事实）

| 事实 | 位置 |
| --- | --- |
| 版本状态机 `DRAFT → APPROVED → PUBLISHED → DISABLED` | `src/types/knowledge.ts:24` |
| 只有 `DRAFT` 可编辑内容 | `src/views/knowledge/documents/detail.vue:115`、`src/composables/useKnowledgeVersionEditable.ts:42` |
| 后端同口径守卫，非 `DRAFT` 编辑返回 409 | 错误码 `KNOWLEDGE_VERSION_NOT_EDITABLE`（`src/utils/business-error.ts:164`） |
| 已有上下线与回滚，但都不解决"改内容" | `disable` / `enable` / `rollback`（`src/api/modules/knowledge.ts:330`-`342`） |
| 已发布 / 已停用版本已允许"维护式重建索引" | `rebuildVersionIndexMaintenance`（`src/api/modules/knowledge.ts:507`、`KnowledgeOverviewPanel.vue:99`） |

**停用后依然只读**：`DISABLED` 不在可编辑白名单内，`enable` 只恢复发布状态、不开放编辑。因此"停用后可修改"目前**做不到**，需要新增能力。

### 1.2 用户痛点

发布后发现某几页数据有问题 → 只能新建版本 → 新版本**从零重来**（重新上传、解析、逐页识别确认、审核、发布）。

真正麻烦的不是"发新版本"这个动作，而是**重复劳动**。因此方案重心是"内容继承 + 只改差异"，而非"绕过发布流程"。

### 1.3 为什么不能直接放开已发布版本的编辑

| 风险 | 说明 |
| --- | --- |
| 线上一致性 | 该版本正在被 AI 问答检索，编辑中途索引 stale，其他用户可能命中半成品 |
| 审计留痕 | 已发布内容被静默改写，事后追不回"谁改的、改前是什么" |
| 不可回滚 | 原地改覆盖旧内容，改坏无法回退 |

## 2. 方案：版本继承

### 2.1 目标流程

1. 用户在已发布版本上点「修改内容」
2. 后端从该版本克隆出一份新草稿 `v(N+1)`，继承页面图、识别确认结果、章节树、页码映射
3. 前端切到新草稿，用户只改有问题的页
4. 走现有审核 → 发布流程
5. 发布时自动停用旧版本，旧版本留档可回滚

### 2.2 关键取舍：不改编辑守卫

克隆产出的是 `DRAFT`，天然落回现有唯一可编辑态。因此：

- 前端 `versionEditable`（`status === 'DRAFT'`）**零改动**
- `useKnowledgeVersionEditable` **零改动**
- 后端编辑守卫**零改动**

新增能力全部收敛在"克隆"这一个动作上，避免状态机扩散。

## 3. 后端接口契约（必须新增）

### 3.1 克隆版本为草稿

```http
POST /api/v1/platform/knowledge/versions/:versionId/clone-as-draft
Content-Type: application/json

{
  "changeNote": "修正第 12 页导热系数",
  "title": "可选，缺省沿用原版本标题"
}
```

响应：

```jsonc
{
  "documentId": "",
  "versionId": "",
  "version": { /* KnowledgeDocumentVersion，status = DRAFT */ },
  "inherited": {
    "pageCount": 0,
    "recognitionConfirmedCount": 0,
    "tocItemCount": 0,
    "pageMappingCount": 0
  },
  "warnings": []
}
```

约束：

- 源版本状态必须是 `PUBLISHED` 或 `DISABLED`（`DRAFT` / `APPROVED` 直接编辑即可，无需克隆）
- 同文档同时只允许一个 `DRAFT`；已有草稿时返回 `KNOWLEDGE_VERSION_DRAFT_EXISTS`（**建议新增错误码**），前端引导去编辑已有草稿
- 克隆应幂等可防重：前端禁用按钮 + 后端建议请求去重
- `inherited` 用于前端展示"继承了多少内容"，非必须但便于反馈

### 3.2 发布顶替（已具备，无需新增参数）

**实现结论**：`publishVersion` 已经在发布事务内把同文档其他 `PUBLISHED` 版本置为 `DISABLED`，因此克隆草稿发布时天然顶替旧版本，不需要 `replacePublished` 参数：

```ts
await tx.update(knowledgeDocumentVersions)
  .set({ status: "DISABLED", updatedAt: new Date() })
  .where(and(
    eq(knowledgeDocumentVersions.documentId, version.documentId),
    eq(knowledgeDocumentVersions.status, "PUBLISHED")
  ));
```

`KNOWLEDGE_PUBLISHED_VERSION_CONFLICT` 仅出现在 `enableVersion`（重新启用已停用版本）路径，与本方案无关。

### 3.3 workspace 返回口径（已确认）

`findWorkingVersion`（`knowledge-workflow.service.ts:93`）取"同文档非 `DISABLED` 且版本号最大"的版本。因此同时存在 `PUBLISHED v3` 与 `DRAFT v4` 时：

- `currentVersion` 返回 `v4`（`status = DRAFT`）→ 前端克隆后 `refresh()` 自动落到新草稿
- `document.publishedVersionId` 仍指向 `v3`
- 线上问答检索仍只走 `publishedVersionId`

另外：克隆草稿的 `indexStatus = INDEX_PENDING`、`indexDirty = true`，因此 workspace 返回 `canPublish = false` 且 `publishBlockers` 含索引未就绪项 —— 前端会正确提示"需要更新问答内容"，无需额外改门禁。

## 4. 克隆范围

### 4.1 继承

| 类别 | 字段 |
| --- | --- |
| 版本元信息 | `title` / `docType` / `evidenceLevel` / `usageMode` |
| 资产 `assets` | 原文件、可搜索源文件 —— **复用 `fileId`，不复制文件实体** |
| 页面 `pages` | `physicalPageNumber` / `pageLabel` / `pageTitle` / `pageNumber` / `parsedText` / `imageFileId`（复用） |
| 识别结果 | 已确认的 `structuredData` 与确认状态 |
| 章节 | 目录 `toc` 与 `chapter-tree` |
| 页码映射 | `page-mappings`（检索页 ↔ 正式原文页） |

### 4.2 不继承（新版本重建）

- 知识索引 / chunks：带 `versionId` 关联，需在新草稿上重新构建（复用 `rebuildVersionIndex`）
- 解析任务历史、审核 / 发布记录：新版本从 `DRAFT` 起，需重新审核

### 4.3 文件引用约束（重要）

页面图与资产以 `fileId` **复用而非复制**。因此：

- 删除草稿时不能删除被旧版本共用的文件
- **已实现**：`deleteDocumentVersion` 删除前检查该 `fileId` 是否仍被其他版本或 `knowledge_document_assets` 引用；有引用则只删版本行、保留文件与对象存储实体，审计日志记 `fileRetainedForOtherVersions`
- 未引入引用计数表：存在性检查已足够，且 `knowledge_document_assets.file_id` 本身是 `restrict` 外键，误删会被数据库直接拦下

## 5. 前端改造清单

| 文件 | 改动 |
| --- | --- |
| `src/api/modules/knowledge.ts` | 新增 `cloneKnowledgeVersionAsDraft(versionId, input)`；`publishKnowledgeVersion` 增加可选 `replacePublished` |
| `src/types/knowledge.ts` | 新增 `KnowledgeVersionCloneInput` / `KnowledgeVersionCloneResult`；`KnowledgeVersionStatus` 不变 |
| `src/views/knowledge/documents/detail.vue` | `moreActions` 增加「修改内容」（`PUBLISHED` / `DISABLED` 且 `canEdit` 时展示）；克隆成功后 `await refresh()` 自动落到新草稿 |
| `src/components/business/knowledge/KnowledgeVersionDrawer.vue` | 历史版本列表给 `PUBLISHED` / `DISABLED` 版本加「以此版本修改」 |
| `src/composables/useKnowledgeVersionActivation.ts` | 参照 `useConfirmedCrudAction` 模式新增克隆动作（确认弹窗 + 防重） |
| `src/utils/business-error.ts` | 登记新错误码 `KNOWLEDGE_VERSION_DRAFT_EXISTS` 等文案 |
| 发布流程 | 克隆路径发布时传 `replacePublished: true`；若后端不支持则保留"先停用"引导 |

**不改动**：`versionEditable` 判断、`useKnowledgeVersionEditable`、后端编辑守卫。

## 6. 交互细节

- **入口**：详情页右上「更多」→「修改内容」；历史版本抽屉对应版本行「以此版本修改」
- **确认弹窗**：说明"将基于 v3 创建草稿 v4，页面与识别结果会继承，原发布版本继续对外服务"，必填「修改说明」`changeNote`
- **克隆中**：按钮 loading + 文案"正在创建草稿（继承 N 页）"；页面多时耗时，建议同步接口 + 前端超时放宽（参考 `PAGE_IMPORT_TIMEOUT_MS`）
- **克隆后**：提示"已创建草稿 v4，请修改后重新发布"，`refresh()` 落到新草稿，停留在「处理资料」

## 7. 边界与异常

| 场景 | 处理 |
| --- | --- |
| 源版本正在解析 / 识别中 | 禁止克隆，提示等待完成 |
| 同文档已有 `DRAFT` | 返回 `KNOWLEDGE_VERSION_DRAFT_EXISTS`，引导去编辑已有草稿 |
| 重复点击克隆 | 前端按钮禁用；后端建议幂等 |
| 克隆出的草稿被删除 | 不影响原发布版本与共用文件 |
| 克隆后原版本被停用 / 回滚 | 草稿独立存在，不受影响 |
| 无编辑权限 | 不展示入口 |

## 8. 权限

| 动作 | 权限码 |
| --- | --- |
| 克隆草稿入口 | `system:knowledge:doc:edit` |
| 发布顶替 | `system:knowledge:doc:publish` |

建议后端对克隆接口同时校验 `doc:edit` 与源版本所属文档的可见范围。

## 9. 验收标准

1. 已发布版本可一键创建草稿，页面数、已确认识别数、章节数、映射数与源版本一致
2. 草稿可正常编辑页面 / 识别结果 / 章节（现有 `DRAFT` 编辑能力全可用）
3. 草稿发布后旧版本自动 `DISABLED`，线上问答指向新版本
4. 旧版本仍可在历史版本中查看并回滚
5. 克隆全程原发布版本保持可用，无问答中断
6. 删除草稿不影响原版本与其文件

## 10. 实现记录与遗留

### 10.1 已定决策

| 原待确认项 | 结论 |
| --- | --- |
| 独立端点还是复用 `POST /documents/:id/versions` | 独立端点 `POST /versions/:versionId/clone-as-draft`；与 `rollback-to`（仅复制元信息、内容重新解析）语义区分 |
| 同时存在 `PUBLISHED` + `DRAFT` 时 `currentVersion` 口径 | 返回版本号最大的非 `DISABLED` 版本（见 §3.3） |
| 文件引用复用下的删除策略 | 存在性检查 + 保留文件（`deleteDocumentVersion` 已改，见 §4.3） |
| 克隆是否写审计日志 | 写入 `knowledge.version_cloned`，含源版本号与继承统计 |
| 热工确认行是否随版本克隆 | 随 `pages.metadata` 一并继承（`thermalSync` 状态保留），不单独重建正式热工行 |
| 索引（blocks / chunks）是否继承 | 不继承。`rebuildPageDrivenVersionIndex` 会先删该版本的 blocks / chunks 再从页面重建，故克隆只复制页面层 |

### 10.2 遗留

1. **热工正式行的版本归属**：克隆草稿沿用源版本的 `thermalSync` 状态；草稿改页后重新确认会按既有确认流程重新同步正式热工行。该路径依赖 `knowledge-thermal-sync`，未在本次改动范围内。
2. **克隆耗时**：页面数量大时克隆是同步事务，前端沿用请求超时、未加进度反馈。后续如需可改异步任务 + 进度轮询。
3. **`rollback-to` 与 `clone-as-draft` 语义并存**：前者仍是"仅元信息 + 重新解析"，前端当前未使用；后续可评估是否统一。

## 11. 分期与降级

若后端接口短期内无法排期，可先做**过渡方案**：把 `DISABLED` 纳入可编辑白名单（前端 `resolveVersionEditable` 与后端守卫同步放开），改完重新启用。

代价：编辑期间该知识库在问答中不可检索，且需记得重新启用。**定位为过渡方案，不作为终态。**
