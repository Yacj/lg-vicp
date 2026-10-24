# AI语义匹配强制规范

2026-10-19：SM-SUBSTRATE-SCALAR-01仅归一已声明substrateThickness字段的完整“数值+mm/毫米”表示，复用工程厚度解析、原话证据与置信度，不推断指标或授权；五个正例、七个冲突/范围/否定反例及多条件遗漏检查见phase03-handoff-replay.test.ts。正式编码集合按目录身份核验，未命中的其他条件仍拒绝；单一正式表标题型号只用于只读事实，见同一回放测试。产品简称来自用户明确确认的受控名称表，近似编辑距离只产出名称建议，不改变Domain或绑定产品；证据见product-identity-approvals.test.ts。续问上下文仅服务器验证紧邻读取并重验会话归属/同端/项目/24h，不构成副作用授权。无新增开放自然语言快路径或AST豁免。

2026-10-18 λ参数规则登记：以下仅在结构化参数提案验证中提取/核验封闭工程字段，不按原句路由意图。开放语义仍由resolveDomainTurn提出PRODUCT_PARAMETER_QUERY，副作用为READ_ONLY。新增两个字段文件纳入AST精确指纹检查，未扩大成全项目正则禁令。

| Rule ID | 封闭边界 | 正反例与多轮证据 |
| --- | --- | --- |
| SM-PARAMETER-FIELD-01 | 仅导热系数、λ、完整lambda字段名；模糊系数、K/R、厚度不是λ | product-parameter-query.test.ts 5个字段正例/5个相似反例；语义否定/引用/假设只读拒绝各1例 |
| SM-PARAMETER-UNIT-01 | W/(m·K)、W/(m.K)、W/mK及字形归一；面积单位拒绝；单位内部K不作为指标 | 标准单位与面积单位反例、双指标/单位K例；不换算、不选择领域 |
| SM-PARAMETER-COMPARISON-01 | 标量LT/LTE/GT/GTE/EXACT/APPROX的封闭符号与同义运算词；±数字仅核验容差，未明确近似窗口不补值 | 比较运算正反例、裸值/近似/遗漏容差例；继承、修正、切话题在product-parameter-continuity.test.ts |
| SM-PARAMETER-EVIDENCE-01 | 已核验本轮或紧邻待澄清原问的连续证据和原名称，不删否定、不纠错、不从目录造数 | 多数字/厚度/未知别名/伪造目标/失效pending反例；Service执行时再次核验 |

实现位于src/shared/lambda-field.ts与src/modules/ai/product-parameter-query.ts；精确AST节点登记于scripts/semantic-matching-exemptions.json。上述规则没有开放语义快路径或正式动作授权职责。

适用于 Domain、Advice、Action 路由及其调用入口。开放自然语言由现有 `resolveDomainTurn` 理解；模型仅给提案。正式ID、参数事实、权限、状态机和副作用均由后端校验。不得新增竞争的 Advice Router。

## 允许的有限用途

1. **工程格式提取**：构造编码、45mm、K≤0.3、R₀、页码、单位和数值运算符。只提取数据，不签发写入授权。沿用 `thermal-lookup-*`、编码规范化、引用 grounding，保留单位、全半角与边界回归。
2. **UI/机器协议**：正式枚举、Tool名、Zod/JSON合同、后端字段映射；不得猜自然语言。
3. **封闭完整命令**：整句等于已定义命令，仍须权限、revision、来源和状态验证。引用、否定、假设或复合句不能命中；Confirm只能既有完整命令。
4. **无损格式归一**：NFKC、首尾空白、末尾标点、工程符号。保留原话、否定范围和实体差异。
5. **后端事实匹配**：正式ID、编码、受控别名、确认档位、原话连续证据与候选集合运算；同源身份必须绑定发布版本、optionId和revision。
6. **封闭性能快路径**：如精确问候，未命中交语义解析，不能扩大权限。

`includes`/`Set.has`/`startsWith`/切片/词表与RegExp一样受限；改变API不改变规则。

## 禁止事项

- 禁止用方案/建议/通用/推荐等子串判定 Advice、选择、报告或写入。
- 禁止用确认/保留/修订/开始/加入等开放子串判断 mutation、Final、Confirm或报告。
- 禁止删否定/排除条件后判断正向意图，禁止恢复 `positiveRequestText`。
- 禁止因出现厚度/热工指标排除 Advice或自动执行计算；条件与输出目标正交。
- 候选存在或 pending boolean 不等于续聊、Selected、写入或报告授权。
- 低置信、超时、解析失败不得统一问“查资料、筛方案还是操作”；只读可有边界回答或针对性澄清，副作用 fail-closed。
- 禁止把未显式确认的聊天变成Snapshot/PDF；正式报告仍须CONFIRMED不可变Snapshot。
- 禁止跨项目、发布版本、revision、过期或无权限候选兜底；不得填造基层、K/R、产品和页码。
- 禁止为单条失败UAT新增原句正则；也禁止删除工程解析、将确定性事实和权限交给模型。

