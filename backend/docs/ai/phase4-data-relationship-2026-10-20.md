# 阶段 4：正式参考行 / 知识库档位 数据关系与最小修复方案

- 时间：2026-10-20（UTC 2026-10-19T20:2x）
- 方式：单事务 `READ ONLY` + 只读脚本 `backend/scripts/audit-reference-source-binding.mjs`
- 本轮**未执行**：任何 INSERT/UPDATE/DELETE、来源绑定、批量导入、门禁放宽、代码改动、部署
- 证据：`docs/ai/evidence/phase4-2026-10-20/reference-source-audit.json` / `.md`

---

## 0. 结论摘要

1. 两条 `thermal_reference_rows` **全部来自甲方 Excel 的两个计算示例（整体法 25mm、分层法 35mm）**，与知识库图集页无任何来源关系；强行绑定图集页会构成编造来源。
2. 已发布范围有 **890 档、794 档四项数值齐全**，但 **0 档带目录规格绑定**，**0 档具备成为正式候选的完整资格**。
3. 知识库档位进不了查询/比较/选择，是**四个层次同时缺**：数据（无规格/构造绑定）、映射（行与页档位之间没有派生关系，`optionId` 从不产生）、代码（准入过滤会静默丢弃）、授权（知识页被设计为只读）。
4. 只读比较与正式 Candidate/Final 目前**没有分离**：对比服务只吃正式候选，只读档位不可比较，这正是盲测 B10 的成因。
5. 35 问 PASS 与 74 项 1 PASS 的冲突**不是同一把尺子**：前者是语义验收（接受"资料不完整"），后者是硬断言（要求 thermal 工具 + 正式候选 + fixture 数值 + 原页绑定）。且后者至少有一处把"正确拒绝"误判为合规断言（见 §5.3）。

---

## 1. Q1：两条正式行到底来自哪里

### 1.1 事实（只读核对）

| 行 | 厚度 | 产品层 R | 整构造 R₀ | K | 参考集 | 构造 | 规格 | 原页 |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| `5f1c8f80` | 25.00mm | 4.0000 | 4.3068 | 0.2322 | `VICP-SHEET-1` v1《VICP热工计算表格公式示例》 | `VICP-OVERALL` 热阻整体计算 | `VICP-BOARD-25`（25.00mm） | 无 |
| `da25c17b` | 35.00mm | 5.0000 | 5.3068 | 0.1884 | 同上 | `VICP-LAYERED` 热阻分层计算 | `VICP-BOARD-25`（**25.00mm**） | 无 |

- `evidence_source = "VICP热工计算表格公式"`，`evidence_ref = "Sheet1"`，`evidence_level = A`
- `source_document_id = NULL`、`source_page_id = NULL`、`source_page_label = NULL`
- 参考集 `atlas_document_id = NULL`；构造 `atlas_page = NULL`；`effective_at = NULL`
- 数值与甲方 Excel 复算一致：整体法 ΣR=4.156822→R₀=4.306822→K=0.232190；分层法 ΣR=5.156822→R₀=5.306822→K=0.188437

**判定：这两条就是甲方 Excel 里的两个算法演示（整体法 / 分层法），不是图集里的产品档位。**

### 1.2 结论

- **禁止**把它们绑定到任何知识库图集页。页上没有对应的"整体法/分层法"构造；页内构造是 A1-1、A3-1 这类图集系统，身份与计算示例不同。
- 现状的"无原页但有发布来源签名"（`PUBLISHED_REFERENCE_ROW`）是**符合事实**的：来源就是这张 Excel 表，`evidence_source/ref` 已可核验。
- 真正的问题是**用途被误解**：它被当成"图集正式候选库"来用，实际只是"公式示例集"。因此"问 K≈0.3 只返回 2 条演示行"不是候选丢失，而是**数据集本来就只有 2 条演示数据**。

### 1.3 附带发现的数据冲突（未修正）

- 35mm 行复用 `VICP-BOARD-25`（25.00mm 规格），**行厚与规格厚度不一致**；若被用于计算或报告，会输出"35mm 板 = 25mm 规格"的矛盾事实。
- 两条规格都未声明 `spec_class`（I/II 型）；甲方 Excel 未区分型号，属资料缺口。
- 参考集无 `effective_at`，无法表达"何时起有效"。

---

## 2. Q2：890 档里到底有多少具备正式候选条件

### 2.1 已发布可读范围（`PUBLISHED` + `AI_ENABLED` + `ACTIVE` + 当前版本 + 全局项目）

- 页 79 / 文档 1 / 构造系统 156 / 厚度档 **890**

