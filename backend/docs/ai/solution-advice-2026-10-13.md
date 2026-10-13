> 后续语义治理已替换本文初版关键词帮助函数；最新合同、实际验证与限制见semantic-matching-policy.md和semantic-routing-closeout-2026-10-13.md。本文旧测试数字仅代表该版本历史结果。

# 方案建议、多轮追问与业务目标衔接（2026-10-13）

## 根因

以工作区最新源码为基线，保留之前的跨页热工修复与其他工作区改动。

原Domain Fast Path不识别普通“出个方案”请求；只在`SOLUTION_ACTION`时进入状态动作parser，其余转到通用Agent/文本生成。动作parser负责选中、添加、移除、Final等，无法承担无副作用的方案建议。开放分类输入只有message、previousQuery、hasCandidates，丢失上轮方案目标与助手追问之间的关系；低置信、缺证据或unresolved又统一输出三选一泛化澄清。

本轮使用2页4候选的内存确认数据，测试整个查询→建议→否定合规范围的多轮链，而非只断言某句话匹配Regex。正式生成入口也显式接入同一只读建议服务，不再交给Agent选择动作。

## 行为前后对照

| 输入与上下文 | 原行为 | 新行为 |
| --- | --- | --- |
| 四基层查询后“能不能出个方案” | 通用生成，可能重复四条参数并追问地区/建筑 | SOLUTION_ADVICE/NONE，按现有实际基层给参考选型分支 |
| 再说“不要根据地区和建筑出通用方案” | 目标衔接不足，泛化三选一澄清 | 延续只读建议，地区/建筑仅从建议校验视图移除，不改变正式QueryState |
| “先不判断达标” | 可能因“达标”进合规 | 有当前建议目标则继续建议；没有可继承目标则针对性澄清 |
| “不用生成报告，只给大致方案” | 可能被报告词干扰 | 否定报告后识别咨询产物，不授权报告 |
| 无候选、概念问答后“给我个方案” | 可能自由组织无依据事实 | 只给选型框架与必要的体系/基层范围问题，不给K/R或产品事实 |
| 产品等新话题后“出方案” | 可能暗中沿用旧候选 | 新话题立即中断旧目标，即使新话题回答失败也不恢复 |
| 明确加入/留下/Final/Confirm/制作PDF | 既有正式动作/报告流程 | 保持独立；不存在已确认方案快照时正式报告仍拒绝 |

## 实际改动文件及原因

- `src/modules/ai/ai-domain-turn-decision.ts`：新增`SOLUTION_ADVICE`，mutation为NONE；最小Fast Path调用通用咨询语义特征，不对三句复现逐句打补丁。
- `src/modules/ai/ai-domain-turn-decision.service.ts`：分类输入加入当前作用域内最近两轮目标和助手必要追问；低置信、超时、解析失败时，对能由现有作用域支持的咨询使用只读降级。写操作、计算、报告必须有本轮明确行为证据，不能由模型意图自行授权。必要澄清改为具体体系/基层/候选动作问题。
- `src/modules/ai/solution-advice-intent.ts`：将咨询产物、组织建议行为、否定合规/报告范围、新热工条件、正式动作分开识别。词汇角色与Parser结果组合使用；保留既有完整开始/确认命令及“这些做方案”显式选择合同。普通数据查询、原页/参数解释、正向合规和PDF请求不会被建议抢占。
- `src/modules/ai/solution-advice-context.ts`：Zod校验`adviceBusinessContext`、`pendingAdviceGoal`，绑定conversationId、projectId、候选revision、时间。最多保留两轮业务目标；有效期不超过24h且不超过原候选有效期。新话题立即中断，候选刷新/跨项目/跨会话/过期不能继承目标。
- `src/modules/ai/solution-advice-context.service.ts`：旧会话兼容，仅从本会话最近4条已完成消息读取最多两轮目标/助手追问/后端revision。相同创建时间按角色稳定排序。正文仅用于理解目标，不能推导正式候选ID或工程事实。
- `src/modules/ai/conversation-task.ts`：现有任务JSON的新增字段解析与合并，无新表或迁移；建议上下文不进入正式QueryState、SolutionState。
- `src/modules/ai/solution-advice.service.ts`：新只读建议服务与共用SSE writer。经过既有候选Resolver与QueryState事实校验后，按真实基层/厚度择一组织建议；仅接受完整、有效的发布确认参考候选，不把计算/产品记录改装成图集建议。文案由确定性事实组织，不让模型自由拼数值。不进行标准核验、Engine计算、候选重查或状态写入。
- `src/modules/ai/reference-candidate-resolver.service.ts`：仅增加建议场景的最近可见集合引用；明确序号/构造时仍走既有引用解析。沿用本人/客户端/项目、revision、24h、正式行及确认页optionId校验，不放松原读权限或事实绑定。
- `src/modules/ai/ai-generation.service.ts`：建议是Agent/非Agent共用的后端直接只读路径，工具列表为空，跳过动作parser、候选刷新和报告分支。复用原ReferencePage/SSE持久化；诊断记录建议的候选/页面ID和核验状态。完成正常消息后仅维护轻量任务上下文，新话题中断标记在业务处理前保存。
- `src/shared/ai-answer-contract.ts`：新增Domain Intent映射到现有参考阅读合同；保持C端事件与字段兼容。
- `src/modules/ai/solution-advice.fixture.ts`、`solution-advice.service.test.ts`、`solution-advice-context.test.ts`：四条确认数据与多轮、故障、权限、协议回归。
- `AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`：同步只读建议与正式动作分离的长期约束。

