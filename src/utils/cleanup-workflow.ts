import { sql, pushMsg } from '../api';
import { isTrashSupported, deleteOriginalImage, readOriginalImage } from './file-system';
import { deleteAssetFile, type AssetInfo } from './siyuan-db';
import { removeAssetFromBlocks } from './siyuan-block';
import { captureAssetThumbnail } from './image-editor';
import { isImageAsset } from './asset-list';
import {
  recordDeletionBatch,
  type IDeletedItemRecord,
  type DeleteDestination,
} from './deletion-logger';
import { captureBlockAnchors, createChildBlocksCache } from './rollback-anchor';
import { error } from './logger';

export interface IConfirmDialogOptions {
  title: string;
  message: string;
  confirmText: string;
  danger: boolean;
}

export interface IBatchDeleteSummary {
  totalCount: number;
  regularCount: number;
  originalCount: number;
  sizeText: string;
  referencedCount: number;
  referencedOriginalsCount: number;
  regularAssets: AssetInfo[];
  originalAssets: AssetInfo[];
}

export interface ICleanupSummary {
  totalCount: number;
  unreferencedCount: number;
  unreferencedSizeText: string;
  orphanOriginalsCount: number;
  orphanOriginalsSizeText: string;
  sizeText: string;
  unreferencedAssets: AssetInfo[];
  orphanOriginals: AssetInfo[];
}

export interface ISingleDeleteResult {
  success: boolean;
  freedBytes: number;
  error?: unknown;
}

export interface IBatchDeleteResult {
  success: boolean;
  deletedRegularCount: number;
  deletedOriginalCount: number;
  freedBytes: number;
  error?: unknown;
}

export interface IUnifiedCleanupResult {
  success: boolean;
  deletedAssetsCount: number;
  deletedOriginalsCount: number;
  freedBytes: number;
  error?: unknown;
}

/**
 * 构造单个资源（普通文件或原始底图）删除前的确认弹窗配置
 */
export function buildSingleDeleteConfirmMessage(asset: AssetInfo): IConfirmDialogOptions {
  if (asset.isOriginal) {
    let confirmMsg = `确定要删除原始底图 ${asset.name} 吗？\n${isTrashSupported() ? '（文件将移入操作系统回收站）' : '【高危警告】当前运行环境不支持系统回收站，此操作将永久彻底删除底图物理文件！'}`;
    if (asset.docCount > 0) {
      confirmMsg = `【高风险警告】此原始底图正被 ${asset.docCount} 个文档中的二次编辑图片关联！\n删除此底图后，未来将无法对这些图片进行图层还原与二次编辑。\n\n确定要删除原始底图 ${asset.name} 吗？\n${isTrashSupported() ? '（将移入操作系统回收站）' : '（Web/Docker 环境：将永久硬删除）'}`;
    }

    return {
      title: '确认删除原始底图',
      message: confirmMsg,
      confirmText: '删除底图',
      danger: true,
    };
  }

  let confirmMsg = isTrashSupported()
    ? `确定要删除 ${asset.name} 吗？\n注意：文件将移入操作系统回收站，且文档中的对应引用块也将被清理。`
    : `【高危警告】当前运行环境不支持系统回收站，确定要永久删除 ${asset.name} 吗？\n注意：物理文件将被直接抹除且不可撤销，文档中的对应引用块也将被清理。`;

  if (asset.docCount > 1) {
    confirmMsg = `【多文档共享警告】此资源正被 ${asset.docCount} 篇不同的文档共同引用！\n删除后将同步清理所有 ${asset.docCount} 篇文档中的引用块。\n\n` + confirmMsg;
  }

  return {
    title: '确认删除',
    message: confirmMsg,
    confirmText: '删除',
    danger: true,
  };
}

/**
 * 构造批量删除确认弹窗配置
 */
