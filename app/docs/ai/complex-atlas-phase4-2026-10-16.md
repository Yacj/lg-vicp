# 复杂建筑热工图集：阶段 4 App / H5

## 1. 本阶段结论与执行范围

**PARTIAL。** App 展示修正及隔离浏览器验收已完成；尚未达到真实登录、生产协议、OSS、App 真机或微信小程序联合验收。本阶段停止，不进入阶段 5，不部署、不重新识别、不确认/发布任何业务页面、不迁移数据库。

依据当前工作区继续阶段 3，保留已有用户修改。以阶段开始时 `C:/Users/admin/AppData/Local/Temp/vicp-complex-atlas-phase4-20261016/before/src` 为增量基线，而不是 Git HEAD。精确文件及前后 SHA-256 见 [implementation-manifest.json](evidence/complex-atlas-phase4/implementation-manifest.json)。Backend、Admin、识别事实、正式 Candidate / SolutionSnapshot / PDF 本阶段没有改动。

| 验收项 | 状态 | 证据与实际范围 |
| --- | --- | --- |
| 三页 6 构造、38 档、12 行 R/K 和构造归属 | PASS | 人工 Fixture → 本地 HTTP/SSE → 真实 App 组件 → 浏览器 DOM；见下表及 `browser-cases.json` |
| 90 页相同 R/K 两构造独立；75 页两个基层 | PASS | 两张命中对比区、完整表两组；独立构造/档位 ID，未按数值合并 |
| 材料层 / 产品整体 / 整构造热阻分离 | PASS | `layerValues.layerIndex` 对应层热阻；产品整体 R 留空，未补算；单元与组件测试 |
| 来源列头、单位、原始标签、备注 | PARTIAL | 三图忠实显示“外墙主断面 / 传热阻 R”，保留全部备注；上游人工 Fixture 的部分层序及防水等级仍待核 |
| 消息正文富文本和独立结构化 UI | PASS | 真实 `AiMessageList → AiReferenceAnswer → AiAnswerReferencePage → ReferencePageViewer → ThermalPageTable`；使用真实 mp-html 和 UniApp H5 编译 |
| 320 / 375 / 430 / 横屏尺寸矩阵 | PARTIAL | CSS 框宽均实测；浏览器缩放导致 `innerWidth` 为 320 / 374 / 431 / 800。375/430 精确浏览器断点没有冒充通过；详见尺寸证据 |
| 三张原 PNG 浏览器实际加载、解码 | PASS | 本地 HTTP 的原始字节，均 `complete=true / naturalWidth=2048 / naturalHeight=1471`；不是 OSS 验收 |
| 图片过期、错误 UI、一次自动续取、手动恢复 | PASS | 隔离详情接口 + 真实浏览器图片 403 + 真实 `useReferencePageResource / useReferencePageImage / ReferencePageImage`；截图和请求日志 |
| 重复来源事件、来源先到/正文先到、历史恢复 | PASS | 隔离 SSE 消费及真实解析/归一化/显示函数；重复不增加组数，取消高亮后重复事件仍保持取消，重新显示定位正确 |
| 真实 assistant store、登录路由、正式 HTTP/SSE、项目权限联测 | NOT_RUN | Fixture 使用自己的流编排及测试入口；正式 store 的 revision/会话守卫只作源码核查，没有假称真实完整会话通过 |
| 实际 App / 微信小程序、触控与性能 | NOT_RUN | 本机未找到可直接运行的 adb / emulator；未启动真机、小程序开发工具或 App 目标，无视频、触控或性能达标证明 |

## 2. 改动文件及最小范围理由

所有下列路径相对于 `D:/work/lg-vicp/app`。共 25 个 `src` 代码/声明/JSON 文件（包括 1 个自动生成声明文件与 3 个测试 JSON），另有 Fixture README、本报告和隔离验收材料。

