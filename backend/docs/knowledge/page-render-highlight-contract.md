# 确认页面全文渲染与 AI 语义高亮

## Audit

| 项目 | 当前能力 / 本次处理 |
| --- | --- |
| `knowledge_pages.metadata.confirmedStructuredData` | 已有人工作出的确认快照；直接复用，仍为页面事实源 |
| `systems[].layers[] / options[]` | 已能表达公共 λ/α 与多个厚度档；保持识别、编辑、确认主链不变 |
| `fullText / parsedText` | 已用于全文索引、问答、调试；旧读取字段保留 |
| `thermal_reference_rows` | 已有 schemeId、productSpecId、thicknessMm、双 R/K、sourcePageId；保持正式查询事实源不变 |
| `referencePages / matches` | 已有同页聚合、候选参数条与签名页图；复用 |
| 稳定渲染定位 | 原先缺失；新增派生 renderModel、optionId、commonLayerId |
| 语义高亮 | 原先只有 field/label/value 展示条；新增 semanticHighlights，旧条目不改名 |

## Render Model

`src/modules/knowledge/knowledge-page-renderer.ts` 为无数据库写入的确定性渲染器。

- 只读取 `confirmedStructuredData`，经现有 Zod 校验，无有效确认快照时 `renderModel=null`。不从 draft、structuredData 或 parsedText 补出确认表格。
- 重新识别尚未确认时继续呈现上次确认快照；再次确认后下一次读取立即更新，不存 HTML、不设第二套事实源。
- `pageId / pageLabel / pageTitle / sections[]` 为页面模型。页签与标题取页面权威字段；pageLabel 缺失为 null，不使用物理页序代替。
- `THERMAL_SYSTEM` 含构造编号、正式 schemeId、规格类别、基层信息、commonLayers、optionTable。
- 普通固定层保留自身 thicknessMm/lambda/alpha/rValue；可变产品层保留公共 lambda/alpha，逐档 thicknessMm/productThermalResistance/totalThermalResistance/kValue 在 optionTable.rows 中。
- `TEXT` 保留确认 fullText，`NOTE` 保留确认原文备注；warnings 是审核诊断，不作为原文备注渲染。全文可能含与结构表重复的原文，前端可放在“完整识别文字”区域。
- 表列使用统一 `fieldKey / label / unit`。缺失数值转为 null，不计算、不用旧 rValue 猜测双 R。

`optionId` 为 pageId + 构造身份 + 厚度/正式产品规格/目录身份的 SHA-256 标识，无数组 index。正常唯一身份下，重排、全文/标题修改、R/K 人工修正不改变 ID；不同页、构造、规格的相同数字不共用 ID。没有构造身份时用现有构造描述派生身份。重复身份用内容摘要区分显示；完全相同项合并显示，绑定高亮仍按原始确认项数量拒绝歧义。缺身份或重复身份的内容修订可能改变 ID，不应跨确认修订持久化为业务主键。

## API 增量

无新路由、权限码或数据库字段：

| 接口 | 新增位置 |
| --- | --- |
| `GET /api/v1/platform/knowledge/pages/:pageId/recognition` | `data.renderModel` |
| `GET /api/v1/platform/knowledge/public/documents/:documentId/pages/:physicalPageNumber` | `data.page.renderModel` |
| `GET /api/v1/client/knowledge/documents/:documentId/pages/:pageNumber` | `data.page.renderModel` |
| `GET /api/v1/client/knowledge/documents/:documentId/pages/by-label/:pageLabel` | `data.page.renderModel` |
| 现有 B/C 页面 window | `data.page.renderModel`；邻页轻量列表不加全文 |
| `GET /api/v1/ai/knowledge/source-detail` | `data.page.renderModel` |

现有 JWT、B_ADMIN、知识查看权限、C/PC 客户端隔离、PUBLIC/PUBLISHED/生效中与项目可见性守卫全部复用。机器提取文本、确认 JSON、页图字段仍保留。

## Highlight Contract 与 Candidate 映射

`reference_pages` SSE 中每个 ReferencePageBlock 及持久化 referencePages 增加 `semanticHighlights[]`。每个 matches 条目增加 `optionId?` 和 `semanticHighlights[]`；AI 查询候选经确认页绑定后增加 `optionId?`，会话恢复保留。正式候选查询 HTTP DTO 不增加未经页面核验的 optionId。

