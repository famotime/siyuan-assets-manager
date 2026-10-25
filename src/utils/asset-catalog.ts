import type { IAssetReEditMetadata } from '../types/reedit'
import type {
  AssetInfo,
  BlockRef,
  OrphanOriginalInfo,
} from './siyuan-db'
import {
  readDirGuarded,
  sql,
  sqlGuarded,
} from '../api'
import { extractAssetNamesFromMarkdown, markdownExcerpt } from './asset-markdown'
import { resolveAttributeViewReferences } from './attribute-view'
import { resolveCanvasAssetTimestamp, scanCanvasAssetsInventory } from './canvas-asset'
import {
  listAllAssetMetadataFiles,
  listOriginalImages,
  normalizeOriginalStoragePath,
  saveAssetMetadataFile,
} from './file-system'
import {
  log,
  warn,
} from './logger'
import { queryAllReEditableBlocks } from './siyuan-block'
import {
  attachAttributeViewReferences,
  attachPreExtractedReferences,
  attachReEditMetadata,
  createAssetInfoMap,
  getNotebookMap,
  SYSTEM_PROTECTED_ASSETS,
  toPreExtractedEntry,
  updateAssetDocCounts,
  type PreExtractedBlockEntry,
} from './siyuan-db'
import {
  blobToText,
  defaultStorage,
} from './storage'
import { mapWithConcurrency } from './concurrency'
import { isImageAsset } from './asset-list'

export { SYSTEM_PROTECTED_ASSETS }

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

/** 思源 AI Agent 会话历史存储目录 */
export const AGENT_SESSIONS_STORAGE_DIR = '/data/storage/ai/agent/sessions'

/**
 * 递归扫描 /data/assets 目录下的所有资源文件（含嵌套子目录），
 * 对齐思源官方 UnusedAssets / allAssetAbsPaths 递归发现所有嵌套资源。
 * 内核 readDir 受超时守卫保护，不再可能无限挂起。
 */
export async function listDataAssetsRecursively(
  baseDir: string = '/data/assets',
  relativePrefix: string = '',
): Promise<Array<{ name: string, size: number, updated: number, isDir: boolean }>> {
  const result: Array<{ name: string, size: number, updated: number, isDir: boolean }> = []
  try {
    const raw = await readDirGuarded(baseDir).catch(() => null)
    if (!raw || !Array.isArray(raw)) return result

    for (const entry of raw) {
      if (!entry || !entry.name || isIgnoredSystemAsset(entry.name)) {
        continue
      }
      const relPath = relativePrefix ? `${relativePrefix}${entry.name}` : entry.name
      if (entry.isDir) {
        const subEntries = await listDataAssetsRecursively(`${baseDir}/${entry.name}`, `${relPath}/`)
        result.push(...subEntries)
      } else {
        result.push({
          name: relPath,
          size: entry.size || 0,
          updated: entry.updated || 0,
          isDir: false,
        })
      }
    }
  } catch (err) {
    warn(`[asset-catalog] 递归扫描资产目录 [${baseDir}] 失败:`, err)
  }
  return result
}

/**
 * 桌面端（Electron）本地快速递归枚举 /data/assets：
 * readdir(withFileTypes) 一次性拿 name/isDir，不逐条 stat，
 * 绕开内核 /api/file/readDir 的按路径互斥串行与每条目一次 os.Stat 的开销。
 * size/updated 留空，由后台 fillMissingAssetStats 并发补全。
 * 目录不存在时抛出异常，由调用方降级判定。
 */
async function listDataAssetsFast(
  baseDir: string,
  relativePrefix: string = '',
): Promise<Array<{ name: string, size: number, updated: number, isDir: boolean }>> {
  const adapter = defaultStorage.adapter as any
  const result: Array<{ name: string, size: number, updated: number, isDir: boolean }> = []
  const entries = await adapter.listDirEntries(baseDir)
  for (const entry of entries) {
    if (!entry || !entry.name || isIgnoredSystemAsset(entry.name)) {
      continue
    }
    const relPath = relativePrefix ? `${relativePrefix}${entry.name}` : entry.name
    if (entry.isDir) {
      const subEntries = await listDataAssetsFast(`${baseDir}/${entry.name}`, `${relPath}/`)
      result.push(...subEntries)
    } else {
      result.push({
        name: relPath,
        size: 0,
        updated: 0,
        isDir: false,
      })
    }
  }
  return result
}

/**
 * 扫描思源内置 AI Agent 的会话存储目录，提取对话上下文中引用的图片资产
 * 对齐思源官方 UnusedAssets 中的 agentSessionImageAssetDests
 */
