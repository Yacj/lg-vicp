import { describe, expect, it } from 'vitest'
import { recognitionConstructionContent, renderKnowledgeDocument } from './knowledge-document'

describe('知识页文档排版', () => {
  it('HTML 与 Markdown 混排为标题、段落、列表和表格，不显示标签源码', () => {
    const html = renderKnowledgeDocument('# 页面标题\n\n普通文字\n\n<table><tr><th>厚度</th><th>R</th></tr><tr><td>18</td><td>2.880</td></tr></table>\n\n- 原文备注\n\n**说明**')
    expect(html).toContain('<h1>页面标题</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>2.880</td>')
    expect(html).toContain('<li>原文备注</li>')
    expect(html).toContain('<strong>说明</strong>')
    expect(html).not.toContain('&lt;table')
  })

  it('过滤脚本、事件、嵌入页面、任意样式与伪造定位属性', () => {
    const html = renderKnowledgeDocument('<p onclick="steal()" style="position:fixed" data-option-id="fake">正文</p><script>steal()</script><iframe src="https://example.com"></iframe><svg onload="steal()"></svg><a href="javascript:steal()">链接</a>')
    expect(html).toContain('<p>正文</p>')
    for (const unsafe of ['<script', 'onclick', '<iframe', '<svg', 'javascript:', 'position:', 'data-option-id']) expect(html).not.toContain(unsafe)
  })

  it('保留原文数值、换行与 HTML 合并单元格，不提取热工行', () => {
    const html = renderKnowledgeDocument('第一行 0.30345\n第二行\n\n<table><tr><td rowspan="2" colspan="3">公共参数</td></tr></table>')
    expect(html).toContain('0.30345')
    expect(html).toContain('<br>')
    expect(html).toContain('rowspan="2"')
    expect(html).toContain('colspan="3"')
  })

  it('直接展示旧识别构造，保持多档位对应关系且不生成后端标识', () => {
    const result = recognitionConstructionContent({ constructionCode: 'A1-3', layers: [{ name: '混合砂浆', thicknessMm: 20, rValue: 0.023 }, { name: '保温板', thicknessMm: null, rValue: null, lambda: 0.005, alpha: 1.25 }], options: [{ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 }, { thicknessMm: 20, productThermalResistance: 3.2, totalThermalResistance: 3.616, kValue: 0.277 }] })
    expect(result.material).toEqual({ name: '保温板', lambda: 0.005, alpha: 1.25 })
    expect(result.layers[1]?.variable).toBe(true)
    expect(result.options[0]).toEqual({ thicknessMm: 18, productThermalResistance: 2.88, totalThermalResistance: 3.297, kValue: 0.303 })
    expect(result.constructionId).toBeUndefined()
    expect(result.options[0]?.optionId).toBeUndefined()
  })

  it('多个可变层候选不猜测产品层，缺失的总热阻不补算', () => {
    const result = recognitionConstructionContent({ layers: [{ name: '材料一', lambda: 0.005, alpha: 1.25 }, { name: '材料二', lambda: 0.004, alpha: 1.25 }], options: [{ thicknessMm: 18, productThermalResistance: 2.88, rValue: 3.297 }, { thicknessMm: 20 }] })
    expect(result.material).toBeNull()
    expect(result.options[0]?.totalThermalResistance).toBeUndefined()
  })

  it('旧纯文本引用保留按字符区间的定位，不按相同数字查找', () => {
    const html = renderKnowledgeDocument('0.303 0.303', [{ charStart: 6, charEnd: 11 }])
    expect(html).toBe('<p>0.303 <mark>0.303</mark></p>')
  })
})
