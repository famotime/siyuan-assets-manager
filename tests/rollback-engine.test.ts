import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../src/api', () => ({
  sql: vi.fn(),
  updateBlock: vi.fn(),
  insertBlock: vi.fn().mockResolvedValue([{ id: 'new-block' }]),
  getChildBlocks: vi.fn(),
  getBlockAttrs: vi.fn(),
  setBlockAttrs: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/utils/attribute-view', () => ({
  replaceAssetInAttributeViews: vi.fn().mockResolvedValue(1),
  restoreAttributeViewAssetCells: vi.fn().mockResolvedValue({
    restoredCount: 0,
    approximateCount: 0,
    skippedCount: 0,
  }),
}));

import { sql, updateBlock, insertBlock, getChildBlocks, getBlockAttrs, setBlockAttrs } from '../src/api';
import {
  replaceAssetInAttributeViews,
  restoreAttributeViewAssetCells,
} from '../src/utils/attribute-view';
import { defaultStorage } from '../src/utils/storage';
import {
  rollbackBatch,
  rollbackDeduplicationBatch,
  getRollbackChecklist,
  checkRollbackFilePresence,
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

  it('restores block attribute (title-img) references that live only in IAL', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("id = 'doc-block'")) {
        // 文档块的 markdown 为空，题头图引用只存在于 IAL 属性里
        return [{ id: 'doc-block', markdown: '', ial: '{: title-img="assets/keep.png"}' }];
      }
      return [];
    });
    vi.mocked(getBlockAttrs).mockResolvedValue({ 'title-img': 'assets/keep.png' } as any);

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'dup.png',
          originalRelativePath: 'data/assets/dup.png',
          size: 1024,
          canonicalName: 'keep.png',
          affectedBlocks: [{ id: 'doc-block', root_id: 'doc-block' }],
          originalIalSnapshots: { 'doc-block': { 'title-img': 'assets/dup.png' } },
        },
      ],
    });

    const result = await rollbackBatch(batch!.id);

    expect(setBlockAttrs).toHaveBeenCalledWith('doc-block', { 'title-img': 'assets/dup.png' });
    expect(result.report.restoredIalCount).toBe(1);
    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.skippedBlocksCount).toBe(0);
  });

  it('prefers the pre-merge snapshot for exact markdown restoration', async () => {
    const original = '![a](assets/keep.png) ![b](assets/dup.png)';
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("id = 'block-mixed'")) {
        // 合并后：本块原有引用与冗余图引用都变成了 keep.png
        return [{ id: 'block-mixed', markdown: '![a](assets/keep.png) ![b](assets/keep.png)', ial: '' }];
      }
      return [];
    });

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'dup.png',
          originalRelativePath: 'data/assets/dup.png',
          size: 1024,
          canonicalName: 'keep.png',
          affectedBlocks: [{ id: 'block-mixed', root_id: 'doc-1' }],
          originalMarkdownSnippets: { 'block-mixed': original },
        },
      ],
    });

    const result = await rollbackBatch(batch!.id);

    // 精确还原整段：原有的 keep 引用保持不变，零误伤
    expect(updateBlock).toHaveBeenCalledWith('markdown', original, 'block-mixed');
    expect(result.report.exactRestoredCount).toBe(1);
    expect(result.report.approximateRestoredCount).toBe(0);
  });

  it('falls back to limited approximate restoration when the block was edited after the merge', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("id = 'block-edited'")) {
        // 用户合并后又补了一张主图
        return [{ id: 'block-edited', markdown: '![b](assets/keep.png) 新增 ![a](assets/keep.png)', ial: '' }];
      }
      return [];
    });

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'dup.png',
          originalRelativePath: 'data/assets/dup.png',
          size: 1024,
          canonicalName: 'keep.png',
          affectedBlocks: [{ id: 'block-edited', root_id: 'doc-1' }],
          originalMarkdownSnippets: { 'block-edited': '![b](assets/dup.png)' },
        },
      ],
    });

    const result = await rollbackBatch(batch!.id);

    expect(updateBlock).toHaveBeenCalledWith(
      'markdown',
      '![b](assets/dup.png) 新增 ![a](assets/keep.png)',
      'block-edited'
    );
    expect(result.report.exactRestoredCount).toBe(0);
    expect(result.report.approximateRestoredCount).toBe(1);
  });

  it('restores attribute view cells by snapshot and aggregates view stats', async () => {
    vi.mocked(sql).mockResolvedValue([] as any);
    vi.mocked(restoreAttributeViewAssetCells).mockResolvedValue({
      restoredCount: 2,
      approximateCount: 1,
      skippedCount: 1,
    });

    const cells = [
      { viewId: 'av-1', keyId: 'key-cover', rowId: 'row-1', originalAssetContents: ['assets/dup.png'] },
    ];

    const batch = await recordDeletionBatch({
      actionType: 'deduplicate',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'dup.png',
          originalRelativePath: 'data/assets/dup.png',
          size: 1024,
          canonicalName: 'keep.png',
          affectedBlocks: [],
          affectedViews: cells,
        },
      ],
    });

    const result = await rollbackBatch(batch!.id);

    expect(restoreAttributeViewAssetCells).toHaveBeenCalledWith(cells, 'keep.png', 'dup.png');
    expect(result.report.restoredViewCellsCount).toBe(2);
    expect(result.report.skippedViewCellsCount).toBe(1);
    // 命中单元格快照时不再触发整文件按名替换
    expect(replaceAssetInAttributeViews).not.toHaveBeenCalled();
  });

  it('reports which rollback files are not yet restored into data/assets', async () => {
    vi.spyOn(defaultStorage, 'statAsset').mockImplementation(async (fileName: string) => {
      return fileName === 'present.png' ? ({ size: 10, updated: 1 } as any) : null;
    });

    const batch: any = {
      id: 'batch_presence',
      items: [
        { fileName: 'present.png', canonicalName: 'keep.png' },
        { fileName: 'missing.png', canonicalName: 'keep.png' },
      ],
    };

    const presence = await checkRollbackFilePresence(batch);

    expect(presence).toEqual([
      { fileName: 'present.png', present: true },
      { fileName: 'missing.png', present: false },
    ]);
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
    // 内核锚点接口不可用（老版本/异常）时的兜底路径
    vi.mocked(getChildBlocks).mockResolvedValue(null);

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
    // 无锚点可用 ⇒ 位置降级必须如实上报
    expect(result.report.degradedPositionCount).toBe(1);
    expect(insertBlock).toHaveBeenCalledWith(
      'markdown',
      '![single-orphan.png](assets/single-orphan.png)',
      expect.objectContaining({ parentID: 'doc-root-id' })
    );
  });

  it('按删除前采集的真实兄弟锚点精确还原原位置（不降级）', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("WHERE id = 'deleted-block-id'")) return [];
      return [];
    });
    vi.mocked(getChildBlocks).mockImplementation(async (id: string) => {
      if (id === 'doc-root-id') {
        return [
          { id: 'block-a', type: 'p' },
          { id: 'block-c', type: 'p' },
        ] as any;
      }
      return [] as any;
    });
    vi.mocked(insertBlock).mockClear();

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'anchored.png',
          originalRelativePath: 'data/assets/anchored.png',
          size: 1024,
          affectedBlocks: [
            {
              id: 'deleted-block-id',
              root_id: 'doc-root-id',
              parent_id: 'doc-root-id',
              previous_id: 'block-a',
              next_id: 'block-c',
              child_index: 1,
            },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![anchored.png](assets/anchored.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.degradedPositionCount).toBe(0);
    expect(insertBlock).toHaveBeenCalledTimes(1);
    expect(insertBlock).toHaveBeenCalledWith(
      'markdown',
      '![anchored.png](assets/anchored.png)',
      expect.objectContaining({ previousID: 'block-a' })
    );
  });

  it('原始相邻块漂移时按序号再锚定并计入位置降级', async () => {
    vi.mocked(sql).mockImplementation(async () => []);
    vi.mocked(getChildBlocks).mockResolvedValue([
      { id: 'block-c', type: 'p' },
      { id: 'block-d', type: 'p' },
      { id: 'block-e', type: 'p' },
    ] as any);
    vi.mocked(insertBlock).mockClear();

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'drifted.png',
          originalRelativePath: 'data/assets/drifted.png',
          size: 1024,
          affectedBlocks: [
            {
              id: 'deleted-block-id',
              root_id: 'doc-root-id',
              parent_id: 'doc-root-id',
              previous_id: 'block-a',
              next_id: 'block-z',
              child_index: 1,
            },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![drifted.png](assets/drifted.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.degradedPositionCount).toBe(1);
    expect(insertBlock).toHaveBeenCalledWith(
      'markdown',
      '![drifted.png](assets/drifted.png)',
      expect.objectContaining({ nextID: 'block-d' })
    );
  });

  it('旧日志无锚点时追加到容器末尾，绝不插到文档开头（回归）', async () => {
    vi.mocked(sql).mockImplementation(async () => []);
    vi.mocked(getChildBlocks).mockResolvedValue([
      { id: 'block-x', type: 'p' },
      { id: 'block-y', type: 'p' },
      { id: 'block-z', type: 'p' },
    ] as any);
    vi.mocked(insertBlock).mockClear();

    const legacyBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'legacy.png',
          originalRelativePath: 'data/assets/legacy.png',
          size: 1024,
          // 旧版本日志：只有 id / root_id，没有 previous_id / child_index
          affectedBlocks: [{ id: 'legacy-block', root_id: 'doc-root-id', parent_id: 'doc-root-id' }],
          originalMarkdownSnippets: {
            'legacy-block': '![legacy.png](assets/legacy.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(legacyBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.degradedPositionCount).toBe(1);
    // 必须带 sibling 锚点（追加到末尾），而不是裸 parentID（内核会 PrependChild 到文档首位）
    const options = vi.mocked(insertBlock).mock.calls[0][2] as any;
    expect(options.previousID).toBe('block-z');
    expect(options.nextID).toBeUndefined();
  });

  it('父容器已被级联清理时用文档层候选兜底并计入位置降级', async () => {
    vi.mocked(sql).mockImplementation(async () => []);
    vi.mocked(getChildBlocks).mockImplementation(async (id: string) => {
      if (id === 'doc-root-id') {
        return [
          { id: 'block-x', type: 'p' },
          { id: 'block-y', type: 'p' },
          { id: 'block-z', type: 'p' },
        ] as any;
      }
      // 列表项已被内核级联清理：子块查询返回空数组
      return [] as any;
    });
    vi.mocked(insertBlock)
      .mockClear()
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce([{ id: 'new-block' }] as any);

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'cascade.png',
          originalRelativePath: 'data/assets/cascade.png',
          size: 1024,
          affectedBlocks: [
            {
              id: 'deleted-block-id',
              root_id: 'doc-root-id',
              parent_id: 'list-item',
              child_index: 0,
              root_index: 1,
            },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![cascade.png](assets/cascade.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.degradedPositionCount).toBe(1);
    expect(result.report.failedBlocksCount).toBe(0);
    expect(vi.mocked(insertBlock).mock.calls[0][2]).toMatchObject({ parentID: 'list-item' });
    expect(vi.mocked(insertBlock).mock.calls[1][2]).toMatchObject({ nextID: 'block-y' });
  });

  it('候选锚点全部失败且原文档仍在时计入失败', async () => {
    vi.mocked(sql).mockImplementation(async (query: string) => {
      if (query.includes("WHERE id = 'doc-root-id'")) return [{ id: 'doc-root-id' }];
      return [];
    });
    vi.mocked(getChildBlocks).mockResolvedValue([{ id: 'block-x', type: 'p' }] as any);
    vi.mocked(insertBlock).mockClear().mockResolvedValue(null as any);

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'rejected.png',
          originalRelativePath: 'data/assets/rejected.png',
          size: 1024,
          affectedBlocks: [
            { id: 'deleted-block-id', root_id: 'doc-root-id', parent_id: 'doc-root-id', child_index: 0 },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![rejected.png](assets/rejected.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(0);
    expect(result.report.failedBlocksCount).toBe(1);
    expect(result.report.skippedBlocksCount).toBe(0);
  });

  it('原文档已被物理移除时记为安全跳过', async () => {
    vi.mocked(sql).mockImplementation(async () => []);
    vi.mocked(getChildBlocks).mockResolvedValue([] as any);
    vi.mocked(insertBlock).mockClear().mockResolvedValue(null as any);

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'gone.png',
          originalRelativePath: 'data/assets/gone.png',
          size: 1024,
          affectedBlocks: [
            { id: 'deleted-block-id', root_id: 'doc-root-id', parent_id: 'doc-root-id' },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![gone.png](assets/gone.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(result.report.restoredBlocksCount).toBe(0);
    expect(result.report.skippedBlocksCount).toBe(1);
    expect(result.report.failedBlocksCount).toBe(0);
  });

  it('候选锚点插入失败时逐个回退重试', async () => {
    vi.mocked(sql).mockImplementation(async () => []);
    vi.mocked(getChildBlocks).mockResolvedValue(null);
    vi.mocked(insertBlock)
      .mockClear()
      .mockResolvedValueOnce(null as any)
      .mockResolvedValueOnce([{ id: 'new-block' }] as any);

    const singleBatch = await recordDeletionBatch({
      actionType: 'single-delete',
      destination: 'os-trash',
      freedBytes: 1024,
      canRollback: true,
      items: [
        {
          fileName: 'retry.png',
          originalRelativePath: 'data/assets/retry.png',
          size: 1024,
          affectedBlocks: [
            {
              id: 'deleted-block-id',
              root_id: 'doc-root-id',
              parent_id: 'doc-root-id',
              previous_id: 'block-gone',
              next_id: 'block-next',
            },
          ],
          originalMarkdownSnippets: {
            'deleted-block-id': '![retry.png](assets/retry.png)',
          },
        },
      ],
    });

    const result = await rollbackBatch(singleBatch!.id);

    expect(insertBlock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(insertBlock).mock.calls[0][2]).toMatchObject({ previousID: 'block-gone' });
    expect(vi.mocked(insertBlock).mock.calls[1][2]).toMatchObject({ nextID: 'block-next' });
    expect(result.report.restoredBlocksCount).toBe(1);
    expect(result.report.failedBlocksCount).toBe(0);
  });
});
