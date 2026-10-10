# 销售 / 设计院真实 AI UAT（2026-10-07）

本轮完成最后四个交互边界并建立第一批40个完整业务场景（销售20、设计院20，共123轮）。Parser / Matcher 主结构从此冻结：后续自然语言变更先新增真实失败UAT Case，标明归因，再做针对性修复。这个冻结规则不等同于已经通过真实业务验收。

## Part A：四个交互边界

1. 路由：方案动作优先于「限值」「这个墙体」等名词；`传热系数限值0.3有哪些方案`走参考查询。明确计算走原有热工计算。达标、是否满足、符合哪个标准、够不够等进入现有标准判断链，验收intent为COMPLIANCE，回答合同仍为THERMAL，不增加平行业务流程。
2. 活跃厚度条件下的省略追问：`25以内`、`25以上`、`改成25`、`放宽到25`、`调到25`无指标词时更新厚度；K/双R条件保留。没有活跃厚度条件或含明确指标时不猜。
3. 厚度口语：支持改到/调到/调整为/从20改到25、放宽/收紧、最大改成等。单边放宽继承原边界；双边未说改哪端仍澄清。厚度不限/无所谓/不考虑/先不看/取消清除精确档、两端和尽量薄；只取消明确某端保留另一端。
4. 省略连接词：`K控制0.3以内/左右`、`总R做到3.3以上/左右`、`产品R做到2.9左右`按既有指标、数字、比较语义分离解析。

不修改数据库schema/migrations、热工公式、三种计算模式、Knowledge主流程或Report Snapshot。新增可选消息metadata记录真实Backend路由，工具审计记录真实重查/复用决定；不新增客户端SSE事件或公开调试接口。

## Case / Runner / 三层验证

`tests/uat/schema.ts`只定义验收契约。查询、候选、任务、工具和计算快照类型复用现有Backend DTO/表推导类型，不建立第二套业务模型。

`scripts/run-ai-uat.ts`启动本机独立Fastify测试API，注册现有认证、AI会话、来源详情及AI热工路由。通过真实HTTP创建独立用户会话，逐轮POST messages，消费完整SSE并确认done，GET会话最终消息，读取当前消息真实工具日志、任务状态和计算快照。没有直接调用Parser/Matcher/业务Service来生成回答；测试资料装载时可直接写入隔离数据库。

| 层 | 执行者 | 核验 |
| --- | --- | --- |
| Backend决策 | 确定性程序 | 实际intent/任务、实际工具及operation、filters、厚度/型号/体系/方案/规格/产品、参数继承/清除、重查/复用审计 |
| 正式事实 | 确定性程序 | 固定正式行的双R/K/厚度/来源页、AND全部满足、冻结计算记录独立验算、来源详情和真实PNG下载 |
| 最终回答 | 确定性规则 + 可选AI体验Judge | 必需数值/概念、双R/K表格列、来源页宣称、结果类型、无依据达标、内部术语、结论优先和简洁性 |

每轮报告保留输入、预期、实际查询/任务/工具/最终文字、计算及来源事件、评分与归因。工具输出超过原有存储上限会保留truncated提示；工程断言使用完整持久化候选与计算快照，不以截断预览代替事实。

销售关注短句、薄板、方案、客户解释和原始依据，规则Judge默认长度700字。设计院关注正式术语、单位、双R、λ/α/Ri/Re、图集/计算区别和规范依据，默认1800字。persona用于案例设计与体验评审，不改变客户端角色或增加产品配置。自然语言案例本身体现角色，Runner不插入额外系统Prompt。

## 固定数据与隔离

- A1-3 / I型VICP薄抹灰外保温 / 18mm / 产品R2.880 / 总R3.297 / K0.303 / 印刷页22。
- A1-4 / I型 / 20mm / 产品R3.200 / 总R3.390 / K0.295 / 印刷页23，验证多指标AND通过。
- A1-3 / I型 / 25mm / 产品R4.000 / 总R4.417 / K0.226 / 印刷页22，验证放宽/下限。
- B1-1 / II型 / 18mm / 产品R2.500 / 总R2.917 / K0.343 / 印刷页24，验证型号切换与无命中。
- 计算fixture包含已发布产品参数λ0.005、α1.25，灰砂砖240mm/λ0.9，Ri0.11、Re0.04及构造产品选项。改变厚度的计算记录使用手工独立公式验算，不调用生产计算器构造预期。
- 页图由程序生成明确标记的合成UAT页，上传独立对象前缀；不借用生产页图，不将测试资料作为真实工程依据。
- 不提供真实地区标准fixture，合规场景要求正式依据不足时澄清，禁止直接宣称达标。

