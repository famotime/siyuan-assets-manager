import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const UTILS_DIR = join(PROJECT_ROOT, 'src', 'utils')

/** 匹配指向 Vue 应用根模块的导入（`../main`、`./main`、`@/main`） */
const APP_ROOT_IMPORT = /from\s+['"](?:@\/|(?:\.\.?\/)+)main['"]/

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath)
    }
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

describe('module boundaries', () => {
  it('keeps src/utils free of imports from the Vue app root', () => {
    // src/main.ts 会挂载 App.vue，进而牵入整套组件与 tui-image-editor。
    // 工具模块一旦导入它，纯逻辑单测就被迫依赖整个 UI 运行时。
    const offenders = listSourceFiles(UTILS_DIR)
      .filter((file) => APP_ROOT_IMPORT.test(readFileSync(file, 'utf8')))
      .map((file) => file.replace(`${PROJECT_ROOT}/`, ''))

    expect(offenders).toEqual([])
  })
})
