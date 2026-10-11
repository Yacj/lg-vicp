# 知识页结构化展示接入

本轮同步接通 Backend 的版本问答和页面识别详情，复用既有接口，不从全文提取热工数据、不修改识别算法或已确认数据。

用户可见标签统一为“页面原图 / 页面内容 / 识别结果”。页面内容优先展示 Render Model；老页面已有 confirmedStructuredData 时，直接按其 systems/layers/options 展示同一套构造层和档位表。只保留显示投影，不补算数值，也不为旧数据生成 constructionId/optionId。两者均缺少时按原文排版展示。

HTML、Markdown 和普通文字经 `KnowledgeDocumentContent` 统一渲染；使用 DOMPurify 清理脚本、事件、外部嵌入、任意样式和伪造定位属性，保留标题、列表、表格与合并单元格。识别校验默认显示阅读视图，只有主动点击“编辑原文”才显示输入框；预览不改写或提交 fullText。旧纯文本来源的明确字符区间高亮仍可显示，不按数值字符串查找。

Backend 的确认快照只读投影提供 renderModel、constructionId、optionId。标识包含页面与快照摘要，快照变化时旧定位失效。版本问答仅加载当前检索且同版本的确认页面，不使用识别候选，也不查询全局热工集。该代码需要 Backend 同步发布才能在实际环境返回新字段。

## 可选响应字段

`KnowledgePage`、`KnowledgePageRecognition`、`KnowledgePageWindow.page`、`AiSourcePage` 均可携带：

- `renderModel`: 页面结构化展示模型；缺少或不受支持时优先显示已确认的识别表格，均缺少时提示“当前按原文排版展示”并保留全文。
- `confirmedStructuredData`: 现有已确认识别结果，供有校验权限的管理员查看。
- `referenceHighlight` / `matches`: 页面级结构化命中；也可通过查看器的 `highlights` 属性传入。

### renderModel

```ts
{
  pageLabel?: string
  pageTitle?: string
  paragraphs?: string[]
  notes?: string[]
  warnings?: string[]
  constructions: Array<{
    constructionId: string // 后端稳定标识，全页唯一
    constructionCode?: string
    title?: string
    systemName?: string
    layers: Array<{
      layerId?: string
      order?: number
      name: string
      thicknessMm?: number | string | null
      lambda?: number | string | null
      alpha?: number | string | null
      rValue?: number | string | null
      variable?: boolean // 多档位层：公共层列表不展示单一厚度/R
    }>
    material?: { name: string, lambda?: number | string | null, alpha?: number | string | null }
    options: Array<{
      optionId: string // 后端稳定标识，同一构造内唯一
      thicknessMm?: number | string | null
      productThermalResistance?: number | string | null
      totalThermalResistance?: number | string | null
      kValue?: number | string | null
      warnings?: string[]
    }>
    notes?: string[]
    warnings?: string[]
  }>
}
```

同页所有构造合成一张连续的热工表，共用页面标题和两级表头，不再每个构造单独成表。包含编号、构造层、分层厚度、λ、α、热阻，以及“外墙主断面”下的传热阻 R₀ / 传热系数 K。各构造独立分组，编号跨本构造全部行合并，构造之间保留完整分界线；材料名称及公共 λ/α 的合并范围也只在所属构造内。后端唯一明确标记 `variable: true` 的层在原位置展开为各厚度档位，数值独立成行，构造后续层仍在档位之后。页面及构造备注均保留。知识库详情、识别校验的已有识别结果和 AI 引用使用同一表格组件。

主断面的传热阻、传热系数两列隐藏正文内部横向分隔线，按原图呈现贯穿构造的连续区域。保留各档位单元格及其高度，确保数值仍与厚度同行，`optionId` / `fieldKeys` 高亮定位不变；表头、竖向边界和构造外框保留。

公共材料参数使用该层已有参数，缺少时显示所属构造的 `material` 参数；不按材料名称或数值猜测关联。当对应层未明确或多个层同时标为可变时，保留全部构造层，把档位列在本构造最后一层之后。全部档位可读，长表固定表头，窄容器内横向滚动支持键盘。当前契约没有简图图片或原图区域，表格不制造示意图、空白简图列或固定裁切位置。有完整原图时提供“查看构造简图及原页”入口，详情切换到页面原图，AI 引用切换到完整原图；图文仍按需互斥显示。将简图嵌入原表的对应单元格仍需要后端真实区域数据。

