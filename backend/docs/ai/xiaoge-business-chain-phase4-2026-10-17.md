# 小格 AI 业务理解、检索与热工问答：阶段 4（自动化与真实对话回归）

执行日期：2026-10-17（Asia/Hong_Kong）。本阶段只做阶段 4，完成后停止。

## 1. 执行方式与范围

**确定性矩阵（新增，可重复）**

`src/modules/ai/xiaoge-chain-phase4.matrix.test.ts`，16 例，只锁定**跨阶段衔接**，不重复各模块内部边界：
Semantic 决策 → 查询/事实 → 回答合同 → 授权边界，以及「某一步失败时不能把失败伪装成成功」。

**真实 HTTP/SSE（隔离环境）**

使用仓库既有 UAT 通道 `tests/uat/environment.ts`：随机临时库 `vicp_ai_uat_<32hex>`、独立 Redis 前缀与队列、OSS 隔离前缀、真实模型 `deepseek-chat`；配置只读加载，业务数据从零建立，结束后清理。

本轮实跑 4 次：

| 运行 | 用例 | 结果 |
|---|---|---|
| `run-ai-uat.ts --case SALES-017` | 模糊指标澄清 → 改 K → 追原页 | WARN 1 / FAIL 2，Hard Fail 5 |
| `run-ai-uat.ts --case SALES-014` | 产品咨询（为什么能做薄 / λ / 客户话术） | WARN 2 / FAIL 1，Hard Fail 0 |
| `run-ai-uat.ts --case DESIGN-012` | 图集参数 → 当量法正式计算 → 改厚度重算 | FAIL 3，Hard Fail 2 |
| `run-solution-uat.ts` | 方案选择/Final/Confirm 13 轮 | BLOCKED，执行 0/13 |

证据：`docs/ai/evidence/xiaoge-business-chain-phase4-2026-10-17/`（`report.md`/`report.json`）、`logs/solution-uat/2026-10-17T07-56-05-927Z/report.json`、`tests-full.json`。

## 2. 真实对话结果与逐条根因

### F1（P0，新发现）：只读事实没有成为可引用的上下文，下一轮追问断链

**证据 A**：SALES-017 Turn 3「刚才第一个图集哪一页？」

```text
toolRoute=["backend:reference_read"]，referencePageIds=[]，candidateIdList=[]
回答：当前没有可定位的候选，请先查询已有档位或选择方案。
```

上一轮实际展示了 A1-3 / A1-4 两档并给出印刷页 22、23，但只读结果没有进入可引用上下文，位置引用（`POSITION:1`）失去锚点。

**证据 B**：SALES-014 Turn 2「导热系数λ是多少？」

```text
factValidationCode=FACT_IDENTITY_REQUIRED
回答：请补充要核对的构造编号；若已有多个构造，还需明确对应来源和保温板厚度。
```

上一轮回答刚以 A1-3、18mm、λ=0.005、页 22 为依据，同一会话内却要求重新给构造编号。

**归因**：阶段 1 联合查询把知识确认页结果放进 `readOnlyReferences`，并**不再发布为可引用候选**（设计上禁止升格为可 Confirm 候选，这一点正确）；但「不可确认」与「不可引用」被合并了，导致引用/来源回溯链断掉。基线 `logs/ai-uat/phase4-sales017` 的 ReferencePage 为 1/1，本轮为 0/1，属**行为退化**。

### F2（P0，新发现）：结构化查表被逐字段复核拒绝，且拒绝原因无法定位到字段

**证据**：DESIGN-012 Turn 1「A1-3 I型18mm图集参数」

```text
policyReason=PAGE_QUERY_CONSTRAINTS_INVALID
pageQuery 约束完整：schemeCode=A1-3、specClass=I、THICKNESS=18 EXACT
toolRoute=["backend:clarify"]
回答：想确认一下：明确指定的对象未被完整保留，请确认。
```

拒绝来自 `thermal/semantic-query.ts:258` 的逐字段复核。本轮做了两次只读复现：

| 复现条件 | 结果 |
|---|---|
| 生产库只读字典（7 个实体） | 不复现：`explicit={}`，无 unresolved（库中没有 A1-3 实体） |
| 纯函数构造字典（schemeCode/specClass/productSpecId 三种组合） | 不复现，或返回其它字段的拒绝原因 |

