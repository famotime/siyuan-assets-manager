import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlugin } from '../src/utils/plugin-context';
import {
  FINGERPRINT_STORE_FILE,
  FINGERPRINT_STORE_VERSION,
  createEmptyFingerprintStore,
  isFingerprintValid,
  pruneFingerprintStore,
  countFingerprintEntries,
  loadFingerprintStore,
  saveFingerprintStore,
  clearFingerprintStore,
} from '../src/utils/dedup-fingerprint-store';
import type { AssetInfo } from '../src/utils/siyuan-db';

function makeAsset(name: string, size: number, updated: number): AssetInfo {
  return {
    name,
    size,
    updated,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    isReEditable: false,
    isOriginal: false,
  };
}

describe('isFingerprintValid', () => {
  const asset = makeAsset('a.png', 1024, 1700000000000);

  it('accepts an entry matching both size and updated', () => {
    expect(isFingerprintValid({ size: 1024, updated: 1700000000000 }, asset)).toBe(true);
  });

  it('rejects when the entry is missing', () => {
    expect(isFingerprintValid(undefined, asset)).toBe(false);
  });

  it('rejects when size changed', () => {
    expect(isFingerprintValid({ size: 2048, updated: 1700000000000 }, asset)).toBe(false);
  });

  it('rejects when updated changed', () => {
    expect(isFingerprintValid({ size: 1024, updated: 1700000000001 }, asset)).toBe(false);
  });

  it('rejects when updated is not a positive timestamp', () => {
    // HTTP 回退路径可能给出 0（见 http-adapter 的 stat 实现）——语义为"未知"，必须判失效
    expect(isFingerprintValid({ size: 1024, updated: 0 }, makeAsset('a.png', 1024, 0))).toBe(false);
  });
});

describe('pruneFingerprintStore', () => {
  it('drops entries whose asset is no longer present and reports the count', () => {
    const store = createEmptyFingerprintStore();
    store.entries['a.png'] = { size: 1, updated: 1 };
    store.entries['b.png'] = { size: 2, updated: 2 };
    store.entries['gone.png'] = { size: 3, updated: 3 };

    const removed = pruneFingerprintStore(store, new Set(['a.png', 'b.png']));

    expect(removed).toBe(1);
    expect(countFingerprintEntries(store)).toBe(2);
    expect(store.entries['gone.png']).toBeUndefined();
  });

  it('is a no-op when everything is live', () => {
    const store = createEmptyFingerprintStore();
    store.entries['a.png'] = { size: 1, updated: 1 };
    expect(pruneFingerprintStore(store, new Set(['a.png']))).toBe(0);
  });
});

describe('fingerprint store persistence', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('round-trips through plugin.saveData / loadData', async () => {
    const store = new Map<string, any>();
    usePlugin({
      // 真实 plugin.saveData 会把数据序列化后落盘（思源内部走 JSON），
      // 此处按引用存储只会证明"原样透传"。序列化后存，才能真正验证
      // 写入的数据是可序列化的，读到的是副本而非同一对象。
      saveData: vi.fn(async (file: string, data: any) => { store.set(file, JSON.parse(JSON.stringify(data))); }),
      loadData: vi.fn(async (file: string) => store.get(file) ?? null),
      removeData: vi.fn(async (file: string) => { store.delete(file); }),
    } as any);

    const fp = createEmptyFingerprintStore();
    fp.entries['a.png'] = { size: 1024, updated: 1700000000000, sha256: 'deadbeef', dHash: '0101', width: 9, height: 8 };

    expect(await saveFingerprintStore(fp)).toBe(true);
    expect(store.has(FINGERPRINT_STORE_FILE)).toBe(true);

    // 落盘内容本身必须是完整的指纹结构，而不只是被调用过
    const persisted = store.get(FINGERPRINT_STORE_FILE);
    expect(persisted.version).toBe(FINGERPRINT_STORE_VERSION);
    expect(persisted.entries['a.png'].width).toBe(9);
    expect(persisted.entries['a.png'].height).toBe(8);

    const loaded = await loadFingerprintStore();
    expect(loaded.version).toBe(FINGERPRINT_STORE_VERSION);
    expect(loaded.entries['a.png'].sha256).toBe('deadbeef');
    expect(loaded.entries['a.png'].dHash).toBe('0101');
    expect(loaded.entries['a.png'].width).toBe(9);
    expect(loaded.entries['a.png'].height).toBe(8);
    // 读回的是副本：后续对内存中指纹对象的改动不会污染"已落盘"的内容
    expect(loaded.entries['a.png']).not.toBe(fp.entries['a.png']);
  });

  it('returns an empty store when the stored version does not match', async () => {
    usePlugin({
      loadData: vi.fn(async () => ({ version: 999, entries: { 'a.png': { size: 1, updated: 1 } } })),
      saveData: vi.fn(),
      removeData: vi.fn(),
    } as any);

    const loaded = await loadFingerprintStore();
    expect(loaded.version).toBe(FINGERPRINT_STORE_VERSION);
    expect(countFingerprintEntries(loaded)).toBe(0);
  });

  it('returns an empty store when loadData throws', async () => {
    usePlugin({
      loadData: vi.fn(async () => { throw new Error('nope'); }),
      saveData: vi.fn(),
      removeData: vi.fn(),
    } as any);

    expect(countFingerprintEntries(await loadFingerprintStore())).toBe(0);
  });

  it('clears the persisted file via removeData', async () => {
    const removeData = vi.fn(async () => {});
    usePlugin({ loadData: vi.fn(), saveData: vi.fn(), removeData } as any);

    expect(await clearFingerprintStore()).toBe(true);
    expect(removeData).toHaveBeenCalledWith(FINGERPRINT_STORE_FILE);
  });

  it('never falls back to localStorage when plugin.saveData is unavailable', async () => {
    // 指纹规模是 O(全部资源)，10000 条约 1.5–3MB，写入 5MB 上限的 localStorage
    // 会顶爆配额并连带破坏分组缓存。故此处刻意不设兜底。
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    usePlugin({ loadData: vi.fn() } as any);

    const ok = await saveFingerprintStore(createEmptyFingerprintStore());

    expect(ok).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
  });
});