| 条件 | 数量 | 占比 |
| --- | ---: | ---: |
| 有厚度 | 890 | 100% |
| 有产品层 R | 800 | 89.9% |
| 有整构造 R₀ | 882 | 99.1% |
| 有 K | 882 | 99.1% |
| R/R₀/K/厚度四项齐全 | **794** | 89.2% |
| 带目录规格绑定 `productSpecId` | **0** | 0% |
| 构造有 `constructionCode` | 118 / 156 | 75.6% |
| 构造有 `rawConstructionLabel` | 6 / 156 | 3.8% |
| 构造有 `baseMaterial` | 148 / 156 | 94.9% |

构造编码重复且不统一：`A1-1` / `外墙A1-1` 各 3 与 2 条，`A1-3` 与 `外墙A1-3` 并存；**38 个系统编码为空**。

### 2.2 成为正式候选的充分条件（按现有代码合同）

一条知识档位要成为可 Confirm 的正式候选，需要同时满足：

1. 页在已发布可读范围（现状：890 档满足）
2. 有厚度 + R/R₀/K（现状：794 档满足）
3. 有稳定的档位身份 `optionId`（现状：**可派生但从不持久化**，见 §3.2）
4. 有目录规格/构造绑定 `productSpecId`、`schemeId`（现状：**0 档**）
5. 有可核验来源身份（页 + 版本 + 印刷页码；现状：页码有 1 处冲突，见 §2.3）

**结论：当前 0 档具备正式候选资格。** 794 档只具备"只读参考事实"的资格，不具备 Confirm/Final/报告资格。

### 2.3 页码身份异常（影响来源可核验性）

- 已发布范围：**标签 `51` 同时对应物理页 31 和 51**；标签 `31` 缺失 → 任何"印刷页码 31/51"的引用都不可唯一回溯。
- DRAFT 文档《J/CABEE 26J702》3 页标签为 89/90/75（`MANUAL`），未与 PDF 页脚核对。
- 161 页 `page_label_verified` 全为 true，但上述冲突说明该字段**不能作为人工核验证据**。

---

## 3. Q3：知识库候选为什么进不了查询/比较/选择

分四层，逐层给位置与证据。

### 3.1 数据缺失（资料层）

| 缺项 | 现状 | 后果 |
| --- | --- | --- |
| 目录规格绑定 | `product_specs` 仅 1 条（25mm）；890 档 `productSpecId=0` | 无法建立"档位 ↔ 可售规格"关系 |
| 构造方案绑定 | `construction_schemes` 仅 2 条（`VICP-OVERALL`/`VICP-LAYERED`），且是 Excel 示例 | 图集 156 个系统无正式构造方案 |
| 产品-知识页关联 | `product_knowledge_links=0` | 产品问答无法引用页 |
| 知识事实 | `knowledge_facts=0` | 无结构化事实层 |
| 标准限值 | `thermal_standard_limits=0`、`standard_documents=0` | 合规类问题只能拒绝 |

### 3.2 映射缺失（身份层）

- `optionId` **不是数据库字段**，是渲染时派生：
  - `src/shared/knowledge-page-render.ts:79` → `${constructionId}-o${index}`（**位置序号**）
  - `src/modules/knowledge/knowledge-page-renderer.ts:68` → 内容哈希 `${sectionId}:option:${optionKey}`（仅测试引用）
- 同一快照存在两套派生规则；位置序号在档位增删/重排后会漂移。
- 正式行到页档位**没有任何派生函数**：`compactCandidateResult` 输出 `sourcePageId`、`sourcePageLabel`，**唯独没有 `optionId`**（`src/modules/ai/tools/thermal-lookup.ts:141-184`）。

### 3.3 代码准入（会静默丢弃）

| 位置 | 条件 | 效果 |
| --- | --- | --- |
| `src/modules/ai/tools/thermal-calculate.tool.ts:476-479` | 页有 `confirmedStructuredData` 且候选无 `optionId` → 丢弃 | **任何已绑定原页的正式行都会在此被静默过滤** |
| `src/modules/ai/published-reference-source.ts:19` | 只要 `sourcePageId` 存在就不允许用"发布行签名" | 有页的行只能走 `optionId` 通道，而该通道无人生产 |
| `src/modules/ai/solution-candidate-query.service.ts:43,74,106` | `verifiedFormal = allPages.candidates`；`rejectedSourceCount = formal - verifiedFormal` | 命中数有值、可确认数 0，答案降级为只读 |
| `src/modules/ai/candidate-result.service.ts:15` | `confirmationEligible = 页+版本+optionId 或 发布行签名` | 知识页 `referenceKind=KNOWLEDGE_PAGE` 恒为 false |
| `src/modules/ai/solution-workflow.ts:160` | 冻结要求同上 | 只读页不可 Confirm/Final |
| `src/modules/ai/reference-candidate-resolver.service.ts:79` | 选择时无 `optionId`/签名 → 拒绝 | 用户"选不了" |

