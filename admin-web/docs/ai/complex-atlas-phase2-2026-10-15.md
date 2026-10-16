# 复杂热工图集：阶段 2 B 端审核、问答和来源表

2026-10-15 开始，2026-10-16 收尾。范围限于用户批准的阶段 2；阶段 3 未实施。**结论：PARTIAL。B 端实现及隔离浏览器验证完成，正式 Backend 检索/确认/OSS 联测尚未完成，不满足正式环境完整验收。没有部署、迁移、重新识别业务资料或改写业务数据库。**

## 1. 本阶段结论与真实执行范围

| 项目 | 状态 | 证据与边界 |
| --- | --- | --- |
| v2 草稿编辑保留原标签、工程属性、源列、逐档原文及层关联 | PASS（Fixture） | 三页保存载荷与独立源图夹具比较；38 档不丢失，产品整体 R 均保持 null |
| 屋面无编号、90 页同值双构造、75 页不同基层 | PASS（Fixture/浏览器） | 六个独立构造；屋面 constructionCode=null；C1-3/C1-4 保留原编号与不同基层 |
| 人工审核界面、保存与确认、只读禁用 | PASS（内存 HTTP Fixture） | 使用实际审核组件和原 API 路径；仅模拟确认，thermal.upserted=0，不是数据库确认成功证据 |
| 来源驱动列头、层 R/产品 R/整构造 R 分离 | PASS（组件/浏览器） | 原表三页“外墙主断面”“传热阻 R”原样呈现；不改成屋面主断面或 R₀；缺字段保守退化 |
| 12 行命中比较 + 完整表 + 原图 + 构造/行定位 | PASS（隔离 SSE/浏览器） | 6 次 20/25mm Fixture 问答，12 行 DOM 精确对照；正式后端数值召回 NOT_RUN |
| 第 90 页两组同值、全部档位及重复 event | PASS（Fixture/浏览器/单测） | 一个来源区块、两行比较、12 档全表、两个命中；按 constructionId+optionId 隔离 |
| 第 90 页备注、75 页备注 | PASS（Fixture 展示） | model.notes 保留原文；分别 4 条、2 条，不由模型重写 |
| 原图网络加载、失败与重新取链 | PASS（本地 PNG/模拟 403） | 浏览器实际解码三张 2048×1471 原 PNG；失败有状态、重试、原文件入口；不是实际 OSS 签名过期验收 |
| 不同宽度、长表横向滚动 | PARTIAL | 实测 768/1280/1440 CSS 内容容器；IAB 请求窗口宽度与 innerWidth 有偏差，不能声称精确窗口矩阵全通过 |
| 明暗主题、紧凑密度、完整键盘操作 | NOT_RUN | 本阶段浏览器证据以浅色默认密度为主 |
| 真实模型、正式 Backend HTTP/SSE、隔离数据库确认/发布、实际 OSS | NOT_RUN（本阶段） | 未启动含真实数据写入的业务服务；阶段 1 核心推理证据不可替代本阶段联测 |
| H5/App/小程序、正式 A3 查询、Snapshot/PDF/项目权限业务 UAT | NOT_RUN（本阶段） | 不属于本阶段实现；没有修改 App、Backend 或这些业务数据 |

所有浏览器画面都显示“人工源图基线／隔离协议 Fixture”横幅。服务仅监听 `127.0.0.1:5186`，不连接数据库、Redis、队列或 OSS，不调用模型。测试使用真实 Vue/TDesign 业务组件，HTTP/SSE 响应由本机内存服务生成，不能据此证明自然语言理解、发布授权、正式查表与服务端确认事务可用。

## 2. 改动文件与最小范围理由

以下路径相对 `admin-web/`；未将工作区既有 Backend/App 改动纳入本阶段成果。

