import type { IAssetReEditMetadata } from "../types/reedit"
import { lsNotebooks } from "../api"
import { extractAssetNamesFromMarkdown } from "./asset-markdown"

/**
 * 资产领域模型层：类型定义与纯装配函数。
 *
 * 本模块只允许依赖 api 薄封装与 asset-markdown 纯文本工具，
 * 禁止导入 asset-catalog / siyuan-block / attribute-view / siyuan-db，
 * 以保证 siyuan-db（高层查询门面）→ asset-model 单向依赖、无循环
 * （由 tests/module-boundaries.test.ts 守护）。
 * siyuan-db.ts 对本模块全部符号做 re-export，对外接口保持兼容。
 */

export interface BlockRef {
  id: string
  root_id: string
  box: string
  content: string
  markdown: string
  path: string // document path
  hpath?: string // 人类可读文档路径 (如 /前端/Vue)
  boxName?: string // 笔记本名称
  readablePath?: string // 易读路径 (如 笔记本名称/前端/Vue)
}

/**
 * 思源内核系统关键保留文件白名单
 * 对齐思源官方 UnusedAssets: 无论是否有文档引用，此类系统文件绝对禁止作为孤儿删除
 */
export const SYSTEM_PROTECTED_ASSETS = new Set([
  'ocr-texts.json',
  'android-notification-texts.txt',
])

export interface AssetInfo {
  name: string
  size: number
  updated: number
  isDir: boolean
  references: BlockRef[]
  refCount: number
  docCount: number // 引用数
  isReEditable?: boolean // 是否包含可二次编辑元数据
  reEditBlockId?: string // 关联的二次编辑文档块 ID
  originalStoragePath?: string // 关联的隔离原始底图路径
  isOriginal?: boolean // 是否为隔离存储的原始底图
  isSystemProtected?: boolean // 是否为思源系统保留受保护文件 (如 ocr-texts.json)
  isCompanion?: boolean // 是否为伴生文件 (如 xxx.pdf.sya)
  isMissing?: boolean // 是否为丢失资源 (有文档/数据库引用但在 /data/assets 中找不到物理文件)
  isCanvasAsset?: boolean // 是否为无界画布专属资源 (如 storage/.../*.assets/xxx.png)
  canvasPath?: string // 关联的画布文件路径 (如 /data/storage/petal/siyuan-canvas/xxx.canvas)
  canvasAssetStoragePath?: string // 在工作区中的存储相对/绝对路径 (如 /data/storage/petal/siyuan-canvas/xxx.assets/123.png)
}

/**
 * 判定是否为操作系统生成的临时/隐藏垃圾文件（如 .DS_Store, Thumbs.db 等）
 */
export function isIgnoredSystemAsset(fileName: string): boolean {
  if (!fileName) return true
  const baseName = fileName.split('/').pop() || fileName
  if (baseName.startsWith('.')) return true
  const lower = baseName.toLowerCase()
  return lower === 'thumbs.db' || lower === 'desktop.ini' || lower === '$recycle.bin'
}

export function createAssetInfoMap(files: any[]): Map<string, AssetInfo> {
  const assetsMap = new Map<string, AssetInfo>()

  for (const file of files) {
    if (!file.isDir) {
      const fileSize = file.size || 0
      assetsMap.set(file.name, {
        name: file.name,
        size: fileSize, // bytes
        updated: file.updated || 0,
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: false,
      })
    }
  }

  return assetsMap
}

/**
 * 格式化以笔记本名称为根目录的易读文档路径 (例如: "我的笔记本/技术文档/Vue3进阶")
 */
export function formatReadableDocPath(boxName: string, hpath?: string, fallbackPath?: string): string {
  const cleanHpath = (hpath || "").replace(/^\/+/, "")
  if (boxName) {
    return cleanHpath ? `${boxName}/${cleanHpath}` : boxName
  }
  return hpath || fallbackPath || ""
}

/**
 * 预提取后的引用块条目：rawAssetNames 是从 markdown+ial 中提取出的原始资源名
 * （未 decode、可能包含目录型引用，如 "assets/widget/"）。
 * 快照与增量校验管线直接持有这类条目，避免每次载入都重跑全量正则提取。
 */
