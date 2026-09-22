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

    const openBtn = mountContainer.querySelector<HTMLButtonElement>('.toolbar-right button.am-action-btn--recycle');
    expect(openBtn).not.toBeNull();
    expect(openBtn?.getAttribute('aria-label')).toContain('打开操作系统回收站窗口');

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

    // 卡片头部已去除跳转按钮，保持头部信息精简
    const jumpBtns = mountContainer.querySelectorAll<HTMLButtonElement>('.btn-jump-doc');
    expect(jumpBtns.length).toBe(0);

    // 展开第一张卡片，检查明细表格中的“关联文档”列与跳转文档按钮
    const firstCardHeader = mountContainer.querySelector<HTMLDivElement>('.history-card .card-header');
    firstCardHeader?.click();
    await nextTick();

    const itemJumpBtn = mountContainer.querySelector<HTMLButtonElement>('.doc-link-cell .am-link-btn');
    expect(itemJumpBtn).not.toBeNull();
    expect(itemJumpBtn?.textContent).toContain('doc_root_456');

    openTabSpy.mockClear();
    itemJumpBtn?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(openTabSpy).toHaveBeenCalled();
    const lastCall = openTabSpy.mock.calls[0][0] as any;
    expect(lastCall.doc.id).toBe('doc_root_456');

    // 展开第二张卡片（孤儿清理），检查显示为无引用
    const cards = mountContainer.querySelectorAll<HTMLDivElement>('.history-card');
    cards[1]?.querySelector<HTMLDivElement>('.card-header')?.click();
    await nextTick();
    const secondCardText = cards[1]?.querySelector('.doc-link-cell')?.textContent;
    expect(secondCardText).toContain('无引用');
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

  it('blocks rollback for permanently deleted files and warns when files are not restored yet', async () => {
    const rollbackEngine = await import('../src/utils/rollback-engine');
    const presenceSpy = vi
      .spyOn(rollbackEngine, 'checkRollbackFilePresence')
      .mockResolvedValue([{ fileName: 'gone.png', present: false }]);

    const makeBatch = (destination: 'os-trash' | 'permanent'): deletionLogger.IDeletionBatch => ({
      id: `batch_${destination}`,
      timestamp: Date.now(),
      actionType: 'single-delete',
      destination,
      items: [
        { fileName: 'gone.png', originalRelativePath: 'data/assets/gone.png', size: 1024 },
      ],
      freedBytes: 1024,
      canRollback: true,
      isRolledBack: false,
    });

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue([makeBatch('permanent')]);
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

    mountContainer.querySelector<HTMLButtonElement>('.btn-rollback, .am-action-btn--rollback')?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(presenceSpy).toHaveBeenCalled();
    // 永久删除 + 文件缺失 ⇒ 明确禁用并说明原因
    const blocked = mountContainer.querySelector('.presence-warning.is-blocked');
    expect(blocked).not.toBeNull();
    expect(blocked?.textContent).toContain('已无法找回');
    const confirmBtn = mountContainer.querySelector<HTMLButtonElement>(
      '.rollback-confirm-dialog .am-btn--primary'
    );
    expect(confirmBtn?.disabled).toBe(true);
    expect(confirmBtn?.textContent).toContain('不可回退');
  });

  it('still allows rollback when files are missing but the recycle bin can restore them', async () => {
    const rollbackEngine = await import('../src/utils/rollback-engine');
    vi.spyOn(rollbackEngine, 'checkRollbackFilePresence').mockResolvedValue([
      { fileName: 'gone.png', present: false },
    ]);

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue([
      {
        id: 'batch_trash',
        timestamp: Date.now(),
        actionType: 'single-delete',
        destination: 'os-trash',
        items: [{ fileName: 'gone.png', originalRelativePath: 'data/assets/gone.png', size: 1024 }],
        freedBytes: 1024,
        canRollback: true,
        isRolledBack: false,
      },
    ]);
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

    mountContainer.querySelector<HTMLButtonElement>('.btn-rollback, .am-action-btn--rollback')?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 可从回收站找回 ⇒ 只提示不阻断，并把未还原文件单独标记
    expect(mountContainer.querySelector('.presence-warning.is-blocked')).toBeNull();
    expect(mountContainer.querySelector('.presence-warning')?.textContent).toContain('建议先从回收站还原文件');
    expect(mountContainer.querySelector('.badge-status.is-missing-file')?.textContent).toContain('未还原');
    const confirmBtn = mountContainer.querySelector<HTMLButtonElement>(
      '.rollback-confirm-dialog .am-btn--primary'
    );
    expect(confirmBtn?.disabled).toBe(false);
  });

  it('renders the dedup rollback breakdown (exact / approximate / IAL / database cells)', async () => {
    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue([
      {
        id: 'batch_dedup_report',
        timestamp: Date.now(),
        actionType: 'deduplicate',
        destination: 'os-trash',
        items: [{ fileName: 'dup.png', originalRelativePath: 'data/assets/dup.png', size: 1024, canonicalName: 'keep.png' }],
        freedBytes: 1024,
        canRollback: true,
        isRolledBack: true,
        rolledBackAt: Date.now(),
        rollbackReport: {
          restoredBlocksCount: 4,
          skippedBlocksCount: 1,
          failedBlocksCount: 0,
          exactRestoredCount: 2,
          approximateRestoredCount: 3,
          restoredIalCount: 1,
          restoredViewCellsCount: 2,
          skippedViewCellsCount: 1,
        },
      },
    ]);
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

    mountContainer.querySelector<HTMLDivElement>('.history-card .card-header')?.click();
    await nextTick();

    const reportText = (mountContainer.querySelector('.rollback-report-box')?.textContent || '').replace(
      /\s+/g,
      ' '
    );
    expect(reportText).toMatch(/精确还原 2 块/);
    expect(reportText).toMatch(/近似还原 3 处/);
    expect(reportText).toMatch(/块属性引用（题头图等）1 处/);
    expect(reportText).toMatch(/数据库单元格 2 处/);
    expect(reportText).toMatch(/跳过 1 处已改动\/已删除的单元格/);
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

  it('verifies that header-thumb-trigger is removed, buttons use am-action-btn with tooltips, and manual restore is highlighted in red', async () => {
    const mockBatch: deletionLogger.IDeletionBatch = {
      id: 'batch_new_ui',
      timestamp: Date.now(),
      actionType: 'single-delete',
      destination: 'os-trash',
      items: [
        {
          fileName: 'pic_with_thumb.png',
          originalRelativePath: 'data/assets/pic_with_thumb.png',
          size: 4096,
          thumbnail: 'data:image/webp;base64,mockthumb',
          affectedBlocks: [
            {
              id: 'block_doc_test',
              root_id: 'doc_20260922_long_title_note',
            },
          ],
        },
      ],
      freedBytes: 4096,
      canRollback: true,
      isRolledBack: false,
    };

    vi.spyOn(deletionLogger, 'getDeletionHistory').mockResolvedValue([mockBatch]);
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

    // 1. 验证卡片头部取消并去除了“预览原图”标签
    expect(mountContainer.querySelector('.header-thumb-trigger')).toBeNull();
    expect(mountContainer.textContent).not.toContain('预览原图');

    // 2. 验证顶部工具栏按钮具备显眼图标、文字 + tooltips
    const recycleBtn = mountContainer.querySelector<HTMLButtonElement>('.am-action-btn--recycle');
    expect(recycleBtn).not.toBeNull();
    expect(recycleBtn?.textContent).toContain('回收站');
    expect(recycleBtn?.classList.contains('b3-tooltips')).toBe(true);

    const clearBtn = mountContainer.querySelector<HTMLButtonElement>('.am-action-btn--clear');
    expect(clearBtn).not.toBeNull();
    expect(clearBtn?.textContent).toContain('清空');
    expect(clearBtn?.classList.contains('b3-tooltips')).toBe(true);

    // 3. 验证卡片头部跳转文档按钮已去除，回退按钮具备文字 + tooltips
    expect(mountContainer.querySelector('.card-header-right .am-action-btn--jump-doc')).toBeNull();

    const rollbackBtn = mountContainer.querySelector<HTMLButtonElement>('.am-action-btn--rollback');
    expect(rollbackBtn).not.toBeNull();
    expect(rollbackBtn?.textContent).toContain('回退');
    expect(rollbackBtn?.classList.contains('b3-tooltips')).toBe(true);

    // 4. 展开卡片，验证明细表格中关联文档显示截短样式与 tooltip
    mountContainer.querySelector<HTMLDivElement>('.history-card .card-header')?.click();
    await nextTick();

    const docJumpBtn = mountContainer.querySelector<HTMLButtonElement>('.doc-jump-btn');
    expect(docJumpBtn).not.toBeNull();
    expect(docJumpBtn?.querySelector('.doc-title-text')).not.toBeNull();
    // 表格内使用原生 title 悬浮显示完整文件名/路径，不带 b3-tooltips 伪元素以防止触发表格容器滚动条
    expect(docJumpBtn?.classList.contains('b3-tooltips')).toBe(false);
    expect(docJumpBtn?.getAttribute('title')).toContain('doc_20260922_long_title_note');

    // 验证复制清单按钮也具备图标+tooltips且向左弹出避免被截断
    const copyBtn = mountContainer.querySelector<HTMLButtonElement>('.card-toolbar .am-action-btn--copy');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn?.classList.contains('b3-tooltips')).toBe(true);
    expect(copyBtn?.classList.contains('b3-tooltips__w')).toBe(true);
    expect(copyBtn?.getAttribute('aria-label')).toBe('复制文件名清单');

    // 5. 点击回退引用按钮，弹出回退前置弹窗，验证“手工还原”文案用红字凸显
    rollbackBtn?.click();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const dangerEmphasis = mountContainer.querySelector<HTMLSpanElement>('.text-danger-emphasis');
    expect(dangerEmphasis).not.toBeNull();
    expect(dangerEmphasis?.textContent).toBe('手工还原');
  });
});

