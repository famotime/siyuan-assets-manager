import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/file-system', () => ({
  readAssetFile: vi.fn(),
  deleteAsset: vi.fn(),
}));

vi.mock('../src/utils/siyuan-block', () => ({
  replaceAssetInBlocks: vi.fn(),
  queryCurrentAssetBlockReferences: vi.fn().mockResolvedValue([]),
  getImageBlockReEditData: vi.fn(),
  setImageBlockReEditData: vi.fn(),
}));

vi.mock('../src/utils/attribute-view', () => ({
  replaceAssetInAttributeViews: vi.fn().mockResolvedValue(0),
}));

import { readAssetFile, deleteAsset } from '../src/utils/file-system';
import { replaceAssetInBlocks, queryCurrentAssetBlockReferences, getImageBlockReEditData, setImageBlockReEditData } from '../src/utils/siyuan-block';
import { replaceAssetInAttributeViews } from '../src/utils/attribute-view';
import {
  isImageFile,
  groupBySize,
  computeFileHash,
  computeDHashFromGrayscale,
  calculateHammingDistance,
  calculateDHashSimilarity,
  scoreAssetCandidate,
  pickCanonicalAsset,
  calculateGroupRedundantSize,
  scanDuplicates,
  normalizeDuplicateGroup,
  batchNormalizeDuplicateGroups,
  saveDeduplicateCache,
  loadDeduplicateCache,
  clearDeduplicateCache,
  type IDuplicateGroup,
  type IDuplicateItem,
} from '../src/utils/deduplicate';
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db';

const readAssetFileMock = vi.mocked(readAssetFile);
const deleteAssetMock = vi.mocked(deleteAsset);
const replaceAssetInBlocksMock = vi.mocked(replaceAssetInBlocks);
const queryCurrentAssetBlockReferencesMock = vi.mocked(queryCurrentAssetBlockReferences);
const replaceAssetInAttributeViewsMock = vi.mocked(replaceAssetInAttributeViews);
const getImageBlockReEditDataMock = vi.mocked(getImageBlockReEditData);
const setImageBlockReEditDataMock = vi.mocked(setImageBlockReEditData);

function makeAsset(name: string, size: number, refCount = 0, opts: Partial<AssetInfo> = {}): AssetInfo {
  const refs: BlockRef[] = [];
  for (let i = 0; i < refCount; i++) {
    refs.push({
      id: `block-${name}-${i}`,
      root_id: `doc-${name}`,
      box: 'box-1',
      content: '',
      markdown: `![img](assets/${name})`,
      path: '/doc.sy',
    });
  }
  return {
    name,
    size,
    updated: 1700000000000,
    isDir: false,
    references: refs,
    refCount,
    docCount: refCount > 0 ? 1 : 0,
    isReEditable: false,
    isOriginal: false,
    ...opts,
  };
}

