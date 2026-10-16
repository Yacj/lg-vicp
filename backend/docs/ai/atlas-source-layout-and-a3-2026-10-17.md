# 复杂图集表格与 A3 查询修复（2026-10-17）

本轮代码修复已实现，整体验收 **PARTIAL**。B 端用户两句失败原话的真实 HTTP/SSE 已连续两轮通过；B/App 正式表格组件的 Fixture 浏览器验证通过。真实 Vision 仍有波动，不能自动确认。**修复验收后，按用户追加指令已发布后端；未迁移或回填业务库、未修改旧确认 JSON、热工行、Snapshot 或 PDF。**

证据目录：[atlas-source-layout-2026-10-17](evidence/atlas-source-layout-2026-10-17/)。测试使用随机数据库、Redis/队列命名空间和统一隔离 OSS 前缀，配置源只读；不依赖 MinIO。

## 1. 原因及处理

| 问题 | 证据/原因 | 处理 |
|---|---|---|
| 编号格夹杂型号、基层 | B/App 组件在标识下主动添加工程属性，并统一写“构造 / 原始标签” | 表头优先沿用原文，默认“编号”；格内仅原图标识，附加属性移到独立区域 |
| 无编号屋面如何显示 | 原图编号栏是“平屋面（正置…）”，没有 A/C 编码 | 保留原始标签，`constructionCode=null`，不编造编号 |
| A1-3 显示成 A1=3 | 线上旧确认快照本身保存了等号，不是前端转换 | 新识别强调编号字形，等号提示复核；不直接将旧等号替换为连字符 |
| 简图 11 条混入热工表 | 线上旧屋面 JSON 的 `layers` 已包含隔汽、防水等简图说明；热工表实际仅六个材料行 | 新增来源区域及独立简图说明；前端只将非 DIAGRAM 行放入热工表，保留原数组索引 |
| 层热阻放进产品整体列 | 旧确认记录将原表层 R 放在产品字段，缺少逐档层证据 | 新识别只写对应 `layerValues`；无独立产品值不增列；旧数据不自动重分类 |
| “基层是什么”报实体不匹配 | 旧规则把“是”当实体赋值分隔符，将“什么”当基层名 | 直接规则仅处理封闭“字段:值 / 字段=值”，开放问句交既有 Domain/语义合同 |
| III 被 I/II 截获 | 混合中英文正式名称缺少起始字母边界 | 正式名称按字母词元边界匹配，I/II 不能匹配 III 后缀；同时修正诊断匹配 |
| 完整体系漏成只有型号 | 模型提案偶尔只保留 III 与 A3-2；目录缺少 III 时旧族名建议阻断确认页读取 | Prompt 明确保留原文 `systemHint`；已证实的文本硬条件不再被旧族名建议改写，不签发虚假目录 ID |
| 问 K 却输出多个 R | 只读回答始终投影全部热阻字段 | 按 `readFields` 投影正文及引用字段，完整 RenderModel 仍保留全表 |
| 只读追问要求 Candidate | 模型把明确编号追问改为 Candidate 详情 | 有前轮查询的参数追问继续走 REFERENCE_REFINE/pageQuery，继承体系和板厚，不创建方案 |

新增的是来源数据合同及校验，不添加针对样本页码、原句或标题的关键词路由。Formal Candidate、确认/发布、权限及报告门禁保持。

## 2. 数据合同与兼容

所有字段均为可选 JSON 字段，无数据库迁移：

- `systems[].sourceTableHeaders`：`identifier/diagram/layers`，原图非数值栏目名称。
- `systems[].diagramNotes[]`：原图简图旁逐条文字做法；不作为热工材料行。
- `systems[].layers[].sourceRegion`：`THERMAL_TABLE / DIAGRAM / UNKNOWN`。新识别热工行明确标记；UNKNOWN 需复核，DIAGRAM 不参加材料档位绑定。
- 复用 `sourceLayerLabel/sourceGroupLabel/sourceColumns/options[].layerValues`；保留热工表跳号及全部档位，层热阻不拿产品热阻补位。

Backend 保留原始层数组；B/App 展示过滤不重排 `layerIndex`，不按名字、空值或厚度推断来源。新增字段经审核编辑、RenderModel、引用、历史持久化兼容透传。旧 JSON 不增加默认字段；旧引用 hash 不因读取而变化。重新人工确认改变快照后引用版本变化，旧引用不能重绑新行。

旧资料未标区域时保留其内容并显示核对提示；**部署代码也不会自动纠正已经确认的等号编号、热阻归属或页标签**。需生成新草稿并按原流程审核。无坐标证据不裁剪或重画构造简图，原始 PNG 独立保留；表格的简图栏明确显示“文字说明；简图请查看原始页面”。App 可展开简图文字，默认优先材料/厚度列并横向查看全表。

