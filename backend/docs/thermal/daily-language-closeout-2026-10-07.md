# 日常表达、多轮条件与厚度范围收口（2026-10-07）

## 自然语言与多轮条件

先定位 K / TOTAL_R / PRODUCT_R，再提取连接词后的目标数字，最后独立识别比较语义。支持在、控制在、要求、需要、要、要达到、达到、做到、做到大概、做到左右、目标、目标是、希望、希望做到、最好、尽量、大概、左右、附近、接近、控制到、做到不超过、做到不低于、最好不要超过等表达。

达到/做到/控制在本身不决定上下限：总R达到3.3左右为近似，达到3.3以上为下限，K控制在0.3以内为上限。模糊保温系数只能继承唯一的历史指标，否则澄清；多指标未知条件和 OR 不可省略或猜测。

- ADD：新指标追加到历史 filters，所有指标 AND。
- UPDATE：同 metric 替换原条件，支持改成/换成/改为/调整到/提高到/降到/变成以及直接说新数值；仅明确再加范围条件时追加同 metric 边界。
- REMOVE：取消/不限制/不用限制/先不看/去掉删除对应指标；清理旧 K/R 摘要，防止模型重复参数恢复已取消条件。
- 未修改指标、用户已授权的同指标同模式容差继续保留。跨指标不转移用户容差；无指向的多指标比较/容差修改先澄清；既有“精确一点”整组固定精度请求继续兼容。

## 厚度与候选查询

保留 thicknessMm（精确档）；AI Tool 新增可选 thicknessMin / thicknessMax，API 既有字段不变。18mm/18毫米/厚度18为精确档；20mm以内/不超过20mm/最多20mm/厚度控制在20以内为上限；18mm以上/不低于18mm/至少18mm为下限；18～25mm/18-25mm/18到25mm/厚度18到25为双边范围。

自然语言厚度覆盖模型错误传入的精确档。新精确档与新范围相互清理；取消厚度清除全部三字段。放宽到25mm继承历史单边含义，双边范围未说清修改哪端时澄清。尽量薄/薄一点/越薄越好保存展示偏好，先满足全部硬条件，再按厚度升序排序及截断，不生成虚构厚度上限。

query signature 包含 thicknessMm / thicknessMin / thicknessMax、薄厚展示偏好和全部热工 filters。条件修改、取消、型号/体系变更和普通查询均重新 queryThermalCandidates；仅纯参数或原页指代可复用历史候选。

Tool 结果和二次归一保留厚度条件，回答以中文说明同时满足的厚度及热工条件。无命中时解释当前范围并继续既有图集检索，不编造候选或偷偷放宽硬条件。

## 验收

- 销售：客户想做薄一点，20mm以内有没有K0.3左右的？→ thicknessMax=20 AND K APPROX 0.3。
- 设计院：厚度控制在18到25mm，K不应大于0.3，总热阻不低于3.3。→ 18～25mm AND K MAX_LIMIT 0.3 AND TOTAL_R MIN_LIMIT 3.3。
- 多轮：K不超过0.3，总R不低于3.3，20mm以内 → 总R改成3.5以上，厚度放宽到25 → 不限制厚度了，K条件保留。最终 K≤0.3 AND TOTAL_R≥3.5，无厚度条件。
- 真实 A1-3 / I型 VICP薄抹灰外保温系统 / 18mm：产品R=2.880，总R=3.297，K=0.303。近似可命中，K上限0.3和总R下限3.3均不能冒充命中；来源页22、sourcePageId、双R、ReferencePage事件及多轮JSON保留。

本轮不修改数据库 schema/migrations、计算引擎及公式、Knowledge上传/识别/确认/readiness/检索、Report Snapshot 或来源页实现。

## 验证结果

| 检查 | 实际执行 | 结果 |
| --- | --- | --- |
| lint | pnpm lint | 通过 |
| typecheck | pnpm exec tsc -p tsconfig.json --noEmit | 通过；仓库没有独立 typecheck script，lint 同样调用 tsc |
| test | pnpm test | 136 个测试文件通过、1 个跳过；1246 项通过、1 项跳过 |
| build | pnpm build | 通过 |
| db:check | pnpm db:check | 通过 |
| 静态迁移链 | node scripts/verify-migrations.mjs --static | SQL/journal/snapshot 静态检查通过 |
| db:verify | pnpm db:verify | 静态检查通过；隔离 PostgreSQL 运行验证因 Docker 未安装或不在 PATH 而无法启动 |

跳过的是依赖 VICP_ATLAS_PDF 本地图集 PDF 的既有解析回归测试，当前文件不存在。迁移验证没有创建容器或运行数据库迁移；本轮没有连接或写入生产业务库。

新增行为通过既有 parser / matcher / conversation / Tool 测试体系验证，Tool 集成用发布数据 fixture 与 service mock，未替代真实模型和真实发布数据库的端到端 UAT。后续进入销售 Persona、设计院 Persona、真实多轮 AI UAT；冻结验收中仍需在具备 Docker 或指定隔离 PostgreSQL 连接的环境补跑 db:verify。

## 本轮修改文件

- 实现：src/modules/thermal/thermal-lookup-mode.ts、src/modules/thermal/thermal-lookup-thickness.ts、src/modules/ai/tools/thermal-lookup.ts、src/modules/ai/tools/thermal-calculate.tool.ts、src/modules/ai/tools/tool-result-normalizer.ts、src/modules/ai/conversation-task.ts。
- 测试：src/modules/thermal/thermal-lookup-semantics.test.ts、src/modules/ai/tools/thermal-lookup.test.ts、src/modules/ai/tools/thermal-lookup.tool.test.ts、src/modules/ai/tools/tool-result-normalizer.test.ts。
- 规则与记录：AGENTS.md、README.md、.cursor/rules/30-ai-and-reports.mdc、.agents/skills/lg-backend/references/ai-and-reports.md、本文件。

工作区接手时已有其他模块及迁移的未提交变更，本轮只在上述文件继续增量修改，未回滚已有工作。
