# 生产前收口验证记录（2026-10-07）

代码修复完成；完整生产 Gate 尚未通过。部署配置指向的现有数据库仅作只读核查，未执行生产迁移或部署。真实数据库验证在同一 PostgreSQL 实例中创建独立临时数据库，全部已清理。真实原页下载返回 OSS `403 AccessDenied`，不能标记全链路通过。

## 1. P0 修复摘要

- P0-1：所有非厚度硬条件先检查，exact/neighbor 都不能绕过 K、型号、体系、基层、目标热阻等；方案/规格/产品目录标识在完整数据库结果中先收窄。K=0.303 在 18mm + APPROX 0.300 下命中，在 MAX_LIMIT 0.300 下排除。
- P0-2：候选类型由统一 Zod schema 推导，历史 JSON 恢复使用同一 schema，保留双热阻、方案编码、原页来源与全部正式展示字段。
- P0-3：无本轮模式语义返回 null；首轮未命中也保存查询条件，18mm 追问继续 REFERENCE_LOOKUP。用户明确语义覆盖错误模型参数并记录中文 warning。
- P0-4：0032 补登记 journal；隔离新库发现 CASE 表达式缺少索引括号，只修正该语法点，同步 schema 表达式；新增 0051 前向修复旧数据库。

## 2. P1 修复摘要

- P1-1：跨体系回退首句明确说明未找到指定体系的正式参考方案，不再同时要求先回答“有”；二次 Tool normalizer 和历史上下文也保留回退标记。
- P1-2：正式 systemId 优先；名称统一 NFKC、空白、品牌、通用保温体系后缀，保留材料与型号，支持薄抹灰别名，I 型不会误命中 II 型。
- P1-3：比较查询签名；K/模式/容差/热阻/厚度/型号/体系/方案/规格/产品目录变化后重读全量正式数据。普通查询即使签名不变也重读发布状态，仅参数/原页指代允许复用。
- P1-4：STRICT warnings 转为 PUBLISH 作用域 blocker，统一进入 readiness.publishReady，工作台和发布 API 消费同一结论。
- 补漏：BROWSE_ONLY 空版本具有 NO_PAGES blocker；OpenAPI/规则文档同步四种 K 语义。

## 3. Candidate matcher

先拒绝其他维度 unmatched，再按 exact 厚度/区间/无厚度分类。相邻档只允许 thickness unmatched，仍执行其他硬约束；既有数据缺失三态口径保留。关联方案、体系、规格必须已发布且有效。没有改写 REFERENCE_TABLE/EQUIVALENT/LAYERED 计算公式。

## 4. 多轮状态保留字段

`id, specClass, thicknessMm, kValue, systemId, systemCode, systemName, atlasPage, schemeId, schemeCode, schemeVersion, substrateMaterial, substrateThickness, productSpecId, catalogProductId, specCode, specVersion, setId, setCode, setVersion, setPriority, setBuildingTypes, matchType, neighborGap, matchedConditions, unmatchedConditions, missingConditions, ranking, compliant, evidenceSource, evidenceRef, productThermalResistance, totalThermalResistance, sourceDocumentId, sourcePageId, sourcePageLabel`。

查询保留 targetK/targetR/thicknessMm/systemHint/specClass/systemId/schemeId/schemeCode/productSpecId/catalogProductId/mode/tolerance；状态额外保留 matchedSystemHint/isFallback。更换体系名称不继承旧 UUID，切换模式不继承旧模式容差。模型上下文明确注入产品层热阻、总热阻、方案编码和原页 ID。

## 5. lookupMode 最终优先级

本轮用户明确自然语言语义 → Tool lookupMode → 历史 query.mode → 首轮 APPROX。B 端正式候选 API 的默认 MAX_LIMIT 保持兼容。APPROX/EXACT 的 kGap 为 abs(K-target)，MAX_LIMIT 为 target-K，MIN_LIMIT 为 K-target。

## 6. Migration 与生产安全

只读核查：部署数据库迁移水位 0050，0032 不在 history，仍是旧登录唯一索引；归一化冲突组 identities/phones/emails 均为 0。这只是核查时点事实，部署时仍由事务内冲突检查兜底。

0032 journal 时间插入 0031/0033 之间；0032 SQL 仅修正 CASE 索引括号，未改变业务逻辑。0051 对正确且有效的目标索引直接跳过，对旧结构先锁表、校验归一化冲突，再同事务归一化/重建索引。旧库较新水位不会重放 0032，直接由 0051 补齐；没有伪造历史执行记录。冲突时数据、旧索引和迁移水位整体回滚。

