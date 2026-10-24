# 小格 AI 全链路修复与最终 UAT

当前结论：**READY（当前已发布资料与公式范围内的修复版本）**。最终轮35问全部PASS，真实H5/DeepSeek、确认与PDF闭环、权限和自动检查完成。生产代码及模板变更尚未部署/发布；此结论不代替具体工程的合规审查。

## 任务与可信依据

本次以 `85597b96655ddda1e9aea2047eac21bf290dfdfd` 为代码基线，累计包含阶段03、阶段04、表头修复及全链路修复。按用户授权同时修复 Backend 与 App，未提交、推送或部署。交接包作为被审阅资料，当前用户要求与后续确认是执行依据。

交接包313项文件哈希、10组35轮原问、两份附件及39个代码入口已经核验。知识库DOCX包含79张可读表；客户Excel的22条BIFF公式已从原文件独立解码核算，与缓存及冻结输入一致。完整读取记录见[资料核验](evidence/phase03-repair-2026-10-19/source-gate.json)。

| 来源 | SHA256 |
| --- | --- |
| 知识库.docx | c6da4d241fa819647f9fcdd3575909ddff39340ad8e839692ad84a4ad593a919 |
| VICP热工计算表格公式(1)(3).xls | 2322dc7c7ba148a1105cb3598e4c4ed1df26824330fb59a875c7c138cb6ae935 |
| 原始 frozen-scenarios.json | 59f1de38bfb5d48bb9fb4207e4e1b48175342f52b7fe201bc7fcecbe35342857 |

UAT通过真实Edge/H5输入、实际Backend HTTP/SSE和正式DeepSeek Chat进行。来源库只读；业务写入发生在随机隔离库、Redis/队列前缀和OSS前缀。工程数据按原值复制，不添加虚构工程样例。合成身份仅用于隔离登录、本人/他人/管理员权限测试。报告文案的新版本另有用户明确确认及独立工作流记录。

## 根因及修复

| 问题 | 根因 | 最终处理与保留的边界 |
| --- | --- | --- |
| λ续问丢失0.3或误加身份条件 | 待澄清原问与当前补充的证据边界不一致；模型把泛称修饰词当具体产品名；诊断追问没有持久读取合同 | 只接受原文与原文加换行两种可验证边界；窄合同只识别名称角色，不改数值/单位/运算符；本人同端同项目24h紧邻诊断读取保留类别及未命中原因 |
| 表头及页码不一致 | 识别后的语义列被直接当作原表头，R被拆成两列；物理页码误作印刷页码 | 79表按DOCX及完整确认内容指纹绑定显示投影，原语义列和数值不改；核对页5→25、6→26、33→53，页3印刷页未知则保持未知 |
| 原图详情/印刷页跳转仍使用旧页码 | location字段覆盖已校验page DTO；按标签导航只查旧raw标签并取首行 | location复用同一页码核验函数；导航读取当前版本的原标签及核验候选ID，再按完整内容指纹验证可见印刷标签，必须唯一命中，不把物理页当印刷页。补充六页真实只读fixture，旧标签/内容变化/多页歧义均拒绝，相关31项测试通过 |
| 原表续问无法比较/回图 | 只接受正式Candidate或单页，未按同次实际引用来源组重验；VIEW只输出链接 | 在有权、同端、同项目、24h、当前版本/revision/optionId范围读取完整来源组；VIEW/DETAIL/COMPARE均保留已定位R/K及各R口径。原页事实缺正式目录身份时维持只读，不伪造可确认资格 |
| 发布参考行不可选择/确认 | 查询遗漏部分正式行；正式Sheet行被强制要求不存在的图页/option；来源JSONB对象属性顺序被错误地当作事实变化 | 读取全部合条件正式行；无图页的正式行使用含全部身份、值及版本的发布来源证明，执行前重验；逐合同字段比较JSONB，并核验当前发布名称，禁止伪造图页 |
| 自然称呼错误变为编码/序号 | 宽Domain合同与后续动作解析重复解释身份；名称字段缺失 | Domain只提出操作目标，独立Parser提出当前发布名称及原话厚度，Backend在当前授权集合/Revision中唯一绑定；歧义澄清。正式编码必须在本轮逐字出现，模型不输出正式Candidate ID |
| 复测偶发拒绝 | 窄合同遗漏完整操作证据、普通比较与极值比较的区别，以及查询澄清上下文不能授权动作的约束 | 共用字段描述；完整原话证据门禁继续执行；同一超时预算内最多一次受限复核，仍经原Policy和动作/计算服务重验。普通并排比较不补MIN/MAX，无关键词或原句专用规则 |
| 选择后状态/参考备选丢失 | C端没有恢复当前查询候选的接口/事件合同；Final目标与保留参考目标混在一个集合 | 增加只读当前候选DTO、SSE及按会话/Revision恢复；按钮显式加入；Final与明确保留的参考候选分开，Confirm冻结正确Final与备选。过期、迟到和跨会话响应不覆盖当前状态 |
| 芯材追问及解释不能续算 | 没有正式计算目标合同，无法证明继承自实际记录；读取版本来源落入自由回答 | 绑定当前发布模型和唯一PRODUCT_LAYER；15→20mm仅改目标层，重验上次实际记录、模型指纹、参数版本和规则后继承；解释从实际记录读取，不重算，不让模型补参数 |
| 定性厚度解释遗漏关系 | 通用DEFINE合同仅覆盖指标口径，缺少层厚度与R及K的关系 | 补齐R=δ/(λ×α)的概念及参数相同、其他层/表面热阻不变的条件；不新增问句路由或数值，不授权计算。两种表述只读回归、真实H5定向复测后重新完整执行35问 |
| PDF来源/厚度口径错误 | 发布Sheet行被统一称图集值；芯材输入被称板厚；数值长尾与页脚排版问题 | 区分发布行/图页/计算记录；按实际输入层显示厚度；仅显示取10位有效数字，冻结值不变；调整页脚留白并重新生成逐页核验 |
| 模板版本操作返回500 | 通用工作流返回存储行的sectionsJson，报告模板DTO要求sections；写入已提交后响应序列化失败 | 复用现有业务DTO投影，通用工厂增加可选响应转换，报告模板6个工作流操作一致应用；原审核、权限及状态转换不变。修复前6例失败，修复后与相关工作流46例通过，并执行真实HTTP审核/发布 |
| 类型检查与日志 | 上游uni-app-types缺少按钮属性声明；开发请求日志带请求数据 | 同版本pnpm补丁覆盖三种声明入口，不升级依赖；开发日志不打印请求体/参数 |

