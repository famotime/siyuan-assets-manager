import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db';

const hoisted = vi.hoisted(() => ({ assets: [] as AssetInfo[] }));

vi.mock('../src/utils/siyuan-db', () => ({
  getAllAssetsInfo: vi.fn(async () => hoisted.assets),
  deleteAssetFile: vi.fn(async () => {}),
  countReferencedDocs: vi.fn(
    (refs: BlockRef[]) => new Set((refs || []).map((r) => r.root_id)).size
  ),
}));

vi.mock('../src/utils/plugin-context', () => ({
  usePlugin: () => ({ name: 'siyuan-assets-manager' }),
}));

import AssetsManager from '../src/components/AssetsManager.vue';

function makeRef(rootId: string, title: string): BlockRef {
  return {
    id: `blk-${rootId}`,
    root_id: rootId,
    box: 'box-1',
    boxName: '笔记本',
    content: '',
    markdown: '',
    path: `/x/${rootId}.sy`,
    hpath: `/${title}`,
    readablePath: `笔记本/${title}`,
  };
}

function makeAsset(name: string, size: number, rootId: string, title: string): AssetInfo {
  return {
    name,
    size,
    updated: 1700000000000,
    isDir: false,
    references: [makeRef(rootId, title)],
    refCount: 1,
    docCount: 1,
    isReEditable: false,
    isOriginal: false,
  };
}

// 大小倒序与名称正序刻意不同，便于区分排序依据是否真的换了
const FIXTURE: AssetInfo[] = [
  makeAsset('a.png', 1000, 'doc-a', '文档A'),
  makeAsset('b.png', 3000, 'doc-b', '文档B'),
  makeAsset('c.png', 2000, 'doc-c', '文档C'),
];

describe('AssetsManager 文档归类视图排序', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    localStorage.setItem('siyuan-assets-manager-view-mode', 'doc');
    hoisted.assets = FIXTURE.map((a) => ({ ...a }));
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);
  });

  afterEach(() => {
    app?.unmount();
    mountContainer.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function renderedDocTitles(): string[] {
    return Array.from(mountContainer.querySelectorAll('.doc-group-card .doc-title-text')).map(
      (el) => el.textContent?.trim() || ''
    );
  }

  async function settle() {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function mountAndSettle() {
    app = createApp(AssetsManager);
    app.mount(mountContainer);
    // 等待异步 loadData 完成并渲染出卡片
    for (let i = 0; i < 10 && renderedDocTitles().length === 0; i++) {
      await settle();
    }
    return renderedDocTitles();
  }

  async function setDocSortField(value: string) {
    const select = mountContainer.querySelector('.doc-sort-select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  }

  it('renders document cards in the initial sort order', async () => {
    const titles = await mountAndSettle();
    // 默认 totalSize desc：B(3000) > C(2000) > A(1000)
    expect(titles).toEqual(['文档B', '文档C', '文档A']);
  });

  it('re-sorts document cards when the sort field changes', async () => {
    await mountAndSettle();
    expect(renderedDocTitles()).toEqual(['文档B', '文档C', '文档A']);

    // 切换排序依据为「按文档名称」，顺序需立刻按名称重排（当前降序）
    await setDocSortField('name');
    expect(renderedDocTitles()).toEqual(['文档C', '文档B', '文档A']);

    // 切回「按文档总大小」应回到大小排序
    await setDocSortField('totalSize');
    expect(renderedDocTitles()).toEqual(['文档B', '文档C', '文档A']);
  });

  it('re-sorts document cards when the sort order is toggled', async () => {
    await mountAndSettle();
    expect(renderedDocTitles()).toEqual(['文档B', '文档C', '文档A']);

    const toggle = mountContainer.querySelector(
      'button[aria-label^="文档排序"], button[title^="文档排序"]'
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await settle();

    // 升序：A(1000) < C(2000) < B(3000)
    expect(renderedDocTitles()).toEqual(['文档A', '文档C', '文档B']);
  });

  it('re-sorts from the latest asset data when the sort field changes after an edit', async () => {
    await mountAndSettle();
    expect(renderedDocTitles()).toEqual(['文档B', '文档C', '文档A']);

    // 模拟编辑 b.png 使其体积骤降：顺序处于冻结态，卡片位置不应变动
    window.dispatchEvent(
      new CustomEvent('assets-manager-refresh', {
        detail: {
          action: 'edit',
          oldName: 'b.png',
          newName: 'b.png',
          size: 100,
          references: [makeRef('doc-b', '文档B')],
        },
      })
    );
    await settle();
    expect(renderedDocTitles()).toEqual(['文档B', '文档C', '文档A']);

    // 改变排序依据：必须按最新体积重排 → C(2000) > A(1000) > B(100)
    await setDocSortField('name');
    await setDocSortField('totalSize');
    expect(renderedDocTitles()).toEqual(['文档C', '文档A', '文档B']);
  });
});
