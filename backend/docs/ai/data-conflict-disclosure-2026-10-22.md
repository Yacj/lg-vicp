# 资料冲突的只读展示与解释（2026-10-22）

本轮功能已完成并合并到本机主目录，未发布线上。原来已有通用的厚度一致性校验和部分冲突解释，但缺少完整的“两处原值＋各自来源”展示。现在先展示核对表，再解释差异和可继续的帮助；不改数据、不猜哪处正确、不自动放行冲突记录。

整体上线结论仍为 **NOT_READY**：原始35问为 **25 PASS / 6 PARTIAL / 4 FAIL**，35mm参考行与25mm规格的数据绑定冲突仍待正式核对。更清楚地展示和解释这条冲突，并不使双方案确认条件成立。文件下载继续按用户要求排除。

## 客户实际看到的内容

真实 DeepSeek Chat＋H5 的比较追问中，显示了以下两处当前发布记录：

| 核对项 | 资料中的原值 | 来源 |
| --- | --- | --- |
| 参考表中的保温厚度 | 35 mm | VICP热工计算表格公式，Sheet1，版本1 |
| 关联规格的板厚 | 25 mm | VICP-BOARD-25，版本1 |

随后说明：“上面两处的厚度不一致，暂时不能把这条记录当成可用方案。这不表示原表没有这个做法；资料核实前，可以查看这些记录，但不能用这条冲突记录做正式计算或生成方案报告。”同时保留另一条有效25mm候选的查看/选择帮助。复合操作未部分执行，原值未被替换。

这里展示的是可核验的来源记录及Sheet1位置，不伪称原始文件或原图。正式参考记录没有关联原图时，不编页码、链接或图片；已有可授权查看原页的引用仍沿用原入口。文件下载没有操作。

[实际桌面截图](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/conflict-table-1280.png)，[实际手机截图](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/conflict-table-390.png)，[DOM/原值/来源核对](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/conflict-ui-review.json)。

## 通用处理与安全边界

- 新增统一的 `ReferenceDataConflict` 只读事实合同，字段为差异类型、对象、核对项、两处原值、来源位置、可得版本和固定 `usage=READ_ONLY`。它不含候选ID、计算请求、选定正确值或执行授权。
- 厚度从实际记录读取，未写死35/25；同一构造、同一厚度的已识别K、产品层R、整构造总R跨来源数值差异也使用该展示合同。身份和来源必须先由既有服务确定，不能只因编号或数值相似就判冲突。
- 新的解释从当前已授权发布资料重新读取；历史诊断只作为寻找说明入口的线索。同会话、用户、客户端、项目、24h、Query Revision及来源失效检查保留。来源已撤回、记录已修订或上下文失效时不重放旧原因。
- 明确显示来源未标注具体名称的位置，不用AI补文件名/页码；来源文字转义，不能注入HTML、Markdown链接或内部页引用。缺来源的记录仍按原有准入规则处理，显示不构成授权。
- 冲突记录与有效候选保持分开，现有匹配、排除、排序、正式候选准入、计算、Confirm、Snapshot和报告门禁未放宽。跨来源差异展示不替用户选择依据；正式选择仍核验原发布身份和来源，不能拿显示表格当计算输入。
- 原表记录、已发布规则、公式、生产模板和历史快照均未修改。C端直接复用现有Markdown表格和滚动能力，没有增加前端代码、下载入口或选择控件。

此能力针对后端已经识别并能核验的冲突类型；它不是“AI自动发现任意资料错误”。未来新增冲突类型应补相应证据校验后接入同一只读展示，不能靠猜测判断哪份正确。

## 测试结果

| 检查 | 结果 |
| --- | --- |
| 后端定向回归 | 81 PASS |
| 后端全量 | 3094 PASS / 1 expected fail / 1 skipped；0非预期失败 |
| 后端与主目录 lint / TypeScript / AST / build | 全部通过；原12个关键文件、54条白名单未改 |
| db:check | 通过，无迁移 |
| 真实DeepSeek＋H5固定35问 | 25 PASS / 6 PARTIAL / 4 FAIL |
| 5轮真实冲突说明与后续操作 | 两处原值、来源和版本完整；无候选升级、正式操作或报告副作用 |
| 24项独立数值/状态关联校验 | PASS；15/20mm计算与独立公式一致 |
| 72项权限和幂等 | PASS，快照数量不变 |
| H5桌面与390px手机 | 两处值、来源、版本可见，冲突表格没有选择按钮 |