静态验证覆盖 SQL↔journal、重复 idx/tag、序号/时间缺口、snapshot 链及孤立 snapshot。早期已部署 0017–0019 命名错位和缺失 snapshot 使用精确限定旧记录例外，未重命名历史 SQL 或重写历史链；后续同类错误仍失败。

## 7. 本轮修改文件

- 运行时：`src/modules/thermal/thermal-candidate-matcher.ts`、`thermal-candidate.service.ts`、`thermal-candidate.schemas.ts`、`thermal-lookup-mode.ts`、`thermal.routes.ts`；`src/modules/ai/conversation-task.ts`、`tools/thermal-lookup.ts`、`tools/thermal-calculate.tool.ts`、`tools/tool-result-normalizer.ts`；`src/shared/ai-answer-contract.ts`；`src/modules/knowledge/knowledge-readiness.ts`、`knowledge-original.service.ts`；`src/db/schema.ts`。
- 回归：`src/modules/thermal/thermal-lookup-semantics.test.ts`、`src/modules/ai/tools/thermal-lookup.test.ts`、`tool-result-normalizer.test.ts`、`src/modules/knowledge/knowledge-readiness.test.ts`、`scripts/verify-migrations.test.mjs`。
- 迁移/验证：`drizzle/0032_messy_magdalene.sql`、`drizzle/meta/_journal.json`、`drizzle/0051_repair_login_identity_indexes.sql`、`drizzle/meta/0051_snapshot.json`、`scripts/verify-migrations.mjs`、`scripts/verify-migrations-postgres.mjs`、`scripts/verify-reference-lookup.mjs`。
- 文档：`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`、`backend-architecture.md`、`docs/thermal/README.md`、本文件。

仓库原有未提交变更保留，不提交或覆盖其他客户端工作。

## 8. 数据库变化

新增 0051 migration 与 snapshot；补登记历史 0032 journal；历史 0032 SQL 有唯一一处语法修正。未新增业务表/字段，数据库目标仍为已有 0032 定义的索引。已执行新环境 migration chain 和各种历史水位隔离验证，未执行 db:migrate:prod 或 pnpm deploy。

## 9. API / Tool schema

可选增加候选 API/Tool 的 schemeId/schemeCode/productSpecId/catalogProductId（Tool 另支持 systemId）；候选响应保留 sourceDocumentId/sourcePageId/sourcePageLabel/catalogProductId。都是增量可选字段，无路径、响应 envelope 或必填项破坏。Tool 保持单一 z.object + superRefine。

## 10. 验证结果

| 检查 | 结果 |
| --- | --- |
| pnpm lint | 通过（tsc --noEmit） |
| pnpm typecheck | 未执行：package.json 无此命令，lint 已做类型检查 |
| pnpm test | 134 个文件通过、1 个文件跳过；1038 项通过、1 项跳过 |
| pnpm build | 通过 |
| pnpm db:check | Everything's fine |
| 静态 migration consistency | 通过，7 个一致性回归测试通过 |
| 本地 pnpm db:verify | 未通过：本机没有 Docker |
| 隔离 PostgreSQL db:verify | 通过：远端 pnpm db:verify 显式禁用依赖自动安装并设置 MIGRATION_VERIFY_DATABASE_URL；空库真实 Drizzle migrate、全链、重复执行、漏 0032 升级、手工已执行兼容、冲突整体回滚通过 |
| 真实 Tool / 数据库联调 | APPROX/双 R/原页 22 SSE、多轮持久化恢复、MAX_LIMIT + 18mm、错误型号、条件变化重查、fallback、STRICT 门禁一致通过 |
| 真实原页下载 | 未通过：HTTP 403；只读 probe 返回 OSS AccessDenied，对象 stat 同样拒绝 |
| 真实模型 + 客户端完整 SSE 对话 | 未执行：本轮联调直接执行真实 Tool 和服务，没有启动客户端或调用真实模型 |

## 11. 剩余风险与最终 Gate

1. OSS 原页 GET/stat 真实返回 AccessDenied，现有对象访问权限/对象归属需排查，尚未修改线上凭据或策略。部署数据库当前没有可用于验收的“当前 PUBLISHED 第 22 页”；本轮业务验收在临时库创建 A1-3 正式业务 fixture，复用已有第 22 页真实对象，不能冒充现有发布业务数据全链路验收。
2. 尚需 staging 发布真实图集数据、验证真实模型与客户端对话 A–E，原始完整页须真实可访问；目前不能最终冻结并宣称全部生产 Gate 通过。
3. 生产 0051 尚未应用；上线时需备份，保留冲突检查和迁移失败不重载流程。旧索引修复会锁 users/user_identities，按维护窗口执行。
