import { t } from '@/i18n'
import type {
  DeleteDestination,
  IDeletedItemRecord,
} from './deletion-logger'
import type { AssetInfo } from './siyuan-db'
import {
  pushMsg,
  sql,
} from '../api'
import { isImageAsset } from './asset-list'
import { deleteCanvasAssetFile } from './canvas-asset'
import {


  recordDeletionBatch,
} from './deletion-logger'
import {
  deleteOriginalImage,
  isTrashSupported,
  readOriginalImage,
} from './file-system'
import { captureAssetThumbnail } from './image-editor'
import { error } from './logger'
import {
  captureBlockAnchors,
  createChildBlocksCache,
} from './rollback-anchor'
import { batchQueryAssetsReferenceCounts, captureAssetAttrSnapshots, removeAssetFromBlocks } from './siyuan-block'
import {

  deleteAssetFile,
  isCanvasRef,
} from './siyuan-db'
import { captureAttributeViewAssetCells } from './attribute-view'
import { listAllAssetMetadataFiles } from './file-system'
import { normalizeOriginalStoragePath } from './storage'

export interface IConfirmDialogOptions {
  title: string
  message: string
  confirmText: string
  danger: boolean
}

export interface IBatchDeleteSummary {
  totalCount: number
  regularCount: number
  originalCount: number
  missingCount?: number
  sizeText: string
  referencedCount: number
  referencedOriginalsCount: number
  regularAssets: AssetInfo[]
  originalAssets: AssetInfo[]
  missingAssets?: AssetInfo[]
}

export interface ICleanupSummary {
  totalCount: number
  unreferencedCount: number
  unreferencedSizeText: string
  orphanOriginalsCount: number
  orphanOriginalsSizeText: string
  sizeText: string
  unreferencedAssets: AssetInfo[]
  /** 孤立底图条目：来自资产装配时为 AssetInfo，来自孤儿扫描时含 path 字段 */
  orphanOriginals: Array<AssetInfo & { path?: string }>
}

export interface ISingleDeleteResult {
  success: boolean
  freedBytes: number
  error?: unknown
}

export interface IBatchDeleteResult {
  success: boolean
  deletedRegularCount: number
  deletedOriginalCount: number
  deletedMissingCount?: number
  freedBytes: number
  error?: unknown
}

export interface IUnifiedCleanupResult {
  success: boolean
  deletedAssetsCount: number
  deletedOriginalsCount: number
  freedBytes: number
  /** 实时复核发现已重新获得引用而被安全跳过的候选数 */
  skippedRecentlyReferenced?: number
  error?: unknown
}

/**
 * 构造单个资源（普通文件、原始底图或丢失资源）删除前的确认弹窗配置
 */
export function buildSingleDeleteConfirmMessage(asset: AssetInfo): IConfirmDialogOptions {
  if (asset.isMissing) {
    const refCount = asset.references?.length || asset.refCount || 0
    let confirmMsg = t('cleanup.missingResourceConfirm', {
      n: refCount,
      name: asset.name,
      refCount,
    })
    // 画布引用无法自动清理，必须如实告知清理后条目仍会出现
    const canvasRefCount = (asset.references || []).filter((r) => isCanvasRef(r)).length
    if (canvasRefCount > 0) {
      confirmMsg += '\n\n' + t('cleanup.missingCanvasRefWarn', { n: canvasRefCount })
    }
    if (asset.docCount > 1) {
      confirmMsg = t('cleanup.missingMultiDocWarning', {
        docCount: asset.docCount,
        message: confirmMsg,
      })
    }

    return {
      title: t('cleanup.missingConfirmTitle'),
      message: confirmMsg,
      confirmText: t('cleanup.missingConfirmText'),
      danger: true,
    }
  }

  if (asset.isOriginal) {
    let confirmMsg = t('cleanup.originalConfirmBase', {
      name: asset.name,
      trashHint: isTrashSupported() ? t('cleanup.trashHint') : t('cleanup.noTrashOriginalWarning'),
    })
    if (asset.docCount > 0) {
      confirmMsg = t('cleanup.originalReferencedConfirm', {
        n: asset.docCount,
        name: asset.name,
        trashHint: isTrashSupported() ? t('cleanup.originalTrashHint') : t('cleanup.originalNoTrashHint'),
      })
    }

    return {
      title: t('cleanup.originalConfirmTitle'),
      message: confirmMsg,
      confirmText: t('cleanup.originalConfirmText'),
      danger: true,
    }
  }

  if (asset.isCanvasAsset) {
    let confirmMsg = t('cleanup.canvasConfirmBase', {
      name: asset.name,
      trashHint: isTrashSupported() ? t('cleanup.trashHint') : t('cleanup.noTrashCanvasWarning'),
    })
    if (asset.docCount > 0) {
      const canvasTitle = asset.canvasPath ? asset.canvasPath.split('/').pop() : t('cleanup.untitledCanvas')
      confirmMsg = t('cleanup.canvasReferencedWarning', {
        canvasTitle,
        message: confirmMsg,
      })
    }

    return {
      title: t('cleanup.canvasConfirmTitle'),
      message: confirmMsg,
      confirmText: t('cleanup.canvasConfirmText'),
      danger: true,
    }
  }

  let confirmMsg = isTrashSupported()
    ? t('cleanup.plainConfirmTrash', { name: asset.name })
    : t('cleanup.plainConfirmNoTrash', { name: asset.name })

  if (asset.docCount > 1) {
    confirmMsg = t('cleanup.plainMultiDocWarning', {
      docCount: asset.docCount,
      message: confirmMsg,
    })
  }

  return {
    title: t('cleanup.plainConfirmTitle'),
    message: confirmMsg,
    confirmText: t('common.delete'),
    danger: true,
  }
}

