# 知识版本原文问答路由修复（2026-10-10）

用户提供两条线上失败案例：`A1-3：I型 VICP 有么` 命中明确的 A1-3/I型原文却回答正式参考表无方案；`保温薄抹灰传热系数0.3方案有么` 命中 K=0.293 的原文，但可能被同一查表路由截走。第二条提供的是检索调试结果，没有完整回答。

## 原因

`streamVersionTestQa` 先以 versionId 限定检索并传入 knowledgeChunks。生成服务虽然关闭 Agent 且设置 needReferenceLookup=false，Answer Contract 仍通过问题文字中的“有么/传热系数”进入 REFERENCE_LOOKUP。随后非 Agent 查表读取正式热工数据并用 Allowed Facts 替换原文上下文，最终返回参考表未命中模板。

`test-inspect` 独立于流式回答，answer 恒为 null；matchedReferenceRows 查询命中页的关联热工行，0 不表示原文中没有方案。

## 修改

- Answer Contract 增加内部 knowledgeContextProvided 信号，优先 KNOWLEDGE；knowledgeChunks 为空数组也保持调用方的检索范围，不改为全库查表或计算。
- 生成服务从是否提供 knowledgeChunks 设置该信号及 sourceOnly 原文上下文，覆盖版本测试和显式知识问答入口；普通对话未提供该参数，仍使用原有正式查表及事实门禁。
- 原文上下文补充命中页自身 pageContext，按 versionId/pageId 去重；不同页面各自保留来源，不跨页补配参数。
- 原文问答提示要求从表头、构造编号、型号及档位绑定参数。原文明示 A1-3/I型时可回答资料里有此构造；孤立的 K=0.293 不证明体系或厚度，关联完整时才描述为接近0.3，不改写为等于0.3，不宣称计算或规范达标。

## 范围及验证

无数据库迁移、公式、HTTP/SSE或前端协议变化。版本权限、检索守卫、来源映射及正式对话事实门禁保留。此修复不将原文自动转换为正式参考候选，也不修改普通正式对话的原文回退链。

按用户要求不运行自动测试或 UAT，不调用线上问答验证。代码差异检查与 pnpm build 编译已通过；随后将提示词中的示例数字改为通用说明，避免模型误用示例。2026-10-10 已按用户要求通过 pnpm deploy 重新编译并发布到线上，数据库备份及迁移完成，API/Worker 重载后均为 online，部署健康检查通过。实际模型回答效果尚未验证。
