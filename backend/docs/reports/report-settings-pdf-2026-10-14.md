# 报告设置驱动正式 PDF（2026-10-14）

范围：Backend，沿用现有报告设置与发布模板。无数据库字段/迁移/依赖变化，无业务数据、生产配置或前端代码写入。原 Snapshot 授权、权限、审核发布门槛保持。

## 本轮实现

| 设置 | 正式PDF行为 |
| --- | --- |
| 企业Logo | 从企业信息取当前Logo，报告创建时冻结企业展示名称、fileId/objectKey/mime；Worker只读冻结对象，不读最新企业信息，不存签名URL |
| 封面标题 | 设置非空标题优先；空标题回退报告标题/类型默认标题 |
| 页眉/页脚 | 冻结设置传入Chromium，每页展示并保留页码 |
| 显示计算过程 | 控制CALCULATED候选冻结步骤/分层；只做单位展示，不重算；缺厚度显示未提供；项目简报不展示详细过程 |
| 显示引用来源 | 控制完整原表/原图附录；关闭后Worker不读取原图。基本引用及追溯仍保留 |
| 显示免责声明/文案 | 开关控制可选免责声明；设置文案覆盖模板默认文案。必要风险与未核验说明不可关闭 |
| 默认导出格式 | 新正式报告仍仅PDF必要；保存为DOCX不会改变输出策略，旧报告格式兼容 |

Logo仅嵌入封闭PNG/JPEG字节。冻结Logo不可取或格式不支持时记录REPORT_LOGO_UNAVAILABLE并继续PDF；不替换最新Logo。重试/相同快照重复请求继续使用原报告展示快照，因此后台更改设置不会改写已有报告。

工程事实仍只来自SolutionSnapshot→DocumentModel。允许新增读取企业展示配置，不读取最新产品、热工、知识工程数值。DocumentModel不承担企业配置查询。既有计算器judgment步骤不作为报告合规结论展示。

## 实际修改文件

- `report-settings.service.ts`：loadReportBranding只读企业与READY未删除Logo文件元信息。
- `report-snapshot.service.ts`：创建时冻结branding及设置副本。
- `report-template-render.ts`：设置/branding类型与embedReportBranding图片嵌入。
- `solution-document-render.ts`：封面Logo、设置开关、冻结计算过程与文案优先级。
- `report.worker.ts`：冻结Logo加载/失败警告与隐藏附录时跳过原图。
- `solution-report-snapshot.test.ts`、`solution-report-generation.test.ts`、`solution-document-render.test.ts`、`report.worker.test.ts`：事实不回查、配置冻结、开关边界、旧合规结论不复活、Logo成功/失败与Worker参数。
- `scripts/check-solution-pdf-fixture.ts`：增加--settings-demo/--compact；示例Logo明确标记Fixture，不是企业真实Logo。
- 同步本说明、报告README、根README、AGENTS.md、Cursor规则和skill reference。

## 验证

| 本轮命令/检查 | 实际结果 |
| --- | --- |
| `pnpm exec vitest run src/modules/reports src/workers/report.worker.test.ts --maxWorkers=4` | 退出0，11文件、91通过、0失败、0跳过；后续新增用例进入全量 |
| `pnpm test --maxWorkers=4` | 退出0，197文件通过/1文件原有跳过；2235通过、0失败、1原有跳过，共2236；269.11秒 |
| `pnpm lint` | 最终退出0，AST检查10关键文件/30现有白名单，TypeScript通过；首次退出1因disclaimerText类型缺失，修复后重跑通过 |
| `pnpm build` | 退出0，仅本地构建，未部署 |
| `pnpm db:check` | 退出0，仅静态检查，未执行迁移 |
| Fixture完整版 `--settings-demo` | Chromium脚本退出0，7页A4、238004字节、4候选事实断言；带示例Logo/封面/页眉页脚/自定义免责声明/完整附录 |
| Fixture简版 `--settings-demo --compact` | Chromium脚本退出0，3页A4、205315字节、相同4候选事实；无完整附录/附加免责声明，基本引用及风险保留 |
| Poppler渲染与视觉检查 | 两次命令均退出0；完整版7页、简版3页逐页检查，Logo/中文/页眉页脚/重复表头无截断 |
| `git diff --check -- .` | 退出0；有既有LF/CRLF提示 |
| 真实HTTP/SSE、BullMQ消费、OSS、真实CONFIRMED业务UAT | 未执行，无授权隔离环境和真实确认快照 |

Fixture的unpdf文本抽取出现Math.sumPrecise/字体替换警告，但实际事实断言通过，Poppler独立渲染逐页中文正常。失败尝试与最终通过分开记录。

复现脚本：`pnpm exec tsx scripts/check-solution-pdf-fixture.ts --settings-demo [--compact] --chromium '<本机Chromium>' --output '<本地产物目录>'`。脚本不连接DB/Redis/OSS。Fixture的Logo为程序绘制的明确标记示例，未读取企业真实Logo。

## B端对接与未完成事项

本轮未修改admin-web。现有GET/PUT /api/v1/platform/reports/settings合同不变，companyLogoFileId仍为企业信息派生字段，不允许在报告设置另传工程事实或签名Logo地址。

- 默认报告类型：Backend已返回defaultReportType；生成弹窗目前仍取类型列表第一项，需前端消费该设置，本轮未修。
- 设置页预览：目前是前端版式示意，不是实际PDF，不能声称已同步。准确效果应使用报告详情受控PDF预览接口；草稿设置即时PDF预览端点本轮未新增。
- 正式报告生成入口：须绑定有权访问的本人同端会话/CONFIRMED Snapshot；仅选项目/类型仍不足以生成。不可为B端预览放松归属。
- 新正式类型应显示PDF可用格式，旧类型继续按availableFormats提供Word等。

当前库只读且无真实确认快照，无授权隔离环境。真实企业Logo OSS读取、真实HTTP/SSE/队列Worker/审核下载完整业务测试均未执行；Fixture和Mock不替代UAT。