export function buildBatchDeleteConfirmMessage(summary: IBatchDeleteSummary): IConfirmDialogOptions {
  const messageLines = [
    `确定要批量删除选中的 ${summary.totalCount} 个文件吗？`,
    '',
    '清单概要：',
    `• 普通资源文件：${summary.regularCount} 个`,
    `• 隔离原始底图：${summary.originalCount} 个`,
    `• 预计释放总空间：${summary.sizeText}`,
  ];

  if (summary.referencedCount > 0) {
    messageLines.push('');
    messageLines.push(`【重要提示】所选资源中有 ${summary.referencedCount} 个已被文档引用，删除将自动清理文档中对应的引用块。`);
  }

  if (summary.referencedOriginalsCount > 0) {
    messageLines.push('');
    messageLines.push(`【高风险警告】所选底图中有 ${summary.referencedOriginalsCount} 个正被文档中的二次编辑图片关联，删除后将无法再次进行图层无损还原！`);
  }

  messageLines.push('');
  if (isTrashSupported()) {
    messageLines.push('文件将移入操作系统回收站，若误删可从回收站手工找回。确定要执行批量删除吗？');
  } else {
    messageLines.push('【高危警告】当前运行环境（Web / Docker）不支持系统回收站，此操作将永久彻底抹除物理文件，无法撤销！确定要执行批量删除吗？');
  }

  return {
    title: `批量删除资源 (${summary.totalCount} 个)`,
    message: messageLines.join('\n'),
    confirmText: '执行批量删除',
    danger: true,
  };
}

/**
 * 构造综合清理未引用孤儿资源与孤立底图的确认弹窗配置
 */
export function buildUnifiedCleanupConfirmMessage(summary: ICleanupSummary): IConfirmDialogOptions {
  const messageLines = [
    isTrashSupported()
      ? '【安全清理】此操作将清理所有未被文档引用的孤儿资源文件及孤立原始底图，所有文件将移入操作系统回收站。'
      : '【高危警告】当前运行环境（Web / Docker）不支持系统回收站，此操作将永久彻底抹除文件且不可撤销！',
    '',
    '待清理清单：',
    `• 孤儿资源文件：${summary.unreferencedCount} 个 (${summary.unreferencedSizeText})`,
    `• 孤立原始底图：${summary.orphanOriginalsCount} 个 (${summary.orphanOriginalsSizeText})`,
    `• 预计释放总空间：${summary.sizeText}`,
    '',
    isTrashSupported()
      ? '确定要执行清理并将这些文件移入系统回收站吗？'
      : '此操作将直接彻底删除物理文件，确定要继续吗？',
  ];

  return {
    title: '清理未引用资源与孤立底图',
    message: messageLines.join('\n'),
    confirmText: '执行清理',
    danger: true,
  };
}

/**
 * 执行单个资源删除（普通文件或原始底图）
 */
