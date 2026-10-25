import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { AssetInfo } from '../src/utils/siyuan-db';

vi.mock('../src/api', () => {
  const readDir = vi.fn(async () => []);
  const sql = vi.fn(async () => []);
  return {
    readDir,
    readDirGuarded: readDir,
    sql,
    sqlGuarded: sql,
  };
});

import {
  CATALOG_CACHE_TTL_MS,
  emptyReferenceData,
  getCachedCatalogInventory,
  invalidateCatalogCache,
  mergeAssetStatsInto,
  setCachedCatalogInventory,
} from '../src/utils/asset-catalog';

function makeInventory(names: string[]): { allAssets: AssetInfo[] } & Record<string, any> {
  return {
    allAssets: names.map((name) => ({
      name,
      size: 0,
      updated: 0,
      isDir: false,
      references: [],
      refCount: 0,
      docCount: 0,
      isReEditable: false,
      isOriginal: false,
    })),
    assetsMap: new Map(),
    originalAssets: [],
    orphanOriginals: [],
    totalOrphanSize: 0,
  } as any;
}

describe('目录库存缓存', () => {
  beforeEach(() => {
    invalidateCatalogCache();
  });

  it('未写入缓存时返回 null', () => {
    expect(getCachedCatalogInventory()).toBeNull();
  });

  it('写入后可读取同一份库存', () => {
    const inv = makeInventory(['a.png']);
    setCachedCatalogInventory(inv as any);
    expect(getCachedCatalogInventory()).toBe(inv as any);
  });

  it('invalidate 后缓存失效', () => {
    setCachedCatalogInventory(makeInventory(['a.png']) as any);
    invalidateCatalogCache();
    expect(getCachedCatalogInventory()).toBeNull();
  });

  it('超过 TTL 后缓存过期', () => {
    setCachedCatalogInventory(makeInventory(['a.png']) as any);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.now() + CATALOG_CACHE_TTL_MS + 1);
    try {
      expect(getCachedCatalogInventory()).toBeNull();
    } finally {
      now.mockRestore();
    }
  });
});

describe('mergeAssetStatsInto 阶段合并', () => {
  it('把上一轮补全的 size/updated 合并进新库存，不覆盖已有值', () => {
    const prev = makeInventory(['a.png', 'b.png']);
    (prev.allAssets[0] as AssetInfo).size = 100;
    (prev.allAssets[0] as AssetInfo).updated = 111;
    (prev.allAssets[1] as AssetInfo).size = 200;

    const next = makeInventory(['a.png', 'b.png', 'c.png']);
    (next.allAssets[1] as AssetInfo).size = 999; // 新库存已有值应保留

    mergeAssetStatsInto(next as any, prev.allAssets);

    expect((next.allAssets[0] as AssetInfo).size).toBe(100);
    expect((next.allAssets[0] as AssetInfo).updated).toBe(111);
    expect((next.allAssets[1] as AssetInfo).size).toBe(999);
    expect((next.allAssets[1] as AssetInfo).updated).toBe(0);
    expect((next.allAssets[2] as AssetInfo).size).toBe(0);
  });
});

describe('emptyReferenceData', () => {
  it('返回结构完整且全部为空的引用数据', () => {
    const data = emptyReferenceData();
    expect(data.entries).toEqual([]);
    expect(data.reEditBlocks).toEqual([]);
    expect(data.originalFiles).toEqual([]);
    expect(data.sidecarMetadataList).toEqual([]);
    expect(data.avReferencesMap.size).toBe(0);
    expect(data.agentAssets.size).toBe(0);
    expect(data.canvasInventory).toBeNull();
    expect(data.notebookMap.size).toBe(0);
  });
});
