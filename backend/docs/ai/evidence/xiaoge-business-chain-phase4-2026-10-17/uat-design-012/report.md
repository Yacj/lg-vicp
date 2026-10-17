# 销售 / 设计院真实 AI UAT

计划：1场景 / 3轮；已执行：3轮。
通过 0；警告 0；失败 3；阻塞 0；Hard Fail 2。

Intent 0.0%；参数 100.0%；事实 0.0%；多轮状态 100.0%；来源 100.0%。
ReferencePage 0/0。

工程事实全部由程序断言；规则/AI体验评分的method见逐轮JSON。没有模型调用的轮次不算通过。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 1

用户：A1-3 I型18mm图集参数
结果：FAIL / 55

- ROUTING：预期intent=REFERENCE_LOOKUP，实际=GENERAL
- ROUTING：本轮实际工具须包含 thermal
- ROUTING：热工操作=LOOKUP_CANDIDATES
- RETRIEVAL：预期正式行存在且数值/规格/来源一致

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["thermal"],"operation":"LOOKUP_CANDIDATES","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"expectedCandidate":{"schemeCode":"A1-3","specClass":"I","thicknessMm":18,"productThermalResistance":2.88,"totalThermalResistance":3.297,"kValue":0.303,"sourcePageLabel":"22"}}`

