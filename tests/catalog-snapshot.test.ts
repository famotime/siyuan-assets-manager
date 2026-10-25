import { describe, expect, it, beforeEach } from 'vitest';
import {
  MemoryStorageAdapter,
  setStorageAdapter,
} from '../src/utils/storage';

import {
  buildCatalogWatermark,
  formatSiYuanTimestamp,
  loadCatalogSnapshot,
  overlaySnapshotFileStats,
  saveCatalogSnapshot,
  WATERMARK_MARGIN_MS,
  type CatalogSnapshot,
} from '../src/utils/catalog-snapshot';

function makeSnapshot(): CatalogSnapshot {
  return {
    savedAt: 1770000000000,
    watermark: '20261001120000',
    files: [
      { name: 'a.png', size: 100, updated: 1770000000, isDir: false },
      { name: 'sub/b.pdf', size: 0, updated: 0, isDir: false },
    ],
    entries: new Map([
      ['blk-1', {
        id: 'blk-1',
        root_id: 'doc-1',
        box: 'box-1',
        content: '摘要文本',
        path: '/doc1.sy',
        hpath: '/知识库/文档',
        rawAssetNames: ['a.png', 'assets/widget/'],
      }],
      ['blk-2', {
        id: 'blk-2',
        root_id: 'doc-2',
        box: 'box-1',
        content: '',
        path: '/doc2.sy',
        hpath: undefined,
        rawAssetNames: ['sub/b.pdf'],
      }],
    ]),
  };
}

describe('目录库存快照', () => {
  beforeEach(() => {
    setStorageAdapter(new MemoryStorageAdapter());
  });

  it('快照写入后可无损读回（文件、条目、水位线）', async () => {
    const snapshot = makeSnapshot();
    const ok = await saveCatalogSnapshot(snapshot);
    expect(ok).toBe(true);

    const loaded = await loadCatalogSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded!.watermark).toBe('20261001120000');
    expect(loaded!.savedAt).toBe(1770000000000);
    expect(loaded!.files).toHaveLength(2);
    expect(loaded!.files[1]).toMatchObject({ name: 'sub/b.pdf', size: 0 });

    expect(loaded!.entries.size).toBe(2);
    const entry1 = loaded!.entries.get('blk-1')!;
    expect(entry1.root_id).toBe('doc-1');
    expect(entry1.hpath).toBe('/知识库/文档');
    expect(entry1.rawAssetNames).toEqual(['a.png', 'assets/widget/']);
    // hpath 为空的条目读回后保持空串（装配层兼容 undefined 语义）
    expect(loaded!.entries.get('blk-2')!.hpath).toBeFalsy();
  });

  it('快照缺失时返回 null', async () => {
    expect(await loadCatalogSnapshot()).toBeNull();
  });

  it('损坏或版本不符的快照返回 null 而非抛错', async () => {
    const adapter = new MemoryStorageAdapter();
    setStorageAdapter(adapter);
    await adapter.write('/data/storage/petal/siyuan-assets-manager/cache/catalog-snapshot.json', new Blob(['{not json']));
    expect(await loadCatalogSnapshot()).toBeNull();

    await adapter.write('/data/storage/petal/siyuan-assets-manager/cache/catalog-snapshot.json', new Blob([JSON.stringify({ v: 999 })]));
    expect(await loadCatalogSnapshot()).toBeNull();
  });

  it('空快照（无文件无条目）返回 null 触发全量回退', async () => {
    const ok = await saveCatalogSnapshot({
      savedAt: Date.now(),
      watermark: '20261001120000',
      files: [],
      entries: new Map(),
    });
    expect(ok).toBe(true);
    expect(await loadCatalogSnapshot()).toBeNull();
  });

  it('水位线 = 取样时刻减回退余量，格式为 yyyyMMddHHmmss', () => {
    const at = new Date(2026, 9, 25, 10, 30, 0).getTime();
    expect(formatSiYuanTimestamp(at)).toBe('20261025103000');
    expect(buildCatalogWatermark(at)).toBe(formatSiYuanTimestamp(at - WATERMARK_MARGIN_MS));
  });
});

describe('overlaySnapshotFileStats 体积持久化覆盖', () => {
  it('用资产已知 size 覆盖全 0 的文件元组，且不被 0 回退', () => {
    const files = [
      { name: 'a.mp4', size: 0, updated: 0, isDir: false },
      { name: 'b.png', size: 512, updated: 100, isDir: false },
      { name: 'gone.png', size: 0, updated: 0, isDir: false },
    ]
    const assets = [
      { name: 'a.mp4', size: 123456789, updated: 1770000000000 },
      { name: 'b.png', size: 0, updated: 0 }, // 资产侧未知，不得回退文件侧已有值
    ]
    const merged = overlaySnapshotFileStats(files, assets)
    expect(merged[0]).toMatchObject({ name: 'a.mp4', size: 123456789 })
    expect(merged[1]).toMatchObject({ name: 'b.png', size: 512, updated: 100 })
    expect(merged[2]).toMatchObject({ name: 'gone.png', size: 0 })
  })

  it('同名多来源时保留较大的 size 并补齐 updated', () => {
    const files = [{ name: 'x.pdf', size: 0, updated: 0, isDir: false }]
    const assets = [
      { name: 'x.pdf', size: 100, updated: 0 },
      { name: 'x.pdf', size: 900, updated: 555 },
    ]
    const merged = overlaySnapshotFileStats(files, assets)
    expect(merged[0].size).toBe(900)
    expect(merged[0].updated).toBe(555)
  })
})
