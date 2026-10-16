import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { PageRecognitionSystem } from '@/types/knowledge'
import type { KnowledgeConstructionContent } from '@/types/knowledge-page-render'
import type { HighlightRangeInput } from '@/utils/highlight'
import { buildHighlightSegments } from '@/utils/highlight'
import { escapeHtml } from '@/utils/ai'

/** 仅处理文档排版，不从全文推导构造/厚度/热工数据。 */
export function renderKnowledgeDocument(content: string, ranges: Array<Pick<HighlightRangeInput, 'charStart' | 'charEnd'>> = []): string {
  // 旧纯文本引用只按明确字符区间标记；HTML/Markdown 排版不猜测变换后的字符位置。
  const plainText = !/<\/?[a-z][^>]*>|^\s*(?:#{1,6}\s|[-*+]\s|\d+\.\s|```|>)|\*\*|__|\[.*?\]\(|\|/im.test(content)
  const html = ranges.length && plainText
    ? `<p>${buildHighlightSegments(content, ranges).map(segment => segment.highlighted ? `<mark>${escapeHtml(segment.text)}</mark>` : escapeHtml(segment.text)).join('').replace(/\n/g, '<br>')}</p>`
    : marked.parse(content, { async: false, gfm: true, breaks: true }) as string
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'div', 'span', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'a', 'mark'],
    ALLOWED_ATTR: ['colspan', 'rowspan', 'scope', 'href', 'title', 'start'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
}

/** 消费现有识别协议：多档位产品层的 thicknessMm/rValue 由后端明确置空。 */
export function recognitionConstructionContent(system: PageRecognitionSystem): KnowledgeConstructionContent {
  const layers = system.layers ?? []
  const options = system.options ?? []
  const variableCandidates = options.length > 1 ? layers.filter(layer => layer.sourceRegion !== 'DIAGRAM' && layer.thicknessMm == null && layer.rValue == null && layer.lambda != null && layer.alpha != null) : []
  const variableLayer = variableCandidates.length === 1 ? variableCandidates[0] : undefined
  return {
    rawConstructionLabel: system.rawConstructionLabel,
    applicationPart: system.applicationPart,
    roofForm: system.roofForm,
    placement: system.placement,
    waterproofGrade: system.waterproofGrade,
    sourceColumns: system.sourceColumns,
    sourceTableHeaders: system.sourceTableHeaders,
    diagramNotes: system.diagramNotes,
    specClass: system.specClass,
    baseMaterial: system.baseMaterial,
    baseThicknessMm: system.baseThicknessMm,
    constructionCode: system.constructionCode,
    systemName: system.systemName,
    layers: layers.map(layer => ({ ...layer, variable: layer === variableLayer })),
    material: variableLayer ? { name: variableLayer.name, lambda: variableLayer.lambda, alpha: variableLayer.alpha } : null,
    options: options.map(option => ({
      sourceRowLabel: option.sourceRowLabel,
      fieldEvidence: option.fieldEvidence,
      layerValues: option.layerValues,
      thicknessMm: option.thicknessMm,
      productThermalResistance: option.productThermalResistance,
      totalThermalResistance: option.totalThermalResistance,
      kValue: option.kValue,
    })),
  }
}
