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
});

