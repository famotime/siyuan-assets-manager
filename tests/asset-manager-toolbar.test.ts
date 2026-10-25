import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db';

const hoisted = vi.hoisted(() => ({
  assets: [] as AssetInfo[],
  /** 挂起的数据库查询，测试可手动放行以观察加载中的中间态 */
  pending: [] as Array<() => void>,
  /** 置为 true 时下一次查询以失败告终，用于验证失败的刷新不改写刷新时间 */
  failNext: false,
  /** 挂起的后台 size 补全，测试可手动推进 onProgress / 完成 */
  pendingFill: [] as Array<{
    hooks: { onProgress?: (done: number, total: number) => void; onBatch?: (n: number) => void },
    resolve: (v: { updated: number; skipped: boolean }) => void,
  }>,
}));

vi.mock('../src/utils/siyuan-db', () => ({
  getAllAssetsInfo: vi.fn(
    () =>
      new Promise<AssetInfo[]>((resolve, reject) => {
        hoisted.pending.push(() => {
          if (hoisted.failNext) {
            hoisted.failNext = false;
            reject(new Error('sqlite unavailable'));
          } else {
            resolve(hoisted.assets);
          }
        });
      })
  ),
  deleteAssetFile: vi.fn(async () => {}),
  countReferencedDocs: vi.fn(
    (refs: BlockRef[]) => new Set((refs || []).map((r) => r.root_id)).size
  ),
}));

vi.mock('../src/utils/plugin-context', () => ({
  usePlugin: () => ({ name: 'siyuan-assets-manager' }),
}));

vi.mock('../src/utils/catalog-snapshot', () => ({
  loadCatalogSnapshot: vi.fn(async () => null),
  saveCatalogSnapshot: vi.fn(async () => true),
  saveCatalogStatCache: vi.fn(async () => true),
  overlaySnapshotFileStats: vi.fn((_files: unknown, assets: unknown) => assets),
  buildCatalogWatermark: vi.fn((t: number) => String(t)),
  removeCatalogSnapshot: vi.fn(async () => {}),
  formatSiYuanTimestamp: vi.fn((t: number) => String(t)),
  WATERMARK_MARGIN_MS: 120000,
  CATALOG_SNAPSHOT_PATH: '/data/storage/petal/siyuan-assets-manager/cache/catalog-snapshot.json',
}));

vi.mock('../src/utils/asset-catalog', () => ({
  // 两阶段扫描的测试替身：文件清单立即返回，引用阶段挂起由测试手动放行
  fetchCatalogFiles: vi.fn(async () => ({ files: [], source: 'kernel', dirAvailable: true })),
  fetchCatalogReferenceData: vi.fn(
    () =>
      new Promise((resolve, reject) => {
        hoisted.pending.push(() => {
          if (hoisted.failNext) {
            hoisted.failNext = false;
            reject(new Error('sqlite unavailable'));
          } else {
            resolve({ assets: hoisted.assets, entries: [], degraded: false });
          }
        });
      })
  ),
  emptyReferenceData: vi.fn(() => ({ assets: null })),
  resolveCatalogInventory: vi.fn((_files: unknown, refData: { assets: AssetInfo[] | null }) => ({
    allAssets: refData && refData.assets ? refData.assets : hoisted.assets,
    assetsMap: new Map(),
    originalAssets: [],
    orphanOriginals: [],
    totalOrphanSize: 0,
  })),
  getCachedCatalogInventory: vi.fn(() => null),
  setCachedCatalogInventory: vi.fn(),
  invalidateCatalogCache: vi.fn(),
  mergeAssetStatsInto: vi.fn(),
  fillMissingAssetStats: vi.fn(
    (
      _assets: unknown,
      hooks: { onProgress?: (done: number, total: number) => void; onBatch?: (n: number) => void } = {}
    ) =>
      new Promise((resolve) => {
        hoisted.pendingFill.push({ hooks, resolve });
      })
  ),
}));


import AssetsManager from '../src/components/AssetsManager.vue';

function makeAsset(name: string, size: number, rootId: string, title: string): AssetInfo {
  return {
    name,
    size,
    updated: 1700000000000,
    isDir: false,
    references: [
      {
        id: `blk-${rootId}`,
        root_id: rootId,
        box: 'box-1',
        boxName: '笔记本',
        content: '',
        markdown: '',
        path: `/x/${rootId}.sy`,
        hpath: `/${title}`,
        readablePath: `笔记本/${title}`,
      },
    ],
    refCount: 1,
    docCount: 1,
    isReEditable: false,
    isOriginal: false,
  };
}

const FIXTURE: AssetInfo[] = [
  makeAsset('a.png', 1000, 'doc-a', '文档A'),
  makeAsset('b.png', 3000, 'doc-b', '文档B'),
];

/** 主操作按钮的 title 即其稳定标识，按用户要求的从左至右顺序排列 */
const ACTION_TITLES = [
  '刷新资源列表',
  '识别疑似重复资源与视觉相似图片，比对后一键归一化合并',
  '综合清理所有未引用的孤儿资源与孤立底图',
  '查看删除操作日志与回退历史',
];