export interface PreExtractedBlockEntry {
  id: string
  root_id: string
  box: string
  content: string
  path: string
  hpath?: string
  rawAssetNames: string[]
  /** 原始 markdown（仅调试用途，无消费方；快照条目刻意不存以控制体积） */
  markdown?: string
}

/**
 * 从块的 markdown 与 ial 中提取原始资源名（去重、保持出现顺序）
 */
export function extractBlockEntryNames(block: { markdown?: string, ial?: string }): string[] {
  const mdAssets = extractAssetNamesFromMarkdown(block.markdown || "")
  const ialAssets = block.ial ? extractAssetNamesFromMarkdown(block.ial) : []
  return Array.from(new Set([...mdAssets, ...ialAssets]))
}

/**
 * 把 SQL 原始块行转换为预提取条目；raw = true 时保留原始行上的 content
 */
export function toPreExtractedEntry(block: any): PreExtractedBlockEntry {
  return {
    id: String(block.id || ''),
    root_id: String(block.root_id || ''),
    box: String(block.box || ''),
    content: String(block.content ?? ''),
    path: String(block.path || ''),
    hpath: block.hpath ? String(block.hpath) : undefined,
    rawAssetNames: extractBlockEntryNames(block),
  }
}

export function attachBlockReferences(
  assetsMap: Map<string, AssetInfo>,
  blocks: any[] = [],
  notebookMap: Map<string, string> = new Map(),
  options: { includeMissing?: boolean } = { includeMissing: true },
): void {
  attachPreExtractedReferences(
    assetsMap,
    (blocks || []).map(toPreExtractedEntry),
    notebookMap,
    options,
  )
}

/**
 * 挂载预提取条目的资源引用（与 attachBlockReferences 完全同语义，
 * 仅跳过 markdown/ial 的正则提取步骤）
 */
export function attachPreExtractedReferences(
  assetsMap: Map<string, AssetInfo>,
  entries: PreExtractedBlockEntry[] = [],
  notebookMap: Map<string, string> = new Map(),
  options: { includeMissing?: boolean } = { includeMissing: true },
): void {
  for (const block of entries) {
    const referencedAssets = block.rawAssetNames
    const boxName = notebookMap.get(block.box) || ""
    const readablePath = formatReadableDocPath(boxName, block.hpath, block.path)

    for (const rawName of referencedAssets) {
      if (!rawName || isIgnoredSystemAsset(rawName)) continue

      let canonicalName = rawName
      try {
        const decoded = decodeURIComponent(rawName)
        if (decoded) canonicalName = decoded
      } catch {}

      // 目录型链接保护：对齐思源官方 UnusedAssets linkDestFolderPaths 逻辑
      // 若引用是以 / 结尾的目录路径 (如 custom-data-assets="assets/widget/")，
      // 自动保护该目录下的所有子文件资产，标记为被该块引用
      const isDirRef = canonicalName.endsWith('/') || rawName.endsWith('/')
      if (isDirRef) {
        const dirPrefix = canonicalName.endsWith('/') ? canonicalName : rawName
        let matchedAny = false
        for (const [assetName, asset] of assetsMap.entries()) {
          if (assetName.startsWith(dirPrefix) && assetName !== dirPrefix) {
            matchedAny = true
            if (!asset.references.some((r) => r.id === block.id)) {
              asset.references.push({
                id: block.id,
                root_id: block.root_id,
                box: block.box,
                content: block.content,
                markdown: block.markdown || '',
                path: block.path,
                hpath: block.hpath,
                boxName,
                readablePath,
              })
              asset.refCount++
            }
          }
        }
        if (matchedAny) {
          continue
        }
      }

      let targetAsset = assetsMap.get(canonicalName) || assetsMap.get(rawName)

      if (!targetAsset && options.includeMissing !== false) {
        targetAsset = {
          name: canonicalName,
          size: 0,
          updated: 0,
          isDir: false,
          references: [],
          refCount: 0,
          docCount: 0,
          isReEditable: false,
          isOriginal: false,
          isMissing: true,
        }
        assetsMap.set(canonicalName, targetAsset)
      }

      if (targetAsset) {
        if (!targetAsset.references.some((r) => r.id === block.id)) {
          targetAsset.references.push({
            id: block.id,
            root_id: block.root_id,
            box: block.box,
            content: block.content,
            markdown: block.markdown || '',
            path: block.path,
            hpath: block.hpath,
            boxName,
            readablePath,
          })
          targetAsset.refCount++
        }
      }
    }
  }
}

