import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveCatalogPipeline } from '../src/utils/asset-catalog';
import {
  filterAssets,
  countMissingAssets,
  calculateBatchDeleteSummary,
  groupAssetsByDocument,
} from '../src/utils/asset-list';
import {
  buildSingleDeleteConfirmMessage,
  buildBatchDeleteConfirmMessage,
  executeSingleAssetDeletion,
  executeBatchAssetsDeletion,
} from '../src/utils/cleanup-workflow';
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db';
import * as siyuanDb from '../src/utils/siyuan-db';
import * as siyuanBlock from '../src/utils/siyuan-block';
import * as deletionLogger from '../src/utils/deletion-logger';

vi.mock('../src/api', () => ({
  sql: vi.fn(async () => []),
  pushMsg: vi.fn(),
}));

vi.mock('../src/utils/file-system', () => ({
  isTrashSupported: vi.fn(() => true),
  deleteOriginalImage: vi.fn(async () => true),
  readOriginalImage: vi.fn(async () => new Blob(['dummy'])),
}));

vi.mock('../src/utils/siyuan-db', async () => {
  const actual = await vi.importActual<typeof import('../src/utils/siyuan-db')>('../src/utils/siyuan-db');
  return {
    ...actual,
    deleteAssetFile: vi.fn(async () => {}),
  };
});

vi.mock('../src/utils/siyuan-block', () => ({
  removeAssetFromBlocks: vi.fn(async () => {}),
}));

vi.mock('../src/utils/deletion-logger', () => ({
  recordDeletionBatch: vi.fn(async () => {}),
}));

vi.mock('../src/utils/image-editor', () => ({
  captureAssetThumbnail: vi.fn(async () => 'data:image/webp;base64,mockthumb'),
}));

vi.mock('../src/utils/rollback-anchor', () => ({
  createChildBlocksCache: vi.fn(() => new Map()),
  captureBlockAnchors: vi.fn(async (blocks) => blocks.map((b: any) => ({ ...b, anchorType: 'adjacent' }))),
}));