修改Resolver、Answer Contract和任务结构，是为兼容新Intent并复用现有来源门禁；不是另建一套Matcher/Parser。未修改本次知识页识别/确认/高亮算法、79页/890选项、已发布资料、Thermal Engine、数据库结构或种子；未直接修改用户业务数据，也未部署本轮改动。之前工作区的知识引用/部署改动仍保留，不属于本任务新增范围。

## 参考建议输出示例

以下是模拟确认数据通过正式只读门禁后的文案概要，不是正式方案选择或地区规范结论：

针对Ⅲ型VICP薄抹灰外保温系统，以最近展示的4个已核验构造为参考范围，保温板厚度45mm。先核对现场基层，再择一采用相应原页构造：

- 200mm钢筋混凝土 → A3-1，第5页。
- 190mm混凝土空心砌块 → A3-2，第5页。
- 240mm蒸压灰砂砖 → 外墙A3-3，第6页。
- 200mm加气混凝土砌块 → 外墙A3-4，第6页。

不为降低K随意更换结构基层；选定基层分支后核对原页固定、防火、构造层与节点要求。建议限于当前可见候选，不宣称全量覆盖，不包含达标、审图或正式确认结论。

四条Candidate中的45mm、产品层R、R₀、K以及基层/厚度均绑定同一确认选项；正文不整段重写四个K/R参数，原参数仍可在既有ReferencePage查看。每个分支的candidateId、sourcePageId、optionId和回答位置相互对应。

## 验收覆盖

| 要求 | 自动化验证 |
| --- | --- |
| 四基层→出方案→不要地区建筑 | 完整多轮运行查询加载器、Domain分类、建议服务及目标状态回读；4条/2页，目标revision不变 |
| 同义咨询 | 初步方案、按刚才数据建议、参考选型、否定报告、无需合规等 |
| 概念解释后无候选 | 框架/关键范围，不编造热工值 |
| 明确加入方案 | 独立动作分类与原Semantic Parser/Grounding定位第一个；既有生命周期测试继续通过 |
| 正式报告/合规 | 缺Confirmed Snapshot拒绝；上海住宅缺正式限值为UNAVAILABLE，不声称达标 |
| 换话题/失效目标 | 产品话题立即清作用域，包含新话题回答失败场景；跨项目/会话/revision及时间失效 |
| 新条件衔接 | 同45mm建议复用当前候选，显式改40mm走Refine；新查询/Refine失败不能恢复旧建议目标 |
| 来源/事实变化 | 撤回来源、旧optionId、候选无效、用户/客户端无权时不引用 |
| 无副作用 | 建议服务的DB insert/update及状态mutation、快照、报告、计算、重查入口调用次数均为0；保留正式QueryState原值 |
| 分类失败 | 低置信/超时/解析异常对咨询安全降级；正式动作仍只澄清，不猜选择 |
| ReferencePage/SSE | Fastify inject协议夹具两轮建议，四个optionId对应第5/6页，无内部引用标记、无solution_state/report_queued事件 |
| 旧会话/上下文合同 | 最近两轮目标与助手追问、schema回读、范围有效期及完整开始/确认/PDF边界 |

## 本轮实际执行结果

- 先运行8个现有相关及新增测试文件：152通过。
- 全量回归首次发现两条旧合同边界回退（当前池显式选择、PDF请求）；修复后4个相关文件114通过。
- `pnpm exec vitest run src/modules/ai/solution-advice.service.test.ts src/modules/ai/solution-advice-context.test.ts`：最终新增两个测试文件共39条通过。
- 最终`pnpm test`：2102通过、1跳过；189个测试文件通过、1个跳过。
- `pnpm lint`、`pnpm build`：通过。
- `pnpm db:check`：迁移文件静态检查通过，没有执行迁移或数据库写入。
- `git diff --check`：通过（仅现有LF/CRLF提示）。

Fastify/SSE测试使用内存候选及模拟DB/分类模型，调用生产共用建议服务与writer；不等于真实会话API/LLM网关UAT。未运行线上HTTP/SSE：需要隔离账号、会话库及依赖，现有真实连接会落消息/审计/任务状态，本次不写用户数据。全量测试仍有既有AI SDK image内容类型弃用提示，不影响通过。

## 剩余风险

开放咨询表达未必都有足够证据；缺作用域或来源时仍需针对性澄清，不能为了降澄清率放松正式动作。建议只覆盖当前实际可见候选；截断之外的档位不加入建议，也不宣称全量最优。旧会话没有可读取的后端目标/revision，或目标已失效时会拒绝沿用，需用户明确新的参考范围。真实模型体验和完整线上多轮路由仍需隔离环境UAT。