## 3. A3 原图核对与真实对话

从正式 B 端只读接口取得当前发布页，再从授权 OSS 链接读取原件，未改图。当前来源版本为 `b93a1099-4f32-45b4-8683-b3a3ef5bb64e`，源记录仍为旧版确认 JSON。

| 构造 | 板厚 | 基层 | 原表整构造 R | K | 原图印刷页 |
|---|---:|---|---:|---:|---:|
| A3-1 | 45 mm | 钢筋混凝土 200 mm | 3.313 | 0.302 | 5 |
| A3-2 | 45 mm | 混凝土空心砌块 190 mm | 3.398 | 0.294 | 5 |
| A3-3 | 45 mm | 蒸压灰砂砖 240 mm | 3.416 | 0.293 | 26 |
| A3-4 | 45 mm | 加气混凝土砌块 200 mm | 4.040 | 0.248 | 26 |

R 单位 `(m²·K)/W`，K 单位 `W/(m²·K)`。原表材料层 R 为 3.000，不据此额外证明一个独立完整产品指标。原图 A3-3 的 λ 印作 0.0012，未按公式擅改。

用户第二句显示的 K 值与这组原图相符，不能把它们当作检索串值直接修改；错误在第一句误澄清，以及旧来源语义/页码问题。A3-3/A3-4 线上旧页签为 6，原件页次为 26，**线上旧记录未改**；隔离人工基线使用原图 26 验证引用。

- 原件：[A3-1/2](evidence/atlas-source-layout-2026-10-17/a3-1-2.png)、[A3-3/4](evidence/atlas-source-layout-2026-10-17/a3-3-4.png)。
- 真实 SSE 第一轮：[B 单构造](evidence/atlas-source-layout-2026-10-17/a3-acceptance/b-a3-single.json)、[B 四基层](evidence/atlas-source-layout-2026-10-17/a3-acceptance/b-a3-compare.json)。
- 第二轮：[完整报告](evidence/atlas-source-layout-2026-10-17/a3-repeat/report.json)。
- [两轮十项联合断言](evidence/atlas-source-layout-2026-10-17/a3-validation.json)：两轮各有 B 端原话 2 项、C 端原话 2 项及追问 1 项；回答数值/基层、引用行、历史恢复、无签名 URL 持久化及无方案/快照/报告创建均核验。两次清理 PASS。

此前失败记录保留在 `a3-real-uat / a3-real-final / a3-real-verified`，不删除失败来替代稳定性证据。脚本总状态 PARTIAL，HTTP/SSE 单独 PASS；浏览器/原生端缺测不被非空字符串误算为通过。

## 4. 测试范围

| 验证 | 结果 | 原始证据 |
|---|---|---|
| Backend 全量 Vitest | PASS：2406 通过、1 跳过 | `backend-test-final2.log` |
| 最终 Domain Prompt 回归 | PASS：87 项 | `domain-final.log` |
| 源图夹具与事实读取追加检查 | PASS：55 项 | `source-fixtures-final.log` |
| Backend lint / build / db:check | PASS；db:check 仅静态检查，不执行业务迁移 | `backend-lint-delivery.log / backend-build-delivery.log / db-check.log` |
| B 全量 test / typecheck / build | PASS：763 通过、1 跳过 | `admin-test-final.log / admin-typecheck.log / admin-build.log` |
| App 全量 test | PASS：149 项 | `app-test-final.log` |
| App 本次生产文件 lint | PASS | `app-changed-lint-final.log` |
| App 全量 lint | FAIL：44 项，包括既有测试文件单行多语句等 | `app-full-lint.log`；不称全量 lint 通过 |
| App type-check | FAIL：第三方 Wot ButtonOpenType 类型不兼容；当前无本次组件报错 | `app-typecheck-final.log` |
| App H5 / App 资源构建 | PASS；不是原生真机运行 | `app-build-h5-rerun.log / app-build-native.log` |
| B 正式组件 Fixture 浏览器 | PASS：22/53/89/90/75；原图切换本地图片加载 | `b-*.png / b-53-original.png` |
| H5 正式 UniApp 组件浏览器 | PASS：实际 320/375/430px；五页共 204 档，15 组横向滚动表头/表体偏差≤1px，无页面横向溢出 | `browser-validation.json / browser.json / h5-*.png` |
| B 用户原话真实 HTTP/SSE | PASS：两轮均单档 1 行、比较 4 行/2 页 | `a3-validation.json` |
| C 共享查询真实 HTTP/SSE | PASS：两轮单档/比较/追问，未自动创建 Candidate 方案流程 | 同上 |
| 原生 App / 小程序实际运行 | NOT_RUN | 无真机或模拟器验收证据 |
| 最新代码线上部署 | PASS：API/Worker online，部署健康检查通过 | `backend-deploy.log`；用户追加指令后执行 |
| 最新代码线上交互回归 | NOT_RUN | 用户要求此次发布不运行测试，未写生产对话 |
| 新字段完整 Worker/队列/人工审核浏览器联测 | NOT_RUN | 本轮 Vision 仅走正式模型/Prompt/schema 核心取证，Fixture 编辑测试不冒充人工审核 |

