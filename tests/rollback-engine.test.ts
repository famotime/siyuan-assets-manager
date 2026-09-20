import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/api', () => ({
  sql: vi.fn(),
  updateBlock: vi.fn(),
  insertBlock: vi.fn().mockResolvedValue([{ id: 'new-block' }]),
}));

vi.mock('../src/utils/attribute-view', () => ({
  replaceAssetInAttributeViews: vi.fn().mockResolvedValue(1),
}));

import { sql, updateBlock, insertBlock } from '../src/api';
import { replaceAssetInAttributeViews } from '../src/utils/attribute-view';
import {
  rollbackBatch,
  rollbackDeduplicationBatch,
  getRollbackChecklist,
} from '../src/utils/rollback-engine';
import {
  recordDeletionBatch,
  getDeletionHistory,
  setDeletionHistoryLimit,
} from '../src/utils/deletion-logger';
import { usePlugin } from '../src/utils/plugin-context';

describe('rollback-engine unit tests', () => {
  let mockStorage: Record<string, any> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.clearAllMocks();

    const mockPlugin: any = {
      settings: { deletionHistoryLimit: 10 },
      loadData: vi.fn(async (file: string) => mockStorage[file] || null),
      saveData: vi.fn(async (file: string, data: any) => {
        mockStorage[file] = data;
      }),
      removeData: vi.fn(async (file: string) => {
        delete mockStorage[file];
      }),
    };

    usePlugin(mockPlugin);
  });

  it('generates rollback checklist properly', () => {
    const batch: any = {
      items: [
        { fileName: 'old1.png', canonicalName: 'keep.png' },
        { fileName: 'old2.png', canonicalName: 'keep.png' },
        { fileName: 'orphan.png' }, // 无 canonicalName
      ],
    };

    const checklist = getRollbackChecklist(batch);
    expect(checklist).toEqual(['old1.png', 'old2.png']);
  });

  it('reverts block references and skips modified/deleted blocks gracefully', async () => {
    await setDeletionHistoryLimit(10);

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'redundant.png',
          originalRelativePath: 'data/assets/redundant.png',
          size: 1024,
          canonicalName: 'canonical.png',
          affectedBlocks: [
            { id: 'block-normal' },
            { id: 'block-deleted' },
            { id: 'block-drifted' },
          ],
        },
      ],
    });

    expect(batch).not.toBeNull();

    // 模拟不同块的状态
    (sql as any).mockImplementation(async (query: string) => {
      if (query.includes("id = 'block-normal'")) {
        return [{ id: 'block-normal', markdown: '![image](assets/canonical.png)', ial: '' }];
      }
      if (query.includes("id = 'block-deleted'")) {
        return []; // 块已删除
      }
      if (query.includes("id = 'block-drifted'")) {
        return [{ id: 'block-drifted', markdown: '用户已修改为纯文本', ial: '' }]; // 图片被用户移除了
      }
      return [];
    });

    (updateBlock as any).mockResolvedValue({ code: 0 });

    const result = await rollbackDeduplicationBatch(batch!.id);

    expect(result.success).toBe(true);
    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.skippedBlocksCount).toBe(2);
    expect(result.report.failedBlocksCount).toBe(0);

    // 验证正常块进行了逆向替换
    expect(updateBlock).toHaveBeenCalledWith(
      'markdown',
      '![image](assets/redundant.png)',
      'block-normal'
    );

    // 验证属性视图执行了逆向替换
    expect(replaceAssetInAttributeViews).toHaveBeenCalledWith('canonical.png', 'redundant.png');

    // 验证批次状态已更新为 isRolledBack
    const history = await getDeletionHistory();
    expect(history[0].isRolledBack).toBe(true);
    expect(history[0].rollbackReport?.restoredBlocksCount).toBe(1);
    expect(history[0].rollbackReport?.skippedBlocksCount).toBe(2);

    // 重复回退应抛出错误
    await expect(rollbackDeduplicationBatch(batch!.id)).rejects.toThrow('此前已执行过回退');
  });

  it('rejects rollback for non-rollbackable batches', async () => {
    const orphanBatch = await recordDeletionBatch({
      actionType: 'orphan-cleanup',
      destination: 'os-trash',
      freedBytes: 500,
      canRollback: false,
      items: [{ fileName: 'orphan.png', originalRelativePath: 'data/assets/orphan.png', size: 500 }],
    });

    await expect(rollbackDeduplicationBatch(orphanBatch!.id)).rejects.toThrow('不支持引用语法回退');
  });

  it('restores deleted image references for single-delete batches using saved snippets', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("WHERE id = 'block-deleted-img'")) {
        return [{ id: 'block-deleted-img', markdown: '段落文本（无图）' }];
      }
      return [];
    });

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 2048,
      canRollback: true,
      items: [
        {
          fileName: 'deleted-img.png',
          originalRelativePath: 'data/assets/deleted-img.png',
          size: 2048,
          thumbnail: 'data:image/webp;base64,mockThumbnailData',
          affectedBlocks: [{ id: 'block-deleted-img' }],
          originalMarkdownSnippets: {
            'block-deleted-img': '段落文本\n![deleted-img.png](assets/deleted-img.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);
    expect(result.success).toBe(true);
    expect(result.report.restoredBlocksCount).toBe(1);
    expect(updateBlock).toHaveBeenCalledWith(
      'markdown',
      '段落文本\n![deleted-img.png](assets/deleted-img.png)',
      'block-deleted-img'
    );
  });

  it('reconstructs deleted block via insertBlock when original block was deleted', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      // 模拟原块已被 deleteBlock 查不到
      if (query.includes("WHERE id = 'deleted-block-id'")) {
        return [];
      }
      // 模拟文档根块依然存在
      if (query.includes("WHERE id = 'doc-root-id'")) {
        return [{ id: 'doc-root-id' }];
      }
      return [];
    });

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'single-orphan.png',
          originalRelativePath: 'data/assets/single-orphan.png',
          size: 1024,
          affectedBlocks: [{ id: 'deleted-block-id', root_id: 'doc-root-id' }],
          originalMarkdownSnippets: {
            'deleted-block-id': '![single-orphan.png](assets/single-orphan.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);
    expect(result.success).toBe(true);
    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.skippedBlocksCount).toBe(0);
    expect(insertBlock).toHaveBeenCalledWith(
      'markdown',
      '![single-orphan.png](assets/single-orphan.png)',
      expect.objectContaining({ parentID: 'doc-root-id' })
    );
  });
});
