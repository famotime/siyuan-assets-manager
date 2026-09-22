import { sql, updateBlock, insertBlock } from '../api';
import { replaceAssetInMarkdown } from './asset-markdown';
import { replaceAssetInAttributeViews } from './attribute-view';
import { createChildBlocksCache, planInsertAnchors } from './rollback-anchor';
import {
  getDeletionHistory,
  updateBatchStatus,
  type IDeletionBatch,
  type IRollbackReport,
} from './deletion-logger';
import { log, warn, error } from './logger';

export interface IRollbackExecutionResult {
  success: boolean;
  batchId: string;
  report: IRollbackReport;
  restoredFileNames: string[];
}

/**
 * 获取批次需由用户从操作系统回收站放回的文件名清单
 */
export function getRollbackChecklist(batch: IDeletionBatch): string[] {
  if (!batch || !Array.isArray(batch.items)) return [];
  const hasCanonical = batch.items.some((item) => Boolean(item.canonicalName));
  if (batch.actionType === 'deduplicate' || hasCanonical) {
    return batch.items
      .filter((item) => Boolean(item.canonicalName))
      .map((item) => item.fileName);
  }
  // 单文件或批量删除：返回该批次所有被删文件
  return batch.items.map((item) => item.fileName);
}

/**
 * 判断容器块是否已从库中消失（回退插入全部失败时用于区分"安全跳过"与"真失败"）
 */
async function isBlockMissing(id: string | undefined, cache: Map<string, boolean>): Promise<boolean> {
  if (!id) return false;
  if (cache.has(id)) return cache.get(id) as boolean;

  let missing = false;
  try {
    const rows = await sql(`SELECT id FROM blocks WHERE id = '${id}'`);
    missing = !rows || 0 === rows.length;
  } catch (e) {
    missing = false;
  }

  cache.set(id, missing);
  return missing;
}

/**
 * 执行指定批次的文档引用逆向回退（支持去重批次、单文件删除与批量删除批次）
 * @param batchId 批次唯一标识
 */
