import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, ref, nextTick, type App } from 'vue';
import DeletionHistoryDialog from '../src/components/DeletionHistoryDialog.vue';
import * as deletionLogger from '../src/utils/deletion-logger';

describe('DeletionHistoryDialog component visibility and reload behavior', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);
  });

  afterEach(() => {
    app?.unmount();
    mountContainer.remove();
    const overlays = document.body.querySelectorAll('.am-history-dialog-overlay');
    overlays.forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  it('re-fetches deletion history when visible prop flips from false to true', async () => {
    const mockBatches: deletionLogger.IDeletionBatch[] = [
      {
        id: 'batch_1',
        timestamp: Date.now(),
        actionType: 'single-delete',
        destination: 'os-trash',
        items: [
          {
            fileName: 'deleted_pic.png',
            originalRelativePath: 'data/assets/deleted_pic.png',
            size: 1024,
          },
        ],
        freedBytes: 1024,
        canRollback: false,
        isRolledBack: false,
      },
    ];

    const getHistorySpy = vi.spyOn(deletionLogger, 'getDeletionHistory')
      .mockResolvedValueOnce([]) // 初始挂载时返回空
      .mockResolvedValue(mockBatches); // 变为 visible 时返回新批次

    vi.spyOn(deletionLogger, 'getDeletionHistoryLimit').mockResolvedValue(10);

    const isVisible = ref(false);

    // 包装组件以响应式传递 props
    const Wrapper = {
      components: { DeletionHistoryDialog },
      setup() {
        return { isVisible };
      },
      template: `<DeletionHistoryDialog :visible="isVisible" />`,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();

    // 初始状态：getDeletionHistory 被调用 1 次，返回空
    expect(getHistorySpy).toHaveBeenCalledTimes(1);
    expect(document.body.querySelector('.am-history-dialog-overlay')).toBeNull();

    // 模拟用户点击打开日志弹窗
    isVisible.value = true;
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await nextTick();

    // 验证 watch props.visible 触发了重新拉取数据
    expect(getHistorySpy).toHaveBeenCalledTimes(2);

    // 验证弹窗 DOM 渲染出来了，并且包含了刚删除的文件名
    const dialog = mountContainer.querySelector('.deletion-history-dialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('1 个文件');
  });

  it('triggers openOSRecycleBin when clicking open recycle bin button', async () => {
    const fileSystem = await import('../src/utils/file-system');
    const openTrashSpy = vi.spyOn(fileSystem, 'openOSRecycleBin').mockResolvedValue(true);

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue([]);
    vi.spyOn(deletionLogger, 'getDeletionHistoryLimit').mockResolvedValue(10);

    const isVisible = ref(true);
    const Wrapper = {
      components: { DeletionHistoryDialog },
      setup() {
        return { isVisible };
      },
      template: `<DeletionHistoryDialog :visible="isVisible" />`,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await nextTick();

    const openBtn = mountContainer.querySelector<HTMLButtonElement>('.toolbar-right button.am-btn--secondary');
    expect(openBtn).not.toBeNull();
    expect(openBtn?.textContent).toContain('打开系统回收站');

    openBtn?.click();
    await nextTick();

    expect(openTrashSpy).toHaveBeenCalledTimes(1);
  });

  it('handles jump to document when batch has affected blocks and disables when orphaned', async () => {
    const siyuan = await import('siyuan');
    const openTabSpy = vi.spyOn(siyuan, 'openTab').mockResolvedValue(undefined as any);

    const { usePlugin } = await import('../src/utils/plugin-context');
    usePlugin({
      app: { appId: 'mock-app' },
    } as any);

    const mockBatches: deletionLogger.IDeletionBatch[] = [
      {
        id: 'batch_with_ref',
        timestamp: Date.now(),
        actionType: 'single-delete',
        destination: 'os-trash',
        items: [
          {
            fileName: 'with_ref.png',
            originalRelativePath: 'data/assets/with_ref.png',
            size: 2048,
            affectedBlocks: [
              {
                id: 'block_123',
                root_id: 'doc_root_456',
              },
            ],
          },
        ],
        freedBytes: 2048,
        canRollback: true,
        isRolledBack: false,
      },
      {
        id: 'batch_orphan',
        timestamp: Date.now() - 1000,
        actionType: 'orphan-cleanup',
        destination: 'os-trash',
        items: [
          {
            fileName: 'orphan.png',
            originalRelativePath: 'data/assets/orphan.png',
            size: 512,
          },
        ],
        freedBytes: 512,
        canRollback: false,
        isRolledBack: false,
      },
    ];

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue(mockBatches);
    vi.spyOn(deletionLogger, 'getDeletionHistoryLimit').mockResolvedValue(10);

    const isVisible = ref(true);
    const Wrapper = {
      components: { DeletionHistoryDialog },
      setup() {
        return { isVisible };
      },
      template: `<DeletionHistoryDialog :visible="isVisible" />`,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await nextTick();

    const jumpBtns = mountContainer.querySelectorAll<HTMLButtonElement>('.btn-jump-doc');
    expect(jumpBtns.length).toBe(2);

    // 第一张卡片有引用：可点击且不带 disabled
    const firstJumpBtn = jumpBtns[0];
    expect(firstJumpBtn.classList.contains('is-disabled')).toBe(false);
    expect(firstJumpBtn.disabled).toBe(false);

    // 第二张卡片为孤儿清理：置灰且带 is-disabled 和 disabled
    const secondJumpBtn = jumpBtns[1];
    expect(secondJumpBtn.classList.contains('is-disabled')).toBe(true);
    expect(secondJumpBtn.disabled).toBe(true);

    // 点击第一张卡片的跳转到文档
    firstJumpBtn.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(openTabSpy).toHaveBeenCalled();
    const lastCall = openTabSpy.mock.calls[0][0] as any;
    expect(lastCall.doc.id).toBe('doc_root_456');

    // 展开第一张卡片，检查明细表格中的“关联文档”列与跳转文档按钮
    const firstCardHeader = mountContainer.querySelector<HTMLDivElement>('.history-card .card-header');
    firstCardHeader?.click();
    await nextTick();

    const itemJumpBtn = mountContainer.querySelector<HTMLButtonElement>('.doc-link-cell .am-link-btn');
    expect(itemJumpBtn).not.toBeNull();
    expect(itemJumpBtn?.textContent).toContain('跳转文档');

    openTabSpy.mockClear();
    itemJumpBtn?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(openTabSpy).toHaveBeenCalled();
  });

  it('renders degraded position count in the rollback report', async () => {
    const mockBatches: deletionLogger.IDeletionBatch[] = [
      {
        id: 'batch_rolled_back',
        timestamp: Date.now(),
        actionType: 'single-delete',
        destination: 'os-trash',
        items: [
          {
            fileName: 'rolled_back.png',
            originalRelativePath: 'data/assets/rolled_back.png',
            size: 1024,
          },
        ],
        freedBytes: 1024,
        canRollback: true,
        isRolledBack: true,
        rolledBackAt: Date.now(),
        rollbackReport: {
          restoredBlocksCount: 3,
          skippedBlocksCount: 1,
          failedBlocksCount: 0,
          degradedPositionCount: 2,
        },
      },
    ];

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue(mockBatches);
    vi.spyOn(deletionLogger, 'getDeletionHistoryLimit').mockResolvedValue(10);

    const isVisible = ref(true);
    const Wrapper = {
      components: { DeletionHistoryDialog },
      setup() {
        return { isVisible };
      },
      template: `<DeletionHistoryDialog :visible="isVisible" />`,
    };

    app = createApp(Wrapper);
    app.mount(mountContainer);
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await nextTick();

    const cardHeader = mountContainer.querySelector<HTMLDivElement>('.history-card .card-header');
    cardHeader?.click();
    await nextTick();

    const reportBox = mountContainer.querySelector('.rollback-report-box');
    expect(reportBox).not.toBeNull();
    expect(reportBox?.textContent).toContain('成功还原');
    // 位置降级需如实展示，避免回退块静默错位
    const reportText = (reportBox?.textContent || '').replace(/\s+/g, ' ');
    expect(reportText).toMatch(/位置降级: 2 处/);
    expect(reportText).toContain('原相邻块已变化，已按近似位置还原');
  });

  it('verifies that DeletionHistoryDialog SFC style contains flex-shrink: 0 and min-height: 0 to prevent card crushing', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sfcPath = path.resolve(__dirname, '../src/components/DeletionHistoryDialog.vue');
    const content = fs.readFileSync(sfcPath, 'utf-8');

    // 验证 .dialog-body 包含 min-height: 0，防止 Flex 滚动容器尺寸计算坍塌
    expect(content).toMatch(/\.dialog-body\s*\{[^}]*min-height:\s*0/s);
    // 验证 .history-card 包含 flex-shrink: 0，防止卡片数量较多或展开时被压缩挤扁
    expect(content).toMatch(/\.history-card\s*\{[^}]*flex-shrink:\s*0/s);
  });
});

