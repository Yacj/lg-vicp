import type { CatalogProduct, CatalogProductStatus } from '@/types/catalog-product'
import type { AppStatus } from '@/components/ui/AppStatusTag.vue'

export const catalogProductStatusMeta: Record<CatalogProductStatus, { label: string, status: AppStatus }> = {
  ACTIVE: { label: '启用', status: 'success' },
  DISABLED: { label: '停用', status: 'disabled' },
}

export const CATALOG_PRODUCT_COMPARE_FIELD_LABELS: Record<string, string> = {
  name: '产品名称',
  categoryId: '产品分类',
  summary: '简介',
  status: '状态',
  sortOrder: '排序',
}

export function catalogProductCategoryLabel(product: Pick<CatalogProduct, 'categoryId'>): string {
  return product.categoryId ? '—' : '—'
}

export function catalogProductFieldLabel(field: string): string {
  return CATALOG_PRODUCT_COMPARE_FIELD_LABELS[field] ?? field
}

export function formatCatalogProductFieldValue(field: string, value: unknown): string {
  if (field === 'status' && (value === 'ACTIVE' || value === 'DISABLED')) {
    return catalogProductStatusMeta[value].label
  }
  if (value == null || value === '') {
    return '—'
  }
  return String(value)
}