| 文件 | 修改原因 / 范围 |
| --- | --- |
| `src/utils/thermalSourceLabels.ts`（新增） | 展示来源列头/单位及明确构造属性；缺失、重复或组间冲突采用保守标签。仅格式化后端字段，不解析开放用户意图 |
| `src/utils/thermalPageTable.ts` | 复用现有分层行模型，优先明确的层索引；材料层热阻不再用产品整体热阻替代 |
| `src/components/ai/ThermalPageTable.vue` | 保留公共层、可变层和所有档位；9 列区分三种 R；来源驱动列头；稳定列宽和构造标签；定位到指标格以兼容 UniApp 的 X/Y 同时滚动 |
| `src/components/ai/AiAnswerReferencePage.vue` | 展示所有命中构造的厚度、源文 R/K、明确属性、基层及定位按钮，取消前两条截断；同页完整表保持全量 |
| `src/components/ai/ReferencePageViewer.vue` | 原始标签、来源栏目说明、全部档位数量、构造备注、印刷页码；沿用原图/表格和来源事件 |
| `src/components/ai/StructuredThermalSection.vue` | 原始标签、部位/形式/位置/基层；明确材料层 R 与产品 R 的差异；可查看全部档位 |
| `src/components/ai/ThermalOptionCard.vue` | 来源驱动 R/K 标签和单位，采用“命中档位”用语；旧 DTO 保守回退 |
| `src/components/ai/AiThermalSolutionCard.vue` | 兼容旧入口的热阻标签改用同一来源展示函数；不改方案状态或报告 |
| `src/components/ai/AiReferenceAnswer.vue` | 仅来源区域文案与导入格式，保留用户已有正文/来源编排逻辑 |
| `src/utils/referencePage.ts` | 原始标签及属性用于显示；确认版本切换不继承旧 matches / URL / answerStyle；现有纯归一化方法复用 |
| `src/composables/useReferencePageHighlight.ts` | 重复对象或重排时按构造+档位保留当前位置；显式 preferred 仍可定位；不因重复事件重启已取消高亮 |
| `src/utils/referenceTable.ts` | 全屏入口携带可选 `confirmedRevision`；版本失效、构造/行失配时拒绝显示，避免落到新版本首行 |
| `src/pages/reference-table/index.vue` | 恢复已有源码中被注释的来源、高亮与上一/下一处工具栏；原始构造标签和印刷页码，不重构路由 |
| `src/composables/useReferencePageResource.ts` | 已有详情重取/图片重试流程增加确认版本不一致保护，不改权限网络层 |
| `src/pages/knowledge-source/index.vue` | 印刷页码、整页定位说明；已读来源换版即关闭旧显示；原文件打开强制重新取授权链接，成功图片也有原文件入口 |
| `src/components/ai/ReferencePageViewer.test.ts` | 增加三图全量组件断言，旧无来源表头用例改为保守标签；保留原兼容用例 |
| `src/composables/useReferencePageHighlight.test.ts` | 重复事件、取消状态和显式定位回归 |
| `src/composables/useReferencePageResource.test.ts` | 确认版本变化不能绑定新原图到旧引用 |
| `src/utils/referenceTable.test.ts` | 旧版本/旧 option / 另一构造的全屏入口拒绝定位 |
| `src/utils/complexAtlas.test.ts`（新增） | 38 档、12 行、重复数值两身份、层证据、来源回退、历史 URL 清理 |
| `src/test/fixtures/complexAtlas.ts`、`src/test/fixtures/complex-atlas/page-{89,90,75}.json`（新增） | 阶段 3 人工协议产物的隔离前端夹具，无正式数据导入；具体组装出处见该目录 README |
| `src/auto-imports.d.ts` | 正常 H5 构建自动生成上述展示函数的声明；没有手写第二套数据 store |

验收入口保存在 `docs/ai/evidence/complex-atlas-phase4/fixture-preview/`，启动时复制自有页面到随机临时目录并以 junction 引用当前 App 源码与依赖；不加入业务 pages、不读取业务 `.env`、拦截 `/api/*`、监听仅 `127.0.0.1:5187`。临时目录含 junction，未使用递归清理。

## 3. 接口、数据及兼容边界