运行前读取现有已准入模型及已发布Prompt配置；只读复制到随机`vicp_ai_uat_<uuid>`库（密文只在进程内复制）。迁移只执行在随机库。每个Case独立NORMAL_USER + CLIENT access、会话，保留真实鉴权/配额逻辑。Redis应用key及BullMQ队列使用UUID命名空间，生产Worker不会消费测试队列。测试只到报告准备，不要求测试Worker导出报告。finally清理自己的库/Redis命名空间/对象；任何清理失败必须保留在报告并让命令失败。

## Hard Fail与评分

七项硬失败均有自动检测与对抗样例：硬条件违规、双R/K混淆、伪造页码、图集/计算值错标、无依据达标、旧条件残留、厚度越界。候选事实和数值比较完全确定性。最终文字采用数值绑定/表格列/句子声明规则，AI Judge不得覆盖这些结果；对自由文本的全部语义不能仅凭这些规则宣称已经覆盖，业务冻结仍需人工复核失败报告与真实回答。

每轮100分：intent/工具20、参数20、事实25、多轮15、回答体验10、来源10。90～100通过，80～89警告，低于80失败；任何Hard Fail直接失败。未执行维度不能默认满分，环境缺失记录BLOCKED、准确率null，不能记作通过。报告统计计划/执行轮数、通过/警告/失败/阻塞、各维度准确率、ReferencePage成功数和Hard Fail次数。

默认回答体验使用明确标识的确定性规则，不冒充AI或人工评审。`--judge`才额外调用已准入模型，只评分易懂性/简洁性/角色适配/自然度/解释帮助，不判断数值、工具、页码或合规；记录评审model与Judge版本。

## 运行

```bash
pnpm uat:check
pnpm uat:ai --list
pnpm uat:ai
pnpm uat:ai --persona sales
pnpm uat:ai --persona design-institute
pnpm uat:ai --case SALES-001
pnpm uat:ai --judge --reasoning on
pnpm uat:ai --out logs/ai-uat/current
```

`uat:check`仅做TypeScript/场景结构检查，不调用模型、不计为业务验收。真实运行需要可连接且有CREATEDB权限的PostgreSQL、可连接Redis、可写/可签名下载对象存储、已启用general_chat Agent及已准入模型/已发布提示词。默认使用.env连接；可单独设置`AI_UAT_DATABASE_ADMIN_URL`（只用于临时库管理）和`AI_UAT_CONFIG_DATABASE_URL`（只读配置来源）。环境准备失败打印阶段和错误码，不打印连接密码或API Key。

输出目录默认`logs/ai-uat/<UTC时间>/report.json`和`report.md`，按gitignore本地保留。运行记录包含git提交、fixture版本、实际模型、Prompt版本、reasoning模式/运行参数及run ID；消息、SSE、真实run含实际版本，用于换模型比较。报告剔除JWT、配置密钥、原始Agent状态/思考链和签名URL参数。

## 第一批场景

| ID | 销售场景 | ID | 设计院场景 |
| --- | --- | --- | --- |
| SALES-001 | 客户想做薄：放宽厚度并找原页 | DESIGN-001 | K近似：区分图集与上限 |
| SALES-002 | 严格上限无结果：说明原因后放宽 | DESIGN-002 | K上限：排除0.303 |
| SALES-003 | K目标选型与最接近方案 | DESIGN-003 | 总热阻下限保留边界 |
| SALES-004 | 厚度上限从20调到25再收紧 | DESIGN-004 | 产品热阻与总热阻分开核验 |
| SALES-005 | 尽量薄：硬条件之后排序 | DESIGN-005 | 厚度与双指标AND |
| SALES-006 | 从20改到25的厚度口语 | DESIGN-006 | 厚度双边范围与只取消上限 |
| SALES-007 | 取消厚度并清除薄板偏好 | DESIGN-007 | 构造层参数可核验 |
| SALES-008 | I型切II型后不能保留旧规格 | DESIGN-008 | 导热系数单位和参数来源 |
| SALES-009 | K严格筛选没有完全满足的方案 | DESIGN-009 | 修正系数与产品R公式解释 |
| SALES-010 | 近似结果不能替代严格上限 | DESIGN-010 | 内外表面换热阻 |
| SALES-011 | 原图集页与页面再次打开 | DESIGN-011 | 图集双R与K精度 |
| SALES-012 | 数据出处追溯 | DESIGN-012 | 正式计算与冻结快照 |
| SALES-013 | 客户解释：近似与严格要求区别 | DESIGN-013 | 查表转正式计算 |
| SALES-014 | 低导热系数与做薄原因 | DESIGN-014 | 厚度变化必须重新计算 |
| SALES-015 | 与岩棉比较，禁止无依据防火卖点 | DESIGN-015 | 原始印刷页而非物理页猜测 |
| SALES-016 | 限值表述查现成方案 | DESIGN-016 | 上海项目合规不能由筛选推出 |
| SALES-017 | 错误术语先澄清后查表 | DESIGN-017 | 标准地区依据不足的克制回答 |
| SALES-018 | 省略连接词且指标不混淆 | DESIGN-018 | 冲突参数与OR必须澄清 |
| SALES-019 | 多轮反悔：增改删不复活 | DESIGN-019 | 无结果说明全部硬条件 |
| SALES-020 | 对比后准备客户说明报告 | DESIGN-020 | 多轮指标修改、取消、恢复 |

