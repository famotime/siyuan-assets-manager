import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, ref, nextTick, type App } from 'vue';
import DocumentAssetGroupList from '../src/components/DocumentAssetGroupList.vue';
import type { DocAssetGroup } from '../src/utils/asset-list';
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

    // 检查多篇引用徽章
    const multiRefBadge = vueCard.querySelector('.multi-ref-badge');
    expect(multiRefBadge).not.toBeNull();
    expect(multiRefBadge?.textContent).toContain('多篇引用 (2)');

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
});
