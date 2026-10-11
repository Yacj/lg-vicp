# B端问答完整原页引用

版本 test-qa 保留 B_ADMIN、doc:test 和版本门禁。普通问答加载本次检索的同版本确认快照；明确指标数值查询读取当前版本的全部确认档位，复用 normalizeConversationLookupQuery 与 matchThermalCandidates 筛选和排序，避免文本 top-N 漏掉目标页。不访问全局参考集，草稿不进入生产检索。不修改 Recognition、Parser、Matcher、公式或数据库结构。

识别详情和问答页面块返回 renderModel，保留完整构造、层、所有档位及备注。pageId+确认快照摘要生成 constructionId/optionId；快照变化后旧引用失效。缺失双R/K不补算，旧语义不明 rValue 不映射总R。

明确数值查询的回答由后端直接抄录匹配档位（最多三个例子），不让模型自由拼接数值、构造或引用；零命中说明当前确认范围未找到，不回退旧文本猜值。普通问答仍由模型回答，确认记录优先占用知识预算，逐条完整保留，不做字符截断；只允许引用实际发送的 optionId。来源统一从对应完整页块获取，数值查询不把无关文本命中列为回答依据。服务端在发 delta 前隐藏内部 `[[KP:optionId:fieldKeys]]`（支持跨 token）；只接受当前快照的真实标识和有值字段。可见 delta 与落库正文一致。

reference_pages / done.referencePages 返回 page、完整 renderModel 及 matches。每个 match 含 pageId/constructionId/optionId/fieldKeys/answerOffset、同档位摘要。answerOffset 为清除标记后的 JS 字符位置，供前端绑定回答段落。完整表格保留未命中行，只高亮当前段落引用；表格/原图一次只显示一种，不裁小表，不抢滚动。

原图保留简图和页脚。快照缺少图片单元格坐标，不猜测框选位置；精准高亮在完整 HTML 表格中。独立简图嵌入表格仍需真实区域数据。

真实验收：`pnpm exec tsx scripts/verify-knowledge-page-references.ts` 使用随机临时库、独立Redis/对象、真实模型和正式 B端HTTP/SSE，不写源业务库。报告在 logs/knowledge-reference-uat；环境失败记 BLOCKED，不算通过。
