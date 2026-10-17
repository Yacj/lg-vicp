# 销售 / 设计院真实 AI UAT

计划：1场景 / 3轮；已执行：3轮。
通过 0；警告 2；失败 1；阻塞 0；Hard Fail 0。

Intent 0.0%；参数 100.0%；事实 66.7%；多轮状态 100.0%；来源 100.0%。
ReferencePage 0/0。

工程事实全部由程序断言；规则/AI体验评分的method见逐轮JSON。没有模型调用的轮次不算通过。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 1

用户：VICP为什么能做薄？
结果：WARN / 80

- ROUTING：预期intent=PRODUCT_CONSULTATION，实际=GENERAL
- ROUTING：本轮实际工具须包含 search_knowledge / get_product_data

预期：`{"intent":"PRODUCT_CONSULTATION","toolsAny":["search_knowledge","get_product_data"],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"]}`

实际条件/决策：`{"decision":{"goal":"KNOWLEDGE_EXPLAIN","patch":[],"intent":"GENERAL","source":"INTENT","factRead":null,"mutation":"NONE","relation":"NEW","taskType":"GENERAL","toolRoute":["backend:knowledge"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"domainIntent":"KNOWLEDGE_EXPLAIN","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"KNOWLEDGE","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"VICP为什么能做薄？","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

VICP 能做薄，核心原因是它的当量导热系数很低，达到同样热阻所需的保温层厚度更小。

**关键点**

- 依据资料中 I 型 VICP 的当量导热系数 λ=0.005 W/(m·K)，修正系数 α=1.25。产品层热阻按 R=δ/(λ×α) 计算，厚度对热阻的“拖累”很小。
- 以图集数据为例：A1-3 仅 18mm，产品层热阻已达 2.880 m²·K/W，总热阻 3.297 m²·K/W，K=0.303 W/(m²·K)；25mm 时产品层热阻 4.000、总热阻 4.417、K=0.226。
- 相同热工条件下，岩棉产品 λ=0.040 W/(m·K)、α=1.0，50mm 厚才达到相应热工水平，厚度差别主要来自材料本身的导热系数差距。

**需要注意的边界**

- 热阻高不等于防火等级高，也不等于成本更低，这两点资料中没有给出证据。
- 上面是测试图集的参考值，不能作为上海或其他地区的合规达标依据。

**依据**

《销售与设计院UAT测试图集》测试图集第22页（I 型 VICP 构造参数与岩棉对比条件）。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 2

用户：导热系数λ是多少？
结果：FAIL / 55

- ROUTING：预期intent=REFERENCE_LOOKUP，实际=GENERAL
- ROUTING：本轮实际工具须包含 search_knowledge / get_product_data
- ANSWER_CONTRACT：最终文字正确表达预期数值 0.005

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["search_knowledge","get_product_data"],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"answerFacts":[{"pattern":"(?:λ|导热系数)[^\\d]{0,30}","value":0.005}]}`

实际条件/决策：`{"decision":{"goal":"KNOWLEDGE_EXPLAIN","patch":[],"intent":"GENERAL","source":"INTENT","factRead":{"mode":"EXPLAIN","metric":null,"evidence":"导热系数λ是多少？","historyClaim":false},"mutation":"NONE","relation":"CONTINUE","taskType":"GENERAL","toolRoute":["backend:knowledge","backend:reference_read"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"candidateIds":[],"domainIntent":"KNOWLEDGE_EXPLAIN","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"KNOWLEDGE","factValidation":"VALID_FACTS","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"导热系数λ是多少？","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"FACT_IDENTITY_REQUIRED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

缺少当前有权访问的确认来源，请指定原构造及资料页后核对。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 3

用户：帮我写一句客户能听懂的优势说明
结果：WARN / 80

- ROUTING：预期intent=PRODUCT_CONSULTATION，实际=REFERENCE_LOOKUP

预期：`{"intent":"PRODUCT_CONSULTATION","toolsAny":[],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"]}`

实际条件/决策：`{"decision":{"goal":"SOLUTION_ADVICE","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"NONE","relation":"NEW","taskType":"GENERAL","toolRoute":["backend:solution_advice"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":"GENERAL_REFERENCE","candidateIds":[],"domainIntent":"SOLUTION_ADVICE","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"帮我写一句客户能听懂的优势说明","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"ADVICE_REFERENCE_UNAVAILABLE","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

通用技术参考可以按以下顺序核对：1. 现场实际基层材料与厚度；2. 选用体系、保温厚度及对应的已确认图集构造；3. 粘结、固定、防火及节点要求；4. 材料参数与来源是否齐全；5. 项目适用的正式标准另行核验。这里不补造热工数值，也不作达标、审图或施工验收承诺；当前独立目标不沿用旧候选数值。
