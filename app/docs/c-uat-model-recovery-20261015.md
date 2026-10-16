# 筑小格 H5 + Backend：上游模型恢复后 UAT 复测

2026-10-15，香港时间。账号 `152****4975`。执行基线 `5719bac5327ccaa8718c47c391507fba1644041d`，没有修改业务代码或部署。

**结论：上游 AI 已恢复，正式方案生成主干跑通；整体验收仍不通过。** 12 组纯对话计划 53 轮，实际执行 52 轮：12 PASS、10 PARTIAL、27 FAIL、3 BLOCKED；另 1 NOT_RUN。52 轮没有请求错误或 `SEMANTIC_UNAVAILABLE`。模型可用不代表语义与多轮业务已正确。

本轮新增完成真实自然语言查表、加入方案、比较、设置 Final → H5 显式确认 → H5 显式生成 → 真实 Worker PDF 的链路。上一轮上午使用 REST 查询补测，本轮首问及选择由真实对话驱动，没有伪造候选或快照。该成功路径不能覆盖其他失败路径。

## 范围与证据

- 按用户提供的 UAT 手册执行；前端范围依用户补充为 H5，未做 Android/iOS 真机。
- 每组对话新建会话，组内保留连续上下文，使用真实 HTTP/SSE、持久化回答、领域决策、工具调用、查询状态及来源事件复核。
- 判定人是执行助手，未由独立业务人员签收。表内 PASS 针对后端回答与状态合同；H5 页面缺陷另计，不表示整个平台通过。
- 源库只读复制到 UUID 隔离数据库，Redis/BullMQ 与 OSS 报告对象使用同一 UUID 前缀。复制 79 页、161 Chunk，知识页事实与源数据一致。正式标准与限值均为 0，不能作合规通过声明。
- 本轮不重复运行未发生代码变化的自动测试。上午的测试、构建和静态检查结果见 [上午复测报告](c-uat-retest-20261015.md)，其中 App type-check/lint 失败仍未修复，不能算本轮新增通过。
- 证据目录：`C:/Users/admin/.codex/visualizations/2026/10/15/01a13d15-1b5d-7bc2-8259-e164bbf59a66/uat-recovery/`。逐轮原话、预期、实际、判定见 `reviewed-turns.md` / `reviewed-matrix.json`，原始状态见 `conversations.json`。

## 对话矩阵

P=PASS，△=PARTIAL，F=FAIL，B=BLOCKED，N=NOT_RUN；从左到右对应原手册轮次。

| 用例 | 逐轮结果 | 主要问题 |
| --- | --- | --- |
| UAT-01 四基层与原页 | △ / F / F / F | 四条初查正确；最低 K 追问清空候选，随后无法打开原页 |
| UAT-02 精确构造与厚度 | F / F / F / △ / F | 首问误入已有候选详情，未查询；厚度追问失去起点 |
| UAT-03 比较与否定 | F / F / F / F / F / P | 初次比较误用当前候选读取，后续缺少有效上下文 |
| UAT-06 指标纠正 | P / F / F / P | K≈0.3 未替换旧 PRODUCT_R≈8.3；上限厚度未正确更新 |
| UAT-07 产品与图集 | P / F / △ / △ | 将目录产品覆盖范围与图集型号覆盖混淆 |
| UAT-08 计算与来源 | F / △ / B / F | 初次精确查表失败，未建立实际计算结果 |
| UAT-09 合规边界 | P / F / △ | 未假称全地区合规，但业务澄清/上下文不完整 |
| UAT-10 筛选继承 | F / F / F / F / F | 首问误入产品发现；后续 K 筛选丢失 III 型/45mm |
| UAT-11 动作边界 | F / △ / △ / P / P | 部分引用/意图不准；未擅自确认或生成报告 |
| UAT-12 澄清与中断 | P / P / B / N / B | 没有形成所需澄清前置；主动断网未执行 |
| UAT-15 普通聊天 | P / △ / F / △ | “如何查图集”误当私有内部机制拒答 |
| UAT-16 无命中/证据 | F / P / P / F | 999mm 未准确表达无档位，后续丢失条件 |

