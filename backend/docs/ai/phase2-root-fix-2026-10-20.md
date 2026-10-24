# 步骤 2｜跨端定向修复（只改已证明根因）

- 日期：2026-10-20
- 基线：步骤 0/1 审计；本地以 `PORT=3001` 启动**新代码**、连接同一 UAT 库与真实 DeepSeek，复放真实失败会话；远程 `lgapi.zblack.cn` 仍是旧代码，未部署
- 结论：4 个 P0 根因已落地修复并有真实 SSE 复放证据；第 5 个“候选失效”因触碰既有“只读页不刷新正式候选”不变量，本轮**不改后端状态**，改为回答层明确“只读不可生成”，风险保留
- 未改固定 35 问、旧失败记录、甲方公式版本、Candidate/Revision/Confirm/Snapshot/PDF 权限

## 1. 修复前后（真实 DeepSeek + 同一库）

| 场景 | 修复前 | 修复后（本地新代码） | 证据 |
| --- | --- | --- | --- |
| F4 “薄膜灰<0.35 方案”→“导热系数” | 962 条，24 条混合材料；0.35 丢失 | **311 条（去重 47 项），列 12 项**；目标 **0.35/LT** 保留；明确“薄膜灰未证明，只按数值列参数”；明确“构造材料层不是完整方案” | `evidence/phase2-2026-10-20/sse-summary.json` F4 |
| F1 “保温0.2材料”→“热阻” | 二次泛化澄清，0.2 丢失 | 首答问指标；补“热阻”后答 **“热阻 0.2 是产品整体/芯材/整构造？”**；0.2 保留 | F1 三轮 |
| F5 “保温0.3材料”→“热阻”→“保温热阻0.3” | 第三次仍泛化“尚未明确” | 第三次答 **“我理解为产品层热阻 R=0.3；口径不对请说明”**；0.3 保留 | F5 三轮 |
| F2 “VICP产品有哪些” | 只给目录 1 款 + “完整系列待补充” | 先给 **12 个知识库构造系统/产品族（含页数、产品层）**，再给目录 1 款，并声明“不等于可销售型号、目录数量不代表总数” | F2 两轮（全名/简称） |
| F3 “vlcp”→“是的” | 同一句建议重复，无法前进 | “是的”绑定上一轮唯一建议，进入 VICP 产品介绍；否定/换一个不绑定 | F3 两轮 |
| F6 “0.3方案”→“基于A3-1生成方案” | “当前没有可核验候选”→“请先明确最终方案”死循环 | 明确 **“刚才那页是只读参考，不是正式候选，不能直接生成；需先导入正式参考行”** | F6 两轮 |

> F4 仍有 311 条原始命中（47 个去重项），因为 λ<0.35 会命中大量构造材料层。已限制展示、去重、分组并明确“不是方案”；**没有**把构造层静默删掉或改写成产品。

## 2. 修改文件与契约

| 根因 | 文件 | 具体改动 | 新契约/不变量 |
| --- | --- | --- | --- |
| R1 澄清回执 | `query-clarification-context.ts` | ① CLARIFY 记录为 `requestedEffect=QUERY` 也认 pending；② 多轮只补“热阻/导热系数”时回链到最近一个带目标数值的 USER；③ 新增 `specificClarificationQuestion()` | pending 只能是本人同端同项目 24h 内紧邻问答；多轮回链只用于“短指标回执”，不吞新话题 |
| R1 澄清输出 | `ai-domain-semantic.ts`、`domain-clarification.ts`、`ai-domain-turn-decision.service.ts` | 新增 `clarificationQuestion`（仅 Backend 生成）；策略拒绝时优先输出它；`isAffirmativeReply()` 封闭短回执 | 只问一个真正影响查询的口径；不把模型内部原因直接给客户 |
| R2 参数域 | `product-parameter-query.ts`、`ai-domain-turn-decision.service.ts` | 新增 `inheritParameterTarget()`：本轮只补 λ 时从原问继承唯一数值与比较符；本轮给新值不覆盖 | `targetValue/operator` 必须来自原问或本轮原话；不接受型号/厚度代替 |
| R2 全库读取 | `product-parameter-read.service.ts` | ① `READ + ANY + 无对象/无目标` 直接返回一个关键问题，不扫全库；② 名称未证明但有明确数值时，去掉名称按数值收窄并提示名称待确认；③ 展示按“名称+数值”去重、最多 12 项、给出构成；④ 构造材料层明确“不是独立产品/完整方案” | 查询不得比用户条件更宽；λ 命中不得含不满足阈值项；构造层不得冒充产品/方案 |
| R3 只读页 | `solution-advice.service.ts` | 上一轮 `confirmedPageLookup` 且无正式候选时，明确“只读参考不可生成方案/报告，需先导入正式参考行” | 只读参考≠正式候选；选择≠Final≠Confirm≠PDF |
| R4 产品范围 | `product-read.service.ts`、`product-answer.ts` | ① 新增 `readProductKnowledgeFamilies()`：只读 ACTIVE/PUBLISHED/AI_ENABLED 知识页，按原表标题与产品层名归纳构造系统/产品族，带页数与来源；② 目录只作 SKU 补充；③ 系列问题先答知识库范围，再答目录；④ 目录数量不等于产品总数 | 产品问答先查已确认知识库；构造系统/产品层/材料层不得包装成可销售系列；来源不足要说覆盖范围 |
| R4 产品建议 | `product-read.service.ts`、`ai-domain-turn-decision.service.ts` | 上一轮唯一“你是不是想了解 X”建议 + 本轮肯定短回执 → 绑定该产品；否定/换一个不绑定 | 只绑定唯一建议；仍按目录正式名称和 24h/同会话重验 |
| 规则审查 | `scripts/semantic-matching-exemptions.json` | 新增 2 条精确白名单：`SM-HISTORY-01`（助手建议固定措辞）、`SM-PARAM-OP-01`（封闭比较符提取） | 只做格式/证据提取，不做意图分类；均有反例测试 |