| 文件 | 原因及范围 |
| --- | --- |
| `src/types/knowledge.ts`、`src/types/knowledge-page-render.ts` | 对齐阶段 1 已有可选合同，不编造接口；修正旧 rValue 注释的误导 |
| `src/components/business/knowledge/recognition/types.ts` | 草稿编辑态承载来源证据和封闭工程枚举 |
| `src/utils/knowledge-recognition-draft.ts`（新增） | 将旧的有损字段拷贝改为独立纯转换；不计算、不补码，删除层时只重排同组 layerIndex |
| `src/components/business/knowledge/KnowledgeRecognitionReview.vue` | 接入无损草稿转换；显示上次确认人、时间及版本状态；保持原保存、确认和权限入口 |
| `src/components/business/knowledge/recognition/RecognitionThermalSection.vue` | 增加已有工程字段的人工编辑，区分材料层/产品/整构造热阻；编号允许留空 |
| `src/components/business/knowledge/recognition/RecognitionEvidenceSection.vue`（新增） | 原列名称/组名/符号/单位/作用域、原层标签、行标签、原数字与明确层引用编辑；使用 TDesign 控件，不自动匹配材料层 |
| `src/utils/knowledge-document.ts` | 审核预览透传同一份来源字段与 layerValues，不另存一份工程事实 |
| `src/utils/knowledge-construction-table.ts` | 优先依据服务端明确层索引展开厚度档，合并范围只限同构造；不按 R/K/厚度去重 |
| `src/utils/knowledge-thermal-labels.ts`（新增） | 来源列一致才使用其表头；缺失、重复或组间冲突时保守退化；不按部位猜名称 |
| `src/components/business/knowledge/ThermalOptionTable.vue` | 复用 TDesign 全页表；分组显示原标签/属性/基层；芯层 R 只来自同组 layerValues，产品 R 单列；来源驱动列头 |
| `src/components/business/knowledge/KnowledgeStructuredContent.vue` | 提示来源命名差异，可展开各组原列与单位，保留完整备注和待核提示 |
| `src/components/business/knowledge/KnowledgePageViewer.vue` | 恢复原本被注释的结构化展示及权限约束的审核/调试入口；原图传 pageId 以便重新授权 |
| `src/utils/knowledge-answer.ts` | 无编号匹配使用服务端构造/档位 ID 与 answerOffset；同位置同页比较可并列，原有编码兼容路径保留 |
| `src/components/business/knowledge/KnowledgeAnswerMatchSummary.vue`（新增） | 根据有效来源 ID 投影比较表，提供定位入口；不从回答数字反推事实 |
| `src/components/business/knowledge/KnowledgeAnswerReferencePage.vue` | 摘要比较表连接原全表/原图切换与定位 |
| `src/composables/useReferenceHighlight.ts` | 相同来源的重复 SSE 对象更新不重置用户当前位置和高亮开关 |
| `src/components/business/knowledge/KnowledgePageImage.vue`、`KnowledgeOriginalPageViewer.vue` | 复用已有 recognition 读接口重新获取短期原图链接；失败反馈、原文件入口与过期异步响应保护 |
| `src/utils/complex-atlas.test.ts`、`src/components/business/knowledge/KnowledgePageImage.test.ts`（新增） | 三页/38 档/证据保留、同值双身份、删除层隔离、源列退化及原图失败恢复 |
| `KnowledgePageViewer.test.ts`、`KnowledgeTestPanel.test.ts`（同业务组件目录） | 旧页保守表头/热阻分离断言，重复 event 高亮与比较表回归 |
| `src/types/components.d.ts` | 自动生成的两个新增业务组件声明（含对应类型扩展），没有注册第二套 UI 库 |
| `AGENTS.md`、`README.md`、`.cursor/rules/30-page-components.mdc` | 同步无损审核、来源表头及 Fixture 证据边界 |
| 本文与 `docs/ai/evidence/complex-atlas-phase2/` | 固化原图、载荷、RenderModel、截图、日志与未通过清单 |

没有修改 Backend/App、数据库 schema、迁移、Semantic Router、热工引擎、采集 Source/Skill、公开文库、产品、项目权限、报告流程或整体页面主题。

## 3. 接口、数据影响与旧版本回退

真实组件调用链：

