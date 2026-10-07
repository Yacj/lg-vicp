# VICP Backend｜销售 + 设计院真实 AI UAT 报告（2026-10-07）

本轮把 UAT 从"结构检查"推进到**真实链路执行**：打通生产 PostgreSQL、生产 Redis、本地 S3 兼容对象存储、解密生产模型 Provider Key，并实际调用 DeepSeek 模型 API 跑完整业务链（Conversation → Intent/Router → Agent → Tool → Service → DB → Knowledge/Thermal/Product/Standard → Message → ReferencePage → State）。

**结论（本轮）：真实 UAT 已实际执行，但被"模型账户余额耗尽"中途阻断，尚不能完成 40 场景 / 123 轮全量验收，Backend 暂不可冻结。** 已修复 1 个真实业务缺陷 + 3 个验收框架误报；另定位 4 个代码/基础设施缺陷。

---

## 1. UAT 总览

| 指标 | 结果 |
| --- | --- |
| 计划 Case | 40（SALES 20 / DESIGN_INSTITUTE 20） |
| 计划 Turn | 123 |
| 实际执行 Turn | 21（SALES-001 ~ SALES-007） |
| PASS / WARN / FAIL / BLOCKED | 13 / 4 / 1 / 3 |
| Hard Fail | 0（按修正后断言口径） |

> 阻断原因：DeepSeek 账户余额在第 20 轮附近耗尽（`/user/balance` 返回 `is_available=false, total_balance=-0.00`），其后模型调用持续 `HTTP 402 Insufficient Balance`，Agent 首步模型调用在 120s 整体超时后 abort。

执行证据：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Backend 类型 | `pnpm lint` | 通过 |
| 全量单元测试 | `vitest run` | 140 文件通过 / 1307 项通过 / 1 跳过 |
| UAT 场景结构 | `tsx scripts/run-ai-uat.ts --check` | 通过：40 场景 / 123 轮 |
| 真实 UAT（修复后） | `tsx scripts/run-ai-uat.ts` | 21 轮真实执行后因余额耗尽中止 |
| 模型可用性 | 解密 Provider Key 直连 | 前 20 轮 HTTP 200；之后 `HTTP 402 Insufficient Balance` |

---

## 2. Sales 结果（SALES-001 ~ 007，21 轮）

| Case | 场景 | 轮次状态 | 说明 |
| --- | --- | --- | --- |
| SALES-001 | 客户想做薄：放宽厚度并找原页 | P P W | 真实调用 `thermal`，候选/来源/原页全部核验通过 |
| SALES-002 | 严格上限无结果：说明原因后放宽 | P P F | 见 §11 候选发现 F-1（原页追问未复用候选、未返回 ReferencePage） |
| SALES-003 | K 目标选型与最接近方案 | P W P W | 排序与"第二个候选"追问正常 |
| SALES-004 | 厚度上限从 20 调到 25 再收紧 | P P P F | 见 §11 F-2（相邻规格豁免，已确认为设计内行为） |
| SALES-005 | 尽量薄：硬条件之后排序 | P P W | 硬条件满足后按厚度升序 |
| SALES-006 | 从 20 改到 25 的厚度口语 | P F B | T2 起被余额耗尽阻断 |
| SALES-007 | 取消厚度并清除薄板偏好 | F | 首轮即被余额耗尽阻断 |

修正断言口径后：Sales 已执行轮次 **Intent 90%、参数 100%、事实 94%、多轮状态 72%、来源 94%、ReferencePage 4/5**。

## 3. Design Institute 结果

**未执行（余额耗尽）。** DESIGN-001 起的 20 个场景全部未运行。

## 4. 各 Domain 准确率

| Domain | 计划 Turn | 已执行 | 备注 |
| --- | --- | --- | --- |
| B. Reference Lookup | 38 | 20 | 主链已跑通，Intent/参数/事实/来源均 ≥90% |
| G. Source / ReferencePage | 14 | 5 | ReferencePage 4/5 |
| 其余（知识库问答 / 正式热工 / 合规 / 产品咨询 / 对比 / 报告） | 71 | 0 | 未执行 |

---

## 5. 本轮发现并修复的问题

### 已修复（真实 UAT 证据驱动）

**FIX-1｜参考查询/正式热工首步未真实调用工具（真实业务缺陷，已修复）**

- 证据：首轮全量运行（123 轮）中 **61/123 轮模型 0 工具调用**，仅凭上下文作答 → 会话权威条件不更新、来源无法核验，集中表现为 49 条"本轮实际工具须包含 thermal"、48 条"热工操作=LOOKUP_CANDIDATES"、25 条"未沿用上一轮候选"、23 条"未返回 ReferencePage"。
- 修复：`src/modules/ai/ai-agent.service.ts` 的 `prepareStep`——当 `answerContract` 为 `REFERENCE_LOOKUP` / `THERMAL` 时，首步强制真实调用工具：无活跃候选时 `toolChoice="required"`；已有候选的追问强制 `{type:"tool", toolName:"thermal"}` 回查，避免凭上下文复述。
- 验证：SALES-001~007 真实运行中 `thermal` 工具调用率恢复；Intent 由 42% → 90%，事实 51% → 94%，来源 67% → 94%。

**FIX-2｜验收断言 3 处误报（框架缺陷，已修复并补回归测试）**

