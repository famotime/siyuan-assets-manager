import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, ref, nextTick, type App } from 'vue';
import DeletionHistoryCard from '../src/components/DeletionHistoryCard.vue';
import type { IDeletionBatch, IDeletedItemRecord } from '../src/utils/deletion-logger';

describe('DeletionHistoryCard component', () => {
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

  const sampleBatch: IDeletionBatch = {
    id: 'batch_test_01',
    timestamp: 1710000000000,
    actionType: 'deduplicate',
    destination: 'os-trash',
    freedBytes: 2048,
    canRollback: true,
    isRolledBack: false,
    items: [
      {
        fileName: 'dup_pic.png',
        originalRelativePath: 'data/assets/dup_pic.png',
        size: 2048,
        canonicalName: 'main_pic.png',
        thumbnail: 'data:image/png;base64,mock',
        affectedBlocks: [
          {
            id: 'block_01',
            root_id: 'doc_root_01',
            content: 'some text',
          },
        ],
      },
    ],
  };

  it('renders batch overview headers correctly', async () => {
    const isExpanded = ref(false);
    const docInfoMap = ref(new Map<string, { title: string; hpath: string }>());

    const Wrapper = {
      components: { DeletionHistoryCard },
      setup() {
        return { batch: sampleBatch, isExpanded, docInfoMap };
      },
      template: `
        <DeletionHistoryCard
          :batch="batch"
          :is-expanded="isExpanded"
          :doc-info-map="docInfoMap"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();

    const card = mountContainer.querySelector('.history-card');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('图片去重合并');
    expect(card?.textContent).toContain('操作系统回收站');
    expect(card?.textContent).toContain('可回退');
    expect(card?.textContent).toContain('1 个文件');
    expect(card?.textContent).toContain('2 KB');
  });

  it('emits toggle-expand when card header is clicked', async () => {
    const onToggle = vi.fn();
    const isExpanded = ref(false);
    const docInfoMap = ref(new Map<string, { title: string; hpath: string }>());

    const Wrapper = {
      components: { DeletionHistoryCard },
      setup() {
        return { batch: sampleBatch, isExpanded, docInfoMap, onToggle };
      },
      template: `
        <DeletionHistoryCard
          :batch="batch"
          :is-expanded="isExpanded"
          :doc-info-map="docInfoMap"
          @toggle-expand="onToggle"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();

    const header = mountContainer.querySelector('.card-header') as HTMLElement;
    expect(header).not.toBeNull();
    header.click();

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('emits rollback event when rollback button is clicked', async () => {
    const onRollback = vi.fn();
    const isExpanded = ref(false);
    const docInfoMap = ref(new Map<string, { title: string; hpath: string }>());

    const Wrapper = {
      components: { DeletionHistoryCard },
      setup() {
        return { batch: sampleBatch, isExpanded, docInfoMap, onRollback };
      },
      template: `
        <DeletionHistoryCard
          :batch="batch"
          :is-expanded="isExpanded"
          :doc-info-map="docInfoMap"
          @rollback="onRollback"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();

    const rollbackBtn = mountContainer.querySelector('.am-action-btn--rollback') as HTMLElement;
    expect(rollbackBtn).not.toBeNull();
    rollbackBtn.click();

    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onRollback).toHaveBeenCalledWith(sampleBatch);
  });

  it('renders detail table and rollback report when expanded and rolled back', async () => {
    const rolledBackBatch: IDeletionBatch = {
      ...sampleBatch,
      isRolledBack: true,
      rolledBackAt: 1710000500000,
      rollbackReport: {
        restoredBlocksCount: 5,
        skippedBlocksCount: 1,
        failedBlocksCount: 0,
        exactRestoredCount: 2,
      },
    };

    const isExpanded = ref(true);
    const docInfoMap = ref(new Map<string, { title: string; hpath: string }>());

    const Wrapper = {
      components: { DeletionHistoryCard },
      setup() {
        return { batch: rolledBackBatch, isExpanded, docInfoMap };
      },
      template: `
        <DeletionHistoryCard
          :batch="batch"
          :is-expanded="isExpanded"
          :doc-info-map="docInfoMap"
        />
      `,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();

    // 验证表格内容
    expect(mountContainer.querySelector('.files-table')).not.toBeNull();
    expect(mountContainer.textContent).toContain('dup_pic.png');
    expect(mountContainer.textContent).toContain('main_pic.png');

    // 验证回退报告
    const report = mountContainer.querySelector('.rollback-report-box');
    expect(report).not.toBeNull();
    expect(report?.textContent).toContain('成功还原: 5 处块引用');
    expect(report?.textContent).toContain('跳过漂移块: 1 处');
    expect(report?.textContent).toContain('精确还原 2 块');
  });
});