## 新自然语言快路径灰区准入

六项必须同时具备，否则不得合并：

1. Rule ID、精确封闭语法、现有schema/受控数据/语义解析不足的理由。
2. 职责为提取还是意图判断；意图判断默认禁止，完整命令除外。
3. 至少5个正例、5个相似反例、3个否定/引用/多轮用例。
4. 无副作用授权证明；mutation仍走Domain Policy和原状态机。
5. 与Domain/Thermal/Solution Parser无冲突的证据。
6. Code Review中明确模块owner批准，CI回归通过。不得将代理自行补manifest视为owner批准。

SM-PAGE-SCOPE-COVERAGE-01仅在Domain已决定QUERY后的字段验证中，检查封闭部位枚举是否丢失；它只拒绝不完整提案，不新增意图路由或补入条件。显式REMOVE不恢复，否定/引用无法一致核验则澄清；5正5反及取消/否定/引用回归见thermal-query-context-regression.test.ts。其职责属于正式字段/原话证据校验，不是开放语义快路径。

本次没有新增灰区自然语言规则。已有完整命令集合保持原样，Domain开放正则和三个建议帮助函数已移除。

## 一次语义决策与后端门禁

`ai-domain-semantic.ts` 解析 intent、relation、adviceMode、constraintPatch、reference和requestedEffect；保留完整原话。`ai-domain-policy.ts` 核验schema、连续证据、revision、肯定直接请求及确定性参数。Action/Report/Calculate及发布候选的Query需明确effect且置信度≥0.9；0.8至0.9的Query仅在完整pageQuery经后端逐字段核验后FACTS_ONLY展示，不改写Candidate或执行副作用；更低置信与超时保持拒绝。factRead≥0.8仅进入受控只读事实服务，不能发布Candidate或执行副作用；返回已核验记录或缺身份澄清。未形成Candidate的原页回溯只消费绑定本人同端同项目的24h内实际引用，重验版本/revision/optionId，不接受旧序号。只读建议在无歧义、有原话和有效来源时可安全降级。新建议条件置信度≥0.8才查表，实际参数仍由原解析器获取。

`EXCLUDE_FROM_THIS_ADVICE`仅允许地区/建筑类型，不能清除项目事实；建议SET/CLEAR这些字段被拒绝。普通建议只消费最近可见候选，新增条件调用既有查表，不执行Thermal Engine。建议查询只更新会话Candidate Result，不能刷新已选或正式SolutionState。

pendingAdvice记录目标、模式、排除评估、会话/项目/revision/创建与有效期。切话题、取消、正式动作及刷新revision立即使旧目标失效。历史仅取两轮必要业务目标，不从聊天造候选ID。模型不可用时不把历史目标当新动作授权。

## AST强制检查与审核

`pnpm semantic:check` 通过 Babel TypeScript AST 检查 `ai-domain-*`、`solution-advice*`、`solution-action-semantic*`、`ai-capability-router.ts`。检测裸正则/RegExp构造、词法字符串方法、Set.has及中文字面量分支，不用grep作为唯一判据。

`scripts/semantic-matching-exemptions.json`每项绑定**精确AST节点指纹**、ruleId、白名单类别、原因、反例测试文件。表达式改词、扩大范围、缺少测试或开放意图类别均阻断。现有豁免仅工程格式、无损归一、连续证据、正式枚举/ID集合运算。关键文件原开放规则先移除，再开启严格检查；其余解析器不全局禁止正则。

CI工作流运行AST检查、Vitest、TypeScript lint/build。该检查是技术门禁，不替代owner审核，不能证明所有间接调用均正确；共享生成编排与各Tool仍必须消费同一Domain结果。后续扩大扫描范围前先审计、迁移存量规则，不能批量给开放意图豁免。

## 回归要求与日志

同时检查正常识别、相似反例、否定/引用/假设、多轮、Tool实际路由、事实来源、SSE和数据库无越权写入；只比文案不足。模型fixture只验证受控合同，不能宣称真实模型理解或HTTP端点UAT通过。

诊断记录 intent/source/goal/relation/patch字段及op/route/policyReason/revision/身份/验证状态；不记录凭证或完整敏感原话。真实数据库验证只能显式只读事务；HTTP/SSE验收使用隔离环境和独立测试用户，不写生产会话或已发布资料。未运行必须写未执行或BLOCKED。

AST工具使用的解析器合同见 [Babel官方文档](https://babeljs.io/docs/babel-parser)。

2026-10-21 SM-PARAMETER-COMPARISON-01 补充：继续使用封闭工程运算符核验，不路由意图。等于、=、==统一EXACT；不等于、!=、≠不支持单侧筛选，显式拒绝，不删除否定。提案校验和上下文合并共用同一提取器。证据：product-filter-continuation.test.ts覆盖比较符替换、只改数值继承上限、三种不等于及换话题/越权/身份/多数字反例；product-parameter-query.test.ts与parameter-continuation.test.ts关联回归保持。AST只更新本次三条已审阅精确表达式，检查器及允许类别不变。