```text
KnowledgeRecognitionReview
  → GET /api/v1/platform/knowledge/versions/:versionId/pages
  → GET /api/v1/platform/knowledge/pages/:pageId/recognition
  → copyRecognitionDraft → RecognitionThermalSection / RecognitionEvidenceSection
  → recognitionDraftPayload → PUT /pages/:pageId/recognition-draft
  → POST /pages/:pageId/confirm-recognition（沿用原确认/映射流程）

KnowledgeTestPanel
  → POST /api/v1/platform/knowledge/versions/:versionId/test-qa（SSE）
  → KnowledgeAnswerContent → knowledgeAnswerContent
  → KnowledgeAnswerReferencePage → KnowledgeAnswerMatchSummary
  → KnowledgePageViewer → KnowledgeStructuredContent → ThermalOptionTable
                       → KnowledgePageImage → 原 PNG / 失败后 GET recognition 重取链接
```

简写 `/pages/...` 路径均沿用 `/api/v1/platform/knowledge` 前缀。未新增 API；本阶段仅扩展前端可选类型、编辑与展示，不调整服务器权限门禁。

复用 `schemaVersion=2`、`pageLabelEvidence`；构造的 `rawConstructionLabel/constructionCodeEvidence/applicationPart/roofForm/placement/waterproofGrade/sourceColumns`；层的 `sourceLayerLabel/sourceGroupLabel`；档位的 `sourceRowLabel/fieldEvidence/layerValues`。保存保留已有额外元数据，空编号和档位数值显式 null；可选层数值 null 在编辑时可表示为未填，不会转成 0。I/II 型与防水等级分别编辑；三页缺乏独立完整产品整体 R 的事实不补算。

旧页没有源列时，整构造列显示“整构造传热阻（源文符号待核）”，标准单位只是工程回退，不能冒充原图单位证据。来源字段存在但各组不一致时，公共表头保守退化，用户仍能展开每组原栏目核对。老页已有产品 R 单独展示，不再充当芯层 R；不回写旧页或旧数值。

引用只消费服务端 `pageId/constructionId/optionId/fieldKeys/answerOffset`。两组相同数值保持两身份，前端不生成正式引用 ID。快照变更由阶段 1 hash 产生不同 ID，旧 ID 不绑定新行；没有足够图像坐标时只定位结构化表格，原图打开整页。没有新增跨快照永久 ID 或数据库迁移。

**仍存在阶段 3 前置缺口：**正式 Backend 数值候选准入仍要求构造编号及完整产品 R；无编号屋面和产品 R 为空的资料，不能因本阶段显示正常就宣称可正式数值召回。权限、确认版本及发布准入沿用原服务，草稿不会自动加入 C 端正式知识库。本阶段截图中的确认仅为隔离内存状态。

## 4. 测试证据、截图和失败详情

证据根目录：[complex-atlas-phase2](evidence/complex-atlas-phase2/)。三张原 PNG 只作逐字节复制，无裁切、重画、合并或修改；SHA-256 在 [verification-summary.json](evidence/complex-atlas-phase2/verification-summary.json) 中与阶段 1 基线一致。

### 命令与检查范围

