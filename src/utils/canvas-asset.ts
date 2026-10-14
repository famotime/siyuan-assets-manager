import { openTab } from 'siyuan'
import type {
  AssetInfo,
  BlockRef,
} from './siyuan-db'
import {
  readDir,
  removeFile,
  sql,
} from '../api'
import { extractAssetNamesFromMarkdown } from './asset-markdown'
import { isTrashSupported } from './file-system'
import {
  log,
  warn,
} from './logger'
import {


  isIgnoredSystemAsset,
} from './siyuan-db'
import {
  blobToText,
  defaultStorage,
} from './storage'

/** 无界插件默认画布存储根目录 */
export const DEFAULT_CANVAS_DIR = '/data/storage/petal/siyuan-canvas'

/** 无界插件配置文件路径 */
export const CANVAS_SETTINGS_PATH = '/data/storage/petal/siyuan-canvas/canvas-plugin-data.json'

/**
 * 规范化画布文件或目录路径（移除冗余斜杠、统一前导斜杠）
 */
export function normalizeCanvasWorkspacePath(path: string): string {
  if (!path) return ''
  let clean = path.replace(/\\/g, '/').trim()
  clean = clean.replace(/\/+/g, '/')
  if (!clean.startsWith('/')) {
    clean = `/${clean}`
  }
  return clean
}

/**
 * 根据画布文件路径推导对应的专属资源目录路径
 * 例如: /data/storage/petal/siyuan-canvas/demo.canvas -> /data/storage/petal/siyuan-canvas/demo.assets
 */
export function getCanvasAssetDirectory(canvasPath: string): string {
  const norm = normalizeCanvasWorkspacePath(canvasPath)
  return norm.replace(/\.canvas$/i, '.assets')
}

/**
 * 根据专属资源目录路径反推对应的画布文件路径
 * 例如: /data/storage/petal/siyuan-canvas/demo.assets -> /data/storage/petal/siyuan-canvas/demo.canvas
 */
export function getCanvasPathFromAssetDir(assetDirPath: string): string {
  const norm = normalizeCanvasWorkspacePath(assetDirPath)
  return norm.replace(/\.assets$/i, '.canvas')
}

/**
 * 从文件路径中提取文件名（basename）
 */
export function getBaseFileName(path: string): string {
  if (!path) return ''
  const clean = path.replace(/\\/g, '/')
  return clean.split('/').pop() || clean
}

/**
 * 纠正画布资源的时间戳：
 * 1. 优先提取无界插件默认的 13 位毫秒时间戳文件名（如 1781831598964.png）；
 * 2. 检查 stUpdated 是否因内核 putFile 将秒误当毫秒导致变成了 1970 年，若落在 1970 年代但 * 1000 落在现代年份，自动恢复为 * 1000 后的现代时间戳；
 * 3. 规范化为毫秒时间戳。
 */
export function resolveCanvasAssetTimestamp(fileName: string, stUpdated: number): number {
  const baseName = getBaseFileName(fileName)
  const nameMatch = baseName.match(/^(\d{13})(?:\.|$)/)
  if (nameMatch) {
    const nameTs = parseInt(nameMatch[1], 10)
    // 2000-01-01 (946684800000) ~ 2100-01-01 (4102444800000)
    if (nameTs > 946684800000 && nameTs < 4102444800000) {
      return nameTs
    }
  }

  if (stUpdated > 0) {
    let ms = stUpdated < 1e11 ? stUpdated * 1000 : stUpdated
    // 若 ms < 946684800000（2000年以前，即 1970 年代），但再乘以 1000 后落在 2000~2100 年
    // 说明原秒级时间戳被思源内核 millisecond2Time 再次除以了 1000 写入了磁盘 mtime
    if (ms < 946684800000 && (ms * 1000) > 946684800000 && (ms * 1000) < 4102444800000) {
      return ms * 1000
    }
    return ms
  }

  return Date.now()
}

export interface ICanvasParseReferencesResult {
  /** 对全局 /data/assets 资源的引用（键为全局资源名，如 20240501-xxx.png） */
  globalAssetRefs: Map<string, BlockRef[]>
  /** 对画布专属资产的引用（集合中存储规范化文件名或局部路径） */
  canvasAssetRefs: Set<string>
}

/**
 * 从单张画布数据中纯函数提取所有引用的资源（全局 /data/assets/ 与 画布专属 *.assets/）
 */
