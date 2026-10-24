# 步骤 3｜独立盲测与发布门槛

- 日期：2026-10-20
- 测试对象：本地新代码 + 同一 UAT 库 + 真实 DeepSeek（`http://localhost:3001`）；远程 `lgapi.zblack.cn` 仍是旧代码
- 结论：**NOT_READY**。固定 35 问的现有 UAT 载体本轮 **1/74 PASS**；10 组独立盲测 4 PASS / 1 PARTIAL / 5 FAIL；C 端 H5、微信小程序、App 均 **NOT_RUN**；两条正式业务链路 **NOT_RUN**。

## 1. 测试总表

| 层级 | 样本 | 结果 | 说明 |
| --- | --- | --- | --- |
| 原始固定 35 问（合成隔离库） | `pnpm uat:ai --persona sales`：24 场景 / 74 轮 | **1 PASS / 7 WARN / 66 FAIL / 0 BLOCKED**；Intent 1.4%、参数 39.2%、事实 39.2%、状态 43.2%、来源 29.7%、ReferencePage 0/14 | 报告：`logs/ai-uat/phase2-sales-2026-10-20/report.md`。**不能宣称 35 通过** |
| 独立盲测（真实库，HTTP/SSE） | 10 组 / 12 轮 | **4 PASS / 1 PARTIAL / 5 FAIL** | `docs/ai/evidence/phase3-2026-10-20/blind.json` |
| C 端 H5 真实输入/展示 | 35 问 + 盲测 | **NOT_RUN** | `agent-browser` daemon 启动超时，未取得页面快照；本地 H5 仅确认可启动 |
| 微信小程序 | 真机/开发者工具 | **NOT_RUN** | 无微信开发者工具 |
| UniApp App | 打包/真机 | **NOT_RUN** | 无构建/设备环境 |
| 业务链路 1：查表→选→比较→Final→Confirm→Snapshot→PDF | 1 条 | **NOT_RUN** | 真实库正式候选仅 2 条，盲测页面档位不可选；无 H5 操作证据 |
| 业务链路 2：产品咨询→对比报告 | 1 条 | **NOT_RUN** | 同上；产品对比/报告未在 C 端执行 |

## 2. 固定 35 问（现有 UAT 载体）

- 结果：24 场景 / 74 轮，`pass=1, warning=7, fail=66, blocked=0, hardFails=185`。
- 典型失败（SALES-023 Turn 2）：
  - 预期：`toolsAny=["thermal"]`、`operation=LOOKUP_CANDIDATES`、正式候选 A1-3 18mm/0.303。
  - 实际：`toolRoute=["backend:knowledge","backend:reference_read"]`、`queryResultMode=FACTS_ONLY`、`candidateIds=[]`；只读页表 2 档，无候选。
- 共同特征：带指标条件的 `pageQuery` 走只读页事实，正式候选查询未产生命中/未发布；`systemHint` 与 fixture 正式行的体系名未对齐。
- **归因状态**：代码已证实 `pageQuery` 只读路径存在；本轮新增“带指标 pageQuery 先查正式候选”后，单场景仍 0 候选，说明 fixture 的体系/正式行与查询条件不匹配，或候选来源资格被过滤。**未能证明是本次修改引入**，但当前基线就是 FAIL，不能沿用历史 round-21 PASS 结论。
- 该 UAT 使用随机隔离库 + 4 条合成事实/3 个目录产品，**不是** C 端真实数据；即使未来 PASS，也只能算接口层/合成数据回归。

## 3. 独立盲测（真实库，10 组）

| # | 盲测问法 | 结果 | 判定依据 |
| --- | --- | --- | --- |
| B1 | “你们知识库里 VICP 有哪些做法？” | **FAIL** | 返回 2 条正式参考行（25/35mm），没有 12 个知识库构造系统/产品族；产品发现意图未触发，仍走 REFERENCE_QUERY |
| B2 | “薄抹灰 K 0.28 左右，25 厚以内，有什么现成做法？” | **PARTIAL** | 14 档/14 构造只读表，K 0.270–0.285、厚度≤25，事实基本符合；但无候选、不可选，仍是只读 |
| B3 | “保温薄抹灰0.3方案”→“A3-1 45mm 产品热阻和整墙热阻？” | **PASS** | A3-1 45mm：产品 R=3.000、主断面 R=3.313、K=0.302，与页 5 一致；明确只读不确认 |
| B4 | “倒置式屋面，K 不大于 0.2，有方案吗？” | **FAIL** | 答“构造属性或印刷页码未能核验，请明确原文”；`倒置式屋面` 的 placement/applicationPart 未进入查询，属关键条件丢失 |
| B5 | “VICP 和岩棉比，防火哪个好？” | **PASS** | 明确“已核验资料没有燃烧性能等级，无法给结论”，未编造防火优势 |
| B6 | “浙江项目 K0.3 能满足吗？” | **FAIL** | 返回 86 档、K=0.300 的只读表并附免责声明，但没有明确“浙江缺正式标准版本/适用范围/限值，不能判断是否满足”；用户会读成“这些满足 0.3” |
| B7 | “A3-3 的 0.0012 是不是印错了？” | **FAIL** | 答“尚未可靠定位…请指定原页”；A3-3 的已知 λ=0.0012 疑点未定位、未提示资料待核 |
| B8 | “帮我直接生成报告” | **PASS** | 明确需先明确最终方案并确认、形成快照；未直接生成 |
| B9 | “0.035 和 0.03 哪个保温更好？” | **PASS** | 先问指标与单位（λ/K/R），未猜测、未直接比较 |
| B10 | “薄抹灰0.3方案”→“把刚才两个方案对比，别生成报告” | **FAIL** | 首轮只读表 22 档；第二轮答“当前没有可定位的候选”；只读页档位不可作为“刚才两个”比较对象 |