| 命令/检查 | 结果 | 日志 |
| --- | --- | --- |
| `pnpm test --maxWorkers=2` | PASS：109 文件通过、1 跳过；758 测试通过、1 跳过 | [full-test.log](evidence/complex-atlas-phase2/full-test.log) |
| 最终 8 文件定向 `pnpm exec vitest run … --maxWorkers=2` | PASS：42/42；覆盖最后的源列展示、复合行键及重复 event 调整 | [targeted-release.log](evidence/complex-atlas-phase2/targeted-release.log) |
| `pnpm typecheck` | FAIL：9 个既有错误，未扩大任务修复 | [typecheck-release.log](evidence/complex-atlas-phase2/typecheck-release.log) |
| `pnpm build` | FAIL：同 9 个错误，停在 vue-tsc，未完成生产构建 | [build.log](evidence/complex-atlas-phase2/build.log) |
| `pnpm lint` | FAIL：4176 errors、415 warnings；不执行全项目自动修复 | [lint-release.log](evidence/complex-atlas-phase2/lint-release.log) |
| 6 个新增实现/测试文件定向 ESLint | PASS；范围仅新增的两个工具、两个业务组件、两个测试文件 | [new-files-lint-release.log](evidence/complex-atlas-phase2/new-files-lint-release.log) |
| 既有修改文件按实际进入阶段前备份比较 ESLint | 见逐文件差异；不能据此声称这些旧文件全量 lint 通过 | [modified-files-lint-comparison.json](evidence/complex-atlas-phase2/modified-files-lint-comparison.json) |
| Backend 目录执行 `node --import tsx ../admin-web/docs/ai/evidence/complex-atlas-phase2/verify-evidence.mjs` | PASS：三图哈希、6 构造、38 档保存、12 行浏览器 DOM、空产品 R、快照 ID 失效隔离 | [脚本](evidence/complex-atlas-phase2/verify-evidence.mjs)、[输出](evidence/complex-atlas-phase2/verification.log) |
| `git diff --check -- .`（Admin） | PASS，只有 Git 行尾转换提示 | 无部署、无迁移 |
| Backend lint/test/build/db:check、App test/lint/typecheck/build:h5 | NOT_RUN（本阶段） | 本阶段没有修改对应源码；前阶段日志不可算作本阶段执行 |

全量测试发生在最后的小范围收尾前；最终 42 项定向测试及类型检查覆盖收尾版本，之后仅拆开测试文件中三处同一行的 await 语句、整理证据文档，未再次运行约十分钟的全量套件。全量测试的 1 项跳过未算通过。类型/构建失败具体为 `StandardSourcePanel.vue` 八处 row/index 未定义，以及 `src/views/review-center/queue/index.vue:230` 的 `.value` 类型错误，均为阶段 0 已记录的范围外问题。新增六文件 ESLint 无报错不代表全仓通过；最终全仓 lint 比阶段 0 的 4188 errors/389 warnings 仍有差异，保留完整日志，不作全量质量通过声明。

定向测试文件完整清单：`src/utils/complex-atlas.test.ts`、`KnowledgePageImage.test.ts`、`KnowledgePageViewer.test.ts`、`KnowledgeTestPanel.test.ts`（后三个位于 `src/components/business/knowledge/`）、`src/utils/knowledge-answer.test.ts`、`src/utils/knowledge-construction-table.test.ts`、`src/composables/useKnowledgePageViewer.test.ts`、`src/components/business/knowledge/recognition/RecognitionTextSection.test.ts`。

### 12 行精确对照

R 使用原表“传热阻 R”，单位 (m²·K)/W；K 单位 W/(m²·K)。以下 PASS 仅指人工基线、保存载荷及浏览器 DOM 一致，**正式查询召回全为 NOT_RUN**。实际服务端生成的构造/档位 ID 见 verification-summary.json，不以数字组合代替身份。

| 印刷页 | 构造 | 厚度 mm | R | K | 基线/载荷/浏览器 |
| --- | --- | --- | --- | --- | --- |
| 89 | I 型坡屋面正置 | 20 | 5.225 | 0.191 | PASS（Fixture） |
| 89 | I 型坡屋面倒置 | 20 | 5.198 | 0.192 | PASS（Fixture） |
| 89 | I 型坡屋面正置 | 25 | 6.025 | 0.166 | PASS（Fixture） |
| 89 | I 型坡屋面倒置 | 25 | 5.998 | 0.167 | PASS（Fixture） |
| 90 | II 型平屋面正置 | 20 | 5.369 | 0.186 | PASS（Fixture） |
| 90 | II 型平屋面倒置 | 20 | 5.369 | 0.186 | PASS（Fixture） |
| 90 | II 型平屋面正置 | 25 | 6.169 | 0.162 | PASS（Fixture） |
| 90 | II 型平屋面倒置 | 25 | 6.169 | 0.162 | PASS（Fixture） |
| 75 | I 型外墙 C1-3，蒸压灰砂砖 240mm | 20 | 6.916 | 0.145 | PASS（Fixture） |
| 75 | I 型外墙 C1-4，加气混凝土砌块 200mm | 20 | 7.540 | 0.133 | PASS（Fixture） |
| 75 | I 型外墙 C1-3，蒸压灰砂砖 240mm | 25 | 8.516 | 0.117 | PASS（Fixture） |
| 75 | I 型外墙 C1-4，加气混凝土砌块 200mm | 25 | 9.140 | 0.109 | PASS（Fixture） |