export async function executeSingleAssetDeletion(
  asset: AssetInfo,
  options?: { showMessage?: (msg: string) => void }
): Promise<ISingleDeleteResult> {
  const notify = options?.showMessage || pushMsg;

  if (asset.isOriginal) {
    try {
      let thumbnail: string | undefined;
      try {
        const blob = await readOriginalImage(asset.originalStoragePath || asset.name);
        if (blob) {
          thumbnail = await captureAssetThumbnail(blob);
        }
      } catch {}

      await deleteOriginalImage(asset.originalStoragePath || asset.name);
      notify(`原始底图 ${asset.name} 已删除`);

      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
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
        });
      } catch (logErr) {
        error('[cleanup-workflow] 记录删除原始底图批次失败:', logErr);
      }

      return { success: true, freedBytes: asset.size || 0 };
    } catch (e) {
      error('[cleanup-workflow] 删除原始底图失败:', e);
      notify('删除底图失败');
      return { success: false, freedBytes: 0, error: e };
    }
  }

  try {
    let thumbnail: string | undefined;
    if (isImageAsset(asset.name)) {
      try {
        thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`);
      } catch {}
    }

    const snippets: Record<string, string> = {};
    const blocksToCapture: Array<{ id: string; root_id?: string; parent_id?: string }> = [];

    if (asset.references && asset.references.length > 0) {
      for (const ref of asset.references) {
        if (!ref.id) continue;
        try {
          const rows = await sql(`SELECT id, parent_id, root_id, markdown FROM blocks WHERE id = '${ref.id}'`);
          if (rows && rows.length > 0) {
            const row = rows[0];
            if (row.markdown) {
              snippets[ref.id] = row.markdown;
            }
            blocksToCapture.push({
              id: ref.id,
              root_id: row.root_id || ref.root_id,
              parent_id: row.parent_id,
            });
          } else {
            blocksToCapture.push({ id: ref.id, root_id: ref.root_id });
          }
        } catch {
          blocksToCapture.push({ id: ref.id, root_id: ref.root_id });
        }
      }
    }

    const affectedBlockRecords = await captureBlockAnchors(blocksToCapture, createChildBlocksCache());

    await deleteAssetFile(asset.name);

    if (asset.references && asset.references.length > 0) {
      await removeAssetFromBlocks(asset.references, asset.name);
    }

    notify(`资源 ${asset.name} 及其文档引用已删除`);

    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
    const hasRefs = Boolean(asset.references && asset.references.length > 0);
    try {
      await recordDeletionBatch({
        actionType: 'single-delete',
        destination,
        items: [{
          fileName: asset.name,
          originalRelativePath: `data/assets/${asset.name}`,
          size: asset.size || 0,
          thumbnail,
          affectedBlocks: affectedBlockRecords.length > 0 ? affectedBlockRecords : (asset.references || []).map(r => ({ id: r.id, root_id: r.root_id })),
          originalMarkdownSnippets: Object.keys(snippets).length > 0 ? snippets : undefined,
        }],
        freedBytes: asset.size || 0,
        canRollback: hasRefs,
      });
    } catch (logErr) {
      error('[cleanup-workflow] 记录单文件删除批次失败:', logErr);
    }

    return { success: true, freedBytes: asset.size || 0 };
  } catch (e) {
    error('[cleanup-workflow] 删除资源失败:', e);
    notify('删除失败');
    return { success: false, freedBytes: 0, error: e };
  }
}

/**
 * 执行多选批量删除
 */
export async function executeBatchAssetsDeletion(
  summary: IBatchDeleteSummary,
  options?: { showMessage?: (msg: string) => void }
): Promise<IBatchDeleteResult> {
  const notify = options?.showMessage || pushMsg;
  let deletedRegularCount = 0;
  let deletedOriginalCount = 0;
  let freedBytes = 0;
  const deletedRecords: IDeletedItemRecord[] = [];

  let hasAnyRollbackableRefs = false;
  const anchorCache = createChildBlocksCache();

  try {
    // 1. 删除普通资源及其文档引用
    for (const asset of summary.regularAssets) {
      try {
        let thumbnail: string | undefined;
        if (isImageAsset(asset.name)) {
          try {
            thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`);
          } catch {}
        }

        const snippets: Record<string, string> = {};
        const blocksToCapture: Array<{ id: string; root_id?: string; parent_id?: string }> = [];

        if (asset.references && asset.references.length > 0) {
          hasAnyRollbackableRefs = true;
          for (const ref of asset.references) {
            if (!ref.id) continue;
            try {
              const rows = await sql(`SELECT id, parent_id, root_id, markdown FROM blocks WHERE id = '${ref.id}'`);
              if (rows && rows.length > 0) {
                const row = rows[0];
                if (row.markdown) {
                  snippets[ref.id] = row.markdown;
                }
                blocksToCapture.push({
                  id: ref.id,
                  root_id: row.root_id || ref.root_id,
                  parent_id: row.parent_id,
                });
              } else {
                blocksToCapture.push({ id: ref.id, root_id: ref.root_id });
              }
            } catch {
              blocksToCapture.push({ id: ref.id, root_id: ref.root_id });
            }
          }
        }

        const affectedBlockRecords = await captureBlockAnchors(blocksToCapture, anchorCache);

        await deleteAssetFile(asset.name);
        if (asset.references && asset.references.length > 0) {
          await removeAssetFromBlocks(asset.references, asset.name);
        }
        deletedRegularCount++;
        freedBytes += asset.size || 0;
        deletedRecords.push({
          fileName: asset.name,
          originalRelativePath: `data/assets/${asset.name}`,
          size: asset.size || 0,
          thumbnail,
          affectedBlocks: affectedBlockRecords.length > 0 ? affectedBlockRecords : (asset.references || []).map(r => ({ id: r.id, root_id: r.root_id })),
          originalMarkdownSnippets: Object.keys(snippets).length > 0 ? snippets : undefined,
        });
      } catch (err) {
        error(`[cleanup-workflow] 批量删除普通资源失败: ${asset.name}`, err);
      }
    }

    // 2. 删除原始底图
    for (const orig of summary.originalAssets) {
      try {
        let thumbnail: string | undefined;
        try {
          const blob = await readOriginalImage(orig.originalStoragePath || orig.name);
          if (blob) {
            thumbnail = await captureAssetThumbnail(blob);
          }
        } catch {}

        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name);
        if (ok) {
          deletedOriginalCount++;
          freedBytes += orig.size || 0;
          deletedRecords.push({
            fileName: orig.name,
            originalRelativePath: orig.originalStoragePath || orig.name,
            size: orig.size || 0,
            thumbnail,
          });
        }
      } catch (err) {
        error(`[cleanup-workflow] 批量删除原始底图失败: ${orig.name}`, err);
      }
    }

    if (deletedRecords.length > 0) {
      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
      try {
        await recordDeletionBatch({
          actionType: 'batch-delete',
          destination,
          items: deletedRecords,
          freedBytes,
          canRollback: hasAnyRollbackableRefs,
        });
      } catch (logErr) {
        error('[cleanup-workflow] 记录批量删除批次失败:', logErr);
      }
    }

    notify(`批量删除完成！已成功删除 ${deletedRegularCount} 个资源与 ${deletedOriginalCount} 个底图，释放 ${summary.sizeText} 空间。`);
    return {
      success: true,
      deletedRegularCount,
      deletedOriginalCount,
      freedBytes,
    };
  } catch (e) {
    error('[cleanup-workflow] 批量删除异常:', e);
    notify('批量删除失败');
    return {
      success: false,
      deletedRegularCount,
      deletedOriginalCount,
      freedBytes,
      error: e,
    };
  }
}