- **没有新增后端 DTO、数据列或迁移。** 直接消费阶段 1/3 已有的 `rawConstructionLabel / applicationPart / roofForm / placement / waterproofGrade / sourceColumns / layerValues / confirmedRevision` 等可选字段。
- 列头仅由来源字段显示。三页原图均为“外墙主断面 / 传热阻 R”，屋面同样保留原稿名称，并提示“来源名称按原稿保留”；不改作屋面主断面，不推断 R₀。真实来源若明确为 R₀，才按该证据显示。
- 无来源合同的旧 DTO 显示“整构造传热阻（源文符号待核）”等标签；缺数值显示 `—`，没有补算热阻或导热系数。`layers[].rValue`、产品 R、整构造 R 及 K 分列。
- 无编号屋面使用原始完整标签，`constructionCode=null` 保留；属性只用明确工程字段，不从“Ⅰ / Ⅱ 型”推断防水等级，不增加语义路由规则。
- `confirmedRevision` 仅在已有的前端全屏导航中增加可选参数，旧路由继续支持；过期 revision 或不属于当前构造的 option 拒绝定位。确认内容改变后旧引用仍按既有 hash ID 失效，不承诺永久构造 ID。
- 历史持久化仍使用既有 `referencePersistenceSnapshot` 去除签名 URL；来源详情/原文件链接沿用受控 API。测试入口没有真实授权能力，不能证明生产权限或 OSS CORS。
- 旧 A3、正式参考库、Candidate、Selected/Final、SolutionSnapshot 和已生成 PDF 没有被改写；旧快照仅显示时采用保守标签。不改变确认、发布、权限、热工引擎和报告工作流。

## 4. 测试证据

### 4.1 十二行及全部档位

R 单位 `(m²·K)/W`；K 单位 `W/(m²·K)`。R 为源表“传热阻 R”，产品整体 R 为空。每项均对同一组 option 的真实界面文本核查，不拼接不同候选。

| 印刷页 | 构造 | 厚度 mm | R | K | 状态 / 范围 |
| --- | --- | ---: | ---: | ---: | --- |
| 89 | I 型坡屋面正置 | 20 | 5.225 | 0.191 | PASS / Fixture H5 |
| 89 | I 型坡屋面倒置 | 20 | 5.198 | 0.192 | PASS / Fixture H5 |
| 89 | I 型坡屋面正置 | 25 | 6.025 | 0.166 | PASS / Fixture H5 |
| 89 | I 型坡屋面倒置 | 25 | 5.998 | 0.167 | PASS / Fixture H5 |
| 90 | II 型平屋面正置 | 20 | 5.369 | 0.186 | PASS / Fixture H5 |
| 90 | II 型平屋面倒置 | 20 | 5.369 | 0.186 | PASS / Fixture H5 |
| 90 | II 型平屋面正置 | 25 | 6.169 | 0.162 | PASS / Fixture H5 |
| 90 | II 型平屋面倒置 | 25 | 6.169 | 0.162 | PASS / Fixture H5 |
| 75 | I 型外墙 C1-3 · 蒸压灰砂砖 240mm | 20 | 6.916 | 0.145 | PASS / Fixture H5 |
| 75 | I 型外墙 C1-4 · 加气混凝土砌块 200mm | 20 | 7.540 | 0.133 | PASS / Fixture H5 |
| 75 | I 型外墙 C1-3 · 蒸压灰砂砖 240mm | 25 | 8.516 | 0.117 | PASS / Fixture H5 |
| 75 | I 型外墙 C1-4 · 加气混凝土砌块 200mm | 25 | 9.140 | 0.109 | PASS / Fixture H5 |

原始浏览器观测：[browser-cases.json](evidence/complex-atlas-phase4/browser-cases.json)。89/90 各 12 档行，75 为 14 档行，总计 38 档，所有档位仍在同一完整模型里。浏览器读取的是 App DOM，独立数值基线还由 `complexAtlas.test.ts` 精确断言。

### 4.2 命令与结果

在 `D:/work/lg-vicp/app` 执行，日志均在本阶段 evidence 目录。只对实际执行范围给结论，不将旧阶段测试当作本轮已运行。

