import type { IAssetReEditMetadata } from '../types/reedit'
import type { AssetInfo, BlockRef, OrphanOriginalInfo } from './asset-model'
import { t } from '@/i18n'
import type { scanCanvasAssetsInventory } from './canvas-asset'
import {
  attachAttributeViewReferences,
  attachPreExtractedReferences,
  attachReEditMetadata,
  createAssetInfoMap,
  SYSTEM_PROTECTED_ASSETS,
  toPreExtractedEntry,
  updateAssetDocCounts,
  type PreExtractedBlockEntry,
} from './asset-model'
import { normalizeOriginalStoragePath } from './storage'

/**
 * 目录库存纯装配层（从 asset-catalog.ts 分层抽出）。
 *
 * 本模块零 I/O：不发起 SQL / 文件读写，只负责把调用方采集好的
 * 物理文件清单、块引用条目、二次编辑元数据、隔离底图、属性视图引用、
 * 画布引用与 AI 会话资产融合成一致的 CatalogInventory 模型图。
 * 两阶段扫描编排与增量校验仍居 asset-catalog.ts（门面保持 100% 接口兼容）。
 */

// **************************************** 扫描契约类型 ****************************************

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

/**
 * 采集支持源数据（属性视图、画布、AI 会话、二次编辑元数据、底图、PDF 标注引用）。
 * 均为轻量操作，全量扫描与增量校验共用；属性视图 / 画布任一失败置 degraded。
 * 返回值附带 annotationEntries（PDF 标注条目，交由装配阶段并入）。
 */
export interface CatalogSupportDataWithAnnotations extends CatalogSupportData {
  annotationEntries: PreExtractedBlockEntry[]
}

// **************************************** 装配模型 ****************************************

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

/** 2.1/2.2/2.3 三段同构循环的公共尾部：将渲染资产的引用去重合并进底图引用表 */
function mergeRenderedAssetRefs(
  originalToRefsMap: Map<string, BlockRef[]>,
  normPath: string,
  renderedRefs: BlockRef[],
): void {
  let refs = originalToRefsMap.get(normPath)
  if (!refs) {
    refs = []
    originalToRefsMap.set(normPath, refs)
  }
  for (const ref of renderedRefs) {
    if (!refs.some((r) => r.id === ref.id)) {
      refs.push(ref)
    }
  }
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
            content: t('catalog.avFallbackRefContent'),
            markdown: '',
            path: '',
            readablePath: t('catalog.avFallbackReadablePath'),
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
          content: t('catalog.aiAgentRefContent'),
          markdown: '',
          path: '',
          readablePath: t('catalog.aiAgentReadablePath'),
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

      mergeRenderedAssetRefs(originalToRefsMap, normPath, renderedAsset.references)
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

    mergeRenderedAssetRefs(originalToRefsMap, normPath, renderedAsset.references)
  }

  // 2.3 补充遍历 assetsMap 中具备 originalStoragePath 的资产（双向保障）
  for (const asset of assetsMap.values()) {
    if (!asset.originalStoragePath || !asset.references || asset.references.length === 0) {
      continue
    }
    const normPath = normalizeOriginalStoragePath(asset.originalStoragePath)
    if (!normPath) continue

    mergeRenderedAssetRefs(originalToRefsMap, normPath, asset.references)
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
  onPhase?.({ stage: 'resolve', label: t('catalog.phaseResolve') })
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
