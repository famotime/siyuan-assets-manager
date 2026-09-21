import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, ref, nextTick, type App } from 'vue';
import DocumentAssetGroupList from '../src/components/DocumentAssetGroupList.vue';
import type { DocAssetGroup } from '../src/utils/asset-list';
import { DOC_ROW_HEIGHTS } from '../src/utils/doc-group-rows';
import type { AssetInfo } from '../src/utils/siyuan-db';

describe('DocumentAssetGroupList component', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);
  });

  afterEach(() => {
    app?.unmount();
    mountContainer.remove();
    vi.restoreAllMocks();
  });

  function createMockGroup(): DocAssetGroup[] {
    const asset1: AssetInfo = {
      name: 'vue-component.png',
      size: 2048,
      updated: 1700000000000,
      isDir: false,
      references: [{ id: 'blk-1', root_id: 'doc-vue', box: 'box-1', content: '', markdown: '', path: '' }],
      refCount: 1,
      docCount: 1,
      isReEditable: true,
      isOriginal: false,
    };

    const sharedAsset: AssetInfo = {
      name: 'shared-diagram.png',
      size: 4096,
      updated: 1700000000000,
      isDir: false,
      references: [
        { id: 'blk-1', root_id: 'doc-vue', box: 'box-1', content: '', markdown: '', path: '' },
        { id: 'blk-2', root_id: 'doc-react', box: 'box-1', content: '', markdown: '', path: '' },
      ],
      refCount: 2,
      docCount: 2,
      isReEditable: false,
      isOriginal: false,
    };

    const unrefAsset: AssetInfo = {
      name: 'orphan-file.png',
      size: 1024,
      updated: 1700000000000,
      isDir: false,
      references: [],
      refCount: 0,
      docCount: 0,
      isReEditable: false,
      isOriginal: false,
    };

    return [
      {
        id: 'doc-vue',
        title: 'Vue3 实战指南',
        readablePath: '技术笔记/前端/Vue3 实战指南',
        boxName: '技术笔记',
        assets: [asset1, sharedAsset],
        totalSize: 6144,
        assetCount: 2,
        isUnreferenced: false,
        firstBlockId: 'blk-1',
      },
      {
        id: 'unreferenced',
        title: '未被任何文档引用',
        readablePath: '未引用 / 孤立资源',
        assets: [unrefAsset],
        totalSize: 1024,
        assetCount: 1,
        isUnreferenced: true,
      },
    ];
  }

  function mountList(
    overrides: {
      groups?: DocAssetGroup[];
      collapsedDocIds?: Set<string>;
      searchQuery?: string;
    } = {}
  ) {
    const groups = ref(overrides.groups ?? createMockGroup());
    const collapsedDocIds = ref(overrides.collapsedDocIds ?? new Set<string>());
    const selectedNames = ref(new Set<string>());
    const sortField = ref<'size' | 'name' | 'ext' | 'updated' | 'docCount'>('size');
    const sortOrder = ref<'asc' | 'desc'>('desc');
    const searchQuery = ref(overrides.searchQuery ?? '');

    const openDocIdHandler = vi.fn();
    const updateSelectedHandler = vi.fn();
    const toggleCollapseHandler = vi.fn();

    const Wrapper = {
      components: { DocumentAssetGroupList },
      setup() {
        return {
          groups,
          collapsedDocIds,
          selectedNames,
          sortField,
          sortOrder,
          searchQuery,
          openDocIdHandler,
          updateSelectedHandler,
          toggleCollapseHandler,
        };
      },
      template: `
        <DocumentAssetGroupList
          :groups="groups"
          :collapsedDocIds="collapsedDocIds"
          :selectedNames="selectedNames"
          :sortField="sortField"
          :sortOrder="sortOrder"
          :searchQuery="searchQuery"
          @open-doc-id="openDocIdHandler"
          @update:selectedNames="updateSelectedHandler"
          @toggle-collapse="toggleCollapseHandler"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);

    return {
      groups,
      collapsedDocIds,
      searchQuery,
      openDocIdHandler,
      updateSelectedHandler,
      toggleCollapseHandler,
    };
  }

  it('renders document groups, badges, titles, and reports collapse intent', async () => {
    const { openDocIdHandler, updateSelectedHandler, toggleCollapseHandler } = mountList();
    await nextTick();

    const cards = mountContainer.querySelectorAll('.doc-group-card');
    expect(cards.length).toBe(2);

    // 检查正常文档标题与路径
    const vueCard = cards[0];
    expect(vueCard.textContent).toContain('Vue3 实战指南');
    expect(vueCard.textContent).toContain('技术笔记/前端/Vue3 实战指南');
    expect(vueCard.textContent).toContain('2 个资源');

    // 检查多篇引用徽章。行级虚拟化后资源行不再嵌套在卡片元素内部，
    // 因此改为按 data-group-id 定位到该文档名下的资源行再取徽章。
    const sharedRow = mountContainer.querySelector(
      '.asset-item[data-group-id="doc-vue"] .multi-ref-badge'
    );
    expect(sharedRow).not.toBeNull();
    expect(sharedRow?.textContent).toContain('多篇引用 (2)');

    // 检查未引用特殊卡片
    const unrefCard = cards[1];
    expect(unrefCard.classList.contains('is-unreferenced')).toBe(true);
    expect(unrefCard.textContent).toContain('未被任何文档引用');
    expect(unrefCard.textContent).toContain('孤立/未引用');

    // 点击在思源中打开按钮
    const openBtn = vueCard.querySelector('.doc-open-btn') as HTMLButtonElement;
    expect(openBtn).not.toBeNull();
    openBtn.click();
    expect(openDocIdHandler).toHaveBeenCalledWith('doc-vue', 'blk-1');

    // 折叠状态由父组件经 collapsedDocIds 驱动，子组件点击仅上报意图而不自行改写状态
    const header = vueCard.querySelector('.doc-group-header') as HTMLDivElement;
    expect(vueCard.classList.contains('is-collapsed')).toBe(false);
    header.click();
    await nextTick();
    expect(toggleCollapseHandler).toHaveBeenCalledWith('doc-vue');
    expect(vueCard.classList.contains('is-collapsed')).toBe(false);

    // 测试文档级全选勾选框
    const docCheckbox = vueCard.querySelector('.doc-checkbox-wrapper input[type="checkbox"]') as HTMLInputElement;
    expect(docCheckbox).not.toBeNull();
    docCheckbox.checked = true;
    docCheckbox.dispatchEvent(new Event('change'));
    expect(updateSelectedHandler).toHaveBeenCalled();
  });

  it('renders collapse state from the collapsedDocIds prop', async () => {
    mountList({ collapsedDocIds: new Set(['doc-vue']) });
    await nextTick();

    const cards = mountContainer.querySelectorAll('.doc-group-card');
    expect(cards[0].classList.contains('is-collapsed')).toBe(true);
    expect(cards[1].classList.contains('is-collapsed')).toBe(false);
  });

  it('emits toggle-collapse on header click without mutating the provided set', async () => {
    const collapsedDocIds = new Set<string>();
    const { toggleCollapseHandler } = mountList({ collapsedDocIds });
    await nextTick();

    const card = mountContainer.querySelectorAll('.doc-group-card')[0];
    (card.querySelector('.doc-group-header') as HTMLElement).click();
    await nextTick();

    expect(toggleCollapseHandler).toHaveBeenCalledWith('doc-vue');
    expect(collapsedDocIds.size).toBe(0);
    expect(card.classList.contains('is-collapsed')).toBe(false);
  });

  it('force-expands every group while a search query is active, restoring collapsed state afterwards', async () => {
    const { searchQuery } = mountList({
      collapsedDocIds: new Set(['doc-vue', 'unreferenced']),
    });
    await nextTick();

    const cards = mountContainer.querySelectorAll('.doc-group-card');
    expect(cards[0].classList.contains('is-collapsed')).toBe(true);
    expect(cards[1].classList.contains('is-collapsed')).toBe(true);

    // 输入搜索词：全部强制展开以便看到命中结果
    searchQuery.value = 'vue';
    await nextTick();
    expect(cards[0].classList.contains('is-collapsed')).toBe(false);
    expect(cards[1].classList.contains('is-collapsed')).toBe(false);

    // 清空搜索：恢复用户先前的折叠状态
    searchQuery.value = '';
    await nextTick();
    expect(cards[0].classList.contains('is-collapsed')).toBe(true);
    expect(cards[1].classList.contains('is-collapsed')).toBe(true);
  });

  /**
   * 万级资源下列表必须只渲染视口内的行：折叠的文档不产生资源行，
   * 展开的文档也只渲染窗口附近的一小段，否则 DOM 节点数会随资源数线性膨胀。
   */
  function createLargeGroups(totalAssets: number, docCount: number): DocAssetGroup[] {
    const perDoc = Math.ceil(totalAssets / docCount);
    const groups: DocAssetGroup[] = [];
    let seq = 0;

    for (let d = 0; d < docCount; d++) {
      const assets: AssetInfo[] = [];
      for (let i = 0; i < perDoc && seq < totalAssets; i++, seq++) {
        assets.push({
          name: `bulk-${seq}.png`,
          size: 1024 + seq,
          updated: 1700000000000 + seq,
          isDir: false,
          references: [{ id: `blk-${seq}`, root_id: `doc-${d}`, box: 'box-1', content: '', markdown: '', path: '' }],
          refCount: 1,
          docCount: 1,
          isReEditable: false,
          isOriginal: false,
        });
      }
      groups.push({
        id: `doc-${d}`,
        title: `批量文档 ${d}`,
        readablePath: `笔记本/批量文档 ${d}`,
        assets,
        totalSize: assets.length * 1024,
        assetCount: assets.length,
        isUnreferenced: false,
        firstBlockId: `blk-${d * perDoc}`,
      });
    }

    return groups;
  }

  it('renders no asset rows at all while every document group is collapsed', async () => {
    const groups = createLargeGroups(3000, 150);
    mountList({ groups, collapsedDocIds: new Set(groups.map((g) => g.id)) });
    await nextTick();

    expect(mountContainer.querySelectorAll('.asset-item')).toHaveLength(0);
    // 分组卡片同样只渲染视口附近的一小段
    expect(mountContainer.querySelectorAll('.doc-group-card').length).toBeLessThan(50);
    // 150 张卡片若全部渲染约 5850 个节点，这里必须远低于它才算真的开了窗
    expect(mountContainer.querySelectorAll('*').length).toBeLessThan(1000);
  }, 120000);

  it('renders only a window of rows instead of every expanded asset', async () => {
    const groups = createLargeGroups(3000, 150);
    const { collapsedDocIds } = mountList({ groups, collapsedDocIds: new Set<string>() });
    await nextTick();

    // 全部展开后资源行有 3000 条，DOM 里只应存在窗口附近的一小段
    const renderedRows = mountContainer.querySelectorAll('.asset-item').length;
    expect(renderedRows).toBeGreaterThan(0);
    expect(renderedRows).toBeLessThan(100);

    // 收起后资源行彻底消失
    collapsedDocIds.value = new Set(groups.map((g) => g.id));
    await nextTick();
    expect(mountContainer.querySelectorAll('.asset-item')).toHaveLength(0);
  }, 120000);

  it('stays bounded at the reported 10000-asset scale', async () => {
    const groups = createLargeGroups(10000, 500);
    const { collapsedDocIds } = mountList({ groups, collapsedDocIds: new Set(groups.map((g) => g.id)) });
    await nextTick();

    expect(mountContainer.querySelectorAll('.asset-item')).toHaveLength(0);
    expect(mountContainer.querySelectorAll('*').length).toBeLessThan(5000);

    collapsedDocIds.value = new Set<string>();
    await nextTick();
    expect(mountContainer.querySelectorAll('.asset-item').length).toBeLessThan(100);
  }, 120000);

  /**
   * jsdom 没有布局，视口高度恒为 0，上面几个用例因此都停在「从头开窗」这一种情形。
   * 真正容易出现空白或错位的滚动偏移路径必须单独造一个视口来覆盖：
   * 给滚动容器伪造 clientHeight/scrollTop 再派发 scroll 事件，等价于用户滚动。
   */
  it('offsets the rendered window by exactly the height of the rows above it', async () => {
    const DOCS = 8;
    const PER_DOC = 8;
    const groups = createLargeGroups(DOCS * PER_DOC, DOCS);
    mountList({ groups, collapsedDocIds: new Set<string>() });
    await nextTick();

    const container = mountContainer.querySelector('.doc-groups-scroll-container') as HTMLElement;
    const inner = mountContainer.querySelector('.doc-rows-inner') as HTMLElement;
    expect(container).not.toBeNull();
    expect(inner).not.toBeNull();

    const H = DOC_ROW_HEIGHTS;
    // 每张展开的卡片 = 头部 + 列名行 + 每篇文档的资源行 + 卡片间距
    const blockHeight = H.header + H.subheader + PER_DOC * H.asset + H.gap;
    const totalHeight = DOCS * blockHeight;

    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(container, 'scrollTop', { value: 1000, configurable: true });
    container.dispatchEvent(new Event('scroll'));
    await nextTick();

    // 滚到 1000px 恰好越过第一张卡片（528px），因此窗口应从第二张卡片的头部开始
    expect(inner.style.marginTop).toBe(`${blockHeight}px`);
    // 窗口高度 + 偏移必须恒等于整个列表高度，否则滚动条长度和实际内容会对不上
    expect(Number.parseFloat(inner.style.height) + blockHeight).toBe(totalHeight);
    // 首行正是紧随 1000px 位置之后的那个分组头部
    expect(mountContainer.querySelector('.doc-title-text')?.textContent?.trim()).toBe('批量文档 1');
    // 窗口仍然只覆盖视口 + overscan 附近，而不是 64 条资源行
    expect(mountContainer.querySelectorAll('.asset-item').length).toBeLessThan(DOCS * PER_DOC);
  }, 120000);

  it('does not grow the rendered window as the asset count grows', async () => {
    mountList({ groups: createLargeGroups(1500, 75), collapsedDocIds: new Set<string>() });
    await nextTick();
    const smallCount = mountContainer.querySelectorAll('.asset-item').length;

    app?.unmount();
    mountContainer.innerHTML = '';

    mountList({ groups: createLargeGroups(3000, 150), collapsedDocIds: new Set<string>() });
    await nextTick();
    const largeCount = mountContainer.querySelectorAll('.asset-item').length;

    // 资源翻倍，DOM 行数不变：渲染量与数据量解耦才是虚拟滚动
    expect(largeCount).toBe(smallCount);
  }, 120000);
});
