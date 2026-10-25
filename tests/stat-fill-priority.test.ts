import { describe, expect, it, vi, beforeEach } from 'vitest';
import { setStorageAdapter, type IStorageAdapter } from '../src/utils/storage';
import { fillMissingAssetStats } from '../src/utils/asset-catalog';
import type { AssetInfo } from '../src/utils/siyuan-db';

function makeAsset(name: string, overrides: Partial<AssetInfo> = {}): AssetInfo {
  return {
    name,
    size: 0,
    updated: 0,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    isReEditable: false,
    isOriginal: false,
    ...overrides,
  };
}

describe('fillMissingAssetStats 体积大头优先补全', () => {
  let statOrder: string[] = [];

  beforeEach(() => {
    statOrder = [];
    const adapter: IStorageAdapter = {
      stat: vi.fn(async () => null),
      read: vi.fn(async () => null),
      write: vi.fn(async () => {}),
      delete: vi.fn(async () => true),
      list: vi.fn(async () => []),
      statAsync: vi.fn(async (path: string) => {
        const name = path.split('/').pop() || path;
        statOrder.push(name);
        return { size: 1000, updated: 1770000000000, isDir: false };
      }),
    };
    setStorageAdapter(adapter);
  });

  it('视频/音频/文档等非图片资源先于数万图片补全（体积统计秒级逼近真值）', async () => {
    const assets = [
      makeAsset('img-0001.png'),
      makeAsset('clip-001.mp4'),
      makeAsset('img-0002.png'),
      makeAsset('voice-001.mp3'),
      makeAsset('doc-001.pdf'),
      makeAsset('img-0003.png'),
    ];

    const result = await fillMissingAssetStats(assets, {}, 4);

    expect(result.updated).toBe(6);
    // 前三个必须是非图片（mp4/mp3/pdf），图片全部排在其后
    const firstThree = statOrder.slice(0, 3).sort();
    expect(firstThree).toEqual(['clip-001.mp4', 'doc-001.pdf', 'voice-001.mp3']);
    expect(statOrder.slice(3).sort()).toEqual(['img-0001.png', 'img-0002.png', 'img-0003.png']);
  });

  it('已有完整 size/updated 的资源与丢失资源均不进入补全队列', async () => {
    const assets = [
      makeAsset('full.png', { size: 100, updated: 123 }),
      makeAsset('missing.mp4', { isMissing: true }),
      makeAsset('bottom.png', { isOriginal: true, originalStoragePath: 'x' }),
      makeAsset('todo.mp4'),
    ];
    const result = await fillMissingAssetStats(assets, {}, 4);
    expect(result.updated).toBe(1);
    expect(statOrder).toEqual(['todo.mp4']);
  });
});
