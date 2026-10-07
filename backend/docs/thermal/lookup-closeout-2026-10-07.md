# 热工参考查询最终收口（2026-10-07）

本轮范围为 Backend 查询语义、会话上下文及 Answer Contract。没有修改 Thermal Engine、数据库 schema 或 migration。既有未提交改动保留；没有执行部署、生产迁移或对象存储联调。

## 查询结构与兼容

内部标准结构：`{ metric: "K" | "TOTAL_R" | "PRODUCT_R", targetValue, mode: "APPROX" | "MAX_LIMIT" | "MIN_LIMIT" | "EXACT", tolerance }`，体系、方案、规格、产品与厚度继续使用现有 DTO。总热阻取 `totalThermalResistance`，产品层热阻取 `productThermalResistance`，不互推，不由 K 反算。

HTTP 候选 API 新增 `metric/targetValue/mode/tolerance`，metric 和 targetValue 必须成对。响应增加 `metric/targetValue/tolerance`，保留 `lookupMode/kTolerance`；R 查询的 kTolerance 为 null。所有查询共用匹配函数，APPROX 按绝对距离，MAX_LIMIT 按 target-value，MIN_LIMIT 按 value-target 排序。R 的 ranking 增加 metric/metricGap，kGap 保留兼容字段；不能把 R 距离解释成 K 距离。

旧 `targetK`、`kMode`、`kTolerance` 仍有效：裸 targetK 默认 MAX_LIMIT。旧 `targetResistance` 默认总热阻 MIN_LIMIT，旧 K + R 组合仍保留两项硬条件。旧 Tool `targetR` 保留；AI 依据用户语义 → Tool 模式 → 历史 → APPROX。Tool 的 `mode` 原本用于 CALCULATE，继续保留该含义，查表模式仍叫 `lookupMode`；新查表指标传 `metric/targetValue`。新增字段采用可选方式，旧字段没有删除；旧容差会被限制，EXACT 不再允许放大。

## 容差与用户语义

规则单一来源：`src/modules/thermal/thermal-lookup-mode.ts`。

| 指标 | APPROX 默认绝对容差 | 用户近似容差最大值 | EXACT 固定精度容差 | 单位 |
| --- | --- | --- | --- | --- |
| K | 0.02 | 0.05 | 0.0005 | W/(m²·K) |
| TOTAL_R | 0.05 | 0.2 | 0.0005 | m²·K/W |
| PRODUCT_R | 0.05 | 0.2 | 0.0005 | m²·K/W |

R 默认窗口覆盖本轮指定图集档位 3.297≈3.3 和 2.880≈2.9；后续调整只能集中修改规则。MAX_LIMIT/MIN_LIMIT 不使用容差放宽边界。

AI Tool 的 tolerance/kTolerance 不直接生效。只有用户原话明确 `±0.01`、`上下0.05`、正负/误差/容差时才接受并 clamp。历史仅继承标记 `toleranceSource=USER` 的已确认容差；旧历史自由容差回退默认。切指标/模式会清除原近似窗口。该来源字段只在现有会话 JSON 中保存，无数据库列变化。HTTP 直接调用者仍可提供容差，但统一限制最大范围，EXACT 固定精度不能 override。

自然语言覆盖 K/传热系数、总热阻/总R/R0/主断面传热阻、产品热阻/产品层热阻/保温板热阻/VICP热阻/产品R。「传热阻系数」没有明确指标上下文时要求澄清，不按数字大小猜正式指标。用户切指标但没有给出目标值时也澄清。

## 会话继承及正式重查

普通厚度追问继承指标、目标、模式、独立体系/型号条件。切体系清旧 systemId、schemeId/schemeCode、依赖 productSpecId/catalogProductId；切型号或目录产品清旧规格，切型号也清旧目录产品；切方案清继承规格，从完整正式数据中重新匹配 scheme/product 关系。模型重复携带旧依赖 ID 时同样清除；明确的新 ID 保留并由正式查询验证组合。

签名包含指标、目标、模式、实际容差、归一体系、方案、型号、产品、规格和厚度。变化时必须调用 queryThermalCandidates，不能筛上一轮 top12。普通查询即使签名相同也重新读取正式状态。只有「刚才那个方案总 R 是多少 / 第一个是什么规格 / 看刚才那页」等纯参数或原页指代可复用历史。未命中仍保存查询条件，支持后续追问。

