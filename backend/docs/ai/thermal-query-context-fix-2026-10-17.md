# 热工查询与会话上下文修复（2026-10-17）

本轮承接[专项审计](thermal-query-context-audit-2026-10-17.md)，修复口语指标查询、澄清续查及同类 UAT 上下文问题。热工计算公式没有变更；“有无 K≈0.3 的材料/方案”属于读取确认资料，不等于对指定构造重新计算。

## 根因与实现

| 根因 | 修复及受影响入口 |
|---|---|
| 澄清回复只说 K 时，没有有效查询可继承；原问数值证据又不在本轮 | `query-clarification-context.ts` 只读取紧邻已完成问答，绑定本人、会话、客户端、项目及 24h；只将已核验原话交给 QUERY grounding，不制造有效 QueryState/Candidate。当前明确指标与原问唯一数值可分别提供证据 |
| 同事务消息创建时间相同，以随机 UUID 排序可能读错问答顺序 | 已完成时间优先排序；排除当前用户消息 |
| “方案有吗”进入通用建议，K 上限被吞掉 | Domain 明确区分存在性查询与建议；Policy 拒绝丢弃指标条件的 Advice，最多一次结构纠正，共用原超时预算 |
| “3 型”的 3 被误绑为 K 目标；泛称不同砖墙被收窄成某种材料 | 原工程数字角色补型号字形；模型使用现有型号/厚度提示，未指定具体基层时查询集合，后端逐字段核验 |
| pageQuery 内层目标错误；局部改厚度时重复历史实体，违反本轮证据规则 | 内层只接受 REFERENCE_LOOKUP；明确约束是本轮 patch，未改条件由后端继承，不能重述为无本轮证据的 SET |
| 提示词变更后仍可能漏掉明确“外墙”字段，误查到屋面范围 | `SM-PAGE-SCOPE-COVERAGE-01` 在现有 QUERY 字段验证中检查封闭部位枚举是否丢失；只拒绝漏字段，不由词命中选择意图或补筛选。显式 REMOVE 不恢复旧条件；同时提到两个部位交原语义合同处理；否定/引用无法可靠核验时宁可澄清 |
| 裸数值的查询方式在模型和后端不一致 | 明确 K 与数值后默认 APPROX；显式上限、下限、精确及有效历史优先，实际模式由代码核验。未明确指标仍需澄清，不根据数值大小猜 K |
| 明确外墙条件导致旧确认表零命中 | 仅旧格式按封闭正式表名作 EXTERNAL_WALL/ROOF 只读投影；v2 缺字段仍未知。没有回填已确认 JSON |
| 只有确认页引用，后续原页查看却要求正式 Candidate | `confirmed-page-reference-read.ts` 按本会话实际发送的引用回溯；核验 scope、24h、版本、confirmedRevision、optionId；拒绝旧序号和正式操作，不重查/刷新候选 |
| 旧确认页只有事实引用时，事实核对退回宽查 | 无正式 Candidate 时沿实际已显示档位核对；待核数值不能反选身份。既有 Candidate 路径保留 |
| 型号比较和用户提供的数值关系由自由文本发挥 | 型号比较走受控 factRead；确认参数的大小由代码计算。无法核验来源时，只能明确区分“用户所给数值的算术关系”与“已确认工程参数”，不推断芯材属性 |
| 优缺点未响应实际输出目标 | adviceFocus=PROS_CONS，按已确认构造、基层、厚度、来源说明优点和局限；v2 缺产品 R 时不制造 Candidate。没有价格/寿命/防火对照证据就不补结论 |
| 报告混合请求拒绝原因不完整；澄清被误记成工程事实错误 | 补充已确认方案快照与独立正式标准的前置解释；澄清诊断为 NOT_EVALUATED_CLARIFICATION；被 Policy 拒绝的 factRead 不继续执行 |

