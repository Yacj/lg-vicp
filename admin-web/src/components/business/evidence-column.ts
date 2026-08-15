import { h } from 'vue'
import type { PrimaryTableCol, TableRowData } from 'tdesign-vue-next'
import AppEvidenceColumnHeader from './AppEvidenceColumnHeader.vue'
import AppEvidenceSource from './AppEvidenceSource.vue'

/**
 * 「来源与证据」列定义工厂：单元格渲染来源/条款/证据等级/生效期，
 * 列头带证据等级说明。10 个专业数据模块页面共用，避免列定义散落。
 */
export function createEvidenceColumn(minWidth: number, title = '来源与证据'): PrimaryTableCol<TableRowData> {
  return {
    cell: (_, { row }) => h(AppEvidenceSource, { evidence: row }),
    colKey: 'evidence',
    minWidth,
    title: () => h(AppEvidenceColumnHeader, { title }),
  }
}