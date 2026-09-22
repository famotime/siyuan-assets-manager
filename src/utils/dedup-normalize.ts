import { deleteAsset, readAssetMetadataFile, saveAssetMetadataFile, isTrashSupported } from './file-system';
import {
  replaceAssetInBlocks,
  queryCurrentAssetBlockReferences,
  verifyAssetZeroReferences,
  getImageBlockReEditData,
  setImageBlockReEditData,
} from './siyuan-block';
import { replaceAssetInAttributeViews, captureAttributeViewAssetCells, type IAffectedViewCell } from './attribute-view';
import type { AssetInfo, BlockRef } from './siyuan-db';
import type { IAssetReEditMetadata } from '../types/reedit';
import { recordDeletionBatch, type IDeletedItemRecord, type DeleteDestination } from './deletion-logger';
import { captureAssetThumbnail } from './image-editor';
import { warn, log, error } from './logger';

export interface INormalizeStats {
  affectedDocsCount: number;
  affectedBlocksCount: number;
  deletedFilesCount: number;
  freedBytes: number;
  /** 归一化未完全成功（安全复核拦截、物理删除失败等）的冗余资源数；已改写部分仍留有回退记录 */
  failedItemsCount: number;
}

export interface INormalizeOptions {
  skipRecordBatch?: boolean;
  outRecords?: IDeletedItemRecord[];
}

export interface IDuplicateItemLike {
  asset: AssetInfo;
  hash?: string;
  dHash?: string;
  score: number;
  isCanonical: boolean;
  width?: number;
  height?: number;
}

export interface IDuplicateGroupLike {
  id: string;
  mode: 'exact' | 'similar';
  similarity: number;
  canonicalAssetName: string;
  items: IDuplicateItemLike[];
  redundantCount: number;
  redundantSize: number;
  isProcessed?: boolean;
  isIgnored?: boolean;
}

/**
 * 对单个重复组执行归一化合并
 */
