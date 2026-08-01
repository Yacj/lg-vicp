import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(__dirname, '..')

describe('echarts on-demand registration', () => {
  it('never imports the full echarts bundle', () => {
    const violations = fs.readdirSync(sourceRoot, { recursive: true })
      .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'))
      .map(entry => path.join(sourceRoot, entry))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        // type-only import/export 不引入运行时代码，不算全量引入
        const runtimeImports = source.split('\n').filter(line => !/^\s*(import|export)\s+type\b/.test(line))
        return runtimeImports.some(line => line.includes("from 'echarts'") || line.includes('from "echarts"'))
          ? [path.relative(sourceRoot, file)]
          : []
      })

    expect(violations).toEqual([])
  })

  it('registers only the first-phase modules', () => {
    const source = fs.readFileSync(path.join(sourceRoot, 'echarts.ts'), 'utf8')

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