/**
 * 统一综合清理：清理未引用的孤儿资源与孤立底图
 */
export async function executeUnifiedCleanup(
  summary: ICleanupSummary,
  options?: { showMessage?: (msg: string) => void }
): Promise<IUnifiedCleanupResult> {
  const notify = options?.showMessage || pushMsg;
  let deletedAssetsCount = 0;
  let deletedOriginalsCount = 0;
  let freedBytes = 0;
  const deletedRecords: IDeletedItemRecord[] = [];

  try {
    // 1. 清理普通孤儿资源
    for (const asset of summary.unreferencedAssets) {
      try {
        let thumbnail: string | undefined;
        if (isImageAsset(asset.name)) {
          try {
            thumbnail = await captureAssetThumbnail(`/assets/${asset.name}`);
          } catch {}
        }

        await deleteAssetFile(asset.name);
        deletedAssetsCount++;
        freedBytes += asset.size || 0;
        deletedRecords.push({
          fileName: asset.name,
          originalRelativePath: `data/assets/${asset.name}`,
          size: asset.size || 0,
          thumbnail,
        });
      } catch (err) {
        error(`[cleanup-workflow] 删除孤儿资源失败: ${asset.name}`, err);
      }
    }

    // 2. 清理孤立底图
    for (const orig of summary.orphanOriginals) {
      try {
        let thumbnail: string | undefined;
        try {
          const blob = await readOriginalImage(orig.originalStoragePath || orig.name);
          if (blob) {
            thumbnail = await captureAssetThumbnail(blob);
          }
        } catch {}

        const ok = await deleteOriginalImage(orig.originalStoragePath || orig.name);
        if (ok) {
          deletedOriginalsCount++;
          freedBytes += orig.size || 0;
          deletedRecords.push({
            fileName: orig.name,
            originalRelativePath: orig.originalStoragePath || orig.name,
            size: orig.size || 0,
            thumbnail,
          });
        }
      } catch (err) {
        error(`[cleanup-workflow] 删除孤立底图失败: ${orig.name}`, err);
      }
    }

    if (deletedRecords.length > 0) {
      const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
      try {
        await recordDeletionBatch({
          actionType: 'orphan-cleanup',
          destination,
          items: deletedRecords,
          freedBytes,
          canRollback: false,
        });
      } catch (logErr) {
        error('[cleanup-workflow] 记录清理批次失败:', logErr);
      }
    }

    notify(`清理完成！已成功删除 ${deletedAssetsCount} 个孤儿资源与 ${deletedOriginalsCount} 个孤立底图，共释放 ${summary.sizeText} 空间。`);
    return {
      success: true,
      deletedAssetsCount,
      deletedOriginalsCount,
      freedBytes,
    };
  } catch (e) {
    error('[cleanup-workflow] 综合清理异常:', e);
    notify('清理失败');
    return {
      success: false,
      deletedAssetsCount,
      deletedOriginalsCount,
      freedBytes,
      error: e,
    };
  }
}
