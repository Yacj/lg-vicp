# 语义路由与参考建议交付报告

> 后续发布记录：用户在本报告完成后明确授权上线。已执行 `pnpm run deploy --skip-db`，API/Worker在线且部署健康检查通过；服务器.env保留，未执行迁移、seed或新的测试。本报告下文“未部署”描述的是代码验收完成时的历史状态；真实模型UAT的BLOCKED记录未被上线健康检查替代。


本轮以最新工作区为准，保留此前跨页查表修复和已有用户修改。本轮没有部署、迁移、种子或业务数据改写。

## 根因与结果

旧 `positiveRequestText` 删除否定作用域，Advice帮助函数和Domain开放正则先后抢分类；参数变化被当作Advice unsafe，旧GENERAL历史又用同一关键词恢复目标。这导致“确认K”进入动作、“暂不确认先建议”无法稳定只读、“45mm初步方案”与查询互斥。

三个帮助函数已删除。既有 `resolveDomainTurn` 成为开放表达唯一语义入口：intent、relation、continuedGoal、adviceMode、patch、reference与requestedEffect先经Zod，再经Backend Policy。Domain同步快路径仅保留既有完整命令/精确问候，未命中不能给Tool猜授权。能力路由消费该决策，不再另用关键词推断领域。

模型提案仍不是正式ID或数据库权限。Query/Action/Report/Calculate须直接、肯定的请求合同与足够置信；正式动作继续Grounding→权限/来源/revision→原状态机。Confirm仍只允许既有完整命令；报告仍需显式授权和CONFIRMED不可变Snapshot。

## 行为前后与边界

| 场景 | 旧行为 | 当前受控合同与服务验证 |
|---|---|---|
| 四基层查询→能不能出方案→不按地区建筑 | 重复参数/强制条件/泛化澄清 | 引用当前有效四候选，按实际基层择一的参考建议，不创建SolutionState，不判断达标 |
| 45mm初步方案+比较基层 | 参数变化排斥Advice | 目标与条件正交；同条件复用，新条件先查表，再建议 |
| 不要方案只列原表/暂不确认先建议/确认K | 否定丢失或动作子串抢路由 | 原话完整进入语义合同，分别VIEW/ADVICE/DETAIL，零正式动作 |
| 仅报告提纲 | 可能混入报告目标 | OUTLINE只读框架，无PDF任务 |
| 模型低置信/超时/解析异常 | 通用三选一或词法兜底 | 无歧义且证据/来源有效的只读提案可回答；不可用则按当前范围给框架或具体澄清，副作用拒绝 |
| 旧GENERAL里实际请求初步方案 | 关键词猜目标 | 同一模型显式提出continuedGoal，后端核验最近两轮、连续证据、高置信和当前有效来源；不从历史造ID |
| 新条件没有匹配 | 可能沿用旧45mm | 发布空的新revision；不能把旧事实当新条件方案 |
| 换话题/取消/正式选择/过期/跨项目/变revision | 可能续用旧目标 | pendingAdvice失效，来源服务仍重验归属、有效期、发布/optionId和原子事实 |

建议仍只是非正式选型参考；不按最小K建议替换墙体，不补造层构造/产品参数，不声称审图或节能合规。地区/建筑的排除仅本次评估视图；结构、基层和其他查询硬条件保留，项目事实与正式QueryState不被永久清空。

## 实际文件清单与扩展原因

以下列本轮语义治理的实现与验收文件，不重复把前次跨页页面识别、部署脚本改动计为本轮修改。

| 文件 | 作用/必要性 |
|---|---|
| `src/modules/ai/ai-domain-turn-decision.ts` | 移除开放词法优先级，仅封闭协议快路径 |
| `src/modules/ai/ai-domain-turn-decision.service.ts` | 单一模型入口、完整语义合同、两轮业务上下文、安全故障降级 |
| `src/modules/ai/ai-domain-semantic.ts`（新增） | Zod语义提案，不能提供正式ID/Confirm |
| `src/modules/ai/ai-domain-policy.ts`（新增） | 原话/patch/副作用/引用revision/新查询与旧序号门禁 |
| `src/modules/ai/ai-generation.service.ts` | Advice和新条件查询组合、禁止Agent副作用、空结果失效、诊断与目标保存 |
| `src/modules/ai/ai-capability-router.ts` | 移除与Domain竞争的能力关键词判断 |
| `src/modules/ai/solution-advice-intent.ts`（删除） | 删除否定剥离、开放关键词Mutation/Advice/Document判定 |
| `src/modules/ai/solution-advice-context.ts` | 目标/模式/排除范围/TTL/revision，切题和正式动作清理 |
| `src/modules/ai/solution-advice-context.service.ts` | 旧历史仅读取两轮必要目标；移除关键词恢复 |
| `src/modules/ai/solution-advice.service.ts` | OUTLINE框架、只读来源建议、保留结构硬条件、受控旧目标恢复 |
| `src/modules/ai/reference-candidate-resolver.service.ts` | Advice引用范围由语义决定，逐候选重验当前确认来源 |
| `src/modules/ai/reference-candidate-selection.ts` | 既有强格式编码语法复用于正式构造字段；实际A3-3/A3-4带外墙前缀，不能因此丢失身份；不依据名称推族/ID |
| `src/modules/ai/reference-query.service.ts` | 缺Domain查询许可拒绝自动查表 |
| `src/modules/ai/candidate-result.service.ts` | Advice的新条件查询只保存会话Candidate Result，即使有editable state也不刷新正式方案 |
| `src/modules/ai/solution-action-semantic.service.ts` | 只读Domain决策优先退出；不再让第二个技术快路径竞争动作目标 |
| `src/modules/ai/solution-action-semantic.ts` | 复用原引用数字/编码证据核验，Formal生命周期与完整命令集合不变 |