/**
 * 构造批量删除确认弹窗配置
 */
export function buildBatchDeleteConfirmMessage(summary: IBatchDeleteSummary): IConfirmDialogOptions {
  const messageLines = [
    t('cleanup.batchIntroLine', { n: summary.totalCount }),
    '',
    t('cleanup.batchListHeader'),
    t('cleanup.batchLineRegular', { n: summary.regularCount }),
    t('cleanup.batchLineOriginal', { n: summary.originalCount }),
  ]

  if (summary.missingCount && summary.missingCount > 0) {
    messageLines.push(t('cleanup.batchLineMissing', { n: summary.missingCount }))
    // 画布引用无法自动清理，必须如实告知清理后条目仍会出现
    const canvasRefCount = (summary.missingAssets || []).reduce(
      (sum, a) => sum + (a.references || []).filter((r) => isCanvasRef(r)).length,
      0,
    )
    if (canvasRefCount > 0) {
      messageLines.push('')
      messageLines.push(t('cleanup.missingCanvasRefWarn', { n: canvasRefCount }))
    }
  }

  messageLines.push(t('cleanup.lineSizeEstimate', { sizeText: summary.sizeText }))

  if (summary.referencedCount > 0) {
    messageLines.push('')
    messageLines.push(t('cleanup.batchReferencedNotice', { n: summary.referencedCount }))
  }

  if (summary.referencedOriginalsCount > 0) {
    messageLines.push('')
    messageLines.push(t('cleanup.batchReferencedOriginalsNotice', { n: summary.referencedOriginalsCount }))
  }

  messageLines.push('')
  if (isTrashSupported()) {
    messageLines.push(t('cleanup.batchTrashLine'))
  } else {
    messageLines.push(t('cleanup.batchNoTrashLine'))
  }

  return {
    title: t('cleanup.batchConfirmTitle', { n: summary.totalCount }),
    message: messageLines.join('\n'),
    confirmText: t('cleanup.batchConfirmText'),
    danger: true,
  }
}

/**
 * 构造综合清理未引用孤儿资源与孤立底图的确认弹窗配置
 */
export function buildUnifiedCleanupConfirmMessage(summary: ICleanupSummary): IConfirmDialogOptions {
  const messageLines = [
    isTrashSupported()
      ? t('cleanup.unifiedTrashIntro')
      : t('cleanup.unifiedNoTrashIntro'),
    '',
    t('cleanup.unifiedListHeader'),
    t('cleanup.unifiedLineUnreferenced', { n: summary.unreferencedCount, sizeText: summary.unreferencedSizeText }),
    t('cleanup.unifiedLineOrphanOriginals', { n: summary.orphanOriginalsCount, sizeText: summary.orphanOriginalsSizeText }),
    t('cleanup.lineSizeEstimate', { sizeText: summary.sizeText }),
    '',
    isTrashSupported()
      ? t('cleanup.unifiedTrashConfirmLine')
      : t('cleanup.unifiedNoTrashConfirmLine'),
  ]

  return {
    title: t('cleanup.unifiedConfirmTitle'),
    message: messageLines.join('\n'),
    confirmText: t('cleanup.unifiedConfirmText'),
    danger: true,
  }
}