自动测试中的42/28、70/45、13.5/9以及K/R差异只是测试夹具，不写入业务资料，也不冒充真实上游验收。当前真实发布资料可复现的是35/25绑定冲突；跨来源K/R扩展经过纯函数和共享查询Service测试，未伪造真实资料个例。

App源文件与此前158项测试通过的受测版本完全一致；本轮未重复宣称执行App全量测试，新增展示由本轮真实H5验证。Vitest JSON把预期失败归入passed，JSON为3095；控制台分列3094 passed＋1 expected fail，本报告按控制台口径列明。

证据：[定向测试](evidence/data-conflict-disclosure-2026-10-22/targeted-final.log), [全量测试](evidence/data-conflict-disclosure-2026-10-22/backend-tests.log), [lint](evidence/data-conflict-disclosure-2026-10-22/lint-final.log), [build](evidence/data-conflict-disclosure-2026-10-22/backend-build.log), [主目录lint](evidence/data-conflict-disclosure-2026-10-22/main-lint.log), [主目录build](evidence/data-conflict-disclosure-2026-10-22/main-build.log), [迁移检查](evidence/data-conflict-disclosure-2026-10-22/db-check.log), [冲突5轮实测](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/conflict-business-audit.json), [独立校验](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/independent-audit.json), [权限](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/security-acceptance.json)。

## 固定35问与保留的失败

原题逐字保留，SHA256仍为 `59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857`。未修改原预期、阈值、工程参数或权限以取得通过。普通优劣咨询的业务目标可经既有产品或建议路由完成，审计核对实际PROS_CONS目标、事实和无副作用边界，不要求固定句式或固定内部路由。