3 个 BLOCKED 是业务前置未形成，并非模型故障：UAT-08 第 3 轮没有实际计算结果；UAT-12 第 3/5 轮未收到应有系统澄清。UAT-12 第 4 轮要求主动断网/恢复，本轮未执行，后续需单独补验。

52 轮纯对话结束，数据库共 0 Snapshot、0 Report，无残留 STREAMING 消息；没有把普通咨询自动变成正式方案或报告。详见 `final-audit.json`。

## 自然语言方案 → H5 确认 → PDF

独立业务会话 `931b9004…`，首问查得四条真实确认档位。接续 UAT-04、UAT-05：

| 操作 | 实际结果 |
| --- | --- |
| 自然语言加入 A3-2 / A3-4 | PASS：selected=2，REFINING；未创建 Snapshot/Report |
| 比较这两个方案 | PASS（后端）：仅两条，基层/厚度/R/R₀/K 同候选一致 |
| “先不要确定最终方案，给我建议” | 只读，无 Final、Snapshot 或 Report；建议提及四条可见方案，非仅已选二条 |
| 自然语言设置 A3-2 最终 | PASS：READY_TO_CONFIRM，Final=1；Snapshot=0、Report=0 |
| H5 点击“确认生成方案” | PASS：CONFIRMED，Snapshot=1、Report=0 |
| 自然语言“查看已确认方案。” | FAIL：已有唯一确认快照，仍追问“指定卡片序号” |
| H5 点击“查看已确认方案” | PASS：展示最终 A3-2、备选 A3-4 及冻结来源 |
| H5 点击“生成技术方案PDF” | PASS：同一快照生成 technical_scheme；真实 Worker COMPLETED/100%，READY、未发布 |
| 两个并发重复生成请求 | PASS：均 reused=true、同一 reportId；总报告仍为 1 |
| 授权预览/下载 API | PASS：实时 HTTPS、均 200；同一有效 PDF，1,877,870 字节，inline / attachment 正确 |
| PDF 冻结事实 | PASS：最终及备选的构造、基层、厚度、R/R₀/K 与 Snapshot 逐项一致 |
| PDF 逐页目视 | PARTIAL：7 页中文可读，2 张完整来源图，高亮正确；页码和尾部分页缺陷仍在 |

报告 `dedd263f…`、快照 `2414f926…`，最终仍是 1 Snapshot / 1 Report、未发布。业务证据见 `business-flow.json`、`business-confirm-proof.json`、`report-proof.json`、`pdf-verification.json`。

UAT-05 不能整组标 PASS：本轮没有重做“生成期间离开后找回”的 UI 操作、审核状态变更或浏览器内 PDF 预览/下载。上午浏览器预览被浏览器操作安全策略拒绝，本轮没有绕过或重试；后端短效 URL 与下载文件 QA 已独立完成。

## 权限与幂等

`report-proof.json` 共 15 项检查全部通过：显式生成单一报告、Worker 真正 READY、并发复用、预览/下载文件一致；隔离用户 B 访问 A 的会话/方案/快照/报告/预览/下载/创建均拒绝；未登录、无效令牌拒绝；C 端未经审核不能发布，READY 与已发布分离。

拒绝响应实际采用 HTTP 200 + `success=false` + `error.code=401/404/409`，按业务包络语义判定，未误记为越权成功。

UAT-13/14 仍有本轮未重做项：旧签名过期、跨新会话序号引用、SSE 断线重连、UI 快速双击、真实 Worker 失败重试、登录过期恢复及注入 500。上午故障/授权 URL 检查保留原记录，不能宣称本轮全部重跑。

## 待修复缺陷

