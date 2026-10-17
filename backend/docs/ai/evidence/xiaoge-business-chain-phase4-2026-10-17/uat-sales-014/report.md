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

核心原因是材料本身的当量导热系数很低：按测试图集的数据，I型 VICP 产品当量导热系数 λ=0.005 W/(m·K)。在相同热阻目标下，所需厚度与导热系数成正比，λ 越小，达到同一热阻所需的保温层就越薄。

具体到数据：

- A1-3，18mm，产品层热阻 2.880 m²·K/W，整套构造总热阻 3.297，K=0.303 W/(m²·K)。
- A1-3，25mm，产品层热阻 4.000，总热阻 4.417，K=0.226。

18mm 就能做到接近 3.0 的产品层热阻，说明“薄”是把厚度换成高性能材料换来的，而不是构造上少做了什么。

需要注意的两点：

- 薄不等于便宜、也不等于防火等级更高。测试资料里没有给出造价和防火等级的依据，不能由导热系数低推出这两点。
- 上述数值来自测试图集，不能作为实际工程的达标依据，正式项目仍需按适用标准和构造复核。

依据：《销售与设计院UAT测试图集》第22页（I型 VICP 薄抹灰外保温系统 A1-3 构造及当量导热系数说明）。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 2

用户：导热系数λ是多少？
结果：FAIL / 55

- ROUTING：预期intent=REFERENCE_LOOKUP，实际=GENERAL
- ROUTING：本轮实际工具须包含 search_knowledge / get_product_data
- ANSWER_CONTRACT：最终文字正确表达预期数值 0.005

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["search_knowledge","get_product_data"],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"answerFacts":[{"pattern":"(?:λ|导热系数)[^\\d]{0,30}","value":0.005}]}`

实际条件/决策：`{"decision":{"goal":"KNOWLEDGE_EXPLAIN","patch":[],"intent":"GENERAL","source":"INTENT","factRead":{"mode":"EXPLAIN","metric":null,"evidence":"导热系数λ是多少？","historyClaim":false},"mutation":"NONE","relation":"CONTINUE","taskType":"GENERAL","toolRoute":["backend:knowledge","backend:reference_read"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"candidateIds":[],"domainIntent":"KNOWLEDGE_EXPLAIN","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"KNOWLEDGE","factValidation":"VALID_FACTS","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"导热系数λ是多少？","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"FACT_IDENTITY_REQUIRED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

请补充要核对的构造编号；若已有多个构造，还需明确对应来源和保温板厚度。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 3

用户：帮我写一句客户能听懂的优势说明
结果：WARN / 80

- ROUTING：预期intent=PRODUCT_CONSULTATION，实际=REFERENCE_LOOKUP

预期：`{"intent":"PRODUCT_CONSULTATION","toolsAny":[],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"]}`

实际条件/决策：`{"decision":{"goal":"SOLUTION_ADVICE","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"NONE","relation":"NEW","taskType":"GENERAL","toolRoute":["backend:solution_advice"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":"GENERAL_REFERENCE","candidateIds":[],"domainIntent":"SOLUTION_ADVICE","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"帮我写一句客户能听懂的优势说明","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"ADVICE_REFERENCE_UNAVAILABLE","queryChangedFields":[],"semanticConfidence":0.86,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

通用技术参考可以按以下顺序核对：1. 现场实际基层材料与厚度；2. 选用体系、保温厚度及对应的已确认图集构造；3. 粘结、固定、防火及节点要求；4. 材料参数与来源是否齐全；5. 项目适用的正式标准另行核验。这里不补造热工数值，也不作达标、审图或施工验收承诺；当前独立目标不沿用旧候选数值。