| 命令 / 项目 | 状态 | 结果 / 日志 |
| --- | --- | --- |
| `pnpm test` | PASS | 最终 **147/147**，`app-test-final.log`；Node SSR 富文本使用已有替身，真实 mp-html 另有浏览器验收 |
| 末次缺失层证据保护后的限定测试 | PASS | `node --import ./scripts/register-test-loader.mjs --test src/utils/complexAtlas.test.ts src/utils/thermalPageTable.test.ts`，**5/5**，`layer-evidence-final.log`；147 项全量在该末次保护前执行，之后未再次全量 |
| `pnpm build:h5` | PASS | `app-build-h5-final.log`；Browserslist 数据旧及 Uno icon `-` 警告保留；日志已去除 VITE 配置值 |
| `pnpm type-check` | FAIL | 原有 `@wot-ui/ui/.../wd-button.vue:21` 的 `ButtonOpenType` 与 `_ButtonOpenType` 不兼容，见 `app-typecheck-final.log`；未修第三方依赖 |
| `pnpm lint` | FAIL | 最终数量见末尾验收补充及 `app-lint-final.log`；主要是既有用例单行多语句、无关页面/配置和旧工具样式；未声称全量通过 |
| 本轮生产展示文件与新增工具/用例的限定 ESLint | PASS | 见末尾验收补充及限定日志；两份既有组件/高亮测试的原单行写法仍需单列 |
| 隔离 UniApp H5 启动 | PASS | `node docs/ai/evidence/complex-atlas-phase4/fixture-preview/server.mjs`；`preview-server.log` 中有 `uni:h5-main-js`，无业务服务连接 |
| 真实 Vision / 真实确认与发布 / 正式业务 HTTP/SSE | NOT_RUN | 本阶段没有调用模型、真实用户接口或数据库 |
| Backend / Admin 的 lint/test/build/db:check | NOT_RUN | 本阶段没有改这两端；旧未通过项仍见阶段 1/2/3 报告，没有冒充已消除 |
| App/小程序构建、模拟器、真机、触控、长表性能测量 | NOT_RUN | 仅实际 H5 编译和浏览器组件测试 |

最初测试发现旧表头断言以及新用例对不同材料名称写法的过严匹配，已分别修正为保守标签和原有完整名称；保留 `app-test-first.log / targeted-first.log / complex-atlas-test.log` 作为失败过程。不得将这些早期日志当作最终通过依据。

### 4.3 浏览器与图片

浏览器调用 CUA，真实启动 UniApp 编译后的 H5、Wot、mp-html 与 App 消息/表格/图片组件。Fixture 中的请求按钮是封闭测试条件，不是真实自然语言检索，流编排和来源导航入口也是隔离壳。生产 assistant store 的 `handleStreamEvent` 已有 `streamRevision + conversationId` 守卫，本阶段只核查源码。隔离壳初测发现并发流未隔离，已增加自己的序列守卫后重测历史，最终证据为下面 `browser-history.json`。

- 六组比较截图：`h5-{89,90,75}-{20,25}-comparison.jpg`。每组两构造；第 90 页同值也分别显示。
- 完整表独立定位：[h5-90-table-final.jpg](evidence/complex-atlas-phase4/h5-90-table-final.jpg)。当前倒置组、源文 R/K、全量档位与命中强调可见。`browser-interactions.json` 记录重复事件后取消状态仍保留，再恢复后为倒置组；`hitValues` 同时保留两组。
- 表头与表体宽度均约 `961.47 CSS px`（缩放存在亚像素），在窄屏组件内部横向滚动，页面根节点没有横向溢出。切换命中组后的表头/表体 scrollLeft 同为约 `610.45`，X/Y 锚点问题已复测。
- 尺寸：[browser-widths.json](evidence/complex-atlas-phase4/browser-widths.json) 和 `h5-width-{320,375,430,800}.jpg`。请求 CSS 宽 320/375/430/800，实测 `innerWidth` 320/374/431/800。额外校准也未精确得到 375/430，记录在 `browser-widths-calibrated.json`；因此这两个**精确断点仍为 PARTIAL**，不把 CSS 设置值当成实测视口。横屏为桌面浏览器宽框，未模拟手机旋转传感器。
- 原图：[browser-images.json](evidence/complex-atlas-phase4/browser-images.json)、`h5-{89,90,75}-original.jpg`；请求日志 `requests.log` 记录浏览器 GET 和字节数。三图自然尺寸均 2048×1471；源原件未改动。图片哈希及字节数见末尾补充。
- 失败与恢复：`h5-image-expired.jpg / h5-image-recovered.jpg`。本地图片接口返回 403，详情接口自动续取一次，失败提供“重新加载图片 / 打开原文件”；手动恢复再次取详情后真实浏览器解码成功。这验证本地 HTTP 及组件流程，**真实 OSS、跨域和生产签名到期 NOT_RUN**。
- 刷新历史：[browser-history.json](evidence/complex-atlas-phase4/browser-history.json)、`h5-history-restored.jpg`；恢复后只显示第 89 页两个构造及 12 档，再打开原图重新 GET 详情和 89 PNG。存储去 URL 由纯函数测试证明；未声称正式服务器历史鉴权已实测。
- 全屏按钮使用真实表格组件，但壳内导航替代正式登录路由。因此新改 `pages/reference-table`、`pages/knowledge-source` 的完整鉴权路由与原文件下载点击只有编译/契约核查，**正式路由 UI NOT_RUN**。
- `page-{89,90,75}-{20,25}.sse.txt` 是本地 Fixture 接口的 CLI 重放存档，与浏览器同一来源模型，不能称作浏览器抓包或正式业务 SSE。留存浏览器文本的独立核验命令为 `node docs/ai/evidence/complex-atlas-phase4/verify-browser-evidence.mjs`，12 行及 3 张图哈希均通过，详见 `browser-validation.json / .log`。

