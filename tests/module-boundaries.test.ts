import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const UTILS_DIR = join(PROJECT_ROOT, 'src', 'utils')

/** 匹配指向 Vue 应用根模块的导入（`../main`、`./main`、`@/main`） */
const APP_ROOT_IMPORT = /from\s+['"](?:@\/|(?:\.\.?\/)+)main['"]/

/** 匹配指向 siyuan-db 门面的导入（`./siyuan-db`） */
const SIYUAN_DB_IMPORT = /from\s+['"]\.\/siyuan-db['"]/

/** asset-model（纯模型层）允许依赖的模块白名单 */
const ASSET_MODEL_ALLOWED_IMPORTS = new Set([
  '../types/reedit',
  '../api',
  './asset-markdown',
])

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      return listSourceFiles(fullPath)
    }
    return entry.name.endsWith('.ts') ? [fullPath] : []
  })
}

function readUtilsFile(fileName: string): string {
  return readFileSync(join(UTILS_DIR, fileName), 'utf8')
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

  it('keeps asset-model free of dependencies on catalog/block/av/db layers', () => {
    // asset-model 是纯领域模型层（类型 + 纯装配 + 基础环境查询）。
    // 它一旦反向依赖上层的 catalog/block/attribute-view/siyuan-db，
    // siyuan-db → asset-catalog → asset-model 的环形导入就会复活。
    const content = readUtilsFile('asset-model.ts')
    const imports = Array.from(content.matchAll(/(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)?\s*(?:type\s+)?from\s+['"]([^'"]+)['"]/g))
      .map((m) => m[1])
    const offenders = imports.filter((spec) => !ASSET_MODEL_ALLOWED_IMPORTS.has(spec))

    expect(offenders).toEqual([])
  })

  it('breaks the catalog/block/av import cycles via asset-model', () => {
    // 这三个模块曾与 siyuan-db 互相导入形成三角循环。
    // 重构后它们只允许依赖 asset-model，不允许再回头 import siyuan-db 门面。
    for (const fileName of ['asset-catalog.ts', 'siyuan-block.ts', 'attribute-view.ts']) {
      expect(SIYUAN_DB_IMPORT.test(readUtilsFile(fileName)), `${fileName} 不应再导入 ./siyuan-db`).toBe(false)
    }
  })
})