## 本机验证记录

真实`pnpm uat:ai`已执行：配置数据库连接ECONNREFUSED，40场景123轮全部BLOCKED、执行0轮、无通过项、无真实模型调用。不能据此冻结上线。`pnpm db:verify`静态SQL/journal/snapshot检查通过，Docker未安装，隔离PostgreSQL迁移运行验证未执行。待依赖恢复后必须补跑真实UAT并按失败Case修复；不通过Parser单测替代。

## 本轮修改文件与API影响

- 四个交互边界：`src/shared/ai-answer-contract.ts`、`src/modules/thermal/thermal-lookup-mode.ts`、`src/modules/thermal/thermal-lookup-thickness.ts`、`src/modules/ai/tools/thermal-lookup.ts`。
- 真实验收可观测性：`src/modules/ai/ai-generation.service.ts`、`src/modules/ai/tools/thermal-calculate.tool.ts`、`src/modules/ai/tools/tool-runtime.ts`。审计按每次工具调用闭包隔离，包含并行调用回归测试，避免共享状态串写。
- 新增Runner：`scripts/run-ai-uat.ts`；UAT目录下包含`schema.ts`、`environment.ts`、`sse.ts`、`report.ts`、`cases/{sales,design-institute}`、`fixtures/facts.ts`、`assertions/index.ts`、`judges/quality.ts`、`uat-harness.test.ts`。
- 新增交互回归：`src/modules/thermal/thermal-interaction-closeout.test.ts`、`src/modules/ai/tools/tool-runtime-audit.test.ts`。
- 命令与类型检查：`package.json`、`tsconfig.uat.json`、`.env.example`。
- 同步长期约束：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`及本文件。

本轮无正式数据库schema或迁移改动，现有工作区此前已有的迁移/其他模块改动均保留。无breaking API变更，无新路由/SSE事件；可选metadata和工具审计仅补充真实决策记录。现有客户端会话DTO仍按原字段映射。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| Backend类型 | `pnpm lint` | 通过；仓库无独立typecheck脚本 |
| UAT类型/结构 | `pnpm uat:check` | 通过，40场景123轮 |
| 全量测试 | `pnpm test --maxWorkers=2` | 139个文件、1292项通过，1项既有PDF测试跳过；首次高并发与其他检查同时运行曾出现模块导入超时，限制workers后通过，未放宽测试超时或断言 |
| 构建 | `pnpm build` | 通过 |
| 迁移一致性 | `pnpm db:check` | 通过 |
| 迁移运行 | `pnpm db:verify` | 静态链通过；Docker不可用，未执行隔离PostgreSQL验证 |
| 真实AI UAT | `pnpm uat:ai` | 连接ECONNREFUSED，全部BLOCKED，未调用模型 |

当前真实UAT阻塞报告：`logs/ai-uat/final-closeout/report.md`及同目录`report.json`。失败报告内完整列出40场景123轮的预期和阻塞归因，准确率为未执行。`uat:check`另已在不加载.env的情况下验证通过，不需要数据库/模型密钥。


2026-10-10 增加 SALES-021/022，当前矩阵为销售22 + 设计院20，共42场景、128轮。新增真实问题回归覆盖产品自身R/整墙R与体系、厚度冲突更新。结构检查不再硬编码40场景，要求至少40且每类至少20；真实执行记录见 `thermal-constraint-closeout-2026-10-10.md`。本轮测试数据库配置只读加载发生 ECONNREFUSED，全部128轮 BLOCKED，未调用模型，不能计为业务验收通过。