原图字节及 SHA-256（与用户附件一致，见 `source-image-hashes.json`）：

| 印刷页 | 字节数 | SHA-256 |
| --- | ---: | --- |
| 89 | 647161 | `6d48ac8f8a746eb6c012f8c9ad6c2bf24a4161ab65b00ee9222f351e41a4ba9c` |
| 90 | 690463 | `3cda1d4a7da48652b779c637bf19418c0fd4b894dccaaf0fdb951b7a8d916aa3` |
| 75 | 589957 | `a712567ae0622aa41f14961f2cf6cd5ebe28e8ecf701391c0d6814dc3e6ebcea` |

## 5. 未通过清单与下一阶段前置条件

1. **上游人工事实仍不完整**：屋面防水等级不能从 VICP 型号猜；Fixture 原始标签保留“级防水”而明确字段为空，界面提示待核。第 90 页正置 LC7.5 及后续砂浆 sourceLayerLabel 仍有已披露错位。源表应经过真实 B 端人工核对，不由 App 改正。本阶段 12 行通过不代表全部工程事实通过。
2. **真实发布与权限链 NOT_RUN**：需可安全使用的独立 DB / Redis / OSS 前缀、测试用户和已人工审核发布的测试版本，再做阶段 5 正式 HTTP/SSE 与可见 UI 联测。不得直接用当前业务库制造样本或发布未经核对的识别结果。
3. **375 / 430 精确视口与触控 / 真机 NOT_RUN 或 PARTIAL**：当前浏览器缩放影响像素量化，已保留真实观测；需标准缩放的 H5 环境和可用移动运行目标补测。没有用 CSS 截图代替真机。
4. **类型检查与全量 lint 未通过**：保留具体日志；无关旧错误不在本阶段擅自修复。旧 Backend 失败用例、Admin 类型问题同样没有消失。
5. **旧能力联合回归未重跑**：A3 四基层、权限隔离、显式 Confirm / 冻结快照 / PDF 真正业务链留待阶段 5。当前只验证 App 旧 DTO 兼容及其现有测试，未改业务数据和历史报告。

### 最终验收补充

- `pnpm lint` 最终 **38 errors / 0 warnings，FAIL**，均定位在既有测试单行写法、旧 Fixture、无关页面/工具及 Vite 配置；本轮新增浏览器 JSON 的缺尾换行已修复，未将这部分初测错误算成最终旧错误。两份本轮有增补的旧测试文件仍保留 14 个原有单行写法错误。
- 限定命令覆盖本轮生产展示文件、新工具、新数据用例、原文件/全屏路由工具和隔离壳，**0 错误，PASS**，见 `scoped-production-lint.log`；明确未把两份旧组件/高亮测试的全文件 lint 称为通过。末次层证据保护及证据核验脚本另外限定检查通过，见 `final-evidence-lint.log`。
- 最终 H5 构建在末次层证据保护后完成，**exit 0 / PASS**；类型检查仍为上述第三方错误。最后更改旧测试的换行只属格式；全量 147 项和末次限定 5 项的执行时点已在命令表单列。吧
- 最后停止仅本阶段启动的 5187 隔离服务，恢复临时浏览器视口并关闭自己创建的标签；没有停止业务进程，没有清理用户资料。保留源码、随机临时环境和所有证据；不递归删除 junction。
- `implementation-manifest.json` 记录阶段开始到结束实际变化的 **25 个 src 代码/声明/JSON 文件**，不把用户此前脏文件全部算作本轮修改。截图确认为 JPEG；原始三张 PNG 哈希未改变。

## 6. 停止位置

阶段 4 实施及上述有限验收完成，结论 PARTIAL。没有部署，也不要求现在批量重新识别。下一步须由用户明确批准阶段 5；本报告不构成部署、迁移、真实资料确认或发布的授权。