export function extractReferencesFromCanvasData(
  canvasJson: any,
  canvasPath: string,
): ICanvasParseReferencesResult {
  const globalAssetRefs = new Map<string, BlockRef[]>()
  const canvasAssetRefs = new Set<string>()

  if (!canvasJson || !Array.isArray(canvasJson.nodes)) {
    return {
      globalAssetRefs,
      canvasAssetRefs,
    }
  }

  const canvasName = getBaseFileName(canvasPath)
  const normCanvasPath = normalizeCanvasWorkspacePath(canvasPath)

  function addGlobalRef(rawAssetStr: string, nodeId: string, nodeType: string) {
    if (!rawAssetStr || /\.assets[/\\]/i.test(rawAssetStr)) return
    const cleanStr = rawAssetStr.trim()
    // 匹配 assets/xxx 或 /data/assets/xxx
    const match = cleanStr.match(/(?:^|\/|\b)(?:data\/)?assets\/([^?#)"'\s]+)/i)
    if (match && match[1]) {
      const assetName = match[1].replace(/^\/+/, '')
      if (assetName && !isIgnoredSystemAsset(assetName)) {
        let refs = globalAssetRefs.get(assetName)
        if (!refs) {
          refs = []
          globalAssetRefs.set(assetName, refs)
        }
        refs.push({
          id: `canvas:${normCanvasPath}:${nodeId}`,
          root_id: normCanvasPath,
          box: '',
          content: `无界画布节点引用 [${canvasName}] (${nodeType})`,
          markdown: `![${assetName}](assets/${assetName})`,
          path: normCanvasPath,
          hpath: canvasName,
          readablePath: `画布: ${canvasName}`,
        })
      }
    }
  }

  function addCanvasAssetRef(rawAssetStr: string) {
    if (!rawAssetStr) return
    const cleanStr = rawAssetStr.trim()
    // 规范化路径并记录
    const norm = normalizeCanvasWorkspacePath(cleanStr)
    canvasAssetRefs.add(norm)
    const baseName = getBaseFileName(cleanStr)
    if (baseName) {
      canvasAssetRefs.add(baseName)
    }
    // 匹配 xxx.assets/yyy.png 相对片段
    const segmentMatch = cleanStr.match(/([^/\\]+\.assets[/\\][^?#)"'\s]+)/i)
    if (segmentMatch && segmentMatch[1]) {
      canvasAssetRefs.add(segmentMatch[1].replace(/\\/g, '/'))
    }
    // 补充不带 data/ 前缀的路径
    const withoutData = norm.replace(/^\/?data\//, '')
    if (withoutData && withoutData !== norm) {
      canvasAssetRefs.add(withoutData)
    }
  }

  function traverseNode(node: any) {
    if (!node || typeof node !== 'object') return
    const nodeId = String(node.id || 'unknown')
    const nodeType = String(node.type || 'unknown')

    // 1. File 卡片
    if (node.type === 'file' && typeof node.file === 'string') {
      const fileStr = node.file
      if (/\.assets[/\\]/i.test(fileStr)) {
        addCanvasAssetRef(fileStr)
      } else if (/(?:^|\/|\b)(?:data\/)?assets\//i.test(fileStr)) {
        addGlobalRef(fileStr, nodeId, nodeType)
      } else {
        // 其他常规文件引用，若指向图片/附件也可能是相对资源
        addCanvasAssetRef(fileStr)
      }
    }

    // 2. Text 卡片 (Markdown 内容)
    if (node.type === 'text' && typeof node.text === 'string') {
      const textContent = node.text
      // 2.1 提取全局 Markdown 资产
      const mdAssets = extractAssetNamesFromMarkdown(textContent)
      for (const name of mdAssets) {
        addGlobalRef(`assets/${name}`, nodeId, nodeType)
      }

      // 2.2 提取包含 .assets/ 的图片链接或 HTML img 标签
      const assetMatches = textContent.matchAll(/!\[[^\]]*\]\(([^)]+)\)|<img[^>]+src=["']([^"']+)["']/gi)
      for (const m of assetMatches) {
        const link = (m[1] || m[2] || '').trim().split(/\s+/)[0]
        if (/\.assets[/\\]/i.test(link)) {
          addCanvasAssetRef(link)
        } else if (/(?:^|\/)(?:data\/)?assets\//i.test(link)) {
          addGlobalRef(link, nodeId, nodeType)
        }
      }
    }

    // 3. Group 卡片内折叠的子节点 (collapsedNodes)
    if (Array.isArray(node.collapsedNodes)) {
      for (const childNode of node.collapsedNodes) {
        traverseNode(childNode)
      }
    }
  }

  for (const node of canvasJson.nodes) {
    traverseNode(node)
  }

  return {
    globalAssetRefs,
    canvasAssetRefs,
  }
}

/**
 * 自适应探测无界插件的所有候选目录与已知画布路径
 */
export async function discoverCanvasCandidateDirs(): Promise<{
  candidateDirs: Set<string>
  explicitCanvasFiles: Set<string>
}> {
  const candidateDirs = new Set<string>()
  const explicitCanvasFiles = new Set<string>()

  candidateDirs.add(DEFAULT_CANVAS_DIR)

  // 1. 读取无界插件设置文件
  try {
    const blob = await defaultStorage.read(CANVAS_SETTINGS_PATH).catch(() => null)
    if (blob) {
      const text = await blobToText(blob)
      if (text) {
        const parsed = JSON.parse(text)
        if (parsed?.settings?.defaultCanvasDirectory) {
          const dir = normalizeCanvasWorkspacePath(parsed.settings.defaultCanvasDirectory)
          if (dir) candidateDirs.add(dir)
        }
        if (Array.isArray(parsed?.recentFiles)) {
          for (const item of parsed.recentFiles) {
            if (item && typeof item.path === 'string' && item.path.trim()) {
              const cPath = normalizeCanvasWorkspacePath(item.path.trim())
              if (cPath.endsWith('.canvas')) {
                explicitCanvasFiles.add(cPath)
                const parentDir = cPath.substring(0, cPath.lastIndexOf('/'))
                if (parentDir) candidateDirs.add(parentDir)
              }
            }
          }
        }
      }
    }
  } catch (e) {
    warn('[canvas-asset] 读取无界插件设置失败，使用默认目录:', e)
  }

  // 2. 查询思源数据库中嵌入的 custom-canvas-path
  try {
    const rows = await sql(`SELECT value FROM attributes WHERE name = 'custom-canvas-path' LIMIT 1000`).catch(() => [])
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row.value === 'string' && row.value.trim()) {
          const cPath = normalizeCanvasWorkspacePath(row.value.trim())
          if (cPath.endsWith('.canvas')) {
            explicitCanvasFiles.add(cPath)
            const parentDir = cPath.substring(0, cPath.lastIndexOf('/'))
            if (parentDir) candidateDirs.add(parentDir)
          }
        }
      }
    }
  } catch (e) {
    warn('[canvas-asset] 查询 custom-canvas-path 属性失败:', e)
  }

  return {
    candidateDirs,
    explicitCanvasFiles,
  }
}

/**
 * 递归扫描指定目录，查找所有 .canvas 文件与 *.assets 资源目录
 */
export async function scanCanvasWorkspacesRecursively(
  baseDir: string,
  foundCanvasPaths: Set<string>,
  foundAssetDirs: Set<string>,
): Promise<void> {
  const normBase = normalizeCanvasWorkspacePath(baseDir)
  try {
    const raw = await readDir(normBase).catch(() => null)
    if (!raw || !Array.isArray(raw)) return

    for (const entry of raw) {
      if (!entry || !entry.name || isIgnoredSystemAsset(entry.name)) {
        continue
      }
      const fullPath = `${normBase}/${entry.name}`.replace(/\/+/g, '/')
      if (entry.isDir) {
        if (entry.name.endsWith('.assets')) {
          foundAssetDirs.add(fullPath)
        } else {
          await scanCanvasWorkspacesRecursively(fullPath, foundCanvasPaths, foundAssetDirs)
        }
      } else if (entry.name.endsWith('.canvas')) {
        foundCanvasPaths.add(fullPath)
      }
    }
  } catch (err) {
    warn(`[canvas-asset] 扫描目录 [${baseDir}] 失败:`, err)
  }
}

export interface ICanvasInventoryResult {
  /** 画布专属物理资源模型列表（包含已引用和未引用的资源） */
  canvasAssets: AssetInfo[]
  /** 从所有画布中汇总提取的全局 /data/assets 资源引用 */
  globalAssetRefs: Map<string, BlockRef[]>
  /** 失去对应画布文件的孤立 *.assets 目录列表 */
  orphanAssetDirs: string[]
}

/**
 * 全量扫描并构建无界画布资源清单与引用拓扑
 */
export async function scanCanvasAssetsInventory(): Promise<ICanvasInventoryResult> {
  const {
    candidateDirs,
    explicitCanvasFiles,
  } = await discoverCanvasCandidateDirs()

  const foundCanvasPaths = new Set<string>(explicitCanvasFiles)
  const foundAssetDirs = new Set<string>()

  // 递归扫描所有候选目录
  for (const dir of candidateDirs) {
    await scanCanvasWorkspacesRecursively(dir, foundCanvasPaths, foundAssetDirs)
  }

  // 遍历所有发现的画布文件，解析其内部资源引用
  const combinedGlobalRefs = new Map<string, BlockRef[]>()
  const combinedCanvasAssetRefs = new Map<string, BlockRef[]>()

  for (const canvasPath of foundCanvasPaths) {
    try {
      const blob = await defaultStorage.read(canvasPath).catch(() => null)
      if (!blob) continue
      const text = await blobToText(blob)
      if (!text) continue
      const json = JSON.parse(text)
      const parsed = extractReferencesFromCanvasData(json, canvasPath)

      // 合并全局资产引用
      for (const [assetName, refs] of parsed.globalAssetRefs.entries()) {
        const existing = combinedGlobalRefs.get(assetName) || []
        existing.push(...refs)
        combinedGlobalRefs.set(assetName, existing)
      }

      // 合并画布专属资产引用
      const canvasName = getBaseFileName(canvasPath)
      for (const refKey of parsed.canvasAssetRefs) {
        const existing = combinedCanvasAssetRefs.get(refKey) || []
        existing.push({
          id: `canvas:${canvasPath}:${refKey}`,
          root_id: canvasPath,
          box: '',
          content: `无界画布节点引用 [${canvasName}]`,
          markdown: `![${refKey}](${refKey})`,
          path: canvasPath,
          hpath: canvasName,
          readablePath: `画布: ${canvasName}`,
        })
        combinedCanvasAssetRefs.set(refKey, existing)
      }
    } catch (err) {
      warn(`[canvas-asset] 解析画布 [${canvasPath}] 引用失败:`, err)
    }
  }

  // 遍历所有发现的 *.assets 目录，提取内部物理文件并对照引用判定
  const canvasAssets: AssetInfo[] = []
  const orphanAssetDirs: string[] = []

  for (const assetDir of foundAssetDirs) {
    const parentCanvasPath = getCanvasPathFromAssetDir(assetDir)
    const isCanvasExisting = foundCanvasPaths.has(parentCanvasPath)

    try {
      const entries = await readDir(assetDir).catch(() => null)
      if (!entries || !Array.isArray(entries)) continue

      const dirBaseName = getBaseFileName(assetDir)
      const validEntries = entries.filter((e) => e && !e.isDir && !isIgnoredSystemAsset(e.name))

      // 并发通过 defaultStorage.stat 获取每个物理文件的精确 size 与 updated
      const stats = await Promise.all(
        validEntries.map(async (entry) => {
          const fileFullPath = `${assetDir}/${entry.name}`.replace(/\/+/g, '/')
          try {
            const st = await defaultStorage.stat(fileFullPath)
            return { entry, fileFullPath, st }
          } catch {
            return { entry, fileFullPath, st: null }
          }
        }),
      )

      let dirHasAnyRef = false

      for (const { entry, fileFullPath, st } of stats) {
        const relativeKey = `${dirBaseName}/${entry.name}`
        const baseNameKey = entry.name
        const noDataKey = fileFullPath.replace(/^\/?data\//, '')

        // 无论母体画布是否在磁盘上存在，均跨画布多维检索引用（支持全路径、相对路径、无 data 前缀与纯文件名）
        const refs =
          combinedCanvasAssetRefs.get(fileFullPath)
          || combinedCanvasAssetRefs.get(noDataKey)
          || combinedCanvasAssetRefs.get(relativeKey)
          || combinedCanvasAssetRefs.get(baseNameKey)
          || []

        if (refs.length > 0) {
          dirHasAnyRef = true
        }

        const docIds = new Set(refs.map((r) => r.root_id))
        const rawUpdated = st?.updated || entry.updated || 0
        const finalUpdated = resolveCanvasAssetTimestamp(entry.name, rawUpdated)
        const finalSize = st?.size ?? (entry.size || 0)

        canvasAssets.push({
          name: relativeKey,
          size: finalSize,
          updated: finalUpdated,
          isDir: false,
          references: refs,
          refCount: refs.length,
          docCount: docIds.size,
          isReEditable: false,
          isOriginal: false,
          isCanvasAsset: true,
          canvasPath: parentCanvasPath,
          canvasAssetStoragePath: fileFullPath,
        })
      }

      // 仅当母体画布不存在，且该目录内所有物理文件均未被任何画布引用时，才判定为孤立待清理目录
      if (!isCanvasExisting && !dirHasAnyRef) {
        orphanAssetDirs.push(assetDir)
      }
    } catch (err) {
      warn(`[canvas-asset] 读取专属资源目录 [${assetDir}] 失败:`, err)
    }
  }

  return {
    canvasAssets,
    globalAssetRefs: combinedGlobalRefs,
    orphanAssetDirs,
  }
}

/**
 * 删除画布专属物理资产文件（若环境支持则移入操作系统回收站，否则硬删除）
 * 并在文件删除后自动检查父目录，若父目录已为空则自动删除空目录
 */
export async function deleteCanvasAssetFile(
  asset: AssetInfo,
  moveToTrash: boolean = true,
): Promise<boolean> {
  const filePath = asset.canvasAssetStoragePath || asset.name
  if (!filePath) return false

  let success = false
  try {
    if (moveToTrash && isTrashSupported()) {
      success = await defaultStorage.deleteToTrash(filePath).catch(() => false)
    }
  } catch {
    success = false
  }

  if (!success) {
    try {
      const res = await removeFile(filePath).catch(() => null)
      success = res !== null
    } catch {
      success = false
    }
  }

  // 若成功删除文件，检查父 *.assets 目录是否已空；若空则清理空目录
  if (success && filePath.includes('/')) {
    const parentDir = filePath.substring(0, filePath.lastIndexOf('/'))
    if (parentDir.endsWith('.assets')) {
      try {
        const remaining = await readDir(parentDir).catch(() => null)
        if (Array.isArray(remaining) && remaining.filter((e) => !isIgnoredSystemAsset(e?.name)).length === 0) {
          await removeFile(parentDir).catch(() => {})
          log(`[canvas-asset] 已自动清理已清空的画布资源目录: ${parentDir}`)
        }
      } catch {}
    }
  }

  return success
}

/**
 * 深度清理所有已确认清空或对应画布已不存在的孤立 *.assets 目录
 */
export async function cleanupEmptyCanvasAssetDirs(orphanDirs: string[]): Promise<number> {
  let cleanedCount = 0
  for (const dir of orphanDirs) {
    try {
      const remaining = await readDir(dir).catch(() => null)
      if (!remaining || remaining.filter((e) => !isIgnoredSystemAsset(e?.name)).length === 0) {
        await removeFile(dir).catch(() => {})
        cleanedCount++
        log(`[canvas-asset] 成功清理孤立画布目录: ${dir}`)
      }
    } catch (e) {
      warn(`[canvas-asset] 清理孤立画布目录 [${dir}] 失败:`, e)
    }
  }
  return cleanedCount
}

/**
 * 在思源后台标签页中打开无界画布文件
 * @param canvasPath 画布工作区路径 (如 /data/storage/petal/siyuan-canvas/demo.canvas)
 * @param title 画布标题 (可选)
 * @returns 是否成功调用无界插件打开
 */
export async function openCanvasInTab(canvasPath: string, title?: string): Promise<boolean> {
  if (!canvasPath) return false
  const normPath = normalizeCanvasWorkspacePath(canvasPath)

  // 检测思源环境中是否已安装并启用 siyuan-canvas 插件
  const app = (window as any).siyuan?.ws?.app
  const canvasPlugin = app?.plugins?.find((p: any) => p && p.name === 'siyuan-canvas')
  if (!canvasPlugin) {
    return false
  }

  const canvasTitle = title || getBaseFileName(normPath) || '画布'

  try {
    // 优先调用无界插件自身提供的 openCanvasTab 实例方法（可兼顾移动端适配与生命周期注册）
    if (typeof canvasPlugin.openCanvasTab === 'function') {
      await canvasPlugin.openCanvasTab({
        path: normPath,
        title: canvasTitle,
      })
      return true
    }

    // 降级使用思源开放的 openTab API 打开无界自定义标签页
    await openTab({
      app,
      custom: {
        id: 'siyuan-canvas-canvas-editor',
        icon: 'iconCanvas',
        title: canvasTitle,
        data: { path: normPath },
      },
      keepCursor: true,
      openNewTab: true,
    })

    // 联动无界插件记录最近打开历史
    if (typeof canvasPlugin.rememberRecentCanvas === 'function') {
      try {
        canvasPlugin.rememberRecentCanvas(normPath, canvasTitle)
      } catch {}
    }
    return true
  } catch (err) {
    warn('[canvas-asset] 打开无界画布标签页失败:', err)
    return false
  }
}