| 轮次 | 原问 | 结果 | 判定与证据 |
| --- | --- | --- | --- |
| S1-T1 | 介绍下VICP产品。 | **PASS** | 从已确认知识库列出产品名称和可查参数，没有补造用途或完整产品系列。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S1-T1.sse.txt) |
| S1-T2 | 我不是工程师，简单说就行。 | **PASS** | 延续产品上下文，以简短语句介绍现有资料，未生成方案或报告。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S1-T2.sse.txt) |
| S2-T1 | 有保温0.3的材料吗？ | **PASS** | 保留0.3并只澄清指标，没有把未明指标当作K或扫描全部材料。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S2-T1.sse.txt) |
| S2-T2 | 导热系数。 | **PASS** | 实际查询λ EXACT 0.3；无命中，不返回大于目标的泛化材料列表。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S2-T2.sse.txt) |
| S2-T3 | 如果没命中，是没有这个数值，还是缺资料？这次查了哪些？ | **PASS** | 解释上一轮λ=0.3的匹配与资料范围，没有将无命中说成市场上不存在。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S2-T3.sse.txt) |
| S3-T1 | 薄膜灰0.3的有吗？ | **PASS** | 保留数值线索并澄清指标、体系名称，不擅自归一未知体系。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S3-T1.sse.txt) |
| S3-T2 | 我说的是传热系数K，体系是薄抹灰外保温。 | **PASS** | 补充K和薄抹灰体系后继续查询，保留0.3目标、参考来源及只读状态。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S3-T2.sse.txt) |
| S3-T3 | 只看Ⅲ型。 | **PASS** | 只收窄为Ⅲ型，保留K=0.3的既有匹配口径；实际4档均有来源。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S3-T3.sse.txt) |
| S4-T1 | 你们产品有什么优势和不足？ | **PARTIAL** | 已按优劣目标说明现有资料限制并提供核对方向；缺正式正文，不能给完整优缺点结论。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S4-T1.sse.txt) |
| S4-T2 | 和其他保温材料比呢？ | **PARTIAL** | 缺同条件竞品资料，未形成完整比较。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S4-T2.sse.txt) |
| S5-T1 | 客户要做外墙保温，我想先选个VICP参考方案。 | **PASS** | 给出参考选型所需信息与可提供的帮助，未替用户选Final或承诺达标。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T1.sse.txt) |
| S5-T2 | 先用已发布的200mm钢筋混凝土基层Excel示例，不判断达标。 | **PASS** | 列出合法25mm正式参考行，明确排除35mm/25mm绑定冲突，未创造候选。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T2.sse.txt) |
| S5-T3 | 把整体法25mm和分层法35mm的输入、K和限制放一起比较，不当作同厚度对比。 | **PARTIAL** | 正确说明35mm/25mm绑定冲突及可用候选，不再泛化澄清；所需双方案比较仍受正式资料阻塞。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T3.sse.txt) |
| S5-T4 | 先选择整体法25mm这套。 | **PASS** | 真实自然语言选择整体法25mm成功，当前仅选1个，没有自动确认。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T4.sse.txt) |
| S5-T5 | 把这套设为最终方案，参数先让我核对，不要确认。 | **PASS** | 进入Final待确认，未因“设最终”产生Snapshot或报告。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T5.sse.txt) |
| S5-T6 | 我核对好了，请显示确认入口，我自己点按钮。 | **PASS** | 展示确认入口，由真实H5按钮触发确认，冻结本人会话的单方案Snapshot。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T6.sse.txt) |
| S5-T7 | 我要导出PDF，请显示生成入口，我自己操作。 | **PASS** | 展示PDF入口，由真实H5操作生成READY报告；另行下载网络问题单独列PARTIAL。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/S5-T7.sse.txt) |
| R1-T1 | Ⅲ型VICP薄抹灰外保温，45mm，有哪些基层做法？ | **PASS** | Ⅲ型45mm四种基层及K、两种R口径与确认页25/26一致，未跨层补算。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R1-T1.sse.txt) |
| R1-T2 | 把四种基层的K放在一张表里，哪个最低？ | **PASS** | 四种基层45mm的K并列，明确最低/最小0.248；未据此改变实际基层或自动选型。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R1-T2.sse.txt) |
| R1-T3 | 给我看对应原页，定位45mm那档。 | **PASS** | 继续引用页25/26和45mm档，没有重新检索后替换所比较记录。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R1-T3.sse.txt) |
| R2-T1 | I型VICP平屋面，正置和倒置的20mm档分别怎么样？ | **PASS** | 保留I型、平屋面、正置/倒置和20mm两组；R=3.2与整构造R=3.569分列。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R2-T1.sse.txt) |
| R2-T2 | 把两组的R和K列在一起，R是哪一层或哪一列也写清楚。 | **PASS** | 继续并列两组K=0.280及原表R口径；产品整体R缺失时明确保留缺失。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R2-T2.sse.txt) |
| R2-T3 | 打开原图，定位20mm这档。 | **PASS** | 真实页面引用原页53和20mm两档，未误用正式可选候选或改变热阻口径。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R2-T3.sse.txt) |
| R3-T1 | 按Excel右侧分层构造，芯材15mm，给我分层热工计算过程，先不判断达标。 | **PASS** | 15mm芯材按冻结正式分层参数计算，R总=5.306822098，独立公式核对一致。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R3-T1.sse.txt) |
| R3-T2 | 把芯材改成20mm，其他层不变。 | **PASS** | 仅芯材改20mm，其余层保持；R总=6.906822098，独立公式核对一致。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R3-T2.sse.txt) |
| R3-T3 | 列出公式版本、参数来源和缺项；缺了关键参数就不要硬算。 | **PASS** | 读取既有20mm计算，保留规则/公式版本和来源，没有新增第三次计算。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R3-T3.sse.txt) |
| R4-T1 | 浙江省住宅外墙，传热系数K为0.3，能达标吗？ | **PASS** | 没有正式适用标准限值，明确无法判定浙江住宅外墙K=0.3达标。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R4-T1.sse.txt) |
| R4-T2 | 依据哪份正式标准、哪条限值，什么时候生效？ | **PASS** | 解释紧邻真实核验的依据缺项；不自由补适用维度、标准号、限值或日期。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R4-T2.sse.txt) |
| R5-T1 | 查询已发布的VICP-OVERALL和VICP-LAYERED参考行，分别保留输入条件及来源。 | **PARTIAL** | 35mm分层行绑定25mm规格，当前只保留一条合格正式候选。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T1.sse.txt) |
| R5-T2 | 并排比较K、各R的范围和厚度，不按K替我选最终方案。 | **FAIL** | 已明确说明排除原因及可用25mm候选，但不足两条合格正式候选，所需比较未完成。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T2.sse.txt) |
| R5-T3 | 选整体法25mm作为Final，保留分层示例作参考，先不要确认。 | **FAIL** | 正确说明整单未执行；保留无效分层参考的组合请求仍未形成Final，不部分执行或放宽身份。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T3.sse.txt) |
| R5-T4 | 核对最终方案的参数、规则版本和Sheet1来源。 | **PARTIAL** | 未形成Final，只能核对当前参考事实。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T4.sse.txt) |
| R5-T5 | 先停在待确认状态，别生成快照或报告。 | **PARTIAL** | 未自动建快照/报告，但所要求的Final待确认状态尚未形成。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T5.sse.txt) |
| R5-T6 | 确认入口给我，我来点击；不要根据这句聊天自动确认。 | **FAIL** | 无Final，未完成该会话确认闭环。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T6.sse.txt) |
| R5-T7 | 显示PDF生成入口，我自己点击后再打开看。 | **FAIL** | 无Final/Snapshot，没有该会话的正式PDF。 [SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/R5-T7.sse.txt) |