/**
 * 执行单个资源删除（普通文件或原始底图）
 */
export async function executeSingleAssetDeletion(
  asset: AssetInfo,
  options?: { showMessage?: (msg: string) => void },
): Promise<ISingleDeleteResult> {
  const notify = options?.showMessage || pushMsg

  if (asset.isOriginal) {
    try {
      let thumbnail: string | undefined
      try {
        const blob = await readOriginalImage(asset.originalStoragePath || asset.name)
        if (blob) {
          thumbnail = await captureAssetThumbnail(blob)
        }
      } catch {}

      await deleteOriginalImage(asset.originalStoragePath || asset.name)
      notify(t('cleanup.originalDeletedNotify', { name: asset.name }))

      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent'
      try {
        await recordDeletionBatch({
          actionType: 'single-delete',
          destination,
          items: [{
            fileName: asset.name,
            originalRelativePath: asset.originalStoragePath || asset.name,
            size: asset.size || 0,
            thumbnail,
          }],
          freedBytes: asset.size || 0,
          canRollback: false,
        })
      } catch (logErr) {
        error('[cleanup-workflow] 记录删除原始底图批次失败:', logErr)
      }

      return {
        success: true,
        freedBytes: asset.size || 0,
      }
    } catch (e) {
      error('[cleanup-workflow] 删除原始底图失败:', e)
      notify(t('cleanup.deleteOriginalFailedNotify'))
      return {
        success: false,
        freedBytes: 0,
        error: e,
      }
    }
  }

  try {
    let thumbnail: string | undefined
    if (isImageAsset(asset.name)) {
      try {
        thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`)
      } catch {}
    }

    const snippets: Record<string, string> = {}
    const blocksToCapture: Array<{ id: string, root_id?: string, parent_id?: string }> = []

    if (asset.references && asset.references.length > 0) {
      for (const ref of asset.references) {
        if (!ref.id) continue
        try {
          const rows = await sql(`SELECT id, parent_id, root_id, markdown FROM blocks WHERE id = '${ref.id}'`)
          if (rows && rows.length > 0) {
            const row = rows[0]
            if (row.markdown) {
              snippets[ref.id] = row.markdown
            }
            blocksToCapture.push({
              id: ref.id,
              root_id: row.root_id || ref.root_id,
              parent_id: row.parent_id,
            })
          } else {
            blocksToCapture.push({
              id: ref.id,
              root_id: ref.root_id,
            })
          }
        } catch {
          blocksToCapture.push({
            id: ref.id,
            root_id: ref.root_id,
          })
        }
      }
    }

    const affectedBlockRecords = await captureBlockAnchors(blocksToCapture, createChildBlocksCache())

    // 删除前快照：块属性（IAL）与数据库单元格中的引用也会被清理，必须可回退
    const ialSnapshots = asset.isCanvasAsset
      ? {}
      : await captureAssetAttrSnapshots(asset.references || [], asset.name)
    const affectedViewCells = asset.isCanvasAsset
      ? new Map<string, []>()
      : await captureAttributeViewAssetCells([asset.name])

    if (asset.isCanvasAsset) {
      await deleteCanvasAssetFile(asset, isTrashSupported())
    } else if (!asset.isMissing) {
      await deleteAssetFile(asset.name)
    }

    if (asset.references && asset.references.length > 0 && !asset.isCanvasAsset) {
      await removeAssetFromBlocks(asset.references, asset.name)
    }

    notify(
      asset.isMissing
        ? t('cleanup.missingRefsClearedNotify', { name: asset.name })
        : asset.isCanvasAsset
          ? t('cleanup.canvasDeletedNotify', { name: asset.name })
          : t('cleanup.assetRefsDeletedNotify', { name: asset.name }),
    )

    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent'
    const hasRefs = Boolean(asset.references && asset.references.length > 0 && !asset.isCanvasAsset)
    const itemIalSnapshots = Object.keys(ialSnapshots).length > 0 ? ialSnapshots : undefined
    const itemAffectedViews = affectedViewCells.get(asset.name) || []
    try {
      await recordDeletionBatch({
        actionType: 'single-delete',
        destination,
        items: [{
          fileName: asset.name,
          originalRelativePath: asset.isCanvasAsset ? (asset.canvasAssetStoragePath || asset.name) : (asset.isOriginal ? (asset.originalStoragePath || asset.name) : `data/assets/${asset.name}`),
          size: asset.size || 0,
          thumbnail,
          affectedBlocks: affectedBlockRecords.length > 0
            ? affectedBlockRecords
            : (asset.references || []).map((r) => ({
                id: r.id,
                root_id: r.root_id,
              })),
          originalMarkdownSnippets: Object.keys(snippets).length > 0 ? snippets : undefined,
          originalIalSnapshots: itemIalSnapshots,
          affectedViews: itemAffectedViews.length > 0 ? itemAffectedViews : undefined,
        }],
        freedBytes: asset.size || 0,
        canRollback: hasRefs,
      })
    } catch (logErr) {
      error('[cleanup-workflow] 记录单文件删除批次失败:', logErr)
    }

    return {
      success: true,
      freedBytes: asset.size || 0,
    }
  } catch (e) {
    error('[cleanup-workflow] 删除资源失败:', e)
    notify(t('cleanup.deleteFailedNotify'))
    return {
      success: false,
      freedBytes: 0,
      error: e,
    }
  }
}

/**
 * 执行多选批量删除
 */
export async function executeBatchAssetsDeletion(
  summary: IBatchDeleteSummary,
  options?: { showMessage?: (msg: string) => void },
): Promise<IBatchDeleteResult> {
  const notify = options?.showMessage || pushMsg
  let deletedRegularCount = 0
  let deletedOriginalCount = 0
  let deletedMissingCount = 0
  let freedBytes = 0
  const deletedRecords: IDeletedItemRecord[] = []

  let hasAnyRollbackableRefs = false
  const anchorCache = createChildBlocksCache()

  try {
    // 1. 删除普通资源与丢失资源及其文档引用
    const assetsToProcess = Array.from(new Set([...summary.regularAssets, ...(summary.missingAssets || [])]))
    for (const asset of assetsToProcess) {
      try {
        let thumbnail: string | undefined
        if (!asset.isMissing && isImageAsset(asset.name)) {
          try {
            thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`)
          } catch {}
        }

        const snippets: Record<string, string> = {}
        const blocksToCapture: Array<{ id: string, root_id?: string, parent_id?: string }> = []

        if (asset.references && asset.references.length > 0) {
          hasAnyRollbackableRefs = true
          for (const ref of asset.references) {
            if (!ref.id) continue
            try {
              const rows = await sql(`SELECT id, parent_id, root_id, markdown FROM blocks WHERE id = '${ref.id}'`)
              if (rows && rows.length > 0) {
                const row = rows[0]
                if (row.markdown) {
                  snippets[ref.id] = row.markdown
                }
                blocksToCapture.push({
                  id: ref.id,
                  root_id: row.root_id || ref.root_id,
                  parent_id: row.parent_id,
                })
              } else {
                blocksToCapture.push({
                  id: ref.id,
                  root_id: ref.root_id,
                })
              }
            } catch {
              blocksToCapture.push({
                id: ref.id,
                root_id: ref.root_id,
              })
            }
          }
        }

        const affectedBlockRecords = await captureBlockAnchors(blocksToCapture, anchorCache)

        // 删除前快照：块属性（IAL）与数据库单元格中的引用也会被清理，必须可回退
        const ialSnapshots = asset.isCanvasAsset
          ? {}
          : await captureAssetAttrSnapshots(asset.references || [], asset.name)
        const affectedViewCells = asset.isCanvasAsset
          ? new Map<string, []>()
          : await captureAttributeViewAssetCells([asset.name])

        if (asset.isCanvasAsset) {
          await deleteCanvasAssetFile(asset, isTrashSupported())
        } else if (!asset.isMissing) {
          await deleteAssetFile(asset.name)
        }
        if (asset.references && asset.references.length > 0 && !asset.isCanvasAsset) {
          await removeAssetFromBlocks(asset.references, asset.name)
        }
        if (asset.isMissing) {
          deletedMissingCount++
        } else {
          deletedRegularCount++
          freedBytes += asset.size || 0
        }
        const itemIalSnapshots = Object.keys(ialSnapshots).length > 0 ? ialSnapshots : undefined
        const itemAffectedViews = affectedViewCells.get(asset.name) || []
        deletedRecords.push({
          fileName: asset.name,
          originalRelativePath: asset.isCanvasAsset ? (asset.canvasAssetStoragePath || asset.name) : `data/assets/${asset.name}`,
          size: asset.size || 0,
          thumbnail,
          affectedBlocks: affectedBlockRecords.length > 0
            ? affectedBlockRecords
            : (asset.references || []).map((r) => ({
                id: r.id,
                root_id: r.root_id,
              })),
          originalMarkdownSnippets: Object.keys(snippets).length > 0 ? snippets : undefined,
          originalIalSnapshots: itemIalSnapshots,
          affectedViews: itemAffectedViews.length > 0 ? itemAffectedViews : undefined,
        })
      } catch (err) {
        error(`[cleanup-workflow] 批量删除普通资源失败: ${asset.name}`, err)
      }
    }

    // 2. 删除原始底图
    for (const orig of summary.originalAssets) {
      try {
        let thumbnail: string | undefined
        try {
          const blob = await readOriginalImage(orig.originalStoragePath || orig.name)
          if (blob) {
            thumbnail = await captureAssetThumbnail(blob)
          }
        } catch {}

        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name)
        if (ok) {
          deletedOriginalCount++
          freedBytes += orig.size || 0
          deletedRecords.push({
            fileName: orig.name,
            originalRelativePath: orig.originalStoragePath || orig.name,
            size: orig.size || 0,
            thumbnail,
          })
        }
      } catch (err) {
        error(`[cleanup-workflow] 批量删除原始底图失败: ${orig.name}`, err)
      }
    }

    if (deletedRecords.length > 0) {
      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent'
      try {
        await recordDeletionBatch({
          actionType: 'batch-delete',
          destination,
          items: deletedRecords,
          freedBytes,
          canRollback: hasAnyRollbackableRefs,
        })
      } catch (logErr) {
        error('[cleanup-workflow] 记录批量删除批次失败:', logErr)
      }
    }

    const parts: string[] = []
    if (deletedRegularCount > 0) parts.push(t('cleanup.countRegularPart', { n: deletedRegularCount }))
    if (deletedOriginalCount > 0) parts.push(t('cleanup.countOriginalPart', { n: deletedOriginalCount }))
    if (deletedMissingCount > 0) parts.push(t('cleanup.countMissingPart', { n: deletedMissingCount }))
    const countText = parts.length > 0 ? parts.join(t('cleanup.countListSeparator')) : t('cleanup.zeroItemsText')
    notify(t('cleanup.batchDeleteDoneNotify', { countText, sizeText: summary.sizeText }))
    return {
      success: true,
      deletedRegularCount,
      deletedOriginalCount,
      deletedMissingCount,
      freedBytes,
    }
  } catch (e) {
    error('[cleanup-workflow] 批量删除异常:', e)
    notify(t('cleanup.batchDeleteFailedNotify'))
    return {
      success: false,
      deletedRegularCount,
      deletedOriginalCount,
      freedBytes,
      error: e,
    }
  }
}

