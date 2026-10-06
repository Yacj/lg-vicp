import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(__dirname, '..')

function isRuntimeSource(entry: string): boolean {
  return (entry.endsWith('.ts') || entry.endsWith('.vue')) && !entry.endsWith('.test.ts')
}

function runtimeImportLines(source: string): string[] {
  // type-only import/export 不引入运行时代码，不算全量引入
  return source.split('\n').filter(line => !/^\s*(import|export)\s+type\b/.test(line))
}

describe('echarts on-demand registration', () => {
  it('never imports the full echarts bundle', () => {
    const violations = fs.readdirSync(sourceRoot, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && isRuntimeSource(entry))
      .map(entry => path.join(sourceRoot, entry))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return runtimeImportLines(source).some(line => /from\s+['"]echarts['"]/.test(line))
          ? [path.relative(sourceRoot, file)]
          : []
      })

    expect(violations).toEqual([])
  })

  it('loads renderer registration at runtime in AppChart', () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'components', 'chart', 'AppChart.vue'), 'utf8')
    const runtimeImports = runtimeImportLines(source)

    expect(runtimeImports.some(line => /import\s+['"]@\/charts\/echarts['"]/.test(line))).toBe(true)
  })

  it('registers only the first-phase modules', () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'charts', 'echarts.ts'), 'utf8')

    expect(source).toContain("from 'echarts/core'")
    expect(source).toContain("from 'echarts/charts'")
    expect(source).toContain("from 'echarts/components'")
    expect(source).toContain("from 'echarts/renderers'")
    expect(source).toContain('CanvasRenderer')
    expect(source).toContain('LineChart')
    expect(source).toContain('BarChart')
    expect(source).toContain('PieChart')
    expect(source).toContain('GridComponent')
    expect(source).toContain('TooltipComponent')
    expect(source).toContain('LegendComponent')
    expect(source).toContain('DatasetComponent')
  })
})