实际条件/决策：`{"decision":{"goal":"CLARIFY","patch":[],"intent":"GENERAL","source":"INTENT","factRead":null,"mutation":"NONE","relation":"NEW","taskType":"GENERAL","pageQuery":{"intent":"REFERENCE_LOOKUP","queryMode":"NEW_QUERY","confidence":0.95,"unresolved":[],"constraints":[{"hard":true,"type":"ENTITY","field":"schemeCode","value":null,"metric":null,"evidence":"A1-3","operator":null,"operation":"SET","confidence":0.95,"entityText":"A1-3","resolvedText":null},{"hard":true,"type":"ENTITY","field":"specClass","value":null,"metric":null,"evidence":"I型","operator":null,"operation":"SET","confidence":0.95,"entityText":"I型","resolvedText":"I"},{"hard":true,"type":"THICKNESS","field":null,"value":18,"metric":null,"evidence":"18mm","operator":"EXACT","operation":"SET","confidence":0.95,"entityText":"18mm","resolvedText":null}],"preferences":[]},"toolRoute":["backend:clarify"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":null,"candidateIds":[],"domainIntent":"CLARIFY","parserSource":"LLM","policyReason":"PAGE_QUERY_CONSTRAINTS_INVALID","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"CLARIFY","candidateIdList":[],"requestedEffect":"QUERY","referencePageIds":[],"semanticEvidence":"A1-3 I型18mm图集参数","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED_CLARIFICATION","queryChangedFields":[],"semanticConfidence":0.95,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

想确认一下：明确指定的对象未被完整保留，请确认。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 2

用户：请按当量法正式计算A1-3 I型18mm的K
结果：FAIL / 55

- RETRIEVAL：本轮工具调用均成功，不能将业务失败当作可用结果
- ROUTING：热工操作=CALCULATE
- THERMAL [HARD]：本轮改变厚度的真实计算必须有计算模式冻结记录

预期：`{"intent":"THERMAL","toolsAny":["thermal"],"operation":"CALCULATE","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"resultType":"CALCULATED","answerFacts":[{"pattern":"(?:K|传热系数)[^\\d]{0,20}","value":0.303,"tolerance":0.0005}]}`

实际条件/决策：`{"decision":{"goal":"THERMAL_CALCULATE","patch":[],"intent":"THERMAL","source":"INTENT","factRead":null,"mutation":"CALCULATE","relation":"NEW","taskType":"GENERAL","toolRoute":["thermal","search_knowledge","get_product_data"],"toolUsage":{"report":false,"thermal":true,"knowledge":true},"adviceMode":null,"domainIntent":"THERMAL_CALCULATE","parserSource":"LLM","policyReason":"EXPLICIT_EFFECT_PROPOSAL","queryChanged":false,"reportQueued":false,"effectRequest":{"direct":true,"evidence":"请按当量法正式计算A1-3 I型18mm的K","polarity":"AFFIRMATIVE","speechAct":"REQUEST"},"sourcePageIds":[],"answerContract":"THERMAL","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"CALCULATE","referencePageIds":[],"semanticEvidence":"请按当量法正式计算A1-3 I型18mm的K","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

现在还不能按当量法正式计算：A1-3、I型、18mm 这组构造与规格没有匹配到可用的已发布构造方案和产品规格，缺少正式计算所需的方案标识和规格标识，所以尚未生成 K 值。这部分也暂不参与比较。

已发布图集资料中可查到一组 A1-3、I型、18mm 的参考值：产品层热阻 2.880 m²·K/W，总热阻 3.297 m²·K/W，传热系数 K=0.303 W/(m²·K)；该构造基层为 240mm 灰砂砖（λ=0.9），当量导热系数 λ=0.005 W/(m·K)、修正系数 α=1.25，见印刷页 22。这组数值属于图集参考值，并不等同于按当量法重新计算的结果。

可以确认一下：你手上这个 A1-3 是图集里的参考做法，还是已在你项目里选定的构造方案？如果已选定，请告诉我确认的构造方案名称或编号，我再做正式计算。

## DESIGN-012 DESIGN_INSTITUTE / 正式计算与冻结快照 / Turn 3

用户：重新计算A1-3 I型22mm，给出计算值
结果：FAIL / 55

- RETRIEVAL：本轮工具调用均成功，不能将业务失败当作可用结果
- ROUTING：热工操作=CALCULATE
- THERMAL [HARD]：本轮改变厚度的真实计算必须有计算模式冻结记录
- ANSWER_CONTRACT：最终文字正确表达预期数值 0.254

预期：`{"intent":"THERMAL","toolsAny":["thermal"],"operation":"CALCULATE","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"resultType":"CALCULATED","answerFacts":[{"pattern":"(?:K|传热系数)[^\\d]{0,20}","value":0.254,"tolerance":0.0005}]}`

实际条件/决策：`{"decision":{"goal":"THERMAL_CALCULATE","patch":[{"op":"SET","field":"thicknessMm"}],"intent":"THERMAL","source":"INTENT","factRead":null,"mutation":"CALCULATE","relation":"REFINE","taskType":"GENERAL","toolRoute":["thermal","search_knowledge"],"toolUsage":{"report":false,"thermal":true,"knowledge":true},"adviceMode":null,"domainIntent":"THERMAL_CALCULATE","parserSource":"LLM","policyReason":"EXPLICIT_EFFECT_PROPOSAL","queryChanged":false,"reportQueued":false,"effectRequest":{"direct":true,"evidence":"重新计算A1-3 I型22mm，给出计算值","polarity":"AFFIRMATIVE","speechAct":"REQUEST"},"sourcePageIds":[],"answerContract":"THERMAL","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"CALCULATE","referencePageIds":[],"semanticEvidence":"重新计算A1-3 I型22mm，给出计算值","semanticReference":{"items":[{"type":"CONSTRUCTION_CODE","value":"A1-3","evidence":"A1-3"}],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

A1-3、I型、22mm 目前没有图集参考档位，也没有可用的正式计算方案记录，因此无法给出系统计算值。

已发布的 A1-3 参考档位只有 18mm 和 25mm 两档：18mm 的 K=0.303、25mm 的 K=0.226 W/(m²·K)，见印刷页 22。22mm 处于这两档之间，但图集未给出该厚度的参考值，我不会按这两档推算。

如果你需要，我可以按图集给出的当量参数建立该构造的正式计算，不过那需要你确认可用的构造方案（含 22mm 规格）；目前还没有这样的已发布方案可供计算。