/**
 * 将数据库属性视图中的引用合并挂载到资产对象上
 */
export function attachAttributeViewReferences(
  assetsMap: Map<string, AssetInfo>,
  avReferencesMap: Map<string, BlockRef[]> = new Map(),
  options: { includeMissing?: boolean } = { includeMissing: true },
): void {
  if (!avReferencesMap || avReferencesMap.size === 0) return

  for (const [assetName, avRefs] of avReferencesMap.entries()) {
    if (!assetName || isIgnoredSystemAsset(assetName)) continue
    if (!Array.isArray(avRefs) || avRefs.length === 0) continue

    let canonicalName = assetName
    try {
      const decoded = decodeURIComponent(assetName)
      if (decoded) canonicalName = decoded
    } catch {}

    let targetAsset = assetsMap.get(canonicalName) || assetsMap.get(assetName)

    if (!targetAsset && options.includeMissing !== false) {
      targetAsset = {
        name: canonicalName,
        size: 0,
        updated: 0,
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: false,
        isMissing: true,
      }
      assetsMap.set(canonicalName, targetAsset)
    }

    if (targetAsset) {
      for (const ref of avRefs) {
        if (!targetAsset.references.some((r) => r.id === ref.id)) {
          targetAsset.references.push(ref)
          targetAsset.refCount++
        }
      }
    }
  }
}

/**
 * 统计引用涉及的文档数（同一篇文档中的多个引用块只计一次文档）
 */
export function countReferencedDocs(references: BlockRef[] = []): number {
  const docIds = new Set(references.map((r) => r.root_id))
  return docIds.size
}

/**
 * 是否为无界画布引用（root_id 是 .canvas 画布路径，或 id 带 canvas: 前缀）
 */
export function isCanvasRef(ref: BlockRef): boolean {
  if (!ref) return false
  return ref.id?.startsWith('canvas:') || (ref.root_id?.endsWith('.canvas') ?? false)
}

/**
 * 是否为独立数据库伪引用（attribute-view.ts 为未嵌入文档的数据库生成的 av-<avId> 占位 id）。
 * 这类 id 不存在于 blocks 表，无法作为文档打开，只能展示来源名称。
 */
export function isStandaloneDatabaseRef(ref: BlockRef): boolean {
  if (!ref) return false
  return Boolean(ref.id) && ref.id.startsWith('av-') && ref.id === ref.root_id
}

export function updateAssetDocCounts(assets: Iterable<AssetInfo>): void {
  for (const asset of assets) {
    asset.docCount = countReferencedDocs(asset.references)
  }
}

/**
 * 将二次编辑块元数据绑定到对应的资产对象上
 */
export function attachReEditMetadata(
  assetsMap: Map<string, AssetInfo>,
  reEditableBlocks: Array<{ blockId: string, rootId: string, metadata: IAssetReEditMetadata }> = [],
): void {
  for (const item of reEditableBlocks) {
    const renderedName = item.metadata.renderedAssetName
    if (renderedName && assetsMap.has(renderedName)) {
      const asset = assetsMap.get(renderedName)!
      asset.isReEditable = true
      asset.reEditBlockId = item.blockId
      asset.originalStoragePath = item.metadata.originalStoragePath
    }
  }
}

/**
 * 获取笔记本映射表（boxId -> boxName）
 */
export async function getNotebookMap(): Promise<Map<string, string>> {
  const notebookMap = new Map<string, string>()
  try {
    const res = await lsNotebooks()
    if (res && res.notebooks && Array.isArray(res.notebooks)) {
      for (const nb of res.notebooks) {
        if (nb.id && nb.name) {
          notebookMap.set(nb.id, nb.name)
        }
      }
    }
  } catch (e) {}

  // 尝试从全局 window.siyuan.notebooks 补充
  if (notebookMap.size === 0 && (window as any).siyuan?.notebooks) {
    const nbs = (window as any).siyuan.notebooks
    if (Array.isArray(nbs)) {
      for (const nb of nbs) {
        if (nb.id && nb.name) {
          notebookMap.set(nb.id, nb.name)
        }
      }
    }
  }

  return notebookMap
}

export interface OrphanOriginalInfo {
  name: string
  path: string
  size: number
  updated: number
}