原始完整证据：[35问矩阵](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/matrix.json), [逐轮回复/业务复核](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/fixed35-business-review.json), [Semantic](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/semantic.ndjson), [真实上游请求](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/upstream-requests.json), [HTTP/SSE](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/http-sse.ndjson), [最终状态](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/final-observation.json)。

剩余4项FAIL仍为R5双正式候选比较、复合方案操作、确认和PDF流程未完成；6项PARTIAL包括完整优劣/竞品资料不足及数据冲突引起的链路前提不足。本轮没有把展示冲突当成正式修订。实际仅S5有效25mm方案形成1份快照/1份READY报告，R5为0；没有用其他会话的报告补算通过。缺正式标准的正确拒绝也不代表正式标准正向场景已验收。

## 修改文件

14个归属文件已在合并前逐一核验主目录原哈希，并核对合并后与受测工作树相同；未覆盖其他任务修改。

| 文件 | 类型 |
| --- | --- |
| `backend/src/modules/thermal/thermal-candidate.service.ts` | MODIFIED |
| `backend/src/modules/thermal/reference-query-diagnostics.ts` | MODIFIED |
| `backend/src/modules/ai/solution-candidate-query.service.ts` | MODIFIED |
| `backend/src/modules/ai/solution-candidate-query.service.test.ts` | MODIFIED |
| `backend/src/modules/ai/candidate-availability.service.ts` | MODIFIED |
| `backend/src/modules/ai/candidate-availability.service.test.ts` | MODIFIED |
| `backend/src/modules/ai/thermal-answer-validation.ts` | MODIFIED |
| `backend/AGENTS.md` | MODIFIED |
| `backend/README.md` | MODIFIED |
| `backend/.cursor/rules/30-ai-and-reports.mdc` | MODIFIED |
| `backend/.agents/skills/lg-backend/references/ai-and-reports.md` | MODIFIED |
| `backend/src/modules/ai/ai-generation.service.ts` | MODIFIED |
| `backend/src/shared/reference-data-conflict.ts` | ADDED |
| `backend/src/shared/reference-data-conflict.test.ts` | ADDED |

[逐文件SHA256](evidence/data-conflict-disclosure-2026-10-22/change-manifest.json)，[完整补丁](evidence/data-conflict-disclosure-2026-10-22/repair.patch)，[合并证明](evidence/data-conflict-disclosure-2026-10-22/merge-verification.json)。

## 环境与交付

真实上游始终是已批准的DeepSeek Chat，没有Mock或预设Semantic。源库强制只读，已发布工程JSON按哈希一致复制到1个随机隔离数据库；没有合成工程数据、生产迁移或业务写入。免责声明仍只在隔离库按已批准新版本流程验证，生产模板未发布。下载修复和文件传输测试继续排除，安全回归仅核验下载URL授权。

测试数据库、Redis前缀及2个追踪测试对象均已清理，独立只读核验剩余数据库/键为0；API、H5和浏览器已停止，临时登录文件已删除。全部 940 个Backend/App src文件与本机主目录归一对照一致，14个归属文件逐字节哈希一致，最终源码无漂移。

[最终源码/命令/清理一致性](evidence/data-conflict-disclosure-2026-10-22/source-delivery-integrity.json)，[隔离环境及逐表指纹](evidence/data-conflict-disclosure-2026-10-22/round-01-real-uat/environment.json)，[独立清理检查](evidence/data-conflict-disclosure-2026-10-22/cleanup-independent-check.json)。