实测证据（SALES-023 Turn 2）：`matchedCount=2`、`rejectedSourceCount=2`、`issues=["SOURCE_NOT_VERIFIABLE"]`，答案变成"以下为已确认页面的只读参考，不构成正式方案候选"。

### 3.4 业务授权（设计如此）

- 知识页被明确定义为只读事实源：`readOnlyPageFacts: !solutionCandidates.length`（`solution-candidate-query.service.ts:106`），`referenceKind=KNOWLEDGE_PAGE` 不参与正式签名。
- 这是**正确的门禁**，不是缺陷。缺的是"只读轨"的完整能力（比较/选择），而不是把只读页提升为正式候选。

---

## 4. Q4：只读比较与正式 Candidate/Final 的分离

### 4.1 现状

| 能力 | 只读知识档位 | 正式候选 |
| --- | --- | --- |
| 查询/展示 | ✅ 有（`readOnlyAnswer`、`reference_pages`） | ✅ |
| 来源引用 | ✅ 页 + 印刷页码 | ✅ 页或发布行签名 |
| 比较 | ❌ `compare-solution.service.ts:189` 直接调 `queryThermalCandidates`，只吃正式行 | ✅ |
| 选择/确认 | ❌ `reference-candidate-resolver.service.ts:79` | ✅ |
| 冻结/报告 | ❌ | ✅ |
| 标注"不构成候选" | ✅ 文案已明确 | — |

### 4.2 结论

- 分离在**写路径**上已经成立（只读页不能 Confirm/Final/报告），在**读路径**上不成立（只读页不能比较、不能勾选查看）。
- 建议把"只读比较"做成**独立只读接口/独立状态**，不进入 Candidate/Revision/Snapshot：
  - 身份用 `pageId + systemKey + 厚度`（页内派生），不写库、不生成 `optionId`
  - 返回值显式带 `confirmable:false`、`comparisonOnly:true`
  - 不发布 `reference_candidates`，不产生 `solution_state`
- 该方案**不需要放宽任何证据门禁**，也不属于"补造 optionId"。

---

## 5. Q5：35 问 PASS 与 74 项 1 PASS 的冲突解释

### 5.1 四个维度对比

| 维度 | round-21-final（35/35 PASS） | 本次 74 项（1 PASS） |
| --- | --- | --- |
| 判定主体 | Agent 业务复核（`business-review.json` 逐条 `reason`） | 硬断言（`tests/uat/assertions/index.ts`） |
| 环境 | 真实 H5 + 真实 DeepSeek + 已部署后端 | 隔离随机库 + `fastify` 直连 + 真实 DeepSeek |
| 数据 | 已部署库（2 条示例行 / 1 目录产品 / 79 页 890 档） | 合成 fixture（4 条参考事实、3 个目录产品、自建图集页） |
| 断言范围 | 语义正确、无编造、澄清合理 | 必须 `thermal` 工具、必须正式候选、必须命中 `REFERENCE_FACTS`、必须原页绑定 |
| 结论含义 | "回答可接受"（含"资料不完整"） | "候选链路与 fixture 逐项一致" |

**冲突可以完全解释**：35 问 PASS 里的 S1-T1 答案是"目前产品介绍资料还不完整"，被判 PASS；同一形态在 74 项里会因"没有正式候选/没有 thermal 工具"被判 FAIL。两者不是同一把尺子，**不能互相替代，也不能用任一方单独宣布 READY**。

### 5.2 代码版本与数据版本

- 代码：HEAD `85597b9`，工作区有 102 个文件未提交改动（阶段 2 修复）；round-21 记录的后端单测为 2853 pass，当前为 2866 pass → **不是同一构建**。
- 数据：真实库 = 2 条示例行 / 1 目录产品 / 1 规格 / 2 构造方案 / 0 标准限值；UAT 库 = 4 条合成事实 / 3 目录产品 / 自建图集页 + 正确 `sourcePageId`。
- UAT 的运行时代码来自 `src`（tsx 直跑），因此 74 项反映的是**当前工作区代码**，不是已部署版本。

### 5.3 已确认的"正确拒绝被误判"（样例）

`tests/uat/assertions/index.ts` 的合规断言先按句剥离否定词，再判断是否出现"达标"：

- 否定词表：`不满足|未满足|不能|无法|未找到|没有|不符合|不达标|不是|并非|不代表|不构成|不作为|不属于|不算|不用于|不涉及|若|如果|要求|目标|需|是否|假设|尚无|不足`
- 缺 `不判断|不选择|不评价|不替代|仅供|仅作`

SALES-023 Turn 2 的实际答案含"**本次仅查阅资料，不选择方案或判断规范达标。**"——句子含"达标"且不命中任何否定词 → 触发 **HALLUCINATION 硬失败**。这是把合规拒答误判成合规宣称。