未修改本轮Vision、页面识别/确认、完整页渲染/高亮、已发布选项、Thermal Engine、Snapshot或PDF结构。`conversation-task.ts`和共享Answer Contract沿用此前Advice可选JSON字段/只读合同基础。

测试新增：`domain-semantic-regression.test.ts`、`ai-domain-policy.test.ts`、`solution-action-semantic.test.ts`、`domain-semantic.fixture.ts`；补充两个`solution-advice*.test.ts`的目标恢复、同源编码、故障边界。

旧测试迁移为显式受控Domain提案/Tool合同：`ai-domain-turn-decision*.test.ts`、`high-frequency-domain-matrix.test.ts`、`agent-followup-p0.audit.test.ts`、`domain-followup-p0.audit.test.ts`、`reference-followup-p0.audit.test.ts`、`reference-query.service.test.ts`、`reference-candidate-resolver.service.test.ts`、`solution-action-semantic.service.test.ts`、`solution-state.service.test.ts`、`thermal-answer-sse.test.ts`、`ai-capability-router.test.ts`、`ai-answer-regression.test.ts`、`structured-reference-query.test.ts`、`tools/thermal-lookup.tool.test.ts`、`tools/thermal-constraint-flow.test.ts`、`thermal/thermal-interaction-closeout.test.ts`。保留参数、来源、状态、实际Tool路由断言；不把fixture识别视为真实模型验收。新增状态测试执行真实服务与事务模拟数据库，断言Advice查询在有/无editable state时均不修改正式状态/快照，空结果刷新revision。

治理文件：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、`docs/ai/semantic-matching-policy.md`；AST脚本/测试/精确豁免清单为`scripts/check-semantic-matching*`与`scripts/semantic-matching-exemptions.json`；`package.json`/`pnpm-lock.yaml`新增开发期Babel解析器并将检查接入lint；monorepo实际CI路径为`../.github/workflows/backend-semantic.yml`。仓库TypeScript 7使用原生编译器包，不提供旧JS compiler AST API，因此该治理工具使用Babel TypeScript AST；没有运行时依赖或业务解析器替换。

只读验证脚本为`scripts/verify-semantic-advice-readonly.ts`。结果与阶段0审计见下列证据。

## 实际验证结果

| 检查 | 实际结果 |
|---|---|
| 阶段0新增16反例先跑旧实现 | **16失败**，包含开放表达绕过单一语义合同的断言；后续全部通过 |
| 全量Vitest | **2168通过、1跳过、0失败**，194个测试文件；逐文件统计与131项核心用例结果见JSON |
| 最后结构硬条件保留后的相关回归 | **52通过、0失败**；随后lint/build通过 |
| AST匹配门禁 | **通过**，10关键文件，30节点；豁免仅封闭命令/格式/工程提取/原话证据/正式枚举/ID集合 |
| `pnpm lint` | **通过**（含AST和TypeScript） |
| `pnpm build` | **通过** |
| `pnpm db:check` | **通过**，仅迁移静态检查，没有执行迁移 |
| `.env`真实数据库显式READ ONLY事务 | **通过**，数据库连接禁止写入 |
| 实际四基层45mm与页5/6 | **通过**：3.313/.302、3.398/.294、3.416/.293、4.040/.248，基层200/190/240/200mm逐条绑定 |
| 真实归属/发布来源/optionId建议服务 | **通过**，四候选绑定第5页两项、第6页两项；使用受控只读目标，不冒充真实模型通过 |
| 真实模型三轮/否定/参数/提纲 | **BLOCKED**，运行时在`Decipheriv.final → decryptSecret → decryptProviderKey`解密服务商密钥失败，未完成模型请求 |
| 真正生产HTTP/SSE三轮UAT | **未执行/BLOCKED**；本地Fastify inject及SSE协议fixture不等于生产端点UAT |
| 远端GitHub CI | 配置已提交到工作区，**尚未远端运行** |

证据：[阶段0审计](semantic-routing-audit-2026-10-13.md)、[完整回归结果](semantic-regression-results-2026-10-13.json)、[真实数据库及模型阻塞记录](semantic-advice-db-2026-10-13.json)。只读连接和服务调用不创建消息、测试用户、项目、正式方案、快照或报告。

## 剩余风险与交付范围

真实语言分类质量需要在服务商密钥能正常解密、且有隔离会话环境时继续做Agent on/off和真实HTTP/SSE验收；当前不能宣称真实三轮全部通过。应核对运行环境的`AI_CONFIG_ENCRYPTION_KEY`与数据库加密配置是否匹配；本轮没有改密钥、`.env`或数据库配置。

开放表达现在依赖统一语义模型，增加一次分类调用；不可用时针对当前范围澄清，不能猜新的写入授权或取消目标。精确完整命令保持既有状态校验。

AST门禁约束关键文件直接词法表达式，不能替代间接调用和语义质量的人工审查。扩大扫描范围前需迁移存量模块，不得给开放意图批量豁免。没有新增需灰区owner批准的自然语言规则。

本轮仅交付工作区修复与验证，未将新语义合同部署线上。前次部署脚本、跨页修复和其他前端未提交改动保留。