38 档全表均保留：89/90 各组 5、10、15、20、25、30mm；75 各组 5、8、10、15、20、25、30mm。没有为本图新增 8mm 屋面档位、假 A/C 编号或用同值 Map 合并正倒置。

### 原始载荷、HTTP/SSE 和图片

- 保存请求：[89](evidence/complex-atlas-phase2/saved-89.json)、[90](evidence/complex-atlas-phase2/saved-90.json)、[75](evidence/complex-atlas-phase2/saved-75.json)。
- 内存确认响应及完整 RenderModel：[89](evidence/complex-atlas-phase2/confirmed-89.json)、[90](evidence/complex-atlas-phase2/confirmed-90.json)、[75](evidence/complex-atlas-phase2/confirmed-75.json)。
- 最后一次 Fixture SSE 内容：[89](evidence/complex-atlas-phase2/last-sse-89.json)、[90](evidence/complex-atlas-phase2/last-sse-90.json)、[75](evidence/complex-atlas-phase2/last-sse-75.json)；[浏览器 12 行 DOM](evidence/complex-atlas-phase2/browser-twelve-rows.json)、[请求日志](evidence/complex-atlas-phase2/requests.log)。SSE 文件是服务端发送前记录的 answer/block，不是原始网络抓包；服务脚本明确发送两次相同 reference_pages 及 done。
- [原 PNG 89](evidence/complex-atlas-phase2/source-page-89.png)、[原 PNG 90](evidence/complex-atlas-phase2/source-page-90.png)、[原 PNG 75](evidence/complex-atlas-phase2/source-page-75.png)。[最终浏览器 DOM 记录](evidence/complex-atlas-phase2/browser-final-state.json)中三图均 complete=true、naturalWidth=2048、naturalHeight=1471；服务器日志记录读取字节，不能单靠该日志替代浏览器加载证据。
- [隔离预览脚本快照](evidence/complex-atlas-phase2/fixture-preview/server.mjs)及同目录 Atlas.vue/main.js/index.html，含本机绝对路径，仅用于复现本阶段审计，未接入产品路由。纯函数复核脚本不启动该服务，也不连接业务库。

### B 端截图索引

| 页/场景 | 审核 | 完整表 | 问答比较 | 原图 |
| --- | --- | --- | --- | --- |
| 89 | [字段](evidence/complex-atlas-phase2/b89-review-fields.jpg)、[源列编辑](evidence/complex-atlas-phase2/b89-source-evidence-editor.jpg)、[逐档证据](evidence/complex-atlas-phase2/b89-row-evidence-editor.jpg)、[内存确认](evidence/complex-atlas-phase2/b89-confirmed.jpg) | [表格](evidence/complex-atlas-phase2/b89-table.jpg) | [问答](evidence/complex-atlas-phase2/b89-qa.jpg) | [原图](evidence/complex-atlas-phase2/b89-original.jpg) |
| 90 | [字段](evidence/complex-atlas-phase2/b90-review-fields.jpg) | [768 容器](evidence/complex-atlas-phase2/b90-768-table.jpg)、[第二构造定位](evidence/complex-atlas-phase2/b90-second-group.jpg) | [最终问答](evidence/complex-atlas-phase2/b90-qa-release.jpg) | [原图](evidence/complex-atlas-phase2/b90-original.jpg) |
| 75 | [字段](evidence/complex-atlas-phase2/b75-review-fields.jpg)、[只读](evidence/complex-atlas-phase2/b75-review-readonly.jpg) | [表格](evidence/complex-atlas-phase2/b75-table.jpg)、[1280 容器](evidence/complex-atlas-phase2/b75-1280-table.jpg) | [问答](evidence/complex-atlas-phase2/b75-qa.jpg) | [原图](evidence/complex-atlas-phase2/b75-original.jpg) |
| 异常 | [图片模拟 403](evidence/complex-atlas-phase2/b-image-failed.jpg) | [重新取链成功](evidence/complex-atlas-phase2/b-image-recovered.jpg) | 重复 SSE 无重复卡已单测及浏览器核验 | 实际 OSS 过期 NOT_RUN |