describe('deduplicate utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryCurrentAssetBlockReferencesMock.mockResolvedValue([]);
    replaceAssetInAttributeViewsMock.mockResolvedValue(0);
  });

  describe('isImageFile', () => {
    it('correctly identifies image extensions', () => {
      expect(isImageFile('foo.PNG')).toBe(true);
      expect(isImageFile('bar.jpg')).toBe(true);
      expect(isImageFile('baz.webp')).toBe(true);
      expect(isImageFile('test.svg')).toBe(true);
      expect(isImageFile('doc.pdf')).toBe(false);
      expect(isImageFile('audio.mp3')).toBe(false);
      expect(isImageFile('')).toBe(false);
    });
  });

  describe('groupBySize', () => {
    it('groups assets with matching file size >= 2 and filters out unique sizes', () => {
      const a1 = makeAsset('a1.png', 1024);
      const a2 = makeAsset('a2.png', 1024);
      const b1 = makeAsset('b1.png', 2048);
      const c1 = makeAsset('c1.png', 4096);
      const c2 = makeAsset('c2.png', 4096);
      const c3 = makeAsset('c3.png', 4096);
      const d1 = makeAsset('d1.png', 0); // 0 bytes ignored

      const map = groupBySize([a1, a2, b1, c1, c2, c3, d1]);
      expect(map.size).toBe(2);
      expect(map.get(1024)?.length).toBe(2);
      expect(map.get(4096)?.length).toBe(3);
      expect(map.has(2048)).toBe(false);
      expect(map.has(0)).toBe(false);
    });
  });

  describe('computeFileHash', () => {
    it('generates consistent hash for identical blob contents', async () => {
      const blob1 = new Blob(['hello siyuan assets manager']);
      const blob2 = new Blob(['hello siyuan assets manager']);
      const blob3 = new Blob(['different content']);

      const hash1 = await computeFileHash(blob1);
      const hash2 = await computeFileHash(blob2);
      const hash3 = await computeFileHash(blob3);

      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(hash1.length).toBeGreaterThan(0);
    });
  });

  describe('dHash and similarity calculation', () => {
    it('computes 64-bit dHash from 8x9 grayscale matrix', () => {
      // 8 rows of 9 columns
      const grayMatrix: number[][] = [];
      for (let r = 0; r < 8; r++) {
        grayMatrix.push([100, 90, 80, 70, 60, 50, 40, 30, 20]); // All left > right -> '11111111'
      }
      const hash = computeDHashFromGrayscale(grayMatrix);
      expect(hash).toBe('1'.repeat(64));
    });

    it('calculates Hamming distance and similarity accurately', () => {
      const hashA = '1'.repeat(64);
      const hashB = '1'.repeat(64);
      expect(calculateHammingDistance(hashA, hashB)).toBe(0);
      expect(calculateDHashSimilarity(hashA, hashB)).toBe(1.0);

      const hashC = '0'.repeat(64);
      expect(calculateHammingDistance(hashA, hashC)).toBe(64);
      expect(calculateDHashSimilarity(hashA, hashC)).toBe(0.0);

      // 4 bits different -> similarity = 1 - 4/64 = 0.9375
      const hashD = '0000' + '1'.repeat(60);
      expect(calculateHammingDistance(hashA, hashD)).toBe(4);
      expect(calculateDHashSimilarity(hashA, hashD)).toBe(0.9375);
    });
  });

  describe('scoring and canonical asset selection', () => {
    it('prioritizes re-editable, then refCount, then size/resolution', () => {
      const normal = makeAsset('normal.png', 1000, 1);
      const highlyReferenced = makeAsset('popular.png', 1000, 5);
      const reEditable = makeAsset('vector.png', 1000, 1, { isReEditable: true });

      const scoreNormal = scoreAssetCandidate(normal);
      const scorePopular = scoreAssetCandidate(highlyReferenced);
      const scoreReEdit = scoreAssetCandidate(reEditable);

      expect(scorePopular).toBeGreaterThan(scoreNormal);
      expect(scoreReEdit).toBeGreaterThan(scorePopular);
    });

    it('pickCanonicalAsset selects the highest scoring asset', () => {
      const item1: IDuplicateItem = {
        asset: makeAsset('a.png', 1000, 1),
        score: 150,
        isCanonical: false,
      };
      const item2: IDuplicateItem = {
        asset: makeAsset('b.png', 1000, 5),
        score: 550,
        isCanonical: false,
      };
      const item3: IDuplicateItem = {
        asset: makeAsset('c.png', 1000, 0),
        score: 50,
        isCanonical: false,
      };

      const canonicalName = pickCanonicalAsset([item1, item2, item3]);
      expect(canonicalName).toBe('b.png');
    });

    it('calculateGroupRedundantSize sums up non-canonical file sizes', () => {
      const items: IDuplicateItem[] = [
        { asset: makeAsset('a.png', 1000), score: 100, isCanonical: true },
        { asset: makeAsset('b.png', 1000), score: 50, isCanonical: false },
        { asset: makeAsset('c.png', 1000), score: 50, isCanonical: false },
      ];
      expect(calculateGroupRedundantSize(items, 'a.png')).toBe(2000);
    });
  });

  describe('scanDuplicates', () => {
    it('scans exact duplicate files based on content hash', async () => {
      const assetA = makeAsset('imgA.png', 5000, 2);
      const assetB = makeAsset('imgB.png', 5000, 1);
      const assetC = makeAsset('imgC.png', 2000, 1);

      readAssetFileMock.mockImplementation(async (name: string) => {
        if (name === 'imgA.png' || name === 'imgB.png') {
          return new Blob(['same binary content']);
        }
        return new Blob(['unique content for C']);
      });

      const { exactGroups, similarGroups } = await scanDuplicates([assetA, assetB, assetC]);

      expect(exactGroups.length).toBe(1);
      expect(exactGroups[0].items.length).toBe(2);
      expect(exactGroups[0].canonicalAssetName).toBe('imgA.png'); // imgA has 2 refs vs imgB 1 ref
      expect(exactGroups[0].redundantCount).toBe(1);
      expect(exactGroups[0].redundantSize).toBe(5000);
    });

    it('returns empty result when abortSignal is aborted immediately', async () => {
      const assetA = makeAsset('imgA.png', 5000, 2);
      const assetB = makeAsset('imgB.png', 5000, 1);

      const res = await scanDuplicates([assetA, assetB], {
        abortSignal: { aborted: true },
      });

      expect(res.exactGroups).toEqual([]);
      expect(res.similarGroups).toEqual([]);
    });
  });

  describe('normalization workflow', () => {
    it('normalizes single duplicate group: replaces references, syncs reedit metadata, and deletes redundant file', async () => {
      const canonical = makeAsset('main.png', 4000, 2, {
        isReEditable: true,
        reEditBlockId: 'canonical-block-id',
      });
      const redundant = makeAsset('copy.png', 4000, 1);

      const group: IDuplicateGroup = {
        id: 'exact_1',
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: 'main.png',
        items: [
          { asset: canonical, score: 10500, isCanonical: true },
          { asset: redundant, score: 150, isCanonical: false },
        ],
        redundantCount: 1,
        redundantSize: 4000,
      };

      const mockReEditMeta = {
        version: 1,
        renderedAssetName: 'main.png',
        originalStoragePath: 'storage/petal/siyuan-assets-manager/originals/orig.png',
        fabricJson: '{"objects":[]}',
      };
      getImageBlockReEditDataMock.mockResolvedValue(mockReEditMeta);

      const stats = await normalizeDuplicateGroup(group);

      expect(replaceAssetInBlocksMock).toHaveBeenCalledWith(
        redundant.references,
        'copy.png',
        'main.png'
      );
      expect(deleteAssetMock).toHaveBeenCalledWith('copy.png');
      expect(stats.affectedBlocksCount).toBe(1);
      expect(stats.affectedDocsCount).toBe(1);
      expect(stats.deletedFilesCount).toBe(1);
      expect(stats.freedBytes).toBe(4000);
      expect(group.isProcessed).toBe(true);
    });

    it('aborts and does not delete file if pre-delete double check finds remaining references', async () => {
      const canonical = makeAsset('main.png', 4000, 1);
      const redundant = makeAsset('copy.png', 4000, 1);

      const group: IDuplicateGroup = {
        id: 'exact_safe_check',
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: 'main.png',
        items: [
          { asset: canonical, score: 500, isCanonical: true },
          { asset: redundant, score: 100, isCanonical: false },
        ],
        redundantCount: 1,
        redundantSize: 4000,
      };

      // 模拟情况：第一次查询引用（合并不变），第二次在删除前二次复核时发现思源库中还有残留引用未清干净
      queryCurrentAssetBlockReferencesMock
        .mockResolvedValueOnce([]) // 步骤 1: 动态全库实时查询最新引用
        .mockResolvedValueOnce([   // 步骤 4: Pre-delete Double Check 发现残留
          {
            id: 'residual-block-id',
            root_id: 'doc-1',
            box: 'box-1',
            content: '',
            markdown: '![residual](assets/copy.png)',
            path: '/doc.sy',
          },
        ]);

      await expect(normalizeDuplicateGroup(group)).rejects.toThrow('去重安全拦截');

      // 绝不能调用物理文件删除！
      expect(deleteAssetMock).not.toHaveBeenCalled();
      expect(group.isProcessed).toBeFalsy();
    });

    it('combines fresh block references from live query when cached references are empty or stale', async () => {
      const canonical = makeAsset('main.png', 4000, 1);
      // 模拟快照中 references 为空（例如新写文档引用了 copy.png）
      const redundant = makeAsset('copy.png', 4000, 0);

      const group: IDuplicateGroup = {
        id: 'exact_live_query',
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: 'main.png',
        items: [
          { asset: canonical, score: 500, isCanonical: true },
          { asset: redundant, score: 100, isCanonical: false },
        ],
        redundantCount: 1,
        redundantSize: 4000,
      };

      const liveRef: BlockRef = {
        id: 'live-block-99',
        root_id: 'doc-live',
        box: 'box-1',
        content: '',
        markdown: '![img](assets/copy.png)',
        path: '/live.sy',
      };

      queryCurrentAssetBlockReferencesMock
        .mockResolvedValueOnce([liveRef]) // 实时动态补充
        .mockResolvedValueOnce([]);        // 删除前复核无残留

      const stats = await normalizeDuplicateGroup(group);

      expect(replaceAssetInBlocksMock).toHaveBeenCalledWith(
        [liveRef],
        'copy.png',
        'main.png'
      );
      expect(deleteAssetMock).toHaveBeenCalledWith('copy.png');
      expect(stats.affectedBlocksCount).toBe(1);
      expect(stats.affectedDocsCount).toBe(1);
      expect(stats.deletedFilesCount).toBe(1);
    });

    it('batchNormalizeDuplicateGroups aggregates stats across multiple groups', async () => {
      const g1: IDuplicateGroup = {
        id: 'g1',
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: 'g1_main.png',
        items: [
          { asset: makeAsset('g1_main.png', 1000, 1), score: 200, isCanonical: true },
          { asset: makeAsset('g1_copy.png', 1000, 1), score: 100, isCanonical: false },
        ],
        redundantCount: 1,
        redundantSize: 1000,
      };
      const g2: IDuplicateGroup = {
        id: 'g2',
        mode: 'exact',
        similarity: 1.0,
        canonicalAssetName: 'g2_main.png',
        items: [
          { asset: makeAsset('g2_main.png', 2000, 0), score: 100, isCanonical: true },
          { asset: makeAsset('g2_copy.png', 2000, 0), score: 50, isCanonical: false },
        ],
        redundantCount: 1,
        redundantSize: 2000,
      };

      const progressCallback = vi.fn();
      const stats = await batchNormalizeDuplicateGroups([g1, g2], undefined, progressCallback);

      expect(stats.deletedFilesCount).toBe(2);
      expect(stats.freedBytes).toBe(3000);
      expect(progressCallback).toHaveBeenCalledTimes(2);
      expect(g1.isProcessed).toBe(true);
      expect(g2.isProcessed).toBe(true);
    });
  });

  describe('deduplicate persistence cache', () => {
    it('saves and loads deduplicate cache to/from storage', async () => {
      const mockCache = {
        version: 1,
        lastScanTime: 1700000000000,
        similarityThreshold: 95,
        exactGroups: [
          {
            id: 'exact_1',
            mode: 'exact' as const,
            similarity: 1.0,
            canonicalAssetName: 'a.png',
            items: [],
            redundantCount: 1,
            redundantSize: 1024,
          },
        ],
        similarGroups: [],
      };

      const saveOk = await saveDeduplicateCache(mockCache);
      expect(saveOk).toBe(true);

      const loaded = await loadDeduplicateCache();
      expect(loaded).not.toBeNull();
      expect(loaded?.lastScanTime).toBe(1700000000000);
      expect(loaded?.exactGroups.length).toBe(1);
      expect(loaded?.exactGroups[0].canonicalAssetName).toBe('a.png');

      const clearOk = await clearDeduplicateCache();
      expect(clearOk).toBe(true);

      const afterClear = await loadDeduplicateCache();
      expect(afterClear).toBeNull();
    });
  });
});