| 编号 / 级别 | 可复现事实与影响 | 证据 |
| --- | --- | --- |
| R01 / P0 | UAT-06 第 2 轮用户明确纠正 R 为 K，仍保留 PRODUCT_R≈8.3 并追加 K≈0.3；QueryState 主 metric 仍是 PRODUCT_R。应替换指标，不应作交集；第 3 轮 20mm 以内又被 THICKNESS_EVIDENCE_INVALID 拒绝。 | regression-proof.json；逐轮 06-2/3 |
| R02 / P0 | UAT-01 第 1 轮四条正确，第 2 轮最低 K 虽答对 A3-4 / 0.248，却发空 reference_candidates、revision 变 3，清空最近候选。原表追问 3/4 轮随后失败。只读比较应保留来源与候选。 | regression-proof.json；逐轮 01-1～4 |
| R03 / P0 | UAT-02/08 首问已有 III 型、A3-2、45mm，却被路由 REFERENCE_DETAIL / READ_ONLY，返回“当前没有可定位的候选”；首次查询未执行。UAT-03 初次比较也要求已有候选。 | conversations.json 对应 backendDecision |
| R04 / P0 | UAT-10 初始 III 型 45mm 请求误入 PRODUCT_DISCOVERY；下一轮 K<0.29 结果出现 25/35mm，丢失型号/厚度约束。 | 逐轮 UAT-10 |
| R05 / P0 | H5 对话正文空白。UAT-02 五个 mp-html 均有非空 content 属性（33/60/60/243/47 字符），但 textContent 为空且无子节点；Vue 明确报 Failed to resolve component: mp-html。后端回答存在，用户页面看不到。 | h5-empty-answer.jpg、h5-empty-answer-dom.json、h5-console.json |
| R06 / P1 | 已确认唯一快照仍无法通过自然语言查看，错误要求指定候选序号；UI 快照按钮可用。 | business-confirm-proof.json |
| R07 / P1 | 型号 I/II 对比将“正式目录只有 I”扩大为图集没有 II；本轮知识页包含多型号。目录与图集证据范围需明确。 | 逐轮 UAT-07 |
| R08 / P1 | “聊聊如何查图集”被当私有内部机制拒答；999mm 无命中表述及后续证据条件继承错误。 | 逐轮 UAT-15-3、16-1/4 |
| R09 / P1 | 来源标签写“印刷页 5/6”，原图实际印刷 25/26；7 页 PDF 再次带入错误标签。源知识页标签错误，不能通过改报告数字掩盖来源问题。 | pdf-page-4.png、pdf-page-6.png、pdf-verification.json |
| R10 / P2 | PDF 风险条目跨第 6/7 页，最后一页仅少量文字，留白过多。 | pdf-page-7.png |

H5 控制台另出现表格 ScrollView 激活时 scrollTop/scrollLeft 空对象异常，暂不认定为正文空白根因。上午发现的卡片缺基层字段、浏览器来源图片失败未在本轮逐项重验，仍保留为未关闭事项。

建议修复顺序：R01 指标替换、R02 只读追问保留上下文、R03/R04 查询路由与约束继承、R05 H5 正文渲染；然后按原话回放对应多轮用例及自然语言到 PDF 链路。修复必须延用既有语义与 Backend Policy，不新增开放关键词捷径，不改写确认快照或伪造资料。

## 收尾

测试数据只写入本轮隔离范围。已完成清理并独立复核：随机隔离数据库不存在，Redis 剩余键 0，本轮 2 个 OSS 报告对象均不存在；源知识仍为 79 页、161 Chunk。API/H5 的 3300/5173 监听均已停止，开发服务器生成的已跟踪文件已恢复，业务代码无改动。见 `cleanup-proof.json` 与 `cleanup-verification.json`。

归档文本经过密码、JWT、OSS 签名参数检查，结果记录在 `redaction-check.json`。业务缺陷尚未修复，不构成发布批准。