export async function normalizeDuplicateGroup(
  group: IDuplicateGroupLike,
  assetsMap?: Map<string, AssetInfo>,
  options?: INormalizeOptions
): Promise<INormalizeStats> {
  const stats: INormalizeStats = {
    affectedDocsCount: 0,
    affectedBlocksCount: 0,
    deletedFilesCount: 0,
    freedBytes: 0,
    failedItemsCount: 0,
  };

  const canonicalName = group.canonicalAssetName;
  if (!canonicalName) {
    throw new Error('未指定主保留资源文件');
  }

  const canonicalItem = group.items.find(it => it.asset.name === canonicalName);
  const canonicalAsset = canonicalItem?.asset || assetsMap?.get(canonicalName);

  // 检查主资源是否携带二次编辑元数据
  let canonicalReEditMeta: IAssetReEditMetadata | null = null;
  try {
    canonicalReEditMeta = await readAssetMetadataFile(canonicalName);
  } catch (e) {}

  if (!canonicalReEditMeta && canonicalAsset?.isReEditable && canonicalAsset.reEditBlockId) {
    try {
      canonicalReEditMeta = await getImageBlockReEditData(canonicalAsset.reEditBlockId);
    } catch (e) {
      warn(`[deduplicate] 获取主资源二次编辑元数据失败:`, e);
    }
  }

  if (canonicalReEditMeta) {
    try {
      await saveAssetMetadataFile(canonicalName, canonicalReEditMeta);
    } catch (e) {}
  }

  const affectedRootIds = new Set<string>();
  const deletedItemRecords: IDeletedItemRecord[] = [];

  // 采集冗余资源在数据库中被引用的单元格快照：多对一合并的逆向还原必须按单元格进行，
  // 否则按名全局反替换会把来自其它冗余图、以及本来就是主图的单元格一起改错
  let viewCellsByName = new Map<string, IAffectedViewCell[]>();
  const redundantNames = group.items
    .filter((it) => it.asset.name !== canonicalName)
    .map((it) => it.asset.name);
  if (redundantNames.length > 0) {
    try {
      viewCellsByName = await captureAttributeViewAssetCells(redundantNames);
    } catch (cellsErr) {
      warn('[deduplicate] 采集数据库单元格快照失败，回退时将退回按名替换:', cellsErr);
    }
  }

  for (const item of group.items) {
    if (item.asset.name === canonicalName) continue;

    const redundant = item.asset;
    const markdownSnapshots: Record<string, string> = {};
    const ialSnapshots: Record<string, Record<string, string>> = {};
    const affectedViews = viewCellsByName.get(redundant.name) || [];

    let combinedRefs: BlockRef[] = [];
    let thumbnail: string | undefined;
    let refsChanged = false;
    let viewFilesChanged = 0;
    let deleted = false;
    let failureReason = '';

    try {
      // 1. 动态全库实时查询最新引用块，防止读取过期缓存导致漏掉后来新建或修改的文档
      const latestRefs = await queryCurrentAssetBlockReferences(redundant.name);
      const refMap = new Map<string, BlockRef>();
      for (const r of (redundant.references || [])) {
        if (r.id) refMap.set(r.id, r);
      }
      for (const r of latestRefs) {
        if (r.id) refMap.set(r.id, r);
      }
      combinedRefs = Array.from(refMap.values());

      if (combinedRefs.length > 0) {
        // 2. 替换正文 Markdown 及 IAL 块属性（如封面图 title-img、custom-data-assets），
        //    同时采集替换前的原始快照，供逆向回退精确还原
        await replaceAssetInBlocks(combinedRefs, redundant.name, canonicalName, {
          captureSnapshots: { markdown: markdownSnapshots, attrs: ialSnapshots },
        });
        stats.affectedBlocksCount += combinedRefs.length;
        for (const r of combinedRefs) {
          if (r.root_id) affectedRootIds.add(r.root_id);
        }
      }
      refsChanged =
        Object.keys(markdownSnapshots).length > 0 || Object.keys(ialSnapshots).length > 0;

      // 3. 属性视图 (Attribute View) 全局原子替换（即便正文未引用，AV 中仍可能有引用）；
      //    replaceAssetInBlocks 内部会同步一次，这里保留显式调用以覆盖"正文无引用"的情形
      try {
        viewFilesChanged = await replaceAssetInAttributeViews(redundant.name, canonicalName);
      } catch (avErr) {
        error(`[deduplicate] 归一化更新数据库属性视图失败:`, avErr);
        throw avErr;
      }

      // 4. 【核心生死线】删除前强制二次安全复核 (Pre-delete Double Check)
      // 结合思源内核事务主动刷新与内存 AST 树穿透核查，确认全库旧文件引用数确已为 0。
      // 若经真实 AST 深度核查后仍有真实残留引用，坚决禁止删除物理文件！
      const { isClean, remainingBlocks } = await verifyAssetZeroReferences(redundant.name);
      if (!isClean && remainingBlocks.length > 0) {
        throw new Error(
          `[去重安全拦截] 冗余资源 [${redundant.name}] 尚有 ${remainingBlocks.length} 处文档引用未完成替换，已终止删除该物理文件！受影响块ID: ${remainingBlocks
            .map((b) => b.id)
            .slice(0, 3)
            .join(', ')}`
        );
      }

      // 5. 确认 0 引用后，安全删除多余冗余物理文件
      try {
        thumbnail = await captureAssetThumbnail(`/assets/${redundant.name}`);
      } catch {}

      if (!(await deleteAsset(redundant.name))) {
        throw new Error(`删除冗余资源 [${redundant.name}] 失败：文件可能已不存在或不可写`);
      }
      deleted = true;
      stats.deletedFilesCount += 1;
      stats.freedBytes += redundant.size || 0;
      log(`[deduplicate] 成功归一化并安全删除冗余资源: ${redundant.name}`);
    } catch (itemErr) {
      // 单条冗余失败不再中断整组/整批：引用可能已被改写，必须继续为已完成的部分留下回退记录
      failureReason = itemErr instanceof Error ? itemErr.message : String(itemErr);
      error(`[deduplicate] 冗余资源 ${redundant.name} 归一化未完全成功:`, itemErr);
      stats.failedItemsCount += 1;
    }

    // 只要替换环节跑过且随后失败了，引用就可能已被部分改写 —— 必须留下回退记录，
    // 否则会出现"引用改了、文件还在、日志没记录"的不可回退中间态
    const replacementRan = combinedRefs.length > 0 || affectedViews.length > 0;
    const anythingChanged =
      refsChanged || viewFilesChanged > 0 || deleted || (Boolean(failureReason) && replacementRan);

    if (anythingChanged) {
      const record: IDeletedItemRecord = {
        fileName: redundant.name,
        originalRelativePath: `data/assets/${redundant.name}`,
        size: redundant.size || 0,
        canonicalName,
        thumbnail,
        affectedBlocks: combinedRefs.map((r) => ({ id: r.id, root_id: r.root_id })),
        originalMarkdownSnippets:
          Object.keys(markdownSnapshots).length > 0 ? markdownSnapshots : undefined,
        originalIalSnapshots: Object.keys(ialSnapshots).length > 0 ? ialSnapshots : undefined,
        affectedViews: affectedViews.length > 0 ? affectedViews : undefined,
        partialFailure: failureReason ? true : undefined,
        failureReason: failureReason || undefined,
      };
      deletedItemRecords.push(record);
      if (options?.outRecords) {
        options.outRecords.push(record);
      }
    }
  }

  stats.affectedDocsCount = affectedRootIds.size;
  // 有未能完整归一的条目时保持未处理状态，便于用户处理后重试，而不是被静默标记为已完成
  group.isProcessed = 0 === stats.failedItemsCount;

  // 记录单组删除批次
  if (!options?.skipRecordBatch && deletedItemRecords.length > 0) {
    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
    try {
      await recordDeletionBatch({
        actionType: 'deduplicate',
        destination,
        items: deletedItemRecords,
        freedBytes: stats.freedBytes,
        canRollback: true,
      });
    } catch (logErr) {
      warn('[deduplicate] 记录删除批次失败:', logErr);
    }
  }

  return stats;
}