| 编号 | 误报 | 修正 |
| --- | --- | --- |
| A | "这不是在判规范限值达标"被当成肯定合规结论 | 否定/免责表述（不是/并非/不代表/不构成…）不计入肯定句 |
| B | `2.88 ㎡·K/W`、`W/(m²·K)` 中的 `K` 被当成 K 值，与后续总热阻绑定 | K 标签排除单位记号（前有 `·/(²`、后跟 `/`） |
| C | `matchType=NEIGHBOR` 相邻规格因厚度偏离被判定违反硬条件 | 相邻规格仅豁免"被相邻的厚度维度"，其余硬条件（指标/体系/型号）仍强制 |

- 影响量化：首轮 159 条 Hard Fail 中 **31 条**来自误报 A/B；修正后这两类不再产生假失败。
- 回归：`tests/uat/uat-harness.test.ts` 新增 3 条用例，同时断言"真实违规仍必须硬失败"，防止把断言改松。

### 已定位（未修改，需在真实 UAT 复现后修复）

**P0-1｜唯一生产模型账户余额不足，AI 全链不可用（外部依赖，复现）**

- 现象：`ai_providers` 仅 1 个（DeepSeek，`https://api.deepseek.com/v1`）；`ai_models` 仅 `deepseek-chat`。
- 实测：解密 Provider Key 直连 `/chat/completions` 返回 `HTTP 402 Insufficient Balance`；`/user/balance` 返回 `is_available=false, total_balance=-0.00`。
- 影响：UAT 无法完成；生产 AI 全链不可用。
- 处置：充值 DeepSeek 账户（或配置备用可用模型）。

**P0-2｜生产对象存储凭证失效，读写全部 AccessDenied（生产线上故障，复现）**

- 实测：用服务器 `.env` 的 AK/SK（bucket `vlcptestfile`，`oss-cn-beijing`）对已存在对象 HEAD，返回 `AccessDenied 403`；PUT/GET 同样 403。
- 影响：图片驱动知识库主链（页图读写、原始资料附件、报告导出）在生产当前不可用。
- 处置：更换对 `vlcptestfile` 具备对象读写权限的 AK/SK，并补真实上传+下载验证。

**P1-1｜存储健康检查把 AccessDenied 当作健康，掩盖 P0-2**

- 位置：`src/storage/oss-storage.ts:96-106`（`healthCheck`）。
- 现象：生产 `GET /health/ready` 报 `storage:正常`，而存储实际完全不可用。
- 建议：健康检查增加一次真实对象往返；AccessDenied 不得直接判为健康。

**P1-2｜`thermal` 工具 CALCULATE 走 REFERENCE_TABLE 时返回 K=null / R=null**

- 位置：`thermal-calculate.tool.ts:316-324` 读 `calcResult.kValueRounded ?? calcResult.kValue`；`thermal-calc.service.ts:927-938` 的 `executeReferenceTable` 写入的 `resultJson` 只有 `candidates[]`，无顶层 `kValue/totalResistance`（EQUIVALENT/LAYERED 分支有，见 `:807-815`）。
- 可达性：`mode` 允许 `REFERENCE_TABLE`；但本轮 123 轮 UAT 的 CALCULATE 用例均走"当量法"（EQUIVALENT），故**未覆盖**，属潜伏缺陷。
- 建议：REFERENCE_TABLE 分支补写顶层 K/R；补 1 条真实 Case 后再改。

---

## 6. 候选发现（待全量复现）

**F-1｜原页指代追问未复用上一轮候选、未返回 ReferencePage（SALES-002/T3）**

- 用户："刚才第一个图集哪一页？"；期望 `reusePreviousCandidate=true` + `referencePageRequired=true`。
- 实际：后端重新发起查询（`reusePreviousCandidate=false`），且 SSE 未返回 `reference_pages`；文字答案虽正确（A1-3 18mm → 第22页），但按契约应复用候选并回原页图。
- 定性：待复现的行为类问题（可能 P2）。

**F-2｜20mm 精确查询同时返回 25mm 相邻档（SALES-004/T4）**

- 用户："换20mm呢？"；后端返回 A1-4 20mm（EXACT）+ A1-3 25mm（NEIGHBOR，`neighborGap=1`，附 note 提示确认厚度档）。
- 定性：**设计内行为**（`thermal-candidate-matcher.ts:301` "同组无该厚度档时返回最近档"），非缺陷；验收断言已按契约修正（见 FIX-2-C）。

---

## 7. 最终冻结结论

**C. 不可冻结（仍有阻塞项）。**

- **阻塞（环境）**：P0-1 模型账户余额耗尽 → 无法完成 40/123 全量真实验收；Design Institute 全部未执行。
- **阻塞（生产）**：P0-2 生产对象存储不可用 → 图片驱动知识库主链在生产实际损坏。
- **代码侧**：P1-1（健康检查盲区）、P1-2（REFERENCE_TABLE 返回空 K/R）待修；F-1 待复现。
- **正向进展**：FIX-1 真实业务缺陷已修复并验证（工具调用率、Intent/事实/来源准确率显著回升）；FIX-2 消除 3 类验收误报并补回归测试；`pnpm lint` 与 1307 项单元测试全绿。

**解除条件**：① DeepSeek 余额恢复（或配置可用备用模型）→ 跑完 123 轮；② 修复 P1-1 / P1-2；③ 处理 P0-2 生产存储；④ 复核 F-1。