候选状态与结果归一化保留完整正式字段、双 R、K、原页、ranking 和 fallback 标志。参考页仍通过现有当前 PUBLISHED/有效/未删除知识版本守卫输出。

## 回答与 readiness

指定体系实际命中才先回答「有」。`isFallback=true` 或 `matchedSystemHint=false` 时，系统 Answer Contract 与 Tool 都要求首句说明指定体系没有正式匹配，再说明其他体系参考结果。没有选用表匹配时继续检索知识库；不编造档位。APPROX 只说接近，上下限筛选不宣称当地规范达标。REFERENCE_LOOKUP 与正式计算/法规合规保持分离。

未修改 readiness 实现；全量测试继续覆盖 AI_ENABLED 无 searchable chunks 阻止发布、BROWSE_ONLY 规则与空页 blocker、STRICT 统一发布门禁、离线页就绪时 optional ORIGINAL failed 仅 warning。

## 本轮修改文件

- `src/modules/thermal/thermal-lookup-mode.ts`：指标/模式/容差、旧参数 normalize、自然语言解析、统一数值匹配与距离。
- `src/modules/thermal/thermal-candidate-matcher.ts`：统一指标条件和排序，保留厚度/型号/体系等硬条件。
- `src/modules/thermal/thermal-candidate.schemas.ts`：兼容 DTO、新指标字段和响应。
- `src/modules/thermal/thermal-candidate.service.ts`：normalize、完整正式取数、指标响应及日志；R 查询不隐式附加 K 限值过滤，合规标注独立保留。
- `src/modules/ai/tools/thermal-lookup.ts`：依赖 ID 清理、签名、自然语言/容差授权及历史复用边界。
- `src/modules/ai/tools/thermal-calculate.tool.ts`：新增指标 Tool 输入、正式重查及会话快照。
- `src/modules/ai/conversation-task.ts`：指标/目标/容差来源、ranking 的历史解析与上下文。
- `src/modules/ai/tools/tool-result-normalizer.ts`：完整候选类型、指标元信息与回退文案。
- `src/shared/ai-answer-contract.ts`：查表意图、双 R 文案和跨体系回退。
- 测试：`src/modules/thermal/thermal-lookup-semantics.test.ts`、`src/modules/thermal/thermal-candidate.service.test.ts`、`src/modules/ai/tools/thermal-lookup.test.ts`；新增 `src/modules/ai/tools/thermal-lookup.tool.test.ts`、`src/shared/ai-answer-contract.test.ts`。
- 规则文档：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、`docs/thermal/README.md`、本文件。

## 验证记录

| 检查 | 结果 |
| --- | --- |
| `pnpm lint` | 通过；实际执行 `tsc -p tsconfig.json --noEmit` |
| `pnpm typecheck` | package.json 没有此脚本；类型检查由 lint 完成 |
| `pnpm test` | 136 个文件通过、1 个文件跳过；1114 项通过、1 项跳过 |
| `pnpm build` | 通过 |
| `pnpm db:check` | 通过 |
| `node scripts/verify-migrations.mjs --static` | SQL/journal/snapshot 静态迁移链检查通过 |
| `pnpm db:verify` | 静态阶段通过，隔离 PostgreSQL 阶段未能启动：本机 Docker 未安装或不在 PATH；不能标记执行验证通过 |
| `git diff --check`（本轮文件） | 通过 |

原有跳过项为 `atlas-parse.regression.test.ts` 的实际图集 PDF 回归：本机没有 `VICP_ATLAS_PDF` 对应文件。新增 A—J 使用指定 A1-3/18mm/产品 R 2.880/总 R 3.297/K 0.303/第 22 页的回归行，覆盖 matcher、服务层桩、真实 Tool 执行逻辑（外部数据库/存储为桩）、会话持久化往返和 Answer Contract。额外覆盖三指标四模式、排序、容差 clamp、指标切换、ID 清理、签名变化、历史 top12 以外结果、未命中保存、旧 DTO/旧 Tool 双条件，以及 readiness 原有回归。

本轮未执行真实模型请求、真实图集数据库查询或对象存储访问。代码功能回归已通过，可作为冻结候选；隔离数据库执行验证仍需在具备 Docker 的验证环境完成，不据此声明完整生产 Gate 通过。