Windows 首次声明文件生成有 UNKNOWN/open 错误，保留失败日志；后续正常构建通过。没有为通过检查放宽第三方类型或修改无关测试断言。

### 真实 Vision 限制

原始 PNG 以 SHA-256 核对，使用项目正式模型配置、Prompt、Zod 及证据处理核心，配置源事务只读；未建识别业务记录，未自动确认。

证据分别位于 `vision / vision-rerun / vision-final`。多次试验表明：

- 热工表六行与简图说明已可分离，原表跳号可保留；屋面单次 12/12 档 R/K 正确。
- 外墙编号在不同轮次仍有遗漏或将连字符读成等号；个别轮次末档 R/K 缺失。
- 屋面个别轮次少抄简图说明或未读清防水等级，不能按人工基线自动补齐。
- 中间取证脚本曾把缺省属性的 undefined 与 null 判为不同，已修正比较；保留原始输出与失败日志，不把脚本误判当模型数值错行，也不挑选偶发成功宣称整体 PASS。

因此真实识别准确度维持 **PARTIAL/未验收**，所有新识别必须 REVIEW_REQUIRED。两页人工 Fixture 只是前端/协议测试，不代表模型自动达标。

## 5. 变更文件范围

- Backend：`src/shared/page-recognition.ts`、`page-recognition-evidence.ts`、`knowledge-page-render.ts`；`src/modules/thermal/thermal-entity-resolver.ts`、`semantic-query.ts`；`src/modules/ai/ai-domain-turn-decision.service.ts`；`src/modules/knowledge/knowledge-test-reference.ts`，以及对应回归测试。
- B：`ThermalOptionTable.vue`、`recognition/RecognitionEvidenceSection.vue`、`RecognitionThermalSection.vue`、`recognition/types.ts`；`types/knowledge.ts` 与 `knowledge-page-render.ts`；`utils/knowledge-document.ts`、`knowledge-construction-table.ts`、`knowledge-thermal-labels.ts` 和测试。共享类型文件中原有版本克隆改动保留。
- App：`api/reference-page.ts`、`ThermalPageTable.vue`、`StructuredThermalSection.vue`、`thermalPageTable.ts`、`thermalSourceLabels.ts` 及回归测试；生成的 auto-import 类型同步新函数。
- 取证：`scripts/verify-complex-atlas-recognition.ts` 增加原图清单；`run-complex-atlas-uat.ts` 增加 A3 专项；`diagnose-a3-query.ts` 只读诊断；原图夹具与本目录证据。
- 文档：Backend AGENTS/README/规则/技能参考、B AGENTS/README、App README、夹具说明。本轮没有修改其他工作中的版本克隆业务逻辑。

## 6. 后续边界

代码与人工基线 UI 可复核；B/App 发布及旧资料的新草稿审核仍需单独处理。不能通过全库 UPDATE、重算或按页码覆盖来修旧记录。尤其旧 A3、890 档、Candidate、冻结 Snapshot 与已有 PDF 不在本轮回填范围。

截图用于说明布局，不是原图替代品。App 原生运行、签名过期恢复及完整线上浏览器聊天仍缺实测；本报告没有把这些项目标为 PASS。

## 7. 用户追加的后端发布与 Git 提交（2026-10-17）

用户明确要求“发布后端、三个端提交 Git、不走测试”。执行 `pnpm run deploy --skip-db` 成功；完成本地构建、服务器生产依赖安装、部署内置报告运行环境检查、PM2 API/Worker 重载及 `/health/live` 就绪检查。保留服务器 `.env`，跳过数据库备份、迁移和 seed，存储继续使用 OSS。

本次发布未重新运行测试套件；上表测试数字均为此前修复验收记录。B 端与 App 本次仅提交代码，不部署。Git 提交包含工作区已有的知识库版本克隆相关改动，修复报告前文所说未修改该业务逻辑描述的是复杂图集修复范围。

发布日志：[backend-deploy.log](evidence/atlas-source-layout-2026-10-17/backend-deploy.log)。旧数据未重新识别或自动确认，前端新布局仍需发布相应客户端才能在线使用。
