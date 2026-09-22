import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AssetInfo } from '../src/utils/siyuan-db';
import * as fileSystem from '../src/utils/file-system';
import * as siyuanDb from '../src/utils/siyuan-db';
import * as siyuanBlock from '../src/utils/siyuan-block';
import * as deletionLogger from '../src/utils/deletion-logger';
import * as imageEditor from '../src/utils/image-editor';
import * as api from '../src/api';
import {
  buildSingleDeleteConfirmMessage,
  buildBatchDeleteConfirmMessage,
  buildUnifiedCleanupConfirmMessage,
  executeSingleAssetDeletion,
  executeBatchAssetsDeletion,
  executeUnifiedCleanup,
  type IBatchDeleteSummary,
  type ICleanupSummary,
} from '../src/utils/cleanup-workflow';

vi.mock('../src/api', () => ({
  sql: vi.fn(async () => []),
  pushMsg: vi.fn(),
}));

vi.mock('../src/utils/file-system', () => ({
  isTrashSupported: vi.fn(() => true),
  deleteOriginalImage: vi.fn(async () => true),
  readOriginalImage: vi.fn(async () => new Blob(['dummy'])),
}));

vi.mock('../src/utils/siyuan-db', () => ({
  deleteAssetFile: vi.fn(async () => {}),
  countReferencedDocs: vi.fn(() => 1),
}));

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