结论：只在含 A1-3 的隔离 fixture 字典下触发，**被拒字段仍未定位**（隔离库已随运行销毁）。未据此改代码。

连带影响：T2「请按当量法正式计算 A1-3 I型18mm 的 K」因缺方案/规格 ID 被拒绝，但同一回答又列出了图集参考值（2.880 / 3.297 / 0.303），出现「不能计算，但这是参考值」的混合表述，用户容易把它当成计算结果。

### F3（记录，非缺陷）：工具路由与 UAT 期望不一致

`pageQuery` 路径走 `backend:knowledge + backend:reference_query`，UAT 期望 `thermal`。这是阶段 0/1 已确认的架构（结构化查表不经过 Thermal Tool），属于断言口径过期，不是用户可见缺陷。

### F4（记录，断言层问题）：UAT 检查器本身有噪声

- `intent` 全部 0%：`domainIntent` 正确（CLARIFY / KNOWLEDGE_EXPLAIN / THERMAL_CALCULATE），但检查器读取的 `intent/taskType` 仍是 `GENERAL`，映射口径不一致。
- HALLUCINATION 检查把回答中的「不判断规范达标」当成肯定合规结论（SALES-017 T2）。
- 上述两项会压低分数，但不影响 F1/F2 的事实判断。

### 与上一轮基线的对比（失败记录全部保留）

| 用例 | 基线（`logs/ai-uat/phase4-sales017`） | 本轮 | 判断 |
|---|---|---|---|
| SALES-017 | WARN 1 / FAIL 2 / Hard 5；参数 100%、事实 33.3%、状态 33.3%、来源 100%、ReferencePage 1/1 | WARN 1 / FAIL 2 / Hard 5；参数 66.7%、事实 66.7%、状态 33.3%、来源 33.3%、ReferencePage 0/1 | 主判定相同（本就失败），但**来源与引用页能力退化**（F1） |
| SALES-014 | 无基线 | WARN 2 / FAIL 1 / Hard 0 | 首跑；失败项为 F1-B 与 intent 映射 |
| DESIGN-012 | 历史均为 BLOCKED（ECONNREFUSED） | FAIL 3 / Hard 2 | 首次真实执行，暴露 F2 |

## 3. 五类场景覆盖表

| 类别 | 自动化矩阵 | 真实 HTTP/SSE |
|---|---|---|
| 1 普通产品介绍/咨询 | ✅ 3 例：介绍形态不出参数；越界回落；只读不授权 | ✅ SALES-014 T1/T3：如实说明原因、拒绝编造防火/造价，引用页 22 |
| 2 知识库原页/热工查表/多构造比较 | ✅ 3 例：四类空结果分别解释；取值概览标注「未作为命中」；不同体系不误判冲突 | ⚠️ SALES-017 T2 正确给出 2 档与页 22/23；T3 断链（F1） |
| 3 多轮澄清/口语/指标修改 | ✅ 4 例：澄清只补数值；REPLACE 不叠加；名称不确认就澄清；切话题清条件 | ⚠️ SALES-017 T1 澄清正确、T2 NEW_QUERY+REPLACE 正确（`queryChangedFields` 含 filters/metric）；T3 断链 |
| 4 正式计算/缺参拒绝 | ✅ 3 例：无直接授权即拒绝；达标需结构化字段+原话证据；引用作用域不被改写 | ⚠️ DESIGN-012 T2 如实拒绝并说明缺方案/规格 ID（未生成计算记录），但前置 F2 使链路不可用 |
| 5 方案/Final/Confirm/Snapshot/PDF | ✅ 3 例：域层不产出 CONFIRM；自由文本非封闭命令；假设式报告请求被拒 | ❌ BLOCKED：方案 UAT 创建会话即失败（0/13）；PDF 未执行 |

## 4. 本阶段修改内容

**未修改任何产品代码。** 只新增 1 个测试文件（16 例）。

新增用例首跑有 2 项失败，均为**断言写错层次**，已修正断言而非改产品代码：