没有新增 UAT 原句的开放语义 Regex/includes 路由。新增格式规则分别为 `SM-NUMBER-ROLE-02`、`SM-LEGACY-PAGE-SCOPE-01`；只负责工程数字角色和封闭确认表名，不判断开放用户意图。原话证据绑定为 `SM-CLARIFY-EVIDENCE-01`。`SM-PAGE-SCOPE-COVERAGE-01` 是已进入 QUERY 后的正式字段覆盖校验，有 5 组正例、5 组不猜部位对照以及取消/否定/引用反例；不能新增意图或授予副作用，遗漏且一次纠正仍失败则保留旧候选并澄清。

## 只读与正式操作边界

- QUERY 置信度 0.8–0.9 只有完整 pageQuery 且所有条件通过确定性 grounding 才展示 FACTS_ONLY，不发布/覆盖 Candidate；允许保存独立、受会话范围约束的成功确认页查询上下文。低于 0.8、超时或结构未能核验时保持拒绝。
- factRead 置信度达到 0.8 后仅进入受控只读事实服务；只返回源记录核验、概念合同或针对缺少身份的澄清，不发布 Candidate。缺少可靠来源仍不能给出已核验结论。
- ADD / SET_FINAL / CONFIRM / CALCULATE / REPORT 的完整授权、0.9 门槛、revision、归属、来源及既有状态机保持；澄清历史不能授权这些操作。
- 原页回溯只接受明确构造编号和/或厚度；序号、跨端/项目/用户、过期或已变更引用不能借此恢复。旧消息缺少 queryScope 时不隐式补授权，可重新完整查询。

## 验证记录

| 检查 | 结果 |
|---|---|
| `pnpm db:check` | PASS；只检查迁移文件，无迁移执行 |
| `pnpm lint` / `pnpm build` | PASS；语义 AST 检查 10 个关键文件、31 个既有精确豁免 |
| 最终字段门禁后全量 `pnpm test` | 2,485 PASS、1 SKIP；216 个文件通过、1 个跳过 |
| 最后提示词与空源数据保护后的定向回归 | 76 PASS；涵盖澄清、数值角色、只读 Policy、原页回溯及新旧确认页核对 |
| 字段门禁及最后新增的有限纠正/仍失败保留旧候选回归 | 33 PASS；该定向运行包括全量运行启动后新增的一项测试，不与全量数量相加 |
| `http-delivery` 核心链两轮 | 30 PASS；0.3→补充 K→0.2 上限、明确外墙 K 上限、45→35→继续对比、优缺点、报告前置及 ADD/SET_FINAL/CONFIRM/REPORT 反例 |
| `http-original-delivery` 原对照连续会话两轮 | 24 PASS、17 PARTIAL、3 FAIL；2 个 FAIL 为不同型号/厚度算术比较，见下项修正后的独立复验；另 1 个为产品介绍误入自由解释，未用后续版本重跑，不宣称已解决。旧结果保留 |
| `http-compare-delivery` | 6 PASS；两轮均给出用户所给数值 4.800 < 5.000，明确来源尚待核验；两轮 A3-2 45mm→核对 K=0.294 均沿实际引用给出一致结论，没有确认正式方案 |
| **`http-scope-guard` 最终字段门禁版本核心链两轮** | **30 PASS**；两轮外墙 K≤0.3 均保留 EXTERNAL_WALL、513 档/118 构造，仅引用 12 档；45→35 保留 III 与外墙。每轮 SolutionState/Snapshot/Report 均为 0；清理后 DB 不存在、Redis 0、OSS 写入 0；源资料哈希一致 |

原 UAT-12 的主动断网轮没有执行；原 UAT-07/08/11/12/15 其余连续自然语言轮次已实际运行。原始运行过程中发现的失败保留，不能把修正版本的一次成功当作先前版本的稳定通过。

最终主链[逐轮判定](evidence/thermal-query-context-2026-10-17/http-scope-guard-reviewed.json)、[问答/Policy/查询条件及确认档位](evidence/thermal-query-context-2026-10-17/http-scope-guard-transcript.json)、[数值比较与明确身份核对](evidence/thermal-query-context-2026-10-17/http-compare-delivery-reviewed.json)、[旧对照完整逐轮结果](evidence/thermal-query-context-2026-10-17/http-original-delivery-reviewed.json)及[历次运行与清理](evidence/thermal-query-context-2026-10-17/run-history.json)分别保留。APPROX/MAX_LIMIT 已真实 HTTP 对照；EXACT 及模式优先级另有确定性回归，不冒充本轮真实 EXACT 端到端验收。