/**
 * 统一综合清理：清理未引用的孤儿资源与孤立底图
 */
export async function executeUnifiedCleanup(
  summary: ICleanupSummary,
  options?: { showMessage?: (msg: string) => void },
): Promise<IUnifiedCleanupResult> {
  const notify = options?.showMessage || pushMsg
  let deletedAssetsCount = 0
  let deletedOriginalsCount = 0
  let freedBytes = 0
  let skippedRecentlyReferenced = 0
  const deletedRecords: IDeletedItemRecord[] = []

  // 0. 删除前的最后防线：实时复核候选是否已重新获得文档引用。
  // 列表数据可能来自快照/增量校验，存在短暂的过期窗口；孤儿判定一旦过期，
  // 直接删除就是数据丢失。合并 OR-LIKE 批量核查，每批只付一次内核扫描。
  let unreferencedAssets = summary.unreferencedAssets
  let orphanOriginals = summary.orphanOriginals
  try {
    const candidateNames = new Set<string>()
    for (const asset of summary.unreferencedAssets) {
      candidateNames.add(asset.name)
    }
    // 孤立底图：通过最新 Sidecar 元数据映射到渲染名一并核查
    const renderedByOriginalPath = new Map<string, string>()
    try {
      const sidecars = await listAllAssetMetadataFiles()
      for (const item of sidecars) {
        const rendered = item.metadata.renderedAssetName
        const orig = item.metadata.originalStoragePath
        if (rendered && orig) {
          renderedByOriginalPath.set(normalizeOriginalStoragePath(orig), rendered)
        }
      }
    } catch (e) {
      error('[cleanup-workflow] 清理前读取 Sidecar 元数据失败，孤立底图复核降级为仅按底图文件名核查:', e)
    }
    for (const orig of summary.orphanOriginals) {
      candidateNames.add(orig.name)
      const rendered = renderedByOriginalPath.get(normalizeOriginalStoragePath(orig.path || orig.name))
      if (rendered) candidateNames.add(rendered)
    }

    if (candidateNames.size > 0) {
      const counts = await batchQueryAssetsReferenceCounts(Array.from(candidateNames))
      const stillOrphan = unreferencedAssets.filter((a) => (counts.get(a.name) || 0) === 0)
      skippedRecentlyReferenced += unreferencedAssets.length - stillOrphan.length
      unreferencedAssets = stillOrphan
      const stillOrphanOriginals = orphanOriginals.filter((o) => {
        if ((counts.get(o.name) || 0) > 0) return false
        const rendered = renderedByOriginalPath.get(normalizeOriginalStoragePath(o.path || o.name))
        return !rendered || (counts.get(rendered) || 0) === 0
      })
      skippedRecentlyReferenced += orphanOriginals.length - stillOrphanOriginals.length
      orphanOriginals = stillOrphanOriginals
      if (skippedRecentlyReferenced > 0) {
        notify(t('cleanup.recheckSkippedNotify', { n: skippedRecentlyReferenced }))
      }
    }
  } catch (verifyErr) {
    // 复核查询失败：秉持安全第一，中止本轮清理
    error('[cleanup-workflow] 清理前实时复核失败，为安全起见中止本轮清理:', verifyErr)
    notify(t('cleanup.recheckFailedNotify'))
    return {
      success: false,
      deletedAssetsCount: 0,
      deletedOriginalsCount: 0,
      freedBytes: 0,
      skippedRecentlyReferenced: 0,
      error: verifyErr,
    }
  }

  try {
    // 1. 清理普通孤儿资源
    for (const asset of unreferencedAssets) {
      try {
        let thumbnail: string | undefined
        if (isImageAsset(asset.name)) {
          try {
            thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`)
          } catch {}
        }

        if (asset.isCanvasAsset) {
          await deleteCanvasAssetFile(asset, isTrashSupported())
        } else {
          await deleteAssetFile(asset.name)
        }
        deletedAssetsCount++
        freedBytes += asset.size || 0
        deletedRecords.push({
          fileName: asset.name,
          originalRelativePath: asset.isCanvasAsset ? (asset.canvasAssetStoragePath || asset.name) : `data/assets/${asset.name}`,
          size: asset.size || 0,
          thumbnail,
        })
      } catch (err) {
        error(`[cleanup-workflow] 删除孤儿资源失败: ${asset.name}`, err)
      }
    }

    // 2. 清理孤立底图
    for (const orig of orphanOriginals) {
      try {
        let thumbnail: string | undefined
        try {
          const blob = await readOriginalImage(orig.originalStoragePath || orig.name)
          if (blob) {
            thumbnail = await captureAssetThumbnail(blob)
          }
        } catch {}

        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name)
        if (ok) {
          deletedOriginalsCount++
          freedBytes += orig.size || 0
          deletedRecords.push({
            fileName: orig.name,
            originalRelativePath: orig.originalStoragePath || orig.name,
            size: orig.size || 0,
            thumbnail,
          })
        }
      } catch (err) {
        error(`[cleanup-workflow] 删除孤立底图失败: ${orig.name}`, err)
      }
    }

    if (deletedRecords.length > 0) {
      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent'
      try {
        await recordDeletionBatch({
          actionType: 'orphan-cleanup',
          destination,
          items: deletedRecords,
          freedBytes,
          canRollback: false,
        })
      } catch (logErr) {
        error('[cleanup-workflow] 记录清理批次失败:', logErr)
      }
    }

    notify(t('cleanup.unifiedDoneNotify', {
      assetCount: deletedAssetsCount,
      originalCount: deletedOriginalsCount,
      sizeText: summary.sizeText,
    }))
    return {
      success: true,
      deletedAssetsCount,
      deletedOriginalsCount,
      freedBytes,
      skippedRecentlyReferenced,
    }
  } catch (e) {
    error('[cleanup-workflow] 综合清理异常:', e)
    notify(t('cleanup.cleanupFailedNotify'))
    return {
      success: false,
      deletedAssetsCount,
      deletedOriginalsCount,
      freedBytes,
      skippedRecentlyReferenced,
      error: e,
    }
  }
}
