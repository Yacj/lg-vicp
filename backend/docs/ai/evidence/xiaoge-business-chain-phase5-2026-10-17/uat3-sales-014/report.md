# 销售 / 设计院真实 AI UAT

计划：1场景 / 3轮；已执行：3轮。
通过 0；警告 2；失败 1；阻塞 0；Hard Fail 1。

Intent 0.0%；参数 100.0%；事实 66.7%；多轮状态 100.0%；来源 66.7%。
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

VICP 能做薄，核心原因是材料本身当量导热系数很低，达到同样保温效果所需厚度小。

**关键点：**

- 在测试资料中，I型 VICP 产品当量导热系数 λ=0.005 W/(m·K)，修正系数 α=1.25，产品层热阻按 R=δ/(λ×α) 计算。正因为 λ 小，较薄的厚度就能获得较高热阻。
- 例如 A1-3 的产品层：18mm 厚对应产品层热阻 2.880 m²·K/W；25mm 厚对应 4.000 m²·K/W。厚度只增加 7mm，热阻提升明显。
- 与之相比，同资料中岩棉测试产品 λ=0.040 W/(m·K)、α=1.0，要接近的热工效果需要厚得多（资料给出的厚度为 50mm）。

**需要注意的边界：**

- “薄”只说明达到同一热阻所需厚度小，不能推断其防火等级更高或成本更低，这些在资料中没有对应证据。
- 以上数值来自测试图集，属参考性质，不代表任何地区法规下的合规结论；正式工程需按适用标准和实际构造复核。

**依据：**《销售与设计院UAT测试图集》测试图集第22页（I型 VICP 薄抹灰外保温系统 A1-3 构造参数及当量导热系数说明）。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 2

用户：导热系数λ是多少？
结果：FAIL / 45

- ROUTING：预期intent=REFERENCE_LOOKUP，实际=GENERAL
- ROUTING：本轮实际工具须包含 search_knowledge / get_product_data
- ANSWER_CONTRACT：最终文字正确表达预期数值 0.005
- SOURCE [HARD]：原页ID/印刷页码与正式行一致

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["search_knowledge","get_product_data"],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"answerFacts":[{"pattern":"(?:λ|导热系数)[^\\d]{0,30}","value":0.005}]}`

实际条件/决策：`{"decision":{"goal":"KNOWLEDGE_EXPLAIN","patch":[],"intent":"GENERAL","source":"INTENT","factRead":{"mode":"EXPLAIN","metric":null,"evidence":"导热系数λ是多少？","historyClaim":false},"mutation":"NONE","relation":"CONTINUE","taskType":"GENERAL","toolRoute":["backend:knowledge","backend:reference_read"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"candidateIds":["kp-c76590aa91122a433388d3d4-0-o0","kp-c76590aa91122a433388d3d4-0-o1"],"domainIntent":"KNOWLEDGE_EXPLAIN","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":["57d0596e-c66b-45f7-9e40-c672d988ed8b"],"answerContract":"KNOWLEDGE","factValidation":"INVALID_FACT","referenceScope":"LATEST_VISIBLE","candidateIdList":["kp-c76590aa91122a433388d3d4-0-o0","kp-c76590aa91122a433388d3d4-0-o1"],"requestedEffect":"READ_ONLY","referencePageIds":["57d0596e-c66b-45f7-9e40-c672d988ed8b"],"semanticEvidence":"导热系数λ是多少？","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"CONFIRMED_FACT_READ","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

I型 VICP薄抹灰外保温系统；方案 A1-3；I型；厚度 18 mm；产品层热阻 R=2.88 m²·K/W；总热阻 R₀=3.297 m²·K/W；K=0.303 W/(m²·K)。
来源：CONFIRMED_PAGE（已确认图集页（页面识别确认）），印刷页码 22。
I型 VICP薄抹灰外保温系统；方案 A1-3；I型；厚度 25 mm；产品层热阻 R=4 m²·K/W；总热阻 R₀=4.417 m²·K/W；K=0.226 W/(m²·K)。
来源：CONFIRMED_PAGE（已确认图集页（页面识别确认）），印刷页码 22。

## SALES-014 SALES / 低导热系数与做薄原因 / Turn 3

用户：帮我写一句客户能听懂的优势说明
结果：WARN / 80

- ROUTING：预期intent=PRODUCT_CONSULTATION，实际=REFERENCE_LOOKUP

预期：`{"intent":"PRODUCT_CONSULTATION","toolsAny":[],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"]}`

实际条件/决策：`{"decision":{"goal":"SOLUTION_ADVICE","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"NONE","relation":"CONTINUE","taskType":"GENERAL","toolRoute":["backend:solution_advice"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":"GENERAL_REFERENCE","candidateIds":[],"domainIntent":"SOLUTION_ADVICE","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"帮我写一句客户能听懂的优势说明","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"ADVICE_REFERENCE_UNAVAILABLE","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

通用技术参考可以按以下顺序核对：1. 现场实际基层材料与厚度；2. 选用体系、保温厚度及对应的已确认图集构造；3. 粘结、固定、防火及节点要求；4. 材料参数与来源是否齐全；5. 项目适用的正式标准另行核验。这里不补造热工数值，也不作达标、审图或施工验收承诺；当前独立目标不沿用旧候选数值。