describe('AssetsManager 顶部操作区', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    hoisted.assets = FIXTURE.map((a) => ({ ...a }));
    hoisted.pending = [];
    hoisted.pendingFill = [];
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);
  });

  afterEach(() => {
    app?.unmount();
    mountContainer.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function settle() {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  /** 放行所有挂起的数据库查询并等待渲染完成 */
  async function flushLoad() {
    for (let i = 0; i < 10; i++) {
      const waiting = hoisted.pending;
      hoisted.pending = [];
      waiting.forEach((resolve) => resolve());
      await settle();
      if (waiting.length === 0) break;
    }
  }

  async function mountManager() {
    app = createApp(AssetsManager);
    app.mount(mountContainer);
    await settle();
    return mountContainer;
  }

  /**
   * 主操作区按钮的 title 序列。选中态下中间两个按钮会被批量删除/取消选择替换，
   * 因此按「已知主操作」而不是「固定四个 title」筛选。
   */
  function orderedActionTitles(): string[] {
    const isPrimary = (title: string) =>
      ACTION_TITLES.includes(title)
      || title.startsWith('批量删除')
      || title === '取消当前多选';

    return Array.from(mountContainer.querySelectorAll('.primary-action-icons button'))
      .map((button) => button.getAttribute('aria-label') || button.getAttribute('title') || '')
      .filter(isPrimary);
  }

  function refreshLabel(): string {
    return mountContainer.querySelector('.refresh-time')?.textContent?.trim() || '';
  }

  function refreshButton(): HTMLButtonElement {
    const button = mountContainer.querySelector(
      'button[aria-label="刷新资源列表"], button[title="刷新资源列表"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    return button;
  }

  it('orders the primary actions as 刷新 · 去重 · 清理 · 日志 from left to right', async () => {
    await mountManager();
    await flushLoad();

    expect(orderedActionTitles()).toEqual(ACTION_TITLES);
  });

  it('renders visible text labels for the primary actions (刷新, 去重, 清理, 日志)', async () => {
    await mountManager();
    await flushLoad();

    const buttons = Array.from(mountContainer.querySelectorAll('.primary-action-icons button'));
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toEqual(['刷新', '去重', '清理', '日志']);
  });

  it('shows a placeholder until the first refresh finishes, then the refresh time', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-21T10:00:00').getTime());

    await mountManager();
    expect(refreshLabel()).toBe('上次刷新：—');

    await flushLoad();
    expect(refreshLabel()).toBe('上次刷新：2026-09-21 10:00:00');
  });

  it('advances the refresh time when the refresh button is pressed', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(new Date('2026-09-21T10:00:00').getTime());

    await mountManager();
    await flushLoad();
    expect(refreshLabel()).toBe('上次刷新：2026-09-21 10:00:00');

    now.mockReturnValue(new Date('2026-09-21T10:05:30').getTime());
    refreshButton().click();
    await flushLoad();

    expect(refreshLabel()).toBe('上次刷新：2026-09-21 10:05:30');
  });

  it('leaves the refresh time untouched when a refresh fails', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(new Date('2026-09-21T10:00:00').getTime());

    await mountManager();
    await flushLoad();
    expect(refreshLabel()).toBe('上次刷新：2026-09-21 10:00:00');

    // 失败的一次刷新不应让顶部显示出「刚刚刷新过」
    hoisted.failNext = true;
    now.mockReturnValue(new Date('2026-09-21T11:30:00').getTime());
    refreshButton().click();
    await flushLoad();

    expect(refreshLabel()).toBe('上次刷新：2026-09-21 10:00:00');
  });

  it('still puts 刷新 ahead of the buttons that replace 去重 and 清理 while a selection exists', async () => {
    await mountManager();
    await flushLoad();

    const checkbox = mountContainer.querySelector('.asset-item .am-checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await settle();

    const titles = orderedActionTitles();
    expect(titles[0]).toBe('刷新资源列表');
    expect(titles[1]).toContain('批量删除');
    expect(titles[2]).toBe('取消当前多选');
    expect(titles[titles.length - 1]).toBe('查看删除操作日志与回退历史');
  });

  it('keeps the list rendered while a refresh is in flight', async () => {
    await mountManager();
    await flushLoad();

    const cardsBefore = mountContainer.querySelectorAll('.asset-item').length;
    expect(cardsBefore).toBeGreaterThan(0);

    // 刷新请求尚未返回时列表不应被卸载成「正在扫描」的空态，否则滚动位置会丢失
    refreshButton().click();
    await settle();

    expect(mountContainer.querySelector('.loading-state')).toBeNull();
    expect(mountContainer.querySelectorAll('.asset-item').length).toBe(cardsBefore);

    await flushLoad();
    expect(mountContainer.querySelectorAll('.asset-item').length).toBe(cardsBefore);
  });
  it('size 补全进行中显示显式进度（计数与百分比），完成后消失', async () => {
    await mountManager();
    await flushLoad();
    await settle();

    // 加载完成后进入后台补全：指示器已出现（尚无计数时显示准备中）
    let indicator = mountContainer.querySelector('.stat-fill-progress');
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain('补全大小');

    // 推进进度到 40%
    const fill = hoisted.pendingFill[hoisted.pendingFill.length - 1];
    expect(fill).toBeDefined();
    fill.hooks.onProgress?.(400, 1000);
    await settle();
    indicator = mountContainer.querySelector('.stat-fill-progress');
    expect(indicator).not.toBeNull();
    expect(indicator!.textContent).toContain('400 / 1,000');
    expect(indicator!.textContent).toContain('40%');
    expect((indicator as HTMLElement).querySelector('.stat-fill-progress-fill')!.getAttribute('style')).toContain('40%');

    // 补全完成后指示器与进度一并消失
    fill.resolve({ updated: 1000, skipped: false });
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mountContainer.querySelector('.stat-fill-progress')).toBeNull();
  });

});
