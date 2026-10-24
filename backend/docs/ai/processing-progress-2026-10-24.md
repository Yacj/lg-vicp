# AI 对话处理过程展示

本轮实现客户要求的查询处理过程：理解问题、读取产品资料、核对参数、知识检索、参考资料核对及整理回答。只显示真实执行阶段与已授权读取结果中的资料名称、印刷页码；不展示模型原始推理、工具入参、内部编号、签名地址或检索正文。不需要开启 reasoningMode，不更换正式模型。

根因：原 SSE 在语义与大部分资料查询结束后才启动；App 只显示一条当前状态，回答完成即消失。现在在原权限、配额、会话锁和消息身份核验后开始推送准备阶段，实际执行步骤分别更新。准备失败、断开连接、停止都会结束进度并释放原生成状态。查询、数值、候选、Revision、Confirm、Snapshot 和报告授权合同不变。

App 生成期间默认展开，完成后自动折叠，可在本次会话中重新查看。同一本资料的印刷页码合并，资料名称来自实际返回结果，不从模型猜测。过程仅保存在当前客户端消息中；不回填历史消息，彻底刷新后不伪造旧步骤。停止按钮另行补上本地步骤冻结，迟到 SSE 不能将未完成步骤改成成功。

验证证据位于 `evidence/processing-progress-2026-10-24/`：

- Backend 全量 3337 passed / 1 expected fail / 1 skipped；最后的计算阶段完成提示另跑生成编排与处理过程 16 项定向回归。原有预期失败与原件缺失跳过保持原状。
- App 最终165项测试全部通过，类型检查、生产 H5 构建通过，结果见对应 final 日志。新增 Mock 仅登记真实处理工具与原有 stopMessage，不修改业务期望。
- 真实 DeepSeek HTTP/SSE：200mm 钢筋混凝土、K<0.3 参考查询，首进度643ms、结束12503ms；停止场景首进度660ms、结束2822ms。结果见 `real-sse-review.json`。原首次验证脚本误给空 JSON body，导致停止请求400；原失败记录保留为 attempt1，修正脚本为 App 原有的 `{}` 请求体后复测通过。
- 真实 Edge H5：产品咨询与200mm墙体查询出现处理过程入口；展开显示真实资料与页码，完成自动折叠；生成时可见“正在理解你的问题”。发现本地停止后步骤仍显示进行中，已修复并补真实 store 回归。后续浏览器控制中断，手机390px检查未完成，最终停止显示由 store 自动测试及真实停止SSE验证；不据此宣称原生App/全部UAT通过。
- 临时随机库、隔离Redis前缀、当前正式模型、只读生产资料副本；没有生产业务写入。已独立确认测试库不存在、前缀Redis键0、对象写入0；自建H5端口8897及API4341已停止，临时登录文件已移除。清理结果见 environment.json 和 independent-cleanup-proof.json。

本轮未部署 Backend 或 App，未改生产数据、模板、计算规则、历史快照及文件下载。此前其他 UAT 缺项和整体 NOT READY 结论保持。

## 本轮修改文件

Backend：`ai-generation.service.ts`、新增 `ai-processing-progress.ts` / `.test.ts`、`product-parameter-generation.test.ts`，以及本说明与规则索引。

App：`AiAgentStatus.vue`、`AiMessageList.vue`、`api/types.ts`、`utils/aiStream.ts`、新增 `utils/aiProcessing.ts` / `.test.ts`、`store/assistant.ts` / `assistant-report.test.ts`，以及 README。