### Reference Highlight

```ts
{
  pageId?: string
  constructionId?: string
  optionId?: string
  fieldKeys?: Array<'thicknessMm' | 'productThermalResistance' | 'totalThermalResistance' | 'kValue'>
}
```

知识测试 `referencePages[].matches[]`、普通测试来源和 `AiSourceRef` 保留这些字段。标识只作为前端显示状态传递，不向旧来源查询接口追加未声明的参数。

指定 constructionId 时只匹配该构造；仅指定 optionId 时必须全页唯一；指定 pageId 时必须为当前页。不以 candidateId、行序号、厚度或数值字符串替代 optionId。重复命中同一行合并字段高亮；不存在/有歧义的标识提示无法定位。文本关键词溯源仅用于旧全文回退，不参与热工行定位。

## 数值、校验和权限

- Backend 提供的数值字符串原样展示；数值补足三位小数，更高精度原样保留，不重算 R/K。
- 缺失、非正数、无效数值及后端 warnings 显示校验提示，不修复数据。
- `system:knowledge:page:review` / `page:confirm` / `system:knowledge:debug` 可查看识别数据；JSON 仅 `system:knowledge:debug` 可见。
- 图库可在当前权限范围内进入既有识别校验；原图缩放、拖拽、全屏由共享组件处理。

## AI 回答段落中的完整原页

问答测试使用 KnowledgeAnswerContent，在对应回答段落下插入 KnowledgeAnswerReferencePage。每处显示完整 renderModel，包括同页其他构造、未命中的全部厚度档位、后续层和备注。只突出本段引用的正式行和字段；不裁成参数小表，不从回答数值造匹配。完整表格/完整原图按需切换，一次只渲染一种，原图保留构造简图。流式完成不自动抢滚动，命中导航由管理员主动触发。

Markdown 分块仅用于排版。优先按 matches[].answerOffset 绑定真实引用位置（移除服务端内部标记后的 JS 字符位置）；同编号多页也可精确关联。旧协议缺少位置时按明确 constructionCode 完整编号关联，跨页同编号不猜测。字段定位只使用 constructionId/optionId/fieldKeys，不使用 candidateId、厚度或数值 find。

表中数值来自完整原页 renderModel，缺失显示“—”并提示需核对；不补算，也不映射旧语义不明 rValue。重复同段同行引用合并字段，未命中的相同数值不突出。取消/重新显示高亮不改变页面数据。

旧 Backend 或没有有效档位引用时仅有 sources，保留文字和来源入口，不伪造匹配。reference_pages 没有 renderModel 时展示完整原图。图片单元格坐标目前缺失，原图不猜测框选，精准高亮在完整 HTML 表格中；简图独立嵌入表格仍需真实区域数据。

## 验证

knowledge-answer.test.ts 覆盖后端位置、多页重名、旧编号关联和输入不改写。KnowledgeTestPanel.test.ts 覆盖每段完整双构造/全部档位保留、仅正式ID行/字段突出、切换表格/原图互斥、取消/重显、无模型原图回退、sources不造表和不抢滚动，使用通用协议夹具。Backend 真实HTTP/SSE验收脚本见 docs/knowledge/answer-page-references.md；本机数据库连接拒绝时应记为 BLOCKED，不可把协议测试称作真实联调通过。

`KnowledgePageViewer.test.ts` 用测试协议夹具覆盖 A1-3/A1-4 共用一张完整表和表头、多/单厚度、合并范围和构造边界、无/单/多高亮、同数字及同 optionId 不同构造、构造级命中、无法定位、全文回退、告警、精度、权限与单次自动滚动，以及旧已确认页面共表、备注保留与简图原页入口。`knowledge-construction-table.test.ts` 验证展开位置、跨构造合并偏移、空构造、唯一行键、未明确对应层时不猜测、无档位/单档位及输入不改写。`knowledge-document.test.ts` 和 `RecognitionTextSection.test.ts` 覆盖 HTML/Markdown 混排、脚本过滤、合并单元格、原文不改写及只读预览。真实数据的精准行高亮仍需 Backend 返回正式模型和稳定标识后联调。