回归同时覆盖低置信与超时保持旧 Candidate、无已确认快照拒绝报告、旧 revision/撤回/换版/过期/跨用户/跨项目/跨客户端拒绝、本轮数字覆盖原问而非追加旧指标，以及无原话依据/多个数字不能借澄清补数。原页回溯返回完整当前确认模型和原命中档位，不新增候选。

复核中纠正了一次验收遗漏：早期 `http-inheritance-fixed` 的审阅只断言 K 范围，没有断言 `applicationPart`，最初记作 30 PASS；补充断言后应为 **28 PASS、2 FAIL**（外墙条件漏提取）。`http-delivery` 两轮均实际保留 EXTERNAL_WALL，但随后 `http-final-verified` 再次漏部位，说明提示词不能保证该条件。由此增加上面的字段覆盖门禁，再以 `http-scope-guard` 验证；先前成功不当作稳定性结论。该纠正记录在 run-history.json，不隐藏早期误判。

17 个 PARTIAL 不作全通过处理，主要包括：材料比较全部属性未逐项核验，I/II 多构造来源无法唯一比较，A3-2 未给体系时需消歧，55mm 正式计算未完成及后续文案不准确，报告章节未按全部模板逐项验收，切话题后一次带旧概念内容，以及只读页上下文“最薄那个”仍有重列档位或误进必须有 Candidate 的入口。这些没有借本次修复放宽正式计算/选择/确认门禁。整个旧 UAT 手册仍未验收通过。

修改集中在 Domain schema/Policy/决策提示词、generation 与 semantic query 编排、只读确认页/原页/事实/建议服务、确认页事实投影和工程数字角色；相应测试及长期规则文件已同步。没有更改热工公式、数据库 schema、迁移、前端页面或报告状态机。

原始证据目录：`logs/thermal-query-fix-20261017/`（被 Git 忽略，工作区可读）。可追踪的脱敏逐轮摘要放在 `docs/ai/evidence/thermal-query-context-2026-10-17/`。

真实验收使用随机逻辑克隆 DB、独立 Redis/队列前缀及独立 PC_AI 普通用户，经正式 HTTP/SSE 路由和真实模型。源 DB 强制只读；目标库复制现有结构和数据，不执行 migration/seed。OSS 仅授权读取，写入接口主动阻断；未生成报告或写对象。每次结束删除本次随机库及 Redis 前缀，记录数据库不存在、Redis 零遗留。源 knowledge_pages 前后哈希一致时才记为资料未变更。

没有运行浏览器/真机 UI、原图失败恢复、签名自然过期、主动断网/Worker 故障验收，也没有重验完整 76 项手册。原页码与 λ 等源资料问题需继续走资料审核，不在回答中偷偷修正。修复验收阶段未部署；后续用户追加授权的发布结果见下。未提交代码、未改 `.env`，App 原有 `auto-imports.d.ts` 改动保持原样。

## 用户追加授权后的后端发布

2026-10-17 香港时间 10:35，按“通过 pnpm run 部署”执行 `pnpm run deploy --skip-db`，本地重新构建后上传并重载后端。生产保留 `.env`，跳过数据库备份、迁移和 seed；没有发布 App 前端。

部署脚本的中文字体/Chromium/真实 PDF 环境自检通过。发布后独立只读检查 API 与 Worker 均 online、运行目录正确，`/health/live` 与 `/health/ready` 均 HTTP 200；Domain Policy、澄清上下文、历史原页读取、语义查询及确认页事实共 5 个编译文件的远程 SHA-256 与本地构建一致。

[发布核验记录](evidence/thermal-query-context-2026-10-17/deploy-verification.json)保留检查时间、进程状态、健康码与文件哈希。完整部署输出位于忽略目录 `logs/thermal-query-fix-20261017/deploy-20261017.log`。本次发布没有再次运行整套测试或在生产写入测试会话；前述隔离 UAT 结论与旧 UAT 未通过项保持原判。
