import type { AiReferencePage } from '@/api/reference-page'
import { readFileSync } from 'node:fs'

/** 阶段 3 隔离 HTTP 产物的原样副本；人工基线，不是真实确认/模型识别。 */
export function complexAtlasFixture(page: 89 | 90 | 75): AiReferencePage {
  return JSON.parse(readFileSync(new URL(`./complex-atlas/page-${page}.json`, import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
}