DeepSeek请求使用受支持的JSON-object输出（SDK `output: no-schema`），Backend继续Zod、原话、字段、关系、来源、权限和状态校验。旧SDK曾有自动降级提示，因此不将修复描述成“以前确实向上游成功发送严格Schema”。实际请求格式与模型见各轮 `upstream-requests.json`，没有切换正式模型。

## 工程口径与资料缺项

- VICP为用户确认的正式简称。VLCP等近似拼写只给友好建议，不自动绑定正式身份。
- A2-2基层15mm/保温首档190mm、A3-3 λ=0.0012无正式勘误，按用户确认保留原值并标注疑点。11页识别标题疑点留痕；不以软件修复冒充客户资料修订。
- 原表76张主表使用“外墙主断面”，77–79使用“板材主断面”；导热系数、热阻、传热阻R、传热系数K及单位按原文显示，未因屋面语境改写源文组名。详见[表头核对](table-header-repair-2026-10-19.md)。
- 发布的整体法25mm行：R=4、R₀=4.3068、K=.2322；分层法35mm行：R=5、R₀=5.3068、K=.1884；保留基层200mm钢筋混凝土及Sheet1来源，不能当作同厚度性能比较。原参考行未绑定历史公式版本，不用当前规则补造。
- VICP-CALC-1原口径未改。芯材15mm行R=4.8，两侧包覆各.1，整构造R₀=5.3068220978349885、K=.18843669178357564；芯材20mm行R=6.4、R₀=6.9068220978349885、K=.1447843865…。不能把芯材行R称为包括包覆的产品整体R=5.0。已有knownGap继续留在回归中。
- 若未来需要整体产品热阻的新口径，应建立新公式版本与明确范围字段，独立双轨复算、甲方确认后发布；旧公式、记录、快照不回算。
- 来源库缺正式适用标准限值及比较规则/证据，目录summary也不完整。咨询应说明已核实范围、比较维度及需补资料；浙江K=.3达标问题应解释缺标准版本、适用范围、条文和生效日期，不编造结论。

## 真实复测与证据

原始问题逐字从冻结文件读取；每轮保存实际提交体、SSE、DOM、截图、Backend决策及状态。HTTP200、模型拒绝、PDF文件存在均不自动计PASS。各调试轮的失败继续保留，未完整人工复核的调试输入只记PARTIAL。

