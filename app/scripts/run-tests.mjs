import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function testFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? testFiles(path.join(directory, entry.name)) : entry.name.endsWith('.test.ts') ? [path.join(directory, entry.name)] : [])
}
const result = spawnSync(process.execPath, ['--import', './scripts/register-test-loader.mjs', '--test', ...testFiles('src')], { stdio: 'inherit' })
process.exitCode = result.status ?? 1