export async function scanAgentSessionAssets(): Promise<Set<string>> {
  const agentAssets = new Set<string>()
  try {
    const entries = await defaultStorage.list(AGENT_SESSIONS_STORAGE_DIR).catch(() => [])
    const sessionDirs = entries.filter((e) => e.isDir)
    for (const sDir of sessionDirs) {
      for (const jsonName of ['session.json', 'runtime.json']) {
        try {
          const filePath = `${AGENT_SESSIONS_STORAGE_DIR}/${sDir.name}/${jsonName}`
          const blob = await defaultStorage.read(filePath)
          if (blob) {
            const text = await blobToText(blob)
            if (text) {
              const names = extractAssetNamesFromMarkdown(text)
              for (const name of names) {
                agentAssets.add(name)
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return agentAssets
}

export interface CatalogInventory {
  allAssets: AssetInfo[]
  assetsMap: Map<string, AssetInfo>
  originalAssets: AssetInfo[]
  orphanOriginals: OrphanOriginalInfo[]
  totalOrphanSize: number
}

/**
 * 统一领域解析流水线：
 * 将物理资产文件、Markdown SQL 块引用、二次编辑块属性、全局 Sidecar 元数据与隔离底图融合成一致的模型图
 */
export function resolveCatalogPipeline(
  files: any[],
  blocks: any[],
  reEditBlocks: Array<{ blockId: string, rootId: string, metadata: IAssetReEditMetadata }>,
  originalFiles: Array<{ name: string, path: string, size: number, updated: number }>,
  notebookMap: Map<string, string>,
  sidecarMetadataList: Array<{ assetName: string, metadata: IAssetReEditMetadata }> = [],
  avReferencesMap: Map<string, BlockRef[]> = new Map(),
  agentAssets: Set<string> = new Set(),
  avRawContents: string[] = [],
  canvasGlobalRefs: Map<string, BlockRef[]> = new Map(),
  canvasAssets: AssetInfo[] = [],
): CatalogInventory {
  return resolveCatalogPipelineFromEntries(
    files,
    (blocks || []).map(toPreExtractedEntry),
    reEditBlocks,
    originalFiles,
    notebookMap,
    sidecarMetadataList,
    avReferencesMap,
    agentAssets,
    avRawContents,
    canvasGlobalRefs,
    canvasAssets,
  )
}

/**
 * 与 resolveCatalogPipeline 完全同语义的条目化入口：
 * 直接消费预提取的块条目（快照载入 / 增量校验管线使用），
 * 免去对全量 markdown 的重复正则提取。
 */
export function resolveCatalogPipelineFromEntries(
  files: any[],
  entries: PreExtractedBlockEntry[],
  reEditBlocks: Array<{ blockId: string, rootId: string, metadata: IAssetReEditMetadata }>,
  originalFiles: Array<{ name: string, path: string, size: number, updated: number }>,
  notebookMap: Map<string, string>,
  sidecarMetadataList: Array<{ assetName: string, metadata: IAssetReEditMetadata }> = [],
  avReferencesMap: Map<string, BlockRef[]> = new Map(),
  agentAssets: Set<string> = new Set(),
  avRawContents: string[] = [],
  canvasGlobalRefs: Map<string, BlockRef[]> = new Map(),
  canvasAssets: AssetInfo[] = [],
): CatalogInventory {
  // 1. 构建常规资产 Map 并挂载文档块引用
  const assetsMap = createAssetInfoMap(files)
  if (entries && entries.length > 0) {
    attachPreExtractedReferences(assetsMap, entries, notebookMap)
  }

  // 1.0 挂载数据库属性视图引用 (Attribute View)
  if (avReferencesMap && avReferencesMap.size > 0) {
    attachAttributeViewReferences(assetsMap, avReferencesMap)
  }

  // 1.0.1 属性视图全局文本包含保底防御（严格对齐思源官方 UnusedAssets 逻辑）
  // 对齐 kernel/model/assets.go:2082-2110: bytes.Contains(avData, []byte(asset))
  if (avRawContents && avRawContents.length > 0) {
    for (const asset of assetsMap.values()) {
      if (asset.docCount === 0 && !asset.isSystemProtected) {
        const targetSearch = `assets/${asset.name}`
        const bareSearch = asset.name
        const isContained = avRawContents.some(
          (raw) => raw.includes(targetSearch) || raw.includes(bareSearch),
        )
        if (isContained) {
          asset.docCount = 1
          asset.refCount = (asset.refCount || 0) + 1
          asset.references.push({
            id: 'av-fallback-containment',
            root_id: 'av-fallback-containment',
            box: '',
            content: '属性视图底层数据包含保底引用',
            markdown: '',
            path: '',
            readablePath: '属性视图（保底保护）',
          })
        }
      }
    }
  }

  updateAssetDocCounts(assetsMap.values())

  // 1.1 标记思源系统关键保护文件（如 ocr-texts.json），免于孤儿判定与误清理
  for (const asset of assetsMap.values()) {
    if (SYSTEM_PROTECTED_ASSETS.has(asset.name)) {
      asset.isSystemProtected = true
    }
  }

  // 1.2 PDF 标注伴生文件 (.pdf.sya) 联动拓扑保活
  // 对齐思源官方 UnusedAssets: 只要母体 xxx.pdf 存在有效文档引用，其标注伴生文件 xxx.pdf.sya 自动保活，绝不能被当作孤儿误删
  for (const [name, asset] of assetsMap.entries()) {
    if (name.toLowerCase().endsWith('.pdf.sya')) {
      asset.isCompanion = true
      const parentPdfName = name.slice(0, -4)
      const parentAsset = assetsMap.get(parentPdfName)
      if (parentAsset && parentAsset.docCount > 0) {
        asset.references = [...parentAsset.references]
        asset.refCount = parentAsset.refCount
        asset.docCount = parentAsset.docCount
      }
    }
  }

  // 1.3 AI Agent 会话上下文中的资源保活
  if (agentAssets && agentAssets.size > 0) {
    for (const agentAssetName of agentAssets) {
      const asset = assetsMap.get(agentAssetName)
      if (asset && asset.docCount === 0) {
        asset.docCount = 1
        asset.refCount = (asset.refCount || 0) + 1
        asset.references.push({
          id: 'ai-agent-session',
          root_id: 'ai-agent-session',
          box: '',
          content: '思源 AI Agent 会话上下文引用',
          markdown: '',
          path: '',
          readablePath: '思源 AI 对话',
        })
      }
    }
  }

  // 1.3.1 挂载来自无界画布对全局资源的引用保活（防止画布引用的全局资产被误删为未引用）
  if (canvasGlobalRefs && canvasGlobalRefs.size > 0) {
    for (const [assetName, refs] of canvasGlobalRefs.entries()) {
      const asset = assetsMap.get(assetName)
      if (asset) {
        for (const ref of refs) {
          if (!asset.references.some((r) => r.id === ref.id)) {
            asset.references.push(ref)
          }
        }
        asset.refCount = asset.references.length
        const docIds = new Set(asset.references.map((r) => r.root_id))
        asset.docCount = docIds.size
      }
    }
  }

  // 1.3.2 挂载画布专属资源到资产库中（支持展示、筛选与独立/综合孤儿清理）
  if (canvasAssets && canvasAssets.length > 0) {
    for (const ca of canvasAssets) {
      assetsMap.set(ca.name, ca)
    }
  }

  // 1.4 挂载 Sidecar 元数据（优先全局真理源）
  if (sidecarMetadataList && sidecarMetadataList.length > 0) {
    for (const item of sidecarMetadataList) {
      const renderedName = item.metadata.renderedAssetName || item.assetName
      if (renderedName && assetsMap.has(renderedName)) {
        const asset = assetsMap.get(renderedName)!
        asset.isReEditable = true
        asset.originalStoragePath = item.metadata.originalStoragePath
        if (!asset.reEditBlockId && asset.references && asset.references.length > 0) {
          asset.reEditBlockId = asset.references[0].id
        }
      }
    }
  }

  // 1.5 补充挂载块级元数据（向前兼容历史数据）
  if (reEditBlocks && reEditBlocks.length > 0) {
    attachReEditMetadata(assetsMap, reEditBlocks)
  }

  // 2. 建立底图与有效文档引用的双向拓扑映射
  const originalToRefsMap = new Map<string, BlockRef[]>()

  // 2.1 从 Sidecar 关联底图与有效引用
  if (sidecarMetadataList && sidecarMetadataList.length > 0) {
    for (const item of sidecarMetadataList) {
      const normPath = normalizeOriginalStoragePath(item.metadata.originalStoragePath)
      if (!normPath) continue

      const renderedName = item.metadata.renderedAssetName || item.assetName
      const renderedAsset = renderedName ? assetsMap.get(renderedName) : undefined
      // 渲染图片必须在 assetsMap 中真实存在且仍有文档引用
      if (!renderedAsset || !renderedAsset.references || renderedAsset.references.length === 0) {
        continue
      }

      let refs = originalToRefsMap.get(normPath)
      if (!refs) {
        refs = []
        originalToRefsMap.set(normPath, refs)
      }

      for (const ref of renderedAsset.references) {
        if (!refs.some((r) => r.id === ref.id)) {
          refs.push(ref)
        }
      }
    }
  }

  // 2.2 从块级元数据关联底图与有效引用（向前兼容）
  for (const item of reEditBlocks) {
    const normPath = normalizeOriginalStoragePath(item.metadata.originalStoragePath)
    if (!normPath) continue

    const renderedName = item.metadata.renderedAssetName
    const renderedAsset = renderedName ? assetsMap.get(renderedName) : undefined
    // 渲染图片必须在 assetsMap 中真实存在且仍有文档引用
    if (!renderedAsset || !renderedAsset.references || renderedAsset.references.length === 0) {
      continue
    }

    let refs = originalToRefsMap.get(normPath)
    if (!refs) {
      refs = []
      originalToRefsMap.set(normPath, refs)
    }

    for (const ref of renderedAsset.references) {
      if (!refs.some((r) => r.id === ref.id)) {
        refs.push(ref)
      }
    }
  }

  // 2.3 补充遍历 assetsMap 中具备 originalStoragePath 的资产（双向保障）
  for (const asset of assetsMap.values()) {
    if (!asset.originalStoragePath || !asset.references || asset.references.length === 0) {
      continue
    }
    const normPath = normalizeOriginalStoragePath(asset.originalStoragePath)
    if (!normPath) continue

    let refs = originalToRefsMap.get(normPath)
    if (!refs) {
      refs = []
      originalToRefsMap.set(normPath, refs)
    }

    for (const ref of asset.references) {
      if (!refs.some((r) => r.id === ref.id)) {
        refs.push(ref)
      }
    }
  }

  // 3. 构建原始底图模型并判定孤立状态
  const originalAssets: AssetInfo[] = []
  const orphanOriginals: OrphanOriginalInfo[] = []
  let totalOrphanSize = 0

  for (const orig of originalFiles) {
    const normOrigPath = normalizeOriginalStoragePath(orig.path)
    const refs = originalToRefsMap.get(normOrigPath) || []
    const docIds = new Set(refs.map((r) => r.root_id))

    originalAssets.push({
      name: orig.name,
      size: orig.size,
      updated: orig.updated,
      isDir: false,
      references: refs,
      refCount: refs.length,
      docCount: docIds.size,
      isReEditable: false,
      isOriginal: true,
      originalStoragePath: orig.path,
    })

    if (refs.length === 0) {
      orphanOriginals.push(orig)
      totalOrphanSize += orig.size
    }
  }

  const allAssets = [...Array.from(assetsMap.values()), ...originalAssets]

  return {
    allAssets,
    assetsMap,
    originalAssets,
    orphanOriginals,
    totalOrphanSize,
  }
}

/**
 * 异步获取全量目录库存与装配模型（兼容入口：文件 + 引用两阶段一次性完成）。
 * 带短 TTL 内存缓存：插件重载、标签页重开等高频重复加载不再触发全量重扫。
 */
export async function fetchCatalogInventory(): Promise<CatalogInventory> {
  const cached = getCachedCatalogInventory()
  if (cached) return cached

  const filesRes = await fetchCatalogFiles()
  if (!filesRes.dirAvailable) {
    return {
      allAssets: [],
      assetsMap: new Map(),
      originalAssets: [],
      orphanOriginals: [],
      totalOrphanSize: 0,
    }
  }
  const refData = await fetchCatalogReferenceData()
  const inventory = resolveCatalogInventory(filesRes.files, refData)
  setCachedCatalogInventory(inventory)
  return inventory
}

// **************************************** 两阶段扫描架构 ****************************************
// 大工作空间（10 万级资源 + 百万级块）上，一次全量扫描 = 目录枚举(内核串行) + 百万块
// LIKE 全表扫描(分钟级) + 数万次 stat。此前这些全部串在 loading 一个状态里，首屏要
// 十几分钟且无任何反馈。现拆为两个可独立汇报进度的阶段：
//   阶段一 fetchCatalogFiles：拿物理文件清单（桌面端本地枚举，秒级）→ 先渲染列表
//   阶段二 fetchCatalogReferenceData：SQL 引用关系 + 属性视图/画布/AI 会话 → 合并引用
// size/updated 补全(fillMissingAssetStats)移到渲染后后台执行，不再阻塞首屏。

export interface CatalogScanPhase {
  stage: 'files' | 'refs' | 'resolve'
  label: string
}

export type ScanPhaseReporter = (phase: CatalogScanPhase) => void

export interface CatalogFilesResult {
  files: Array<{ name: string, size: number, updated: number, isDir: boolean }>
  /** 枚举来源：desktop 本地文件系统 或 内核 readDir */
  source: 'local-fs' | 'kernel'
  /** /data/assets 是否可用（不可用时上层直接呈现空列表，跳过引用阶段） */
  dirAvailable: boolean
}

/**
 * 阶段一：枚举 /data/assets 物理文件清单。
 * 桌面端优先本地 readdir（绕过内核 readDir 按路径互斥锁），否则回退带超时守卫的内核接口。
 */
export async function fetchCatalogFiles(onPhase?: ScanPhaseReporter): Promise<CatalogFilesResult> {
  onPhase?.({ stage: 'files', label: '正在读取资源文件清单...' })

  const adapter = defaultStorage.adapter as any
  if (typeof adapter.listDirEntries === 'function') {
    try {
      const files = await listDataAssetsFast('/data/assets')
      return {
        files,
        source: 'local-fs',
        dirAvailable: true,
      }
    } catch (err) {
      warn('[asset-catalog] 本地快速枚举资源目录失败，回退内核 readDir:', err)
    }
  }

  const rawFiles = await listDataAssetsRecursively('/data/assets').catch(() => null)
  if (!rawFiles || !Array.isArray(rawFiles) || rawFiles.length === 0) {
    const fallbackFiles = await readDirGuarded('/data/assets').catch(() => null)
    if (!fallbackFiles || !Array.isArray(fallbackFiles)) {
      return { files: [], source: 'kernel', dirAvailable: false }
    }
  }

  const files = (rawFiles && rawFiles.length > 0 ? rawFiles : await readDirGuarded('/data/assets').catch(() => [] as any[]))
    .filter((f: any) => !isIgnoredSystemAsset(f.name) && !f.isDir)
  return { files, source: 'kernel', dirAvailable: true }
}

export interface CatalogReferenceData {
  /** 预提取的主引用块 + PDF 标注引用条目（content 已由 markdown 摘要兜底） */
  entries: PreExtractedBlockEntry[]
  reEditBlocks: Array<{ blockId: string, rootId: string, metadata: IAssetReEditMetadata }>
  originalFiles: Array<{ name: string, path: string, size: number, updated: number }>
  sidecarMetadataList: Array<{ assetName: string, metadata: IAssetReEditMetadata }>
  avReferencesMap: Map<string, BlockRef[]>
  agentAssets: Set<string>
  canvasInventory: Awaited<ReturnType<typeof scanCanvasAssetsInventory>> | null
  notebookMap: Map<string, string>
  /**
   * 引用数据不完整（大 SQL / 属性视图 / 画布扫描超时或失败）时为 true。
   * 消费方必须把列表视为"引用未知"，禁止放开任何基于引用状态的清理操作，
   * 否则被引用资源会被误判为孤儿而遭删除。
   */
  degraded: boolean
}

/** 除"主块引用 SQL"外的全部引用支持源（均为轻量采集，增量与全量共用） */
export interface CatalogSupportData {
  reEditBlocks: Array<{ blockId: string, rootId: string, metadata: IAssetReEditMetadata }>
  originalFiles: Array<{ name: string, path: string, size: number, updated: number }>
  sidecarMetadataList: Array<{ assetName: string, metadata: IAssetReEditMetadata }>
  avReferencesMap: Map<string, BlockRef[]>
  agentAssets: Set<string>
  canvasInventory: Awaited<ReturnType<typeof scanCanvasAssetsInventory>> | null
  notebookMap: Map<string, string>
  /** 属性视图 / 画布两个关键支持源失败时为 true */
  degraded: boolean
}

/** PDF 标注索引表行 → 预提取条目（file_path 即 markdown 语义） */
function annotationRowsToEntries(rows: any[]): PreExtractedBlockEntry[] {
  return (Array.isArray(rows) ? rows : []).map((r: any) =>
    toPreExtractedEntry({ id: r.id, markdown: r.markdown || '' }),
  )
}

/** SQL 原始行 → 预提取条目（content 列已裁剪，展示文本由 markdown 摘要兜底） */
function blockRowsToEntries(rows: any[]): PreExtractedBlockEntry[] {
  return (Array.isArray(rows) ? rows : []).map((b: any) =>
    toPreExtractedEntry({
      ...b,
      content: b.content ?? markdownExcerpt(b.markdown || ''),
    }),
  )
}

/**
 * 采集支持源数据（属性视图、画布、AI 会话、二次编辑元数据、底图、PDF 标注引用）。
 * 均为轻量操作，全量扫描与增量校验共用；属性视图 / 画布任一失败置 degraded。
 * 返回值附带 annotationEntries（PDF 标注条目，交由装配阶段并入）。
 */
export interface CatalogSupportDataWithAnnotations extends CatalogSupportData {
  annotationEntries: PreExtractedBlockEntry[]
}

export async function fetchCatalogSupportData(): Promise<CatalogSupportDataWithAnnotations> {
  let degraded = false
  let avReferencesMap = new Map<string, BlockRef[]>()
  let canvasInventory: Awaited<ReturnType<typeof scanCanvasAssetsInventory>> | null = null
  const notebookMap = await getNotebookMap().catch(() => new Map<string, string>())
  const [annotationRefRows, reEditBlocks, originalFiles, sidecarMetadataList, agentAssets] = await Promise.all([
    sql(`SELECT block_id as id, file_path as markdown FROM file_annotation_refs LIMIT 100000`).catch(() => []),
    queryAllReEditableBlocks().catch(() => []),
    listOriginalImages().catch(() => []),
    listAllAssetMetadataFiles().catch(() => []),
    scanAgentSessionAssets().catch(() => new Set<string>()),
    resolveAttributeViewReferences(notebookMap)
      .then((m) => {
        avReferencesMap = m
      })
      .catch((err) => {
        warn('[asset-catalog] 属性视图引用解析失败，本轮引用数据标记为降级:', err)
        degraded = true
      }),
    scanCanvasAssetsInventory()
      .then((inv) => {
        canvasInventory = inv
      })
      .catch((err) => {
        warn('[asset-catalog] 画布资源扫描失败，本轮引用数据标记为降级:', err)
        degraded = true
      }),
  ]) as [any[], any[], any[], any[], Set<string>, void, void]

  // 自动平滑向后迁移：将存在于块 IAL 但尚未落盘 Sidecar 的元数据自动持久化到 Sidecar
  if (reEditBlocks && reEditBlocks.length > 0) {
    const existingSidecarNames = new Set(sidecarMetadataList.map((s) => s.assetName))
    for (const item of reEditBlocks) {
      const assetName = item.metadata.renderedAssetName
      if (assetName && !existingSidecarNames.has(assetName)) {
        try {
          await saveAssetMetadataFile(assetName, item.metadata)
          existingSidecarNames.add(assetName)
          sidecarMetadataList.push({
            assetName,
            metadata: item.metadata,
          })
          log(`[asset-catalog] 成功将块 ${item.blockId} 中的历史二次编辑元数据迁移至 Sidecar: ${assetName}.json`)
        } catch (migErr) {
          warn(`[asset-catalog] 迁移块 ${item.blockId} 元数据至 Sidecar 失败:`, migErr)
        }
      }
    }
  }

  return {
    reEditBlocks,
    originalFiles,
    sidecarMetadataList,
    avReferencesMap,
    agentAssets,
    canvasInventory,
    notebookMap,
    degraded,
    annotationEntries: annotationRowsToEntries(annotationRefRows),
  }
}

/**
 * 全量采集主引用块（大 SQL，带超时守卫）并预提取为条目。
 * 说明：主查询刻意不取 content 列 —— content 与 markdown 高度重复，裁掉后大库上
 * 传输体积近乎减半（实测 79MB → 约 50MB），展示文本由 markdownExcerpt 兜底。
 */
export async function fetchAllReferencingBlockEntries(): Promise<{ entries: PreExtractedBlockEntry[], degraded: boolean }> {
  let degraded = false
  let rows: any[] = []
  try {
    const result = await sqlGuarded(`SELECT id, root_id, box, markdown, path, hpath, ial FROM blocks WHERE markdown LIKE '%assets/%' OR ial LIKE '%assets/%' LIMIT 1000000`)
    if (result === null) {
      degraded = true
    } else {
      rows = result
    }
  } catch (err) {
    warn('[asset-catalog] 引用主 SQL 查询失败，本轮引用数据标记为降级:', err)
    degraded = true
  }
  return { entries: blockRowsToEntries(rows), degraded }
}

/**
 * 阶段二：采集全部引用关系数据（SQL 块引用、属性视图、画布、AI 会话、二次编辑元数据、底图）。
 * 与阶段一并行启动时可让内核 SQL 在首屏渲染期间后台执行。
 */
export async function fetchCatalogReferenceData(onPhase?: ScanPhaseReporter): Promise<CatalogReferenceData> {
  onPhase?.({ stage: 'refs', label: '正在查询文档引用关系（大工作空间约需数分钟）...' })

  const [support, blockResult] = await Promise.all([
    fetchCatalogSupportData(),
    fetchAllReferencingBlockEntries(),
  ])

  return {
    entries: [...blockResult.entries, ...support.annotationEntries],
    reEditBlocks: support.reEditBlocks,
    originalFiles: support.originalFiles,
    sidecarMetadataList: support.sidecarMetadataList,
    avReferencesMap: support.avReferencesMap,
    agentAssets: support.agentAssets,
    canvasInventory: support.canvasInventory,
    notebookMap: support.notebookMap,
    degraded: support.degraded || blockResult.degraded,
  }
}

// **************************************** 增量校验 ****************************************

export interface CatalogBlockDelta {
  /** 新增或内容变化的块条目（已重新提取，直接替换旧条目） */
  upserted: PreExtractedBlockEntry[]
  /** 已消失的块 ID（含被编辑为不再引用任何资源的块） */
  removedIds: string[]
}

/** 存在性核查的单批 ID 数量（字符串内插，ID 均为内核生成的安全字符集） */
const EXISTENCE_CHECK_CHUNK = 900

/**
 * 增量块引用校验：三路查询补齐上次扫描后的全部引用增删。
 *
 * 1) `updated >= 水位线`（不带 LIKE）：抓回所有近期变更块的完整行——
 *    无论引用是新增还是被删掉，块 updated 都会变化，因此增删两个方向都完备；
 * 2) `ial LIKE '%assets/%'` 全量（结果集小）：思源内核 setBlockAttrs 不更新 updated
 *    （见 kernel/model/blockial.go），属性携带的引用（文档题头图等）只有这条路能抓到；
 *    该查询幂等，未变化的块重提取后替换旧条目无副作用；
 * 3) 快照内全部引用块 ID 的存在性核查（PK 索引分片查询）：块删除不留 updated 痕迹。
 *
 * 查询 1/2 内核侧仍是全表扫描（blocks 无 updated 索引），但结果集从 10 万行降到
 * 近期变更量级，序列化/传输/解析成本近乎归零。
 */
export async function fetchCatalogBlockDelta(
  snapshotEntries: Map<string, PreExtractedBlockEntry>,
  watermark: string,
): Promise<CatalogBlockDelta> {
  const changedById = new Map<string, any>()

  const [updatedRows, ialRows] = await Promise.all([
    sqlGuarded(`SELECT id, root_id, box, markdown, path, hpath, ial FROM blocks WHERE updated >= '${watermark}' LIMIT 1000000`),
    sqlGuarded(`SELECT id, root_id, box, markdown, path, hpath, ial FROM blocks WHERE ial LIKE '%assets/%' LIMIT 1000000`),
  ])

  for (const row of Array.isArray(updatedRows) ? updatedRows : []) {
    if (row && row.id) changedById.set(String(row.id), row)
  }
  for (const row of Array.isArray(ialRows) ? ialRows : []) {
    if (row && row.id) changedById.set(String(row.id), row)
  }

  const upserted: PreExtractedBlockEntry[] = []
  const removedIdSet = new Set<string>()
  for (const row of changedById.values()) {
    const entry = toPreExtractedEntry({
      ...row,
      content: row.content ?? markdownExcerpt(row.markdown || ''),
    })
    if (entry.rawAssetNames.length === 0) {
      // 块已不再引用任何资源：从条目集中移除其历史贡献
      removedIdSet.add(entry.id)
    } else {
      upserted.push(entry)
    }
  }

  // 存在性核查：仅快照中已有的条目需要检查（upserted 刚刚查到必然存在）
  const idsToCheck = Array.from(snapshotEntries.keys())
  const found = new Set<string>()
  const chunks: string[][] = []
  for (let i = 0; i < idsToCheck.length; i += EXISTENCE_CHECK_CHUNK) {
    chunks.push(idsToCheck.slice(i, i + EXISTENCE_CHECK_CHUNK))
  }
  await mapWithConcurrency(chunks, 4, async (chunk) => {
    const quoted = chunk.map((id) => `'${id}'`).join(',')
    const rows = await sqlGuarded(`SELECT id FROM blocks WHERE id IN (${quoted})`)
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row && row.id) found.add(String(row.id))
    }
  })
  for (const id of idsToCheck) {
    if (!found.has(id)) removedIdSet.add(id)
  }

  return { upserted, removedIds: Array.from(removedIdSet) }
}

/**
 * 将增量差异应用到条目集（就地修改并返回同一 Map）
 */
export function applyCatalogBlockDelta(
  entries: Map<string, PreExtractedBlockEntry>,
  delta: CatalogBlockDelta,
): Map<string, PreExtractedBlockEntry> {
  for (const id of delta.removedIds) {
    entries.delete(id)
  }
  for (const entry of delta.upserted) {
    entries.set(entry.id, entry)
  }
  return entries
}

/** 引用阶段尚未开始/失败时的空引用数据（阶段一先行渲染用） */
export function emptyReferenceData(): CatalogReferenceData {
  return {
    entries: [],
    reEditBlocks: [],
    originalFiles: [],
    sidecarMetadataList: [],
    avReferencesMap: new Map(),
    agentAssets: new Set(),
    canvasInventory: null,
    notebookMap: new Map(),
    degraded: false,
  }
}

/** 纯装配：文件清单 + 引用数据 → 完整库存模型 */
export function resolveCatalogInventory(
  files: CatalogFilesResult['files'],
  refData: CatalogReferenceData,
  onPhase?: ScanPhaseReporter,
): CatalogInventory {
  onPhase?.({ stage: 'resolve', label: '正在构建资源关联表...' })
  return resolveCatalogPipelineFromEntries(
    files,
    refData.entries,
    refData.reEditBlocks,
    refData.originalFiles,
    refData.notebookMap,
    refData.sidecarMetadataList,
    refData.avReferencesMap,
    refData.agentAssets,
    [],
    refData.canvasInventory?.globalAssetRefs,
    refData.canvasInventory?.canvasAssets,
  )
}

/** 纯装配（支持源分离版）：文件清单 + 条目集 + 支持源 → 完整库存模型（增量校验用） */
export function resolveCatalogInventoryFromSources(
  files: CatalogFilesResult['files'],
  entries: PreExtractedBlockEntry[],
  support: CatalogSupportData,
): CatalogInventory {
  return resolveCatalogPipelineFromEntries(
    files,
    [...entries, ...(support as CatalogSupportDataWithAnnotations).annotationEntries],
    support.reEditBlocks,
    support.originalFiles,
    support.notebookMap,
    support.sidecarMetadataList,
    support.avReferencesMap,
    support.agentAssets,
    [],
    support.canvasInventory?.globalAssetRefs,
    support.canvasInventory?.canvasAssets,
  )
}

// **************************************** 库存缓存 ****************************************

/** 缓存有效期：覆盖"重开标签页/刷新插件"等短间隔重复加载；所有写入路径会显式失效 */
export const CATALOG_CACHE_TTL_MS = 90_000

let catalogCache: { at: number, inventory: CatalogInventory } | null = null

export function getCachedCatalogInventory(): CatalogInventory | null {
  if (!catalogCache) return null
  if (Date.now() - catalogCache.at > CATALOG_CACHE_TTL_MS) {
    catalogCache = null
    return null
  }
  return catalogCache.inventory
}

export function setCachedCatalogInventory(inventory: CatalogInventory): void {
  catalogCache = { at: Date.now(), inventory }
}

/** 任何资源写入（删除/重命名/编辑/去重合并）后必须调用，避免读到脏缓存 */
export function invalidateCatalogCache(): void {
  catalogCache = null
}

// **************************************** 渲染后 stat 补全 ****************************************

export interface StatFillHooks {
  onProgress?: (done: number, total: number) => void
  /** 每累计 batchSize 次有效更新回调一次，供 UI 分批刷新列表 */
  onBatch?: (updatedCount: number) => void
}

export interface StatFillResult {
  /** 成功补全 size/updated 的资源数 */
  updated: number
  /** true 表示环境不支持远程 stat（HTTP HEAD 404），已整体跳过避免数万次无效请求 */
  skipped: boolean
}

/**
 * 后台并发补全缺失的 size/updated。
 *
 * - 桌面端：adapter.statAsync（fs.promises.stat）+ 并发池，既不冻结渲染进程又能
 *   用并发掩盖单次 stat 的过滤驱动延迟（实测串行 98k 次约 8 分钟，并发 32 可压到分钟内）。
 * - 浏览器端：HEAD 探测一次，若内核 /assets/* 不支持 HEAD（GET-only 路由返回 404）
 *   则整体跳过——此前会白发 9.8 万次 404 请求，耗时一分钟且 size 依旧为 0。
 */
export async function fillMissingAssetStats(
  assets: AssetInfo[],
  hooks: StatFillHooks = {},
  concurrency: number = 32,
): Promise<StatFillResult> {
  const targets = assets.filter((a) => !a.isOriginal && !a.isMissing && (a.size === 0 || !a.updated))
  if (targets.length === 0) {
    return { updated: 0, skipped: false }
  }

  // 体积大头优先：视频/音频/文档/压缩包等非图片资源数量极少（通常几百个）但
  // 占据绝大部分体积，先补全它们能让分类体积统计在数秒内逼近真值；
  // 数万张图片随后批量补齐。Array.sort 稳定，组内保持原序。
  targets.sort((a, b) => {
    const aIsBulk = isImageAsset(a.name) ? 1 : 0
    const bIsBulk = isImageAsset(b.name) ? 1 : 0
    return aIsBulk - bIsBulk
  })

  const adapter = defaultStorage.adapter as any
  const statOne = async (asset: AssetInfo) => {
    const path = asset.isCanvasAsset && asset.canvasAssetStoragePath
      ? asset.canvasAssetStoragePath
      : `/data/assets/${asset.name}`
    if (typeof adapter.statAsync === 'function') {
      return adapter.statAsync(path)
    }
    return defaultStorage.statAsset(asset.name)
  }

  // HTTP 模式探测：HEAD 是否被内核支持
  if (typeof adapter.statAsync !== 'function') {
    const probe = await defaultStorage.statAsset(targets[0].name).catch(() => null)
    if (!probe) {
      warn(`[asset-catalog] 当前环境 stat 不可用（HEAD 未支持），跳过 ${targets.length} 个资源的 size 补全`)
      return { updated: 0, skipped: true }
    }
  }

  let updated = 0
  const BATCH_SIZE = 400
  await mapWithConcurrency(targets, concurrency, async (asset) => {
    try {
      const st = await statOne(asset)
      if (st) {
        let changed = false
        if (asset.size === 0 && st.size > 0) {
          asset.size = st.size
          changed = true
        }
        if (!asset.updated && st.updated) {
          asset.updated = asset.isCanvasAsset
            ? resolveCanvasAssetTimestamp(asset.name, st.updated)
            : st.updated
          changed = true
        }
        if (changed) {
          updated++
          if (updated % BATCH_SIZE === 0) {
            hooks.onBatch?.(updated)
          }
        }
      }
    } catch (e) {}
  }, {
    onProgress: hooks.onProgress,
    onError: (err) => warn('[asset-catalog] 后台补全 stat 失败:', err),
  })

  hooks.onBatch?.(updated)
  return { updated, skipped: false }
}

/**
 * 将上一轮已补全的 size/updated 合并进新装配的库存（阶段二替换列表时保留后台填充成果）
 */
export function mergeAssetStatsInto(inventory: CatalogInventory, prevAssets: Iterable<AssetInfo>): void {
  const prevByName = new Map<string, AssetInfo>()
  for (const a of prevAssets) {
    if (!prevByName.has(a.name)) prevByName.set(a.name, a)
  }
  for (const asset of inventory.allAssets) {
    const prev = prevByName.get(asset.name)
    if (!prev) continue
    if ((!asset.size || asset.size === 0) && prev.size > 0) asset.size = prev.size
    if (!asset.updated && prev.updated) asset.updated = prev.updated
  }
}
