import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', () => ({
  sql: vi.fn(async () => []),
  sqlGuarded: vi.fn(async () => []),
  readDirGuarded: vi.fn(),
  lsNotebooks: vi.fn(async () => ({ notebooks: [] })),
}));
vi.mock('../src/utils/file-system', () => ({
  listOriginalImages: vi.fn(async () => []),
  listAllAssetMetadataFiles: vi.fn(async () => []),
  saveAssetMetadataFile: vi.fn(),
}));
vi.mock('../src/utils/siyuan-block', () => ({
  queryAllReEditableBlocks: vi.fn(),
}));
vi.mock('../src/utils/attribute-view', () => ({
  resolveAttributeViewReferences: vi.fn(),
}));
vi.mock('../src/utils/canvas-asset', () => ({
  scanCanvasAssetsInventory: vi.fn(),
  resolveCanvasAssetTimestamp: vi.fn(),
}));
vi.mock('../src/utils/storage', () => ({
  defaultStorage: {
    adapter: {} as any,
    list: vi.fn(async () => []),
    read: vi.fn(async () => null),
    statAsset: vi.fn(),
  },
  blobToText: vi.fn(async () => ''),
}));

import { readDirGuarded } from '../src/api';
import { listAllAssetMetadataFiles, saveAssetMetadataFile } from '../src/utils/file-system';
import { queryAllReEditableBlocks } from '../src/utils/siyuan-block';
import { resolveAttributeViewReferences } from '../src/utils/attribute-view';
import { scanCanvasAssetsInventory } from '../src/utils/canvas-asset';
import { defaultStorage } from '../src/utils/storage';
import {
  fetchCatalogFiles,
  fetchCatalogSupportData,
  type CatalogSupportDataWithAnnotations,
} from '../src/utils/asset-catalog';

const readDirMock = vi.mocked(readDirGuarded);
const saveSidecarMock = vi.mocked(saveAssetMetadataFile);
const listSidecarsMock = vi.mocked(listAllAssetMetadataFiles);
const queryReEditMock = vi.mocked(queryAllReEditableBlocks);
const resolveAvMock = vi.mocked(resolveAttributeViewReferences);
const scanCanvasMock = vi.mocked(scanCanvasAssetsInventory);

const makeReEditBlock = (assetName: string, blockId = 'blk-1') => ({
  blockId,
  rootId: 'root-1',
  metadata: {
    renderedAssetName: assetName,
    originalStoragePath: `orig-store/${assetName}`,
    vectorLayers: '[]',
  } as any,
});

describe('fetchCatalogFiles · 枚举降级链', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete (defaultStorage.adapter as any).listDirEntries;
  });

  it('桌面端优先本地 listDirEntries 快速枚举并过滤系统垃圾文件', async () => {
    (defaultStorage.adapter as any).listDirEntries = vi.fn(async (dir: string) =>
      dir === '/data/assets'
        ? [
            { name: 'a.png', isDir: false },
            { name: '.DS_Store', isDir: false },
            { name: 'sub', isDir: true },
          ]
        : [],
    );

    const res = await fetchCatalogFiles();

    expect(res).toMatchObject({ source: 'local-fs', dirAvailable: true });
    expect(res.files).toEqual([{ name: 'a.png', size: 0, updated: 0, isDir: false }]);
    expect(readDirMock).not.toHaveBeenCalled();
  });

  it('本地枚举失败时回退内核 readDir（含递归发现）', async () => {
    (defaultStorage.adapter as any).listDirEntries = vi.fn(async () => {
      throw new Error('no local fs');
    });
    readDirMock.mockResolvedValue([
      { name: 'nested', isDir: true, size: 0, updated: 0 },
    ] as any);
    // 递归进入子目录
    readDirMock.mockImplementation(async (dir: string) => {
      if (dir === '/data/assets') return [{ name: 'nested', isDir: true }] as any;
      if (dir === '/data/assets/nested') return [{ name: 'b.png', isDir: false, size: 5, updated: 6 }] as any;
      return null as any;
    });

    const res = await fetchCatalogFiles();

    expect(res.source).toBe('kernel');
    expect(res.dirAvailable).toBe(true);
    expect(res.files).toEqual([{ name: 'nested/b.png', size: 5, updated: 6, isDir: false }]);
  });

  it('本地与内核均不可用时返回 dirAvailable=false（跳过引用阶段）', async () => {
    (defaultStorage.adapter as any).listDirEntries = vi.fn(async () => {
      throw new Error('no local fs');
    });
    readDirMock.mockRejectedValue(new Error('kernel down'));

    const res = await fetchCatalogFiles();

    expect(res).toEqual({ files: [], source: 'kernel', dirAvailable: false });
  });
});

describe('fetchCatalogSupportData · IAL→Sidecar 自动迁移写路径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAvMock.mockResolvedValue(new Map());
    scanCanvasMock.mockResolvedValue({} as any);
  });

  it('块 IAL 中的历史元数据缺失 Sidecar 时自动落盘并合入支持源', async () => {
    queryReEditMock.mockResolvedValue([makeReEditBlock('legacy.png')] as any);
    listSidecarsMock.mockResolvedValue([] as any);
    saveSidecarMock.mockResolvedValue(undefined);

    const res: CatalogSupportDataWithAnnotations = await fetchCatalogSupportData();

    expect(saveSidecarMock).toHaveBeenCalledWith('legacy.png', expect.objectContaining({ renderedAssetName: 'legacy.png' }));
    expect(res.sidecarMetadataList).toHaveLength(1);
    expect(res.sidecarMetadataList[0]).toMatchObject({ assetName: 'legacy.png' });
    expect(res.degraded).toBe(false);
  });

  it('Sidecar 已存在时不重复写盘', async () => {
    queryReEditMock.mockResolvedValue([makeReEditBlock('already.png')] as any);
    listSidecarsMock.mockResolvedValue([
      { assetName: 'already.png', metadata: makeReEditBlock('already.png').metadata },
    ] as any);

    await fetchCatalogSupportData();

    expect(saveSidecarMock).not.toHaveBeenCalled();
  });

  it('迁移写失败时告警并继续，不阻断采集流程', async () => {
    queryReEditMock.mockResolvedValue([
      makeReEditBlock('bad.png', 'blk-bad'),
      makeReEditBlock('good.png', 'blk-good'),
    ] as any);
    listSidecarsMock.mockResolvedValue([] as any);
    saveSidecarMock.mockRejectedValue(new Error('disk full'));

    const res = await fetchCatalogSupportData();

    expect(saveSidecarMock).toHaveBeenCalledTimes(2);
    expect(res.sidecarMetadataList).toHaveLength(0);
    expect(res.reEditBlocks).toHaveLength(2);
    expect(res.degraded).toBe(false);
  });

  it('属性视图解析失败时置 degraded，其余支持源照常返回', async () => {
    queryReEditMock.mockResolvedValue([] as any);
    listSidecarsMock.mockResolvedValue([] as any);
    resolveAvMock.mockRejectedValue(new Error('av broken'));

    const res = await fetchCatalogSupportData();

    expect(res.degraded).toBe(true);
    expect(res.reEditBlocks).toEqual([]);
    expect(res.originalFiles).toEqual([]);
  });

  it('画布扫描失败时同样置 degraded', async () => {
    queryReEditMock.mockResolvedValue([] as any);
    listSidecarsMock.mockResolvedValue([] as any);
    scanCanvasMock.mockRejectedValue(new Error('canvas broken'));

    const res = await fetchCatalogSupportData();

    expect(res.degraded).toBe(true);
    expect(res.canvasInventory).toBeNull();
  });
});