describe('cleanup-workflow service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Confirmation message builders', () => {
    it('builds confirmation message for single normal asset', () => {
      vi.mocked(fileSystem.isTrashSupported).mockReturnValue(true);
      const asset: AssetInfo = {
        name: 'test.png',
        size: 1024,
        updated: Date.now(),
        isDir: false,
        references: [{ id: 'b1', root_id: 'd1' }],
        refCount: 1,
        docCount: 1,
        isReEditable: false,
        isOriginal: false,
      };

      const msg = buildSingleDeleteConfirmMessage(asset);
      expect(msg.title).toBe('确认删除');
      expect(msg.message).toContain('确定要删除 test.png 吗？');
      expect(msg.message).toContain('操作系统回收站');
      expect(msg.message).not.toContain('多文档共享警告');

      // 多文档共享时需包含警告
      const multiDocAsset: AssetInfo = { ...asset, docCount: 3 };
      const multiMsg = buildSingleDeleteConfirmMessage(multiDocAsset);
      expect(multiMsg.message).toContain('多文档共享警告');
      expect(multiMsg.message).toContain('3 篇不同的文档');
    });

    it('builds confirmation message for single original image', () => {
      vi.mocked(fileSystem.isTrashSupported).mockReturnValue(true);
      const origAsset: AssetInfo = {
        name: 'orig_123.png',
        size: 2048,
        updated: Date.now(),
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 2,
        isReEditable: false,
        isOriginal: true,
        originalStoragePath: 'orig_123.png',
      };

      const msg = buildSingleDeleteConfirmMessage(origAsset);
      expect(msg.title).toBe('确认删除原始底图');
      expect(msg.message).toContain('高风险警告');
      expect(msg.message).toContain('2 个文档中的二次编辑图片关联');
    });

    it('builds confirmation message for batch deletion', () => {
      const summary: IBatchDeleteSummary = {
        totalCount: 5,
        regularCount: 3,
        originalCount: 2,
        sizeText: '5.2 MB',
        referencedCount: 2,
        referencedOriginalsCount: 1,
        regularAssets: [],
        originalAssets: [],
      };

      const msg = buildBatchDeleteConfirmMessage(summary);
      expect(msg.title).toContain('批量删除资源 (5 个)');
      expect(msg.message).toContain('普通资源文件：3 个');
      expect(msg.message).toContain('隔离原始底图：2 个');
      expect(msg.message).toContain('预计释放总空间：5.2 MB');
      expect(msg.message).toContain('所选资源中有 2 个已被文档引用');
      expect(msg.message).toContain('所选底图中有 1 个正被文档中的二次编辑图片关联');
    });

    it('builds confirmation message for unified cleanup', () => {
      const summary: ICleanupSummary = {
        totalCount: 10,
        unreferencedCount: 8,
        unreferencedSizeText: '4.0 MB',
        orphanOriginalsCount: 2,
        orphanOriginalsSizeText: '1.2 MB',
        sizeText: '5.2 MB',
        unreferencedAssets: [],
        orphanOriginals: [],
      };

      const msg = buildUnifiedCleanupConfirmMessage(summary);
      expect(msg.title).toBe('清理未引用资源与孤立底图');
      expect(msg.message).toContain('孤儿资源文件：8 个 (4.0 MB)');
      expect(msg.message).toContain('孤立原始底图：2 个 (1.2 MB)');
      expect(msg.message).toContain('预计释放总空间：5.2 MB');
    });
  });

  describe('executeSingleAssetDeletion', () => {
    it('deletes a regular asset and records deletion batch with rollback capability', async () => {
      vi.mocked(api.sql).mockResolvedValueOnce([
        { id: 'b1', parent_id: 'p1', root_id: 'd1', markdown: '![img](assets/foo.png)' },
      ]);

      const asset: AssetInfo = {
        name: 'foo.png',
        size: 1024,
        updated: Date.now(),
        isDir: false,
        references: [{ id: 'b1', root_id: 'd1' }],
        refCount: 1,
        docCount: 1,
        isReEditable: false,
        isOriginal: false,
      };

      const result = await executeSingleAssetDeletion(asset);

      expect(result.success).toBe(true);
      expect(siyuanDb.deleteAssetFile).toHaveBeenCalledWith('foo.png');
      expect(siyuanBlock.removeAssetFromBlocks).toHaveBeenCalledWith(asset.references, 'foo.png');
      expect(deletionLogger.recordDeletionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'single-delete',
          destination: 'os-trash',
          freedBytes: 1024,
          canRollback: true,
        })
      );
    });

    it('deletes an original image asset and records non-rollbackable batch', async () => {
      const origAsset: AssetInfo = {
        name: 'orig_photo.png',
        size: 4096,
        updated: Date.now(),
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: true,
        originalStoragePath: 'orig_photo.png',
      };

      const result = await executeSingleAssetDeletion(origAsset);

      expect(result.success).toBe(true);
      expect(fileSystem.deleteOriginalImage).toHaveBeenCalledWith('orig_photo.png');
      expect(deletionLogger.recordDeletionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'single-delete',
          destination: 'os-trash',
          freedBytes: 4096,
          canRollback: false,
        })
      );
    });
  });

  describe('executeBatchAssetsDeletion', () => {
    it('executes batch deletion across regular assets and original images', async () => {
      const regAsset: AssetInfo = {
        name: 'reg.png',
        size: 1000,
        updated: Date.now(),
        isDir: false,
        references: [{ id: 'b1', root_id: 'd1' }],
        refCount: 1,
        docCount: 1,
        isReEditable: false,
        isOriginal: false,
      };

      const origAsset: AssetInfo = {
        name: 'orig.png',
        size: 2000,
        updated: Date.now(),
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: true,
        originalStoragePath: 'orig.png',
      };

      const summary: IBatchDeleteSummary = {
        totalCount: 2,
        regularCount: 1,
        originalCount: 1,
        sizeText: '3.0 KB',
        referencedCount: 1,
        referencedOriginalsCount: 0,
        regularAssets: [regAsset],
        originalAssets: [origAsset],
      };

      const result = await executeBatchAssetsDeletion(summary);

      expect(result.success).toBe(true);
      expect(result.deletedRegularCount).toBe(1);
      expect(result.deletedOriginalCount).toBe(1);
      expect(result.freedBytes).toBe(3000);
      expect(siyuanDb.deleteAssetFile).toHaveBeenCalledWith('reg.png');
      expect(fileSystem.deleteOriginalImage).toHaveBeenCalledWith('orig.png');
      expect(deletionLogger.recordDeletionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'batch-delete',
          freedBytes: 3000,
          canRollback: true,
        })
      );
    });
  });

  describe('executeUnifiedCleanup', () => {
    it('cleans unreferenced assets and orphan original images', async () => {
      const orphanAsset: AssetInfo = {
        name: 'orphan.png',
        size: 500,
        updated: Date.now(),
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: false,
      };

      const orphanOrig: AssetInfo = {
        name: 'orig_orphan.png',
        size: 1500,
        updated: Date.now(),
        isDir: false,
        references: [],
        refCount: 0,
        docCount: 0,
        isReEditable: false,
        isOriginal: true,
        originalStoragePath: 'orig_orphan.png',
      };

      const summary: ICleanupSummary = {
        totalCount: 2,
        unreferencedCount: 1,
        unreferencedSizeText: '500 B',
        orphanOriginalsCount: 1,
        orphanOriginalsSizeText: '1.5 KB',
        sizeText: '2.0 KB',
        unreferencedAssets: [orphanAsset],
        orphanOriginals: [orphanOrig],
      };

      const result = await executeUnifiedCleanup(summary);

      expect(result.success).toBe(true);
      expect(result.deletedAssetsCount).toBe(1);
      expect(result.deletedOriginalsCount).toBe(1);
      expect(result.freedBytes).toBe(2000);
      expect(deletionLogger.recordDeletionBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'orphan-cleanup',
          freedBytes: 2000,
          canRollback: false,
        })
      );
    });
  });
});
