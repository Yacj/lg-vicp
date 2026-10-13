# 语义路由阶段0审计

基线是当前工作区（含此前只读建议修复），不是压缩包。此审计先于本轮实现修改。

## 实际入口与竞争路径

- `solution-advice-intent.ts` 的 `positiveRequestText` 删除否定范围；`hasExplicitSolutionMutation`、`readOnlyAdviceLanguage` 对删改后的文本分类。
- `resolveDomainTurn` 先调用这些帮助函数，后调用开放正则 `decideDomainTurn`，最后才调用现有模型；模型异常再次调用帮助函数兜底。这是同一目标的竞争判定。
- `loadAdviceBusinessContext` 对旧 GENERAL 用户文本再次做关键词建议识别，未经语义合同恢复业务目标。
- `ai-generation.service.ts` 的 Advice 路径跳过正式动作模型与状态加载，但参数变化先被 unsafe 排除；结构化查询适配器又独立于目标调用。
- Agent、reference query、comparison/calculation tools 在缺 domainDecision 时同步调用决定器；只能保留封闭命令并默认拒绝副作用，不能猜本轮授权。
- 写入链为 Domain→Solution semantic grounding→revision/权限/来源→既有 mutation；正式确认仅闭合命令，报告须授权及 CONFIRMED Snapshot。该链不能被建议扩大。

## 反例与失败测试

`domain-semantic-regression.test.ts` 固定16个正常/否定/引用/假设/复合任务案例。受控模型返回完整语义，断言开放表达必须到同一模型合同，以及只读目标不得变更状态。包含确认K、暂不确认、否定推荐、否定报告、45mm建议、比较后建议、报告提纲、引用确认、假设加入、正式PDF、合规核验。测试先在旧实现运行记录失败，再实施合同迁移；模型 fixture 不是自然语言关键词分类器。

审计结论：移除帮助函数与 Domain 开放词法路由；保留无损归一、封闭完整命令、现有工程提取和事实验证。建议新增条件先经现有查询服务，建议不计算、不激活方案状态。
