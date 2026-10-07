# 热工自然语言与多条件最终收口（2026-10-07）

本轮仅扩展参考查询语义、会话依赖清理和结果提示。没有修改数据库结构、迁移、热工引擎公式、知识库页面/识别、报告快照或部署配置。

## 比较词与产品口径

完整否定短语优先于普通比较词：不应大于、不得大于、不应/不得超过、不高于为 MAX_LIMIT（≤）；不应小于、不得小于、不应/不得低于、不低于为 MIN_LIMIT（≥）。以上为下限，以下/以内为上限。

采用方案 B：普通“小于 / <”按“不超过 / ≤”处理，“大于 / >”按“不低于 / ≥”处理；代码注释与边界相等测试固定此工程筛选口径。保留四种正式查询模式，不新增 LT/GT。

## 多条件与兼容

现有 normalizer 输出 `filters: [{ metric, targetValue, mode, tolerance, ... }]`；每项指标只在自己的自然语言片段解析，K、总 R、产品 R 均可组合。matcher 只做确定性比较，全部条件必须同时满足；精确厚度和相邻档均不能绕过任何热工条件。目标缺失或 OR 关系需澄清，模型只传一项时用户原话中的全部明确条件优先。

HTTP 候选请求及 thermal Tool 新增可选 filters 数组（1～12 项），数组提供时优先于单指标与旧字段。响应新增归一 filters，原 metric/targetValue/lookupMode/tolerance 等作为首项摘要保留。旧 targetK/kMode/kTolerance、targetResistance 与 Tool targetR 保留；旧 K+R 同时提供时转换为两项条件（裸 K 默认上限，旧 R 默认下限）。Tool 正式计算 mode 含义不变。

多指标排序沿用第一项的距离与既有厚度/集优先级规则，不跨单位求和。会话 JSON 持久化全部条件，查询签名包含全部条件；条件变化及普通查询重读完整发布数据，只有纯参数/原页指代可复用历史候选。

## 正式 ID 与缺失条件

productSpecId 改变清旧 catalogProductId 和继承型号；specClass 改变清旧规格/目录；catalogProductId 改变清旧规格；scheme 改变清继承规格/目录。明确的新 ID 交给正式发布行关联查询验证，候选返回正式目录关系，不用旧目录约束新规格。

多标准地区已有 filters 时不再要求旧 targetK，TOTAL_R/PRODUCT_R 查询同样有效。无任何热工条件时仍保留既有多标准选择流程；标准合规标注独立存在，参考查表上下限不触发规范达标判断。

## 容差可追踪

每项归一条件返回 requestedTolerance、effectiveTolerance、toleranceAdjusted。用户总 R 3.3±5 记录 requested=5、effective=0.2、adjusted=true，并返回中文提示“您给出的查询范围较大，系统已按允许的最大范围进行筛选。”AI 回答要求说明实际使用的范围，避免输出内部 clamp 术语。

只有用户原话明确容差或历史 USER 授权可生效，模型直接填写 tolerance（含 filters 中的值）不改变后端默认窗口。默认窗口不冒充用户请求；重复归一保留原始请求与来源。切换模式清旧窗口，EXACT 固定 0.0005。

## 验收数据

固定 A1-3/18mm、K=0.303、总 R=3.297、产品 R=2.880：近似 K0.3/总R3.3/产品R2.9 命中；K不应大于0.3与总R不应小于3.3不命中。新增 K=0.295、总R=3.390、产品R=2.950 行满足 K≤0.3 AND 总R≥3.3；仅满足其中一项的行排除。全部为正式服务桩/Tool 与确定性 matcher 回归，没有对生产数据库试跑。

## 验证结果

最终源码检查（2026-10-07）：

| 脚本 | 真实结果 |
| --- | --- |
| pnpm lint | 通过，执行 tsc --noEmit |
| pnpm typecheck | package.json 无此脚本；类型检查由 lint 完成 |
| pnpm test | 136 文件通过、1 文件跳过；1155 测试通过、1 测试跳过；23.99 秒 |
| pnpm build | 通过，clean + tsc |
| pnpm db:check | 通过，Everything's fine |
| pnpm db:verify | 静态迁移链检查通过；执行验证失败：docker 未安装或不在 PATH |

本机无 Docker、PostgreSQL 可执行程序或专用验证连接；没有使用当前配置的业务数据库替代隔离验证。因此数据库执行验证尚未完成，本轮不宣称全部验收通过。

## 本轮修改文件

- 查询归一与 schema：`src/modules/thermal/thermal-lookup-mode.ts`、新增 `thermal-lookup.schemas.ts`、`thermal-candidate.schemas.ts`。
- 匹配与服务：`src/modules/thermal/thermal-candidate-matcher.ts`、`thermal-candidate.service.ts`。
- AI 链路：`src/modules/ai/tools/thermal-lookup.ts`、`thermal-calculate.tool.ts`、`tool-result-normalizer.ts`、`src/modules/ai/conversation-task.ts`、`src/shared/ai-answer-contract.ts`。
- 验收测试：`src/modules/thermal/thermal-lookup-semantics.test.ts`、`thermal-candidate.service.test.ts`、`src/modules/ai/tools/thermal-lookup.test.ts`、`thermal-lookup.tool.test.ts`、`src/shared/ai-answer-contract.test.ts`。
- 规则与说明：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、本文。

以上为本轮范围，不代表仓库所有未提交改动均来自本轮。API/Tool 为可选字段增量，旧字段与旧单条件语义保留，无 breaking 字段删除；无数据库结构变化。