1. 「切话题不继承」原先断言在 `normalizeConversationLookupQuery`（该函数按设计继承），实际语义由 `relation=SWITCH_TOPIC → NEW_QUERY` 决定；改为验证 `applySemanticQuery(NEW_QUERY)` 清条件。
2. 「模型不能替用户确认」原先断言 `mutation=STATE_MUTATION`，实际域层枚举为 `SOLUTION`；改为断言域层只产出 `SOLUTION` 动作、且自由文本不是封闭命令。

## 5. 测试结果

| 项目 | 结果 |
|---|---|
| 新增矩阵 | **16 / 16 通过** |
| 全量 `vitest run` | **2649 passed / 1 failed / 1 expected fail / 1 skipped**（229 文件），证据 `tests-full.json` |
| 唯一失败 | `tests/report-runtime.test.ts`（`spawnSync` 返回 null + 临时目录 EBUSY），连续第 3 个阶段复现，未修改 |
| 真实 UAT | 4 次运行，结果如上；失败记录全部保留，未用重跑覆盖 |

**环境清理**：4 次运行后发现 1 个遗留临时库 `vicp_ai_uat_9a34050a5be34f2595e147f227bc2a8a`（方案 UAT 早期失败未清理）。已按 UAT 命名白名单校验后 `DROP ... WITH (FORCE)`，复查遗留数为 0。建议给早期失败路径补 cleanup 断言。

**未执行**

- 第 5 类真实闭环（Confirm/Snapshot/正式 PDF）：方案 UAT 在创建会话即失败，未进入任何业务轮次。
- PDF 渲染（Chromium/中文字体）、报告 worker、通知队列的真实链路。
- B 端与 App 页面验收；图片签名过期；原生端与精确屏宽。
- 权限负向用例的真实 HTTP（无权限项目、跨用户引用、过期 revision）。
- `pnpm lint`（`semantic:check`）、build、db:check；未部署、未迁移、未 seed。

## 6. 对知识库、热工计算、权限、Snapshot 与报告的影响

本阶段无代码变更，因此对上述范围**零影响**。真实 UAT 期间：临时库与 Redis 前缀、OSS 前缀均在隔离范围；未触碰生产业务数据、历史计算、Snapshot 与既有 PDF。唯一的外部副作用是上述遗留临时库，已清理。

## 7. 未解决与下一阶段建议

**P0（建议立即修复）**

1. **F1 只读事实上下文断链**：只读确认页/知识事实应当「不可确认但可引用」。建议新增独立引用上下文（例如 `lastReadOnlyReference`：文档/版本/页/optionId/序号/24h/本人同端同项目），供 `REFERENCE_VIEW`、位置引用与来源回溯消费；仍禁止进入 Candidate、Confirm、Snapshot。修复后必须重跑 SALES-017 与 SALES-014，并保留当前失败记录。
2. **F2 逐字段复核拒绝不可诊断**：先在 `semantic-query.ts` 的字段级 reject 处补「被拒字段 + 期望值 + 实际值」到内部日志（不改变用户文案），再在隔离环境复现定位；不要凭猜测放宽 `PAGE_QUERY_CONSTRAINTS_INVALID`。

**P1**

3. UAT 断言层口径：`intent` 应读 `domainIntent`；合规词检查需排除否定句；`referencePageRequired` 应允许只读页引用。
4. 方案 UAT 脚本：`/conversations` 失败未打印错误码，且早期失败未清理临时库，先修脚本再作为第 5 类验收手段。
5. DESIGN-012 T2 的混合表述：拒绝正式计算时不应同时给出图集参考值而不加显著区分，建议在事实合同里明确「参考值 ≠ 计算结果」的段落层级。

**P2（前几阶段遗留）**

6. 阶段 1 结论文档缺失；阶段 1 在 Service 层拼装用户文案；前端 DTO 未带产品热阻口径；Clarify 文案仍用「整墙」俗称；`THERMAL_METRIC_LABELS.TOTAL_R` 全局标签未统一。

**阶段 4 到此停止。** 建议下一轮（阶段 5 / 修复轮）优先处理 F1、F2，并补齐第 5 类真实闭环与权限负向验收。