export async function rollbackBatch(batchId: string): Promise<IRollbackExecutionResult> {
  const history = await getDeletionHistory();
  const batch = history.find((b) => b.id === batchId);

  if (!batch) {
    throw new Error(`找不到批次 [${batchId}]，无法执行回退`);
  }

  if (!batch.canRollback) {
    throw new Error(`批次 [${batchId}] 的类型为 [${batch.actionType}]，不支持引用语法回退`);
  }

  if (batch.isRolledBack) {
    throw new Error(`批次 [${batchId}] 此前已执行过回退，请勿重复操作`);
  }

  let restoredBlocksCount = 0;
  let skippedBlocksCount = 0;
  let failedBlocksCount = 0;
  let degradedPositionCount = 0;
  const restoredFileNames: string[] = [];

  if (batch.actionType === 'deduplicate') {
    // 1. 去重批次回退：将保留主图 canonical 逆向替换回冗余图 redundant
    for (const item of batch.items) {
      if (!item.canonicalName) continue;
      const canonicalName = item.canonicalName;
      const redundantName = item.fileName;
      restoredFileNames.push(redundantName);

      const affectedBlocks = item.affectedBlocks || [];
      for (const ref of affectedBlocks) {
        if (!ref.id) continue;
        try {
          const rows = await sql(`SELECT id, markdown, ial FROM blocks WHERE id = '${ref.id}'`);
          if (!rows || rows.length === 0) {
            skippedBlocksCount++;
            continue;
          }

          const currentMd = rows[0].markdown || '';
          const currentIal = rows[0].ial || '';
          const encodedCanonical = encodeURIComponent(canonicalName);

          const hasCanonicalInMd =
            currentMd.includes(`assets/${canonicalName}`) ||
            (encodedCanonical !== canonicalName && currentMd.includes(`assets/${encodedCanonical}`));
          const hasCanonicalInIal =
            currentIal.includes(`assets/${canonicalName}`) ||
            (encodedCanonical !== canonicalName && currentIal.includes(`assets/${encodedCanonical}`));

          if (!hasCanonicalInMd && !hasCanonicalInIal) {
            skippedBlocksCount++;
            continue;
          }

          if (hasCanonicalInMd) {
            const newMd = replaceAssetInMarkdown(currentMd, canonicalName, redundantName);
            await updateBlock('markdown', newMd, ref.id);
          }

          restoredBlocksCount++;
        } catch (blockErr) {
          error(`[rollback-engine] 逆向回退块 [${ref.id}] 失败:`, blockErr);
          failedBlocksCount++;
        }
      }

      // 逆向还原属性视图（Attribute View）中的单元格引用
      try {
        await replaceAssetInAttributeViews(canonicalName, redundantName);
      } catch (avErr) {
        warn(`[rollback-engine] 逆向还原属性视图失败 (${canonicalName} -> ${redundantName}):`, avErr);
      }
    }
  } else {
    // 2. 单文件删除或批量删除回退：还原被清空的文档块图片引用
    const anchorCache = createChildBlocksCache();
    // 仅在候选锚点全部失败时才查库区分"跳过"与"失败"
    const missingCache = new Map<string, boolean>();

    for (const item of batch.items) {
      restoredFileNames.push(item.fileName);
      const affectedBlocks = item.affectedBlocks || [];
      const snippets = item.originalMarkdownSnippets || {};

      for (const ref of affectedBlocks) {
        if (!ref.id) continue;
        try {
          const rows = await sql(`SELECT id, markdown FROM blocks WHERE id = '${ref.id}'`);
          const targetAssetPath = `assets/${item.fileName}`;
          const fallbackImageMd = `![${item.fileName}](${targetAssetPath})`;
          const restoredMd = snippets[ref.id] || fallbackImageMd;

          if (rows && rows.length > 0) {
            const currentMd = rows[0].markdown || '';
            // 若当前块已包含该图片，无需重复恢复
            if (currentMd.includes(targetAssetPath)) {
              skippedBlocksCount++;
              continue;
            }

            // 优先恢复删除前备份的完整 Markdown 片段
            if (snippets[ref.id]) {
              await updateBlock('markdown', snippets[ref.id], ref.id);
            } else {
              // 兜底恢复：将图片引用追加至块中
              const newMd = currentMd ? `${currentMd}\n${fallbackImageMd}` : fallbackImageMd;
              await updateBlock('markdown', newMd, ref.id);
            }
            restoredBlocksCount++;
          } else {
            // 原块因被清理后变为空白块而被思源原生 deleteBlock 删除了
            // 依据删除前采集的真实位置锚点重建块：内核在 parentID 定位时会
            // PrependChild 到容器首位，因此绝不能把裸 parentID 当作默认落点
            const plans = await planInsertAnchors(ref, anchorCache);
            let inserted = false;

            for (const plan of plans) {
              try {
                const res = await insertBlock('markdown', restoredMd, {
                  previousID: plan.previousID,
                  nextID: plan.nextID,
                  parentID: plan.parentID,
                });
                if (res !== null && res !== undefined) {
                  inserted = true;
                  if (plan.degraded) {
                    degradedPositionCount++;
                    warn(
                      `[rollback-engine] 块 [${ref.id}] 原相邻块已变化，已按近似位置还原（位置降级）`
                    );
                  }
                  break;
                }
                warn(
                  `[rollback-engine] 块 [${ref.id}] 候选锚点插入失败，尝试下一候选:`,
                  plan.previousID || plan.nextID || plan.parentID
                );
              } catch (planErr) {
                warn(`[rollback-engine] 块 [${ref.id}] 候选锚点插入异常，尝试下一候选:`, planErr);
              }
            }

            if (inserted) {
              restoredBlocksCount++;
            } else if (
              0 === plans.length ||
              (await isBlockMissing(ref.root_id || ref.parent_id, missingCache))
            ) {
              // 无候选锚点，或原文档/父块均已被用户物理移除 ⇒ 记录为安全跳过
              skippedBlocksCount++;
            } else {
              failedBlocksCount++;
            }
          }
        } catch (blockErr) {
          error(`[rollback-engine] 恢复删除块 [${ref.id}] 图片引用失败:`, blockErr);
          failedBlocksCount++;
        }
      }
    }
  }

  const report: IRollbackReport = {
    restoredBlocksCount,
    skippedBlocksCount,
    failedBlocksCount,
    degradedPositionCount,
  };

  await updateBatchStatus(batchId, {
    isRolledBack: true,
    rolledBackAt: Date.now(),
    rollbackReport: report,
  });

  log(
    `[rollback-engine] 批次 [${batchId}] 回退完成: 成功 ${restoredBlocksCount} 块（其中位置降级 ${degradedPositionCount} 块），跳过 ${skippedBlocksCount} 块，失败 ${failedBlocksCount} 块`
  );

  return {
    success: true,
    batchId,
    report,
    restoredFileNames,
  };
}

/**
 * 向后兼容别名
 */
export const rollbackDeduplicationBatch = rollbackBatch;