**未改**：`reference-query.service.ts` 的“pageQuery 只读不刷新正式候选”。既有测试 `confirmed-page-query-readonly.test.ts` 明确要求只读页不发布候选、不改已有候选；强行发空候选会破坏“看完原页还能比较上一轮候选”的能力。因此 F6 的“候选与 UI”只修到“明确不可生成”，旧候选失效提示仍是风险。

## 3. 自动检查

| 检查 | 结果 |
| --- | --- |
| Backend `pnpm lint`（semantic AST + tsc） | 通过；12 个关键文件、55 个白名单表达式 |
| Backend `pnpm test` | **246 文件通过 / 1 skip；2866 passed / 1 expected fail / 1 skipped** |
| Backend `pnpm db:check` | `Everything's fine` |
| Backend 编译 | `pnpm build` 的 `clean` 被本机 safe-delete 批量保护拦截（390 文件）；改用 `tsc -p tsconfig.json` 直接输出 **exit 0** |
| App `pnpm test` | **155 passed / 0 failed** |
| 真实 DeepSeek/HTTP/SSE | 本地新代码 7 组复放，见证据 JSON；未部署远程 |
| H5 真实 DOM | **NOT_RUN**：本地 H5 可启动，`agent-browser` daemon 启动超时，未取得页面快照 |
| 微信小程序 / App | **NOT_RUN**（无开发者工具/构建环境） |

新增/更新的定向测试：
- `query-clarification-context.test.ts`：QUERY 澄清、多轮回链、具体口径问题。
- `product-parameter-query.test.ts`：0.35/LT 继承、0.2/0.3 多值拒绝、本轮新值不覆盖。
- `product-parameter-read.service.test.ts`：READ-ANY 保护、λ<0.35 不含 0.87、去重/构造层说明、名称未证明收窄。
- `product-read.service.test.ts`：知识库产品族、VICP 简称、肯定建议绑定/否定不绑定。
- `product-answer.test.ts`：系列问题先答知识库、不等于可销售型号。
- `ai-domain-turn-decision.service.test.ts` / `ai-domain-policy.test.ts`：肯定建议、单指标低置信具体口径。
- `solution-advice.service.test.ts`：只读原页不能生成。

## 4. 仍待解决风险

1. **C 端真实 DOM 未验收**：以上只证明 Backend/SSE 与 App 单测；H5/小程序/App 的卡片、表格、按钮、历史恢复仍未真机核对，不能宣布 UI 通过。
2. **远程仍是旧代码**：本地结果不代表线上；部署需单独授权/流程。
3. **只读页仍不可生成**：真实库正式候选只有 2 条，890 档要可选必须做资料导入/确认/发布，不能由代码补造。
4. **候选残留**：只读页不会清空上一轮正式候选；若产品要求“当前查询无候选就隐藏旧候选”，需要增加**消息级**候选状态/失效标记，不能直接清空 Backend 候选池。
5. **λ 列表仍含通用材料层**：311 条/47 项中仍有加气混凝土、砂浆等；本步只做阈值、去重、分组和“不是方案”说明，未把查询范围收窄到“保温产品”。需要产品/材料分类字段或用户明确对象后再收窄。
6. **原文疑点未进答案行**：A2-2 15mm、A3-3 λ=0.0012 仍在结果中；`confirmedPageSourceAudit.issues` 尚未投影到参数列表行级提示。
7. **肯定词表有限**：`是/对/好/可以/嗯` 等封闭集合；更长口语（“对对对，就是这个”）不会绑定建议，需后续补反例或改为结构化确认按钮。
8. **模型随机性**：同一问题的意图/置信度仍可能波动；本步以状态/合同兜底，但步骤 3 必须重复盲测，不能以单次通过判定稳定。

## 5. 结论

已按 5 个根因做最小修复：
- 澄清不再因 `requestedEffect=QUERY` 或“只补指标名”丢失原值；
- λ 查询不再无对象全库扫描，阈值结果不再含不满足项；
- 产品问答不再只依赖 1 条目录，已接入已发布知识库的构造系统/产品层；
- “vlcp→是的”能绑定唯一建议；
- 只读原页后续问“生成方案”会明确不可确认。

**步骤 2 完成。** 未部署、未改历史数据、未改 35 问。

**补充回归（步骤3执行）**：用 `run-ai-uat.ts --persona sales` 跑既有 24 场景/74 轮，结果 **1 PASS / 7 WARN / 66 FAIL**（Intent 1.4%，Hard Fail 185）；失败集中在 `pageQuery` 只读路径未产出正式候选。该结果与历史 round-21 “35 问 PASS”不一致，不能再用该 PASS 作为当前基线；详见 `phase3-blind-acceptance-2026-10-20.md`。下一步独立盲测需在部署/隔离环境 + 真实 H5/小程序/App 中进行；当前环境不足的部分均标 NOT_RUN。