统计：**PASS 4（B3/B5/B8/B9）、PARTIAL 1（B2）、FAIL 5（B1/B4/B6/B7/B10）**。

## 4. 阻断项与归因

| # | 阻断 | 证据 | 归因（代码已证实/推测） |
| --- | --- | --- | --- |
| P0-1 | 固定 35 问当前 1/74，不能发布 | UAT 报告 | 代码已证实 `pageQuery` 只读路径；正式候选 0 命中的具体原因（systemHint/来源资格）待复核 |
| P0-2 | 产品知识库问题仍可能走查表 | B1 | 代码已证实 `PRODUCT_DISCOVERY` 才走知识族；`REFERENCE_QUERY` 不会；意图路由待修 |
| P0-3 | 屋面“倒置”条件丢失 | B4 | 推测：placement/applicationPart 未 ground 到 pageQuery；需查 `applySemanticQuery`/字典 |
| P0-4 | 合规问题未明确拒绝 | B6 | 代码已证实无 `thermal_standard_limits`/`standard_documents`；`complianceCheck` 未触发，回答层仍给参考表 |
| P0-5 | 原文疑点无法定位 | B7 | 代码已证实 audit JSON 有 A3-3 issue，但回答/事实读取未消费该 issue；`pageLabel`/factRead 未绑定 |
| P0-6 | 只读页档位不可比较/选择 | B10、F6 | 代码已证实 `solutionCandidates` 只从正式 `thermal_reference_rows` 生成；只读页事实不进入候选池 |
| P0-7 | C 端未验收 | — | 环境不足，NOT_RUN；Backend/SSE 不能替代 |

## 5. 发布判定

**NOT_READY**。

阻断理由：
1. 固定 35 问载体 **1/74**，与“35 问通过”的历史结论冲突，必须先复核 UAT 环境/预期/候选合同，不能带病发布。
2. 10 组真实盲测 5 个 FAIL，覆盖产品范围、屋面条件、合规拒绝、原文疑点、比较链路。
3. C 端 H5/小程序/App 全部未真实操作；候选、表格、原页、按钮、刷新恢复均无证据。
4. 890 档只读页仍不可选；正式候选只有 2 条，业务闭环无法完成。

## 6. 下一步最小修复建议（不在本步修改）

1. **产品意图**：把“知识库里有哪些做法/产品”纳入 `PRODUCT_DISCOVERY` 的语义/Policy 合同，而不是靠关键词；B1 必须走 `readProductKnowledgeFamilies()`。
2. **屋面条件**：审计 `placement/applicationPart` 的 grounding 与字典，确保“倒置式屋面”进入 pageQuery；B4 复测。
3. **合规问题**：`能满足吗/达标吗` 必须触发合规读取；无正式标准时明确“缺标准版本、适用范围、限值，不能判断”，不得用参考表代替。
4. **原文疑点**：把 `confirmedPageSourceAudit.issues` 投影到 factRead/参数行；A3-3/ A2-2 的疑点必须在回答中可见。
5. **只读页比较**：为只读页档位提供稳定只读 ID 与比较视图（不可 Confirm），或明确要求先导入正式参考行；B10 复测。
6. **35 问载体**：先核对 `run-ai-uat.ts` 的 fixture 体系名与查询 `systemHint`、正式行来源资格，再复跑；不得改原始预期。

## 7. 证据

- 固定 UAT：`logs/ai-uat/phase2-sales-2026-10-20/report.md`、同目录 `report.json`
- 盲测：`docs/ai/evidence/phase3-2026-10-20/blind.json`（含 10 组原话与完整回答）
- 修复前后 SSE：`docs/ai/evidence/phase2-2026-10-20/sse-summary.json`
- 自动测试：Backend 2866 pass / 1 expected fail / 1 skip；App 155 pass；lint/tsc/db:check 通过；`pnpm build` clean 被本机 safe-delete 保护拦截，`tsc` 直接输出通过。

**步骤 3 完成。结论：NOT_READY；H5/小程序/App 及两条业务闭环均 NOT_RUN。** 未改代码/测试预期，未部署。
