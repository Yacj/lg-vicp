# 销售 / 设计院真实 AI UAT

计划：1场景 / 3轮；已执行：3轮。
通过 0；警告 1；失败 2；阻塞 0；Hard Fail 5。

Intent 0.0%；参数 66.7%；事实 66.7%；多轮状态 33.3%；来源 33.3%。
ReferencePage 0/1。

工程事实全部由程序断言；规则/AI体验评分的method见逐轮JSON。没有模型调用的轮次不算通过。

## SALES-017 SALES / 真实传热8.3保温板问句先区分产品R与总R / Turn 1

用户：有传热8.3的保温板么
结果：WARN / 80

- ROUTING：预期intent=REFERENCE_LOOKUP，实际=GENERAL

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":[],"hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"clarification":true,"answerIncludes":["热阻"]}`

实际条件/决策：`{"decision":{"goal":"CLARIFY","patch":[],"intent":"GENERAL","source":"INTENT","factRead":null,"mutation":"NONE","relation":"NEW","taskType":"GENERAL","toolRoute":["backend:clarify"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":null,"candidateIds":[],"domainIntent":"CLARIFY","parserSource":"LLM","policyReason":"SEMANTIC_AMBIGUOUS","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"CLARIFY","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"有传热8.3的保温板么","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"NOT_EVALUATED_CLARIFICATION","queryChangedFields":[],"semanticConfidence":0.55,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

想确认一下：“传热8.3”指标含义不明确：是整墙传热系数K、整构造热阻R，还是产品热阻？

## SALES-017 SALES / 真实传热8.3保温板问句先区分产品R与总R / Turn 2

用户：我说的是传热系数K，改查0.3左右
结果：FAIL / 10

- ROUTING：本轮实际工具须包含 thermal
- ROUTING：热工操作=LOOKUP_CANDIDATES
- PARSER [HARD]：会话权威条件与预期相同（含明确清除的字段）
- STATE [HARD]：条件变化实际重新查询完整正式数据
- RETRIEVAL：预期正式行存在且数值/规格/来源一致
- SOURCE [HARD]：原页ID/印刷页码与正式行一致
- SOURCE [HARD]：原页ID/印刷页码与正式行一致
- HALLUCINATION [HARD]：合规肯定结论必须有正式地区标准快照

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["thermal"],"operation":"LOOKUP_CANDIDATES","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"query":{"filters":[{"metric":"K","mode":"APPROX","targetValue":0.3}]},"expectedCandidate":{"schemeCode":"A1-3","specClass":"I","thicknessMm":18,"productThermalResistance":2.88,"totalThermalResistance":3.297,"kValue":0.303,"sourcePageLabel":"22"}}`

实际条件/决策：`{"decision":{"goal":"REFERENCE_QUERY","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"QUERY","relation":"CONTINUE","taskType":"GENERAL","pageQuery":{"intent":"REFERENCE_LOOKUP","queryMode":"NEW_QUERY","confidence":0.9,"unresolved":[],"constraints":[{"hard":true,"type":"METRIC","field":null,"value":0.3,"metric":"K","evidence":"改查0.3左右","operator":"APPROX","operation":"SET","confidence":0.9,"entityText":"0.3左右","resolvedText":null}],"preferences":[]},"toolRoute":["backend:knowledge","backend:reference_query"],"toolUsage":{"report":false,"thermal":false,"knowledge":true},"adviceMode":null,"candidateIds":[],"domainIntent":"REFERENCE_QUERY","parserSource":"LLM","policyReason":"READ_ONLY_QUERY","queryChanged":true,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","factValidation":"REFERENCE_QUERY_VERIFIED","queryLifecycle":"NEW_QUERY","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"QUERY","referencePageIds":["611204ac-cdd0-4cd7-b9ff-f8f39e829826","56936b2f-5458-4711-a636-fc36cef91d28"],"semanticEvidence":"我说的是传热系数K，改查0.3左右","semanticReference":{"items":[],"scope":"NONE","revision":null},"factValidationCode":"REFERENCE_QUERY_VERIFIED","queryChangedFields":["intent","filters","metric","targetValue","mode","tolerance","effectiveTolerance","toleranceAdjusted","queryMode","semanticConfidence","parserSource","unresolved","conditionTrace","documentIds","knowledgeVersionIds"],"semanticConfidence":0.9,"solutionStateMutated":false,"queryContextMessageId":"fe234048-40a5-4433-9bd5-0e2a3dd0fddb","candidateSnapshotSource":[],"referenceQueryDiagnostics":{"scope":"JOINT","issues":["SOURCE_NOT_VERIFIABLE"],"coverage":"AUTHORIZED_PUBLISHED_ONLY","matchedCount":2,"metricScopes":[{"count":4,"metric":"K","values":[0.226,0.295,0.303,0.343],"rowCount":8,"truncated":false}],"scannedCount":8,"identityCount":8,"missingMetrics":[],"rejectedSourceCount":2,"partialMissingMetrics":[]}}}`

回答：

以下为已确认页面的只读参考，不构成正式方案候选：
本次已确认资料匹配 2 档、2 个独立构造，当前引用 2 档。

- **A1-3**：板厚 **18mm**，产品整体热阻 **2.880**，整构造传热阻（源文符号待核） **3.297**，传热系数 K **0.303**。来源：《销售与设计院UAT测试图集》，印刷页码 22。

- **A1-4**：板厚 **20mm**，产品整体热阻 **3.200**，整构造传热阻（源文符号待核） **3.390**，传热系数 K **0.295**。来源：《销售与设计院UAT测试图集》，印刷页码 23。

同值不代表做法相同，请结合完整表及原始构造简图核对。材料层热阻、产品整体热阻与整构造传热阻分别读取，缺值不补算；本次仅查阅资料，不选择方案或判断规范达标。

部分来源未通过当前确认档位校验，已排除；可核验结果如上。

仅覆盖当前有权访问、已发布生效的确认范围；参考值不构成计算或合规结论。

## SALES-017 SALES / 真实传热8.3保温板问句先区分产品R与总R / Turn 3

用户：刚才第一个图集哪一页？
结果：FAIL / 55

- ROUTING：本轮实际工具须包含 thermal
- ROUTING：热工操作=LOOKUP_CANDIDATES
- STATE：原页/参数追问实际沿用上一轮候选
- SOURCE：本轮SSE真实返回ReferencePage

预期：`{"intent":"REFERENCE_LOOKUP","toolsAny":["thermal"],"operation":"LOOKUP_CANDIDATES","hardFailRules":["HARD_CONDITION","METRIC_CONFUSION","FABRICATED_PAGE","RESULT_TYPE","UNSUPPORTED_COMPLIANCE","STALE_CONDITIONS","THICKNESS_VIOLATION"],"reusePreviousCandidate":true,"referencePageRequired":true,"resultType":"REFERENCE"}`

实际条件/决策：`{"decision":{"goal":"REFERENCE_VIEW","patch":[],"intent":"REFERENCE_LOOKUP","source":"INTENT","factRead":null,"mutation":"NONE","relation":"CONTINUE","taskType":"GENERAL","toolRoute":["backend:reference_read"],"toolUsage":{"report":false,"thermal":false,"knowledge":false},"adviceMode":null,"candidateIds":[],"domainIntent":"REFERENCE_VIEW","parserSource":"LLM","policyReason":"READ_ONLY_SEMANTIC","queryChanged":false,"reportQueued":false,"effectRequest":null,"sourcePageIds":[],"answerContract":"REFERENCE_LOOKUP","factValidation":"VALID_FACTS","referenceScope":"LATEST_VISIBLE","candidateIdList":[],"requestedEffect":"READ_ONLY","referencePageIds":[],"semanticEvidence":"刚才第一个图集哪一页？","semanticReference":{"items":[{"type":"POSITION","value":1,"evidence":"第一个"}],"scope":"LAST_VISIBLE_CANDIDATES","revision":null},"factValidationCode":"VALID_FACTS","queryChangedFields":[],"semanticConfidence":0.9,"solutionStateMutated":false,"candidateSnapshotSource":[]}}`

回答：

当前没有可定位的候选，请先查询已有档位或选择方案。