describe('Missing Assets (丢失资源：有引用但无物理文件) Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Scanning and Catalog Pipeline Detection', () => {
    it('detects referenced assets missing from physical files and marks them as isMissing', () => {
      const files = [
        { name: 'existing.png', size: 1024, updated: 100, isDir: false },
      ];

      const blocks = [
        {
          id: 'block-1',
          root_id: 'doc-1',
          box: 'box-1',
          content: 'Normal asset',
          markdown: '![pic](assets/existing.png)',
          path: '/doc1.sy',
          hpath: '/知识库/常规',
        },
        {
          id: 'block-2',
          root_id: 'doc-1',
          box: 'box-1',
          content: 'Missing asset 1',
          markdown: '![pic](assets/missing-file.png)',
          path: '/doc1.sy',
          hpath: '/知识库/常规',
        },
        {
          id: 'block-3',
          root_id: 'doc-2',
          box: 'box-1',
          content: 'Missing asset 2',
          markdown: '![pic](assets/missing-file.png)',
          path: '/doc2.sy',
          hpath: '/知识库/进阶',
        },
      ];

      const notebookMap = new Map([['box-1', '笔记本']]);
      const inventory = resolveCatalogPipeline(files, blocks, [], [], notebookMap);

      // 存在的文件不标记 isMissing
      const existingAsset = inventory.assetsMap.get('existing.png');
      expect(existingAsset).toBeDefined();
      expect(existingAsset?.isMissing).toBeFalsy();
      expect(existingAsset?.docCount).toBe(1);

      // 缺失的文件自动识别为丢失资源
      const missingAsset = inventory.assetsMap.get('missing-file.png');
      expect(missingAsset).toBeDefined();
      expect(missingAsset?.isMissing).toBe(true);
      expect(missingAsset?.size).toBe(0);
      expect(missingAsset?.updated).toBe(0);
      expect(missingAsset?.docCount).toBe(2);
      expect(missingAsset?.refCount).toBe(2);
      expect(missingAsset?.references).toHaveLength(2);
    });

    it('detects missing assets from Attribute View (数据库) references', () => {
      const files: any[] = [];
      const blocks: any[] = [];

      const avReferencesMap = new Map<string, BlockRef[]>([
        [
          'av-missing-table.png',
          [
            {
              id: 'block-av-1',
              root_id: 'doc-av',
              box: 'box-1',
              content: '[数据库] 知识库',
              markdown: '',
              path: '/doc-av.sy',
              hpath: '/数据表',
              boxName: '笔记本',
              readablePath: '笔记本/数据表',
            },
          ],
        ],
      ]);

      const inventory = resolveCatalogPipeline(files, blocks, [], [], new Map(), [], avReferencesMap);

      const missingAvAsset = inventory.assetsMap.get('av-missing-table.png');
      expect(missingAvAsset).toBeDefined();
      expect(missingAvAsset?.isMissing).toBe(true);
      expect(missingAvAsset?.docCount).toBe(1);
      expect(missingAvAsset?.references[0].id).toBe('block-av-1');
    });

    it('merges markdown and attribute view references onto the same missing asset without duplicates', () => {
      const files: any[] = [];
      const blocks = [
        {
          id: 'block-1',
          root_id: 'doc-1',
          box: 'box-1',
          content: 'md ref',
          markdown: '![pic](assets/shared-missing.png)',
          path: '/doc1.sy',
        },
      ];

      const avReferencesMap = new Map<string, BlockRef[]>([
        [
          'shared-missing.png',
          [
            {
              id: 'block-av-row',
              root_id: 'doc-2',
              box: 'box-1',
              content: 'av ref',
              markdown: '',
              path: '/doc2.sy',
            },
          ],
        ],
      ]);

      const inventory = resolveCatalogPipeline(files, blocks, [], [], new Map(), [], avReferencesMap);

      const asset = inventory.assetsMap.get('shared-missing.png');
      expect(asset).toBeDefined();
      expect(asset?.isMissing).toBe(true);
      expect(asset?.docCount).toBe(2);
      expect(asset?.refCount).toBe(2);
      expect(asset?.references.map((r) => r.id)).toEqual(['block-1', 'block-av-row']);
    });
  });

  describe('2. Filtering and Grouping', () => {
    const mockAssets: AssetInfo[] = [
      {
        name: 'normal.png',
        size: 5000,
        updated: 100,
        isDir: false,
        references: [{ id: 'b1', root_id: 'd1', box: 'b', content: '', markdown: '', path: '' }],
        refCount: 1,
        docCount: 1,
      },
      {
        name: 'orphan.png',
        size: 2000,
        updated: 100,
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
      },
      {
        name: 'missing.png',
        size: 0,
        updated: 0,
        isDir: false,
        references: [{ id: 'b2', root_id: 'd1', box: 'b', content: '', markdown: '', path: '' }],
        refCount: 1,
        docCount: 1,
        isMissing: true,
      },
    ];

    it('filters missing assets correctly with filterType=missing', () => {
      const missingList = filterAssets(mockAssets, { searchQuery: '', filterType: 'missing' });
      expect(missingList).toHaveLength(1);
      expect(missingList[0].name).toBe('missing.png');
    });

    it('includes missing assets under filterType=all', () => {
      const allList = filterAssets(mockAssets, { searchQuery: '', filterType: 'all' });
      expect(allList).toHaveLength(3);
      expect(allList.some((a) => a.isMissing)).toBe(true);
    });

    it('excludes missing assets under filterType=unreferenced', () => {
      const unrefList = filterAssets(mockAssets, { searchQuery: '', filterType: 'unreferenced' });
      expect(unrefList).toHaveLength(1);
      expect(unrefList[0].name).toBe('orphan.png');
    });

    it('counts missing assets accurately', () => {
      expect(countMissingAssets(mockAssets)).toBe(1);
      expect(countMissingAssets([])).toBe(0);
    });

    it('calculates batch delete summary with missing assets', () => {
      const selectedNames = new Set(['normal.png', 'missing.png']);
      const summary = calculateBatchDeleteSummary(mockAssets, selectedNames);

      expect(summary.totalCount).toBe(2);
      expect(summary.regularCount).toBe(1);
      expect(summary.missingCount).toBe(1);
      expect(summary.missingAssets).toHaveLength(1);
      expect(summary.missingAssets[0].name).toBe('missing.png');
    });

    it('groups document assets and sets hasMissingAssets flag', () => {
      const groups = groupAssetsByDocument(mockAssets);
      const doc1Group = groups.find((g) => g.id === 'd1');

      expect(doc1Group).toBeDefined();
      expect(doc1Group?.hasMissingAssets).toBe(true);
      expect(doc1Group?.missingAssetCount).toBe(1);
      expect(doc1Group?.assets).toHaveLength(2);
    });
  });

  describe('3. Single & Batch Deletion Workflow', () => {
    const missingAsset: AssetInfo = {
      name: 'lost-image.png',
      size: 0,
      updated: 0,
      isDir: false,
      references: [
        { id: 'block-lost-1', root_id: 'doc-lost', box: 'box-1', content: '', markdown: '![lost](assets/lost-image.png)', path: '' },
      ],
      refCount: 1,
      docCount: 1,
      isMissing: true,
    };

    it('builds clear confirmation prompt for deleting a missing asset', () => {
      const confirmOpts = buildSingleDeleteConfirmMessage(missingAsset);
      expect(confirmOpts.title).toBe('确认清理丢失资源引用');
      expect(confirmOpts.message).toContain('在磁盘中已不存在（丢失资源）');
      expect(confirmOpts.confirmText).toBe('清理引用');
      expect(confirmOpts.danger).toBe(true);
    });

    it('builds batch delete confirmation message with missing assets itemized', () => {
      const summary = calculateBatchDeleteSummary([missingAsset], new Set(['lost-image.png']));
      const confirmOpts = buildBatchDeleteConfirmMessage(summary);

      expect(confirmOpts.message).toContain('丢失资源引用：1 项');
      expect(confirmOpts.message).toContain('物理文件已缺失，将清理文档引用链接');
    });

    it('executes single deletion of a missing asset by cleaning references and skipping deleteAssetFile', async () => {
      const showMsg = vi.fn();
      const result = await executeSingleAssetDeletion(missingAsset, { showMessage: showMsg });

      expect(result.success).toBe(true);
      // 物理文件不存在，绝不调用 deleteAssetFile
      expect(siyuanDb.deleteAssetFile).not.toHaveBeenCalled();
      // 正常清理文档引用
      expect(siyuanBlock.removeAssetFromBlocks).toHaveBeenCalledWith(missingAsset.references, 'lost-image.png');
      // 记录删除批次，标记可回退
      expect(deletionLogger.recordDeletionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'single-delete',
          canRollback: true,
        })
      );
      expect(showMsg).toHaveBeenCalledWith('丢失资源 lost-image.png 的文档引用已清理');
    });

    it('executes batch deletion handling missing assets cleanly alongside normal assets', async () => {
      const normalAsset: AssetInfo = {
        name: 'normal.png',
        size: 1000,
        updated: 100,
        isDir: false,
        references: [{ id: 'b1', root_id: 'd1', box: 'b', content: '', markdown: '', path: '' }],
        refCount: 1,
        docCount: 1,
      };

      const summary = calculateBatchDeleteSummary([normalAsset, missingAsset], new Set(['normal.png', 'lost-image.png']));
      const showMsg = vi.fn();

      const result = await executeBatchAssetsDeletion(summary, { showMessage: showMsg });

      expect(result.success).toBe(true);
      expect(result.deletedRegularCount).toBe(1);
      expect(result.deletedMissingCount).toBe(1);
      // 只为 normalAsset 调用了 deleteAssetFile
      expect(siyuanDb.deleteAssetFile).toHaveBeenCalledTimes(1);
      expect(siyuanDb.deleteAssetFile).toHaveBeenCalledWith('normal.png');
      // 两者都清理了引用
      expect(siyuanBlock.removeAssetFromBlocks).toHaveBeenCalledTimes(2);
      expect(showMsg).toHaveBeenCalledWith(expect.stringContaining('1 个资源、1 项丢失资源引用'));
    });
  });
});
