# 销售 / 设计院真实 AI UAT

计划：1场景 / 3轮；已执行：3轮。
通过 0；警告 0；失败 3；阻塞 0；Hard Fail 4。

Intent 0.0%；参数 100.0%；事实 0.0%；多轮状态 100.0%；来源 66.7%。
ReferencePage 0/0。

工程事实全部由程序断言；规则/AI体验评分的method见逐轮JSON。没有模型调用的轮次不算通过。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 1

用户：A1-3 I型18mm图集参数
结果：FAIL / 45

- ROUTING：本轮实际工具须包含 thermal
- ROUTING：热工操作=LOOKUP_CANDIDATES
- RETRIEVAL：预期正式行存在且数值/规格/来源一致
- SOURCE [HARD]：原页ID/印刷页码与正式行一致
- HALLUCINATION [HARD]：合规肯定结论必须有正式地区标准快照

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["thermal"],"operation":"LOOKUP_CANDIDATES","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"expectedCandidate":{"schemeCode":"A1-3","specClass":"I","thicknessMm":18,"productThermalResistance":2.88,"totalThermalResistance":3.297,"kValue":0.303,"sourcePageLabel":"22"}}`

实际条件/决策：`{"decision":{"goal":"REFERENCE_QUERY","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"QUERY","relation":"NEW","taskType":"GENERAL","pageQuery":{"intent":"REFERENCE_LOOKUP","queryMode":"NEW_QUERY","confidence":0.95,"unresolved":[],"constraints":[{"hard":true,"type":"ENTITY","field":"schemeCode","value":null,"metric":null,"evidence":"A1-3","operator":null,"operation":"SET","confidence":0.95,"entityText":"A1-3","resolvedText":null},{"hard":true,"type":"ENTITY","field":"specClass","value":null,"metric":null,"evidence":"I型","operator":null,"operation":"SET","confidence":0.95,"entityText":"I型","resolvedText":"I"},{"hard":true,"type":"THICKNESS","field":null,"value":18,"metric":null,"evidence":"18mm","operator":"EXACT","operation":"SET","confidence":0.95,"entityText":"18mm","resolvedText":null}],"preferences":[]},"toolRoute":["backend:knowledge","backend:reference_query"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"candidateIds":[],"domainIntent":"REFERENCE_QUERY","parserSource":"LLM","policyReason":"READ_ONLY_QUERY","queryChanged":true,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","factValidation":"REFERENCE_QUERY_VERIFIED","queryLifecycle":"NEW_QUERY","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"QUERY","referencePageIds":["bc5b58e8-fe52-426c-a4e0-04ee8b37fa43"],"semanticEvidence":"A1-3 I型18mm图集参数","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"REFERENCE_QUERY_VERIFIED","queryChangedFields":["intent","filters","mode","toleranceAdjusted","schemeCode","specClass","thicknessMm","queryMode","semanticConfidence","parserSource","unresolved","conditionTrace","documentIds","knowledgeVersionIds"],"semanticConfidence":0.95,"solutionStateMutated":false,"candidateSnapshotSource":[],"referenceQueryDiagnostics":{"scope":"JOINT","issues":["SOURCE_NOT_VERIFIABLE"],"coverage":"AUTHORIZED_PUBLISHED_ONLY","matchedCount":1,"metricScopes":[],"scannedCount":8,"identityCount":2,"missingMetrics":[],"rejectedSourceCount":1,"partialMissingMetrics":[]}}}`

回答：

以下为已确认页面的只读参考，不构成正式方案候选：
本次已确认资料匹配 1 档、1 个独立构造，当前引用 1 档。

- **A1-3**：板厚 **18mm**，产品整体热阻 **2.880**，整构造传热阻（源文符号待核） **3.297**，传热系数 K **0.303**。来源：《销售与设计院UAT测试图集》，印刷页码 22。

同值不代表做法相同，请结合完整表及原始构造简图核对。材料层热阻、产品整体热阻与整构造传热阻分别读取，缺值不补算；本次仅查阅资料，不选择方案或判断规范达标。

部分来源未通过当前确认档位校验，已排除；可核验结果如上。

仅覆盖当前有权访问、已发布生效的确认范围；参考值不构成计算或合规结论。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 2

用户：请按当量法正式计算A1-3 I型18mm的K
结果：FAIL / 55

- RETRIEVAL：本轮工具调用均成功，不能将业务失败当作可用结果
- THERMAL [HARD]：本轮改变厚度的真实计算必须有计算模式冻结记录

