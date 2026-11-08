import {
  sql,
} from "../api"
import { fetchCatalogInventory, fillMissingAssetStats } from "./asset-catalog"
import { extractAssetNamesFromMarkdown } from "./asset-markdown"
import type {
  AssetInfo,
  BlockRef,
  OrphanOriginalInfo,
} from "./asset-model"
import {
  formatReadableDocPath,
  getNotebookMap,
  SYSTEM_PROTECTED_ASSETS,
} from "./asset-model"
import { resolveAttributeViewReferences } from "./attribute-view"
import {
  deleteAsset,
  deleteAssetMetadataFile,
  deleteOriginalImage,
  listOriginalImages,
  normalizeOriginalStoragePath,
  readAssetMetadataFile,
  saveAssetMetadataFile,
} from "./file-system"
import {
  error,
  warn,
} from "./logger"
import { queryAllReEditableBlocks } from "./siyuan-block"
import { defaultStorage } from "./storage"

/**
 * 领域模型 re-export：类型与纯装配函数现居 asset-model.ts，
 * 此处保持既有导入路径 100% 兼容（组件与测试无需改动）。
 */
export {
  attachAttributeViewReferences,
  attachBlockReferences,
  attachPreExtractedReferences,
  attachReEditMetadata,
  countReferencedDocs,
  createAssetInfoMap,
  extractBlockEntryNames,
  formatReadableDocPath,
  getNotebookMap,
  isCanvasRef,
  isIgnoredSystemAsset,
  isStandaloneDatabaseRef,
  SYSTEM_PROTECTED_ASSETS,
  toPreExtractedEntry,
  updateAssetDocCounts,
} from "./asset-model"
export type {
  AssetInfo,
  BlockRef,
  OrphanOriginalInfo,
  PreExtractedBlockEntry,
} from "./asset-model"

/**
 * 获取所有的 Asset 信息，包括物理文件和它被哪些 Block 引用以及二次编辑状态
 * （兼容入口：一次性完成两阶段扫描，并在返回前同步补全 size/updated，
 * 供非组件调用方获得与旧版一致的完整数据；组件走两阶段渐进渲染）
 */
export async function getAllAssetsInfo(): Promise<AssetInfo[]> {
  const inventory = await fetchCatalogInventory()
  const needsStat = inventory.allAssets.some(
    (a) => !a.isOriginal && !a.isMissing && (a.size === 0 || !a.updated),
  )
  if (needsStat) {
    await fillMissingAssetStats(inventory.allAssets)
  }
  return inventory.allAssets
}

/**
 * 删除资产文件（优先移入系统回收站）
 * @param fileName 资产文件名
 * @param moveToTrash 是否移入回收站（默认 true）
 */
export async function deleteAssetFile(fileName: string, moveToTrash: boolean = true): Promise<void> {
  if (SYSTEM_PROTECTED_ASSETS.has(fileName)) {
    throw new Error(`系统关键文件 [${fileName}] 受保护，禁止删除`)
  }
  const ok = await deleteAsset(fileName, moveToTrash)
  if (!ok) {
    throw new Error(`删除资产文件 [${fileName}] 失败`)
  }
  try {
    await deleteAssetMetadataFile(fileName)
  } catch (e) {}
}

/**
 * 根据资源文件名获取单个 Asset 信息
 */