同类问题：
- `ROUTING：本轮实际工具须包含 thermal`：本轮走 `backend:reference_read`，事实正确但工具名不同 → 判失败。
- `SOURCE [HARD]：原页ID/印刷页码与正式行一致`：只读页必然没有正式行 → 结构性必失败。
- `RETRIEVAL：预期正式行存在`：隔离库只有 fixture 的 4 条事实，超出即失败。

**因此 66 项 FAIL 中，至少三类属于"口径/断言问题"，不能直接算作软件缺陷。**

---

## 6. 最小修复方案（全部待你确认，本轮不执行）

### P0-A：让"丢弃"变成"可解释的降级"（仅代码，不写库、不放宽）

- 在 `emitReferencePages` 丢弃分支（`thermal-calculate.tool.ts:476-479`）返回显式诊断：`BINDING_MISSING_OPTION`，带 `pageId / schemeCode / thickness`，而不是静默过滤。
- `solution-candidate-query.service.ts` 把该诊断并入 `rejectedSourceCount` 原因，答案文案从"部分来源未通过校验"改为"正式行已绑定原页但缺少档位身份，需完成绑定后才能作为候选"。
- 效果：同样不产生候选，但用户和验收都能看到**确切缺口**，不再误判为"资料不存在"。
- **不涉及**：写入、绑定、门禁放宽。

### P0-B：只读比较与正式候选分离（仅代码，不写库）

- 新增只读比较入口：输入 `pageId + systemKey + thickness`（或 query 条件），输出页内档位对照，标 `confirmable:false / comparisonOnly:true`，不发布 `reference_candidates`、不写 `solution_state`。
- 不改 `compare-solution.service.ts` 的正式路径，只新增只读路径。
- 效果：解决 B10"只读档位不可比较"，且不触碰 Confirm/Final/报告门禁。

### P1-A：断言口径修正（仅测试，不改业务）

- 否定词表补 `不判断|不选择|不评价|不替代|仅供|仅作`（修 5.3 的误判）。
- 把"数据是否具备"与"软件行为是否正确"拆成两组断言：数据不具备时，正确拒绝/只读降级应判 PASS，不得记 HARD FAIL。
- 工具路由断言改为"等价路由"（`thermal` 或 `backend:reference_read` 且事实来自正式/确认源），并在报告中记录路由名。
- **不改** 任何既有预期数值、fixture 事实、35 问问句。

### P1-B：验收报告写清版本指纹

- 每份 UAT 报告记录：git HEAD + 工作区脏文件数 + 数据库标识 + fixture 版本 + 用例数/轮数 + oracle 类型（硬断言/语义复核）。
- 防止再次出现"35/35 PASS"与"1/74"并列却无法解释。

### P2（需要你决策后才可能涉及写库）

1. 是否为图集建独立参考集与构造方案（把 890 档转正式候选）——需资料负责人确认构造编码与厚度口径。
2. 是否为 794 档批量创建 `product_specs` 或采用"无规格资格"标注——两者都改变正式候选口径。
3. 是否把 Excel 两条示例行更名为"公式示例集"并在产品问答中显式排除。
4. 是否确认 35mm 行应为 35mm 规格（当前复用 25mm，属数据错误）。

**以上 4 项任一都涉及写库或口径变更，本轮全部不执行。**

---

## 7. C 端验收计划（按你的要求，接口 200 不算通过）

| 端 | 用途 | 验收内容 | 当前状态 |
| --- | --- | --- | --- |
| H5 | 联调 | 登录、跑 6 个原问题、确认只读/候选卡差异、SSE 完整性 | 未验收（仅静态服务 200） |
| 微信小程序 | **正式交付首选** | 同 6 问 + 候选卡可点/不可点、只读表渲染、空态、清空候选 | NOT_RUN（缺开发者工具） |
| UniApp App | 次选 | 同上 + 键盘/滚动/返回态 | NOT_RUN（缺构建与真机） |

验收判定必须包含：DOM/截图 + SSE 原文 + 后端决策元数据三者一致，任一缺失记 NOT_RUN，不得以 HTTP 200 代替。

---

## 8. 本轮未执行清单

- 未写任何数据库记录（含来源绑定、导入、规格创建）
- 未修改业务代码（阶段 2 的改动仍为工作区未提交状态）
- 未放宽任何证据门禁
- 未部署、未发布
- 未改动 35 问问句与既有 fixture 预期

---

## 9. 待你确认

1. P0-A / P0-B 是否按上述"仅代码、不写库、不放宽"实施？
2. P1-A 断言口径修正是否可以改测试（不动业务预期）？
3. P2 四项中，先做哪一项（建议先确认 35mm 规格错误与示例集更名，这两项不改候选口径）？
4. C 端验收是否先只做微信小程序？
