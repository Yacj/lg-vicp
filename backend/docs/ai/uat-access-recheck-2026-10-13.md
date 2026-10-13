# 真实HTTP/SSE UAT完整复测结果

2026-10-13。实际执行 `pnpm uat:ai --out logs/ai-uat/access-recheck-2026-10-13`。此前CREATEDB及新库连接限制均已解除；本轮成功迁移随机测试库、复制线上模型/Prompt配置、装载合成fixture并调用真实deepseek-chat。业务代码来自当前工作树，不代表线上API已经部署这些修改。

## 结果

| 项目 | 实际结果 |
| --- | --- |
| 计划/执行 | 45场景，138/138轮 |
| 通过 | 18轮 |
| 警告 | 12轮 |
| 失败 | 108轮 |
| 环境阻塞 | 0轮 |
| Hard Fail断言 | 122次（断言次数，不是122个独立业务缺陷） |
| ReferencePage验收 | 13/23 |
| 命令退出码 | 1；业务验收未通过 |
| Runner清理 | COMPLETED |
| 独立清理核验 | 随机库不存在、Redis测试前缀剩余0键、3张测试页OSS对象剩余0，PASS |

没有在生产库创建会话、用户、业务fixture、报告或执行迁移；只读复制运行配置。写入与清理仅限随机隔离库、UUID Redis/队列命名空间、UUID对象前缀。没有修改.env、业务代码、测试断言或fixture来提高本轮分数。

## 已定位的失败分类

| 类别 | 实际证据 | 结论/下一步 |
| --- | --- | --- |
| 真实业务：纠正指标后旧条件残留 | SALES-017 Turn2：“我说的是传热系数K，改查0.3左右”。期望仅K≈0.3，实际同时保留TOTAL_R≈8.3，queryMode=CONTINUE_QUERY；回答因此无命中 | 已有真实失败Case，后续可针对指标纠正/查询生命周期修复；不能用更大容差掩盖 |
| 真实业务：无标准时重复地区澄清 | DESIGN-016 Turn2/3、DESIGN-017 Turn1/2。用户已说上海，COMPLIANCE_CHECK仍回复“项目或构造适用哪个地区？” | 标准fixture为空时地区目录也缺失，当前服务先问地区导致重复；需区分没有有效标准与缺必要范围，不能硬编码城市阈值 |
| 正式约束与知识回退边界需修复/复核 | SALES-023 Turn2：持久化query.unresolved仍含“体系族尚无可靠正式映射”，最后却从知识回退输出肯定候选 | 显式未解决条件与肯定结果不能并存。重点核对legacy needsClarification与unresolved传播、知识回退门禁，保留fail-closed约束 |
| UAT资料与新来源核验不一致 | SALES-001 Turn1：正式参考行被“来源页基层与正式候选冲突”拒绝；fixture的确认页未包含与构造行一致的基层材料字段，layer名称为“测试基层”，正式构造为灰砂砖/A1-4测试基层。随后进入KNOWLEDGE_PAGE回退，systemId为页模型身份；旧断言却要求全部使用正式参考行体系ID | 104次来源ID失败断言受此链路影响；不是104次凭空编造数字。应先补齐隔离fixture同源基层及正式简称配置，再按两种合法候选来源分别严格核验，不放宽生产来源门禁 |
| 旧UAT只读合同过时 | SALES-005 Turn3等：backend:reference_read，mutation=NONE、revision起止相同、QueryState差异为空、未写SolutionState、返回原页；旧断言仍要求thermal LOOKUP_CANDIDATES及工具内reusePreviousCandidate日志 | 35次thermal工具要求失败受此影响。按当前冻结Read合同更新验收，要求不调用查询、不改revision及选用；不能为了旧测试重新查表 |
| 模型语义合同观测 | 125轮metadata携带queryParserSource=LEGACY_FALLBACK，13轮为空；日志出现网关不支持responseFormat schema提示 | 此数字包含历史查询来源沿用，不等于125次模型调用失败。需专项核对结构化字段合同/网关适配；不能凭警告认定所有根因或按关键词补丁处理 |

来源ID、旧工具合同失败和真实条件残留分开记录，没有重算“修正后的通过率”。模型/SSE真实执行不代表业务正确，也不能把全部失败归为旧测试。

## 建议修复顺序

1. 先修正隔离fixture的基层/确认档位同源字段与后台显式别名，修订只读验收合同；保持所有K、双R、厚度真值与硬条件断言。
2. 以SALES-017、DESIGN-016/017、SALES-023的真实记录补失败回归，修复指标纠正、无标准分支及知识回退未解决条件门禁。
3. 再跑定向真实场景及完整矩阵。正式标准正向判断、确认方案PDF、多模型/超时/跨项目/撤回组合不因本轮完整矩阵运行而自动计PASS。

实际产物：[完整UAT报告](../../logs/ai-uat/access-recheck-2026-10-13/report.md)、同目录report.json及cleanup-proof.json。记录保留逐轮QueryState、工具调用、来源及SSE信息；评审使用确定性体验规则，没有额外AI Judge评分。