预期：`{"intent":"THERMAL","toolsAny":["thermal"],"operation":"CALCULATE","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"resultType":"CALCULATED","answerFacts":[{"pattern":"(?:K|传热系数)[^\\d]{0,20}","value":0.303,"tolerance":0.0005}]}`

实际条件/决策：`{"decision":{"goal":"THERMAL_CALCULATE","patch":[],"intent":"THERMAL","source":"INTENT","factRead":null,"mutation":"CALCULATE","relation":"REFINE","taskType":"GENERAL","toolRoute":["thermal","search_knowledge"],"toolUsage":{"report":false,"thermal":true,"knowledge":true},"adviceMode":null,"domainIntent":"THERMAL_CALCULATE","parserSource":"LLM","policyReason":"EXPLICIT_EFFECT_PROPOSAL","queryChanged":false,"reportQueued":false,"effectRequest":{"direct":true,"evidence":"请按当量法正式计算A1-3 I型18mm的K","polarity":"AFFIRMATIVE","speechAct":"REQUEST"},"sourcePageIds":[],"answerContract":"THERMAL","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"CALCULATE","referencePageIds":[],"semanticEvidence":"请按当量法正式计算A1-3 I型18mm的K","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED","queryChangedFields":[],"semanticConfidence":0.95,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

目前还没有热工计算结果，这部分暂时不参与比较。

这一档还没有定位到可用于正式当量法计算的已发布方案记录；只有图集上的参考值：传热系数 K=0.303 W/(m²·K)（印刷页 22）。该数值是图集参考值，不是系统计算值，且资料本身没有地区合规依据。

请在本对话中直接选定该构造方案（A1-3，I型，18mm），确认后即可按当量法出正式计算值。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 3

用户：重新计算A1-3 I型22mm，给出计算值
结果：FAIL / 55

- RETRIEVAL：本轮工具调用均成功，不能将业务失败当作可用结果
- THERMAL [HARD]：本轮改变厚度的真实计算必须有计算模式冻结记录
- ANSWER_CONTRACT：最终文字正确表达预期数值 0.254

预期：`{"intent":"THERMAL","toolsAny":["thermal"],"operation":"CALCULATE","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"resultType":"CALCULATED","answerFacts":[{"pattern":"(?:K|传热系数)[^\\d]{0,20}","value":0.254,"tolerance":0.0005}]}`

实际条件/决策：`{"decision":{"goal":"THERMAL_CALCULATE","patch":[{"op":"SET","field":"specClass"},{"op":"SET","field":"thicknessMm"}],"intent":"THERMAL","source":"INTENT","factRead":null,"mutation":"CALCULATE","relation":"REFINE","taskType":"GENERAL","toolRoute":["thermal","search_knowledge"],"toolUsage":{"report":false,"thermal":true,"knowledge":true},"adviceMode":null,"domainIntent":"THERMAL_CALCULATE","parserSource":"LLM","policyReason":"EXPLICIT_EFFECT_PROPOSAL","queryChanged":false,"reportQueued":false,"effectRequest":{"direct":true,"evidence":"重新计算A1-3 I型22mm，给出计算值","polarity":"AFFIRMATIVE","speechAct":"REQUEST"},"sourcePageIds":[],"answerContract":"THERMAL","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"CALCULATE","referencePageIds":[],"semanticEvidence":"重新计算A1-3 I型22mm，给出计算值","semanticReference":{"items":[{"type":"CONSTRUCTION_CODE","value":"A1-3","evidence":"A1-3"}],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

A1-3 I 型 22mm 目前没有正式计算值可给。

- 图集已列出的档位是 18mm 和 25mm，分别对应 K=0.303 W/(m²·K) 和 K=0.226 W/(m²·K)（来源：《销售与设计院UAT测试图集》，印刷页 22）。22mm 不在该资料已列档位内，因此我也没有按 22mm 进行正式计算的依据。
- 该资料给出 I 型当量导热系数 λ=0.005 W/(m·K)、修正系数 α=1.25，以及 A1-3 基层 240mm 灰砂砖（λ=0.9）、Ri=0.11、Re=0.04 m²·K/W。不过，这些参数只用于说明资料中给出的口径；以此插值或推定 22mm 的 K，属于自行反算，不能作为正式计算值。

请确认希望采用已列档位中的 18mm 还是 25mm 进行正式当量法计算；如果您确实需要 22mm，请提供该厚度对应的正式方案或产品规格记录。另外，该资料没有地区合规依据，计算值只能表示热工结果，不能据此判定达标。