export async function getAssetInfoByName(fileName: string): Promise<AssetInfo | null> {
  // 1. 优先检查是否为隔离存储目录中的原始底图
  try {
    const originalFiles = await listOriginalImages()
    const origMatch = originalFiles.find(
      (f) => f.name === fileName || normalizeOriginalStoragePath(f.path) === normalizeOriginalStoragePath(fileName),
    )
    if (origMatch) {
      const inventory = await fetchCatalogInventory()
      const normOrigPath = normalizeOriginalStoragePath(origMatch.path)
      const found = inventory.originalAssets.find(
        (a) => a.name === origMatch.name || normalizeOriginalStoragePath(a.originalStoragePath || '') === normOrigPath,
      )
      return found || null
    }
  } catch (e) {
    warn("[siyuan-db] 查询底图信息失败:", e)
  }

  let size = 0
  let updated = Date.now()
  try {
    const st = await defaultStorage.statAsset(fileName)
    if (st) {
      size = st.size
      updated = st.updated
    }
  } catch (e) {}

  // 只按 assets/ 粗筛，不把文件名插值进 SQL：
  // 文件名可能含单引号（破坏语句）或 % _ 通配符（造成误匹配）；
  // 且 Markdown 中的引用可能是 URI 编码形式，按原始名 LIKE 反而会漏掉真实引用。
  // 精确匹配交由下方的 extractAssetNamesFromMarkdown 完成（与 getAllAssetsInfo 一致）。
  const blocks: any[] = await sql(
    `SELECT id, root_id, box, content, markdown, path, hpath, ial FROM blocks WHERE markdown LIKE '%assets/%' OR ial LIKE '%assets/%' LIMIT 1000000`,
  )

  const references: BlockRef[] = []
  const notebookMap = await getNotebookMap()
  if (blocks && blocks.length > 0) {
    for (const block of blocks) {
      const mdAssets = extractAssetNamesFromMarkdown(block.markdown || "")
      const ialAssets = block.ial ? extractAssetNamesFromMarkdown(block.ial) : []
      const referencedAssets = Array.from(new Set([...mdAssets, ...ialAssets]))
      if (referencedAssets.includes(fileName)) {
        references.push({
          id: block.id,
          root_id: block.root_id,
          box: block.box,
          content: block.content,
          markdown: block.markdown,
          path: block.path,
          hpath: block.hpath,
          readablePath: formatReadableDocPath(
            block.box && notebookMap ? notebookMap.get(block.box) : undefined,
            block.hpath || block.path,
          ),
        })
      }
    }
  }

  // 补充检索数据库属性视图中的关联引用
  try {
    const avRefsMap = await resolveAttributeViewReferences(notebookMap)
    const avRefs = avRefsMap.get(fileName) || []
    for (const ref of avRefs) {
      if (!references.some((r) => r.id === ref.id)) {
        references.push(ref)
      }
    }
  } catch (avErr) {
    warn("[siyuan-db] 查询属性视图关联引用失败:", avErr)
  }

  const docIds = new Set(references.map((r) => r.root_id))

  // 检查是否具备二次编辑属性
  let isReEditable = false
  let reEditBlockId: string | undefined
  let originalStoragePath: string | undefined

  // 1. 优先从 Sidecar 读取元数据（解耦单点块属性）
  try {
    const sidecarMeta = await readAssetMetadataFile(fileName)
    if (sidecarMeta) {
      isReEditable = true
      originalStoragePath = sidecarMeta.originalStoragePath
    }
  } catch (e) {}

  // 2. 尝试从块属性补充 reEditBlockId 或作为 fallback
  try {
    const reEditBlocks = await queryAllReEditableBlocks()
    const match = reEditBlocks.find((b) => b.metadata.renderedAssetName === fileName)
    if (match) {
      isReEditable = true
      reEditBlockId = match.blockId
      if (!originalStoragePath) {
        originalStoragePath = match.metadata.originalStoragePath
      }
      // 即时自愈：如果 Sidecar 还没写，写入 Sidecar
      try {
        const sidecarMeta = await readAssetMetadataFile(fileName)
        if (!sidecarMeta) {
          await saveAssetMetadataFile(fileName, match.metadata)
        }
      } catch (migErr) {}
    }
  } catch (e) {}

  if (!reEditBlockId && references.length > 0) {
    reEditBlockId = references[0].id
  }

  return {
    name: fileName,
    size,
    updated,
    isDir: false,
    references,
    refCount: references.length,
    docCount: docIds.size,
    isReEditable,
    reEditBlockId,
    originalStoragePath,
    isOriginal: false,
  }
}

/**
 * 扫描隔离存储目录中所有未被任何现有文档块引用的孤立原始底图
 */
export async function getOrphanOriginals(): Promise<{
  orphans: OrphanOriginalInfo[]
  totalSize: number
  totalCount: number
}> {
  try {
    const inventory = await fetchCatalogInventory()
    return {
      orphans: inventory.orphanOriginals,
      totalSize: inventory.totalOrphanSize,
      totalCount: inventory.orphanOriginals.length,
    }
  } catch (e) {
    error("[siyuan-db] 获取孤立原始底图失败:", e)
    return {
      orphans: [],
      totalSize: 0,
      totalCount: 0,
    }
  }
}

/**
 * 一键清理所有无主的孤立原始底图
 */
export async function cleanupOrphanOriginals(): Promise<{ deletedCount: number, freedSize: number }> {
  const { orphans } = await getOrphanOriginals()
  let deletedCount = 0
  let freedSize = 0

  for (const orphan of orphans) {
    const ok = await deleteOriginalImage(orphan.path)
    if (ok) {
      deletedCount++
      freedSize += orphan.size
    }
  }

  return {
    deletedCount,
    freedSize,
  }
}
