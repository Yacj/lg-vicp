import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = path.resolve(__dirname, '..')
const themeEntry = path.join(sourceRoot, 'styles', 'theme.css')
const restrictedElementPattern = /<(button|input|select|textarea|dialog|form|table)(?:\s|>)/gi
const browserFeedbackPattern = /(?:^|[^.\w])(alert|confirm|prompt)\s*\(/g
const hardcodedColorPattern = /#[\da-f]{3,8}\b|rgba?\(|hsla?\(/gi

function collectFiles(directory: string, extensions: ReadonlySet<string>): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      return collectFiles(absolutePath, extensions)
    }
    return extensions.has(path.extname(entry.name)) ? [absolutePath] : []
  })
}

function relative(file: string): string {
  return path.relative(sourceRoot, file).replaceAll('\\', '/')
}

describe('tDesign UI governance', () => {
  it('rejects native interactive elements in Vue templates', () => {
    const violations = collectFiles(sourceRoot, new Set(['.vue']))
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return [...source.matchAll(restrictedElementPattern)].map(match => `${relative(file)}: <${match[1]}>`)
      })

    expect(violations).toEqual([])
  })

  it('rejects browser feedback APIs', () => {
    const violations = collectFiles(sourceRoot, new Set(['.ts', '.vue']))
      .filter(file => file !== __filename)
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return [...source.matchAll(browserFeedbackPattern)].map(match => `${relative(file)}: ${match[1]}()`)
      })

    expect(violations).toEqual([])
  })

  it('keeps hardcoded colors inside the TDesign theme entry', () => {
    const violations = collectFiles(sourceRoot, new Set(['.css', '.vue']))
      .filter(file => file !== themeEntry)
      .flatMap((file) => {
        const source = fs.readFileSync(file, 'utf8')
        return [...source.matchAll(hardcodedColorPattern)].map(match => `${relative(file)}: ${match[0]}`)
      })

    expect(violations).toEqual([])
  })
})