窄容器表格 clientWidth≈728、scrollWidth≈1100，保留横向滚动和所有档位。`b90-requested1280-actual1910.jpg` 文件明确记录请求 1280 窗口却报告 innerWidth≈1910，不能作精确 1280 窗口证明；最终问答截图时 innerWidth=1491、内容容器≈1280。未伪造设备截图或窗口尺寸。独立全表的横向滚动已验证，完整真实后台壳层与弹窗入口的响应式表现仍需正式联测。

## 5. 下一阶段前置条件及未通过清单

| 根因 | 未通过项/风险 | 下一步边界 |
| --- | --- | --- |
| Backend 检索准入 | 无编号、产品 R 为空的确认页不能据本阶段 Fixture 结果声称正式召回通过 | 阶段 3 经用户批准后，沿用语义决策与结构化检索修复，不加关键词捷径 |
| 识别质量 | 阶段 1 模型仍有编号/符号/防水字形问题，原始输出并非可自动确认事实 | 真实重新识别后必须人工审核，不能自动发布 |
| 人工源图夹具质量 | page-90 正置的 `sourceLayerLabel` 中 LC7.5 层为“4”，而图中为“5”，后续两个砂浆层亦存在序号偏移；界面忠实显示输入，尚未代表源层号全部正确 | 本阶段不静默修改 Backend 夹具/旧数据；后续按原图人工核正，不能以 38 档数字正确替代全部材料标签验收 |
| 实际服务环境 | 正式路由认证、权限、数据库确认/发布、真实检索 SSE 未运行 | 准备隔离库、独立 Redis/OSS 前缀及合法测试身份后再验，不写现有业务库 |
| 图片授权 | 已验证模拟 403 后经现有接口重取链接；实际 OSS 跨域、签名时效和授权撤销未验证 | 在实际浏览器网络联测，不以 Node/服务端 URL 200 代替 |
| UI 覆盖 | 精确窗口、暗色/紧凑/键盘、真实后台壳层尚未全测；原审核缩略图加载失败仍依赖原图查看器重取入口 | 保留 PARTIAL；不要把局部组件截图当全产品视觉通过 |
| 工程质量门禁 | 9 个既有 TS 错误阻塞构建；全仓 lint 仍失败 | 保留日志和范围；另行修复范围外模块，不能声称可直接生产发布 |
| 跨端协议 | App/H5 尚未接入新来源语义，本阶段未改 App DTO/表格 | 阶段 3/4 分别经批准后实施，不单端宣称三端一致 |
| 旧业务实测 | 正式 A3 四基层、权限、CONFIRM、Snapshot、PDF 真实业务回归未执行 | 后续隔离联合 UAT 补齐；现有单测不能代替业务运行证据 |

**发布与重新识别：目前不建议直接发布后端或让 B 端对现有确认页批量重新识别。** 阶段 2 解决了旧编辑器丢失 v2 证据的问题，但正式检索、构建门禁及三端联测尚有缺口。后续若部署，应协调阶段 1 Backend 与本阶段 Admin 的合同兼容，先在隔离环境验证单页“新草稿→人工核对→确认”，不能静默覆盖旧 CONFIRMED 页。发布、迁移或真实业务数据操作没有包含在本阶段执行中。

旧 A3-1 至 A3-4、现有热工参考行、Candidate、SolutionSnapshot、已生成 PDF 均不在本阶段写入范围。没有回填旧结构化 JSON、改动冻结快照、重算旧参数、修改报告原件或权限流程；既有数量以实际库为准，本阶段不宣称为 890 条。

## 6. 停止规则

阶段 2 已按上述 PARTIAL 状态交付，停在当前阶段，等待用户明确批准继续阶段 3。无迁移需要批准；下一阶段若需要真实外部服务或数据写入测试，只使用已验证隔离环境及经授权的凭据。