/**
 * 批量执行多个重复组归一化合并
 */
export async function batchNormalizeDuplicateGroups(
  groups: IDuplicateGroupLike[],
  assetsMap?: Map<string, AssetInfo>,
  onProgress?: (current: number, total: number) => void
): Promise<INormalizeStats> {
  const totalStats: INormalizeStats = {
    affectedDocsCount: 0,
    affectedBlocksCount: 0,
    deletedFilesCount: 0,
    freedBytes: 0,
    failedItemsCount: 0,
  };

  const pendingGroups = groups.filter(g => !g.isProcessed && !g.isIgnored);
  let processed = 0;
  const allBatchRecords: IDeletedItemRecord[] = [];

  for (const group of pendingGroups) {
    const singleStats = await normalizeDuplicateGroup(group, assetsMap, {
      skipRecordBatch: true,
      outRecords: allBatchRecords,
    });
    totalStats.affectedDocsCount += singleStats.affectedDocsCount;
    totalStats.affectedBlocksCount += singleStats.affectedBlocksCount;
    totalStats.deletedFilesCount += singleStats.deletedFilesCount;
    totalStats.freedBytes += singleStats.freedBytes;
    totalStats.failedItemsCount += singleStats.failedItemsCount;

    processed++;
    if (onProgress) {
      onProgress(processed, pendingGroups.length);
    }
  }

  // 批量记录统一去重批次
  if (allBatchRecords.length > 0) {
    const destination: DeleteDestination = isTrashSupported() ? 'os-trash' : 'permanent';
    try {
      await recordDeletionBatch({
        actionType: 'deduplicate',
        destination,
        items: allBatchRecords,
        freedBytes: totalStats.freedBytes,
        canRollback: true,
      });
    } catch (logErr) {
      warn('[deduplicate] 批量记录删除批次失败:', logErr);
    }
  }

  return totalStats;
}