最终验收轮为 `round-21-final`，10组原始35问全部逐项PASS（PARTIAL 0、FAIL 0）；额外6问和独立按钮链路通过。round-20的原始35问也通过，但追加定性解释有缺项，因此该轮整体保留PARTIAL；补齐通用定义后完整重跑。完整逐轮判定、原问、回答和SSE/DOM证据见[各轮业务复核](evidence/full-chain-uat-2026-10-19/all-round-business-review.md)及[最终35问](evidence/full-chain-uat-2026-10-19/round-21-final/business-review.json)。

| 场景 | 轮数 | 结论 | 核对范围 |
| --- | ---: | --- | --- |
| S1 | 2 | PASS | 产品介绍/简化追问 |
| S2 | 3 | PASS | λ澄清、0.3继承、五类来源诊断 |
| S3 | 3 | PASS | 口语、K与Ⅲ型条件继承 |
| S4 | 2 | PASS | 优势/比较证据缺项的自然说明 |
| S5 | 7 | PASS | 自然选择、Final、显式确认及单方案PDF |
| R1 | 3 | PASS | 四基层45mm、最低K、两页原表/回图 |
| R2 | 3 | PASS | 正置/倒置20mm、R口径、印刷页53 |
| R3 | 3 | PASS | 八层15→20mm、参数继承及计算解释 |
| R4 | 2 | PASS | 浙江达标/正式标准缺项的正确处理 |
| R5 | 7 | PASS | 整体Final、分层备选、确认及PDF |

原始问题SHA、实际提交体及执行前后904个源码/依赖文件一致，见[来源一致性](evidence/full-chain-uat-2026-10-19/round-21-final/provenance-verification.json)。仅使用DeepSeek Chat、JSON-object输出；来源/模型记录见[运行审计](evidence/full-chain-uat-2026-10-19/round-21-final/runtime-audit.json)及同目录upstream-requests.json。

[162项真实HTTP权限/幂等核验](evidence/full-chain-uat-2026-10-19/round-21-final/security-acceptance.json)全部通过：本人成功、他人/跨端/未登录拒绝，旧Revision、虚构Candidate、Snapshot与会话错配拒绝；重复Confirm不新增快照。实际4份报告均冻结有权的确认快照和模板v2，正式计算只有15/20mm两条，显式确认计算方案未重算，见[冻结核验](evidence/full-chain-uat-2026-10-19/round-21-final/report-freeze-verification.json)、[原问状态](evidence/full-chain-uat-2026-10-19/round-21-final/business-state-verification.json)和[计算报告链路](evidence/full-chain-uat-2026-10-19/round-21-final/calculated-report-flow.json)。

[独立H5按钮闭环](evidence/full-chain-uat-2026-10-19/round-21-final/button-flow.json)验证查询不自动选择、刷新/历史恢复候选、加入两项、比较、Final、Confirm及生成。表格原列头、单R列、45mm高亮切换/取消与390px滚动通过，来源原图26/53显示正确，见[界面复核](evidence/full-chain-uat-2026-10-19/round-21-final/ui-audit.json)及同目录table-audit-complete.json。

| 实际PDF | 页数 | 预览/浏览器保存/逐页 | SHA256 |
| --- | ---: | --- | --- |
| [S5 单一最终方案](evidence/full-chain-uat-2026-10-19/round-21-final/single-pdf-verified/real-browser-download.pdf) | 2 | PASS | d8522e6ad1754f9c7822ab3608a7624d7e182dfd32ff1b80c6b93314bb804fe1 |
| [R5 最终方案及备选](evidence/full-chain-uat-2026-10-19/round-21-final/published-pdf/real-browser-download.pdf) | 3 | PASS | d652ee606ad2dc65fada2393544081bf472b37a86c143ee81121d6ce706534e4 |
| [R3 正式分层计算](evidence/full-chain-uat-2026-10-19/round-21-final/calculated-pdf/real-browser-download.pdf) | 4 | PASS | 9a52aebd95d68fe446a429be03db9a27344a3dea1a169aef81c6692a2b3f5d93 |

PDF核验将访问目标报告ID、签名接口、实际文件及浏览器保存SHA绑定。下载触发附件流的net::ERR_ABORTED仅在实际Download对象已保存且SHA一致后判成功。round-20曾因仅修改hash参数而采集到上一页报告，错误证据保留；S5重新进入页面后独立核验通过，不沿用误采文件。