```ts
type ReferenceHighlight = {
  sectionId: string;
  constructionCode?: string | null;
  optionId: string;
  commonLayerId?: string;
  fieldKeys: Array<'thicknessMm' | 'productThermalResistance' |
    'totalThermalResistance' | 'kValue' | 'lambda' | 'alpha'>;
  facts: Partial<Record<ReferenceHighlight['fieldKeys'][number], number>>;
};
```

映射先限定当前有效发布页及所属文档，再按候选 schemeId（确认数据有人工绑定时优先；否则使用 schemeCode 对 constructionCode）、规格类别、厚度、确认的 productSpecId/catalogProductId 唯一绑定同页档位，并逐字段核验双 R/K。精度门禁沿用确认快照已有的 0.00005 存储精度；不是查询近似容差，不接受用目标值定位。缺数据、数值冲突、多候选项歧义时 semanticHighlights 为空，optionId 不返回，原有候选参数展示条继续可用。

λ/α 只从该构造唯一的 VICP/保温板产品层读取，以 commonLayerId 指向公共层；不复制成可编辑的各档属性。高亮 facts 采用确认原值，不反算。近似命中也高亮实际参考值，不代表精确命中或合规。现有 thermal 工具的 LOOKUP_CANDIDATES / REFERENCE_LOOKUP 共用 emitReferencePages；CALCULATE 不新增参考页事件，也不借邻页数据生成档位定位。

旧 `highlights[]` 的 `field=productR/rValue` 为兼容展示条，不能用于结构表单元格定位；新增契约只使用正式语义名。报告快照规范化、同页合并、深拷贝保留新契约。签名 URL 只临时输出，存储仍只保留 objectKey。

## B/C 接入

1. 页面读取优先消费 renderModel，用组件渲染 TEXT、NOTE、公共层和选项表。确认数据为空时展示“尚无确认的结构化页面”，保留旧提取文字与页图入口。
2. 为构造区域设 sectionId，为档位行设 optionId，为单元格设 fieldKey；公共层区域设 layerId。按 semanticHighlights 的 optionId + fieldKey 定位；lambda/alpha 按 commonLayerId + fieldKey 定位。
3. 不搜索数字文本，不用 legacy highlights 的值作为定位。历史或缺确认页的 semanticHighlights 为空时仅展示原有参数条。
4. 只将 pageLabel 用于用户页码。physicalPageNumber/pageNumber 用于程序打开原页。
5. 所有名称、全文、备注都按普通文本插值渲染；不得使用 v-html/innerHTML。Backend 本轮没有输出 HTML，也没有修改 B/C 样式。

## 验证与迁移

新增 renderer 回归覆盖单/多厚度、同页 A1-3/A1-4、公共 λ/α、同数字不同构造、同行 18/2.880/3.297/0.303、缺失/null、重排 ID、再次确认重渲染、歧义/冲突拒绝定位、正式 scheme/spec 绑定、签名 URL 不入快照。读取服务测试验证 B/C/AI 同一模型，Tool 测试验证正式页确认快照到 SSE/会话候选的完整映射。

A1-3 数值采用需求给出的回归组；A1-4 的测试值复用该组，专门验证同数字也不误绑定。这是固定回归夹具，不宣称读取过真实 A1-4 线上页图或完成真实业务 UAT。

本轮完成检查：`pnpm lint`、`pnpm build`、`pnpm db:check`、`git diff --check` 均通过；`pnpm test` 为 158 个测试文件通过、1 个跳过，1654 项测试通过、1 项跳过。本机真实确认页只读探测返回 BLOCKED（本机数据库无法读取确认页面）；未把测试夹具当作真实页面验收。

## 修改文件

- 渲染与读取：`src/modules/knowledge/knowledge-page-renderer.ts`、`knowledge-page-recognition.service.ts`、`knowledge-wiki-read.service.ts`；现有路由描述同步在 `knowledge.routes.ts`、`knowledge-client.routes.ts`。
- 候选/高亮/快照：`src/modules/ai/reference-page.ts`、`thermal-answer-facts.ts`、`conversation-task.ts`、`report-context-snapshot.ts`、`tools/thermal-calculate.tool.ts`。
- 回归：`src/modules/knowledge/knowledge-page-renderer.test.ts`、`knowledge-wiki-read.service.test.ts`、`src/modules/ai/tools/thermal-reference-page-guard.test.ts`。
- 契约及长期规则：本文件、`AGENTS.md`、`README.md`、`.cursor/rules/30-ai-and-reports.mdc`、`.agents/skills/lg-backend/references/ai-and-reports.md`。

没有 SQL/Drizzle schema 修改，无 Migration。渲染模型与语义高亮为增量字段，旧字段和热工公式不变。