OSS此前返回403 UserDisable，用户恢复后实际写入、读取及清理已重新核验。Windows默认系统代理还曾导致Edge关闭OSS连接；保留该失败证据。成功验收使用浏览器独立直连，未修改系统代理，不能据此宣称软件修复了用户的代理配置。

## 模板文案变更

用户已确认移除内部占位说明，正文采用：“本报告由蓝格 VICP 建筑节能 AI 智配系统生成，工程结论应由专业人员复核。”详见[模板变更说明](report-disclaimer-proposal-2026-10-19.md)。通过既有new-version、编辑、校验、提交、审核、发布流程在隔离库验证，并输出基于正式模板版本及内容指纹的待发布请求。生产模板和历史报告不在本轮修改。

待发布请求见[已确认模板变更](approved-report-template-change-2026-10-19.json)。生产发布时须核对basedOnId、basedOnVersion及章节SHA256，再使用实际返回的新草稿ID继续原工作流；不能把隔离库的新ID用于生产，也不能原地覆盖历史模板。

## 自动检查、文件及环境收尾

自动检查：Backend **2853 PASS / 1 expected fail / 1 skipped**，247个测试文件（246通过、1跳过）；App **155 PASS / 0 FAIL**。Backend lint/AST、build、db:check及App类型检查、H5构建均通过。原有产品整体R口径knownGap仍为预期失败，缺194页实际图集PDF的解析回归仍跳过；未修改正确预期以消除它们。实际客户DOCX79表、Excel公式及本轮原图/PDF已另行核验。Git Bash存在，部署脚本临时目录回归未跳过；没有生产部署。

日志分别为 [Backend全量](evidence/full-chain-uat-2026-10-19/backend-test-final.txt)、[lint](evidence/full-chain-uat-2026-10-19/backend-lint-final.txt)、[构建](evidence/full-chain-uat-2026-10-19/backend-build-final.txt)、[DB检查](evidence/full-chain-uat-2026-10-19/db-check-current.txt)、[App测试](evidence/full-chain-uat-2026-10-19/app-test-candidates-02.txt)、[类型检查](evidence/full-chain-uat-2026-10-19/app-typecheck-candidates-02.txt)、[H5构建](evidence/full-chain-uat-2026-10-19/app-h5-build-candidates.txt)。现有图标/浏览器数据库构建提示未阻断本轮真实交互。

H5影子目录265个App文件比对，仅两份测试文件不同，运行源码一致；证据脱敏扫描无凭据或签名查询串，见[交付检查](evidence/full-chain-uat-2026-10-19/round-21-final/delivery-check.json)。

修改清单见[完整文件清单](evidence/full-chain-uat-2026-10-19/changed-files.md)，含累计实现、自动测试、验收工具、治理文档和显示投影数据，JSON另存文件SHA256。原始证据另列，未打包凭据。

22个隔离环境（预检及21个轮次）均已独立核验DB不存在、Redis/队列与OSS前缀为空，见[清理汇总](evidence/full-chain-uat-2026-10-19/cleanup-summary.json)。本轮临时API、H5服务、浏览器已关闭，临时登录文件已移除。临时App补丁工作目录的删除曾被自动审批拒绝，保留该目录，不绕过删除限制。

## 最终结论

**READY：本轮已验证范围内未发现剩余阻断软件缺陷或新增功能回归。** 最终35问、补测、真实表格/原图、正式参考行及计算报告的逐页PDF、关键权限、自动检查和隔离清理均完成。结构化门槛与保留范围见[发布候选验收记录](evidence/full-chain-uat-2026-10-19/round-21-final/release-readiness.json)。

仍保留以下资料/范围限制，不把它们记成已完成的资料治理：客户原值疑点及11页标题待正式核定；正式适用标准、完整介绍及竞品证据缺失；产品整体R新口径需新版本方案。当前文档不是PUBLIC，公开文库正向HTTP导航未运行，按权限返回404；受控AI来源四页正向读取已实测，公开导航正向、歧义及指纹失效由单元测试覆盖。原图没有核验坐标，展示整页。计算PDF末页仅审核提示造成留白，为非阻断排版项。

生产代码与三个模板新版本尚未部署/发布。模板变更请求已按用户确认准备；正式执行须核对源版本/内容指纹、沿既有权限和审核流程发布，并验证新报告。历史模板、历史快照、已发布计算规则与生产业务数据未改写。
