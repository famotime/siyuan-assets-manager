import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import ConfirmDialog from '../src/components/ConfirmDialog.vue';
import { showConfirm, closeConfirm, confirmState } from '../src/utils/confirm';

describe('ConfirmDialog and showConfirm workflow', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    // 重置状态
    closeConfirm(false);

    // 创建挂载宿主容器
    mountContainer = document.createElement('div');
    mountContainer.id = 'test-app-root';
    document.body.appendChild(mountContainer);

    app = createApp(ConfirmDialog);
    app.mount(mountContainer);
  });

  afterEach(() => {
    closeConfirm(false);
    app?.unmount();
    mountContainer.remove();
    // 清理可能残留的 body 直属弹窗节点
    const overlays = document.body.querySelectorAll('.am-confirm-dialog-overlay');
    overlays.forEach((el) => el.remove());
  });

  it('初始状态下不渲染任何模态弹窗 DOM', () => {
    expect(confirmState.value.visible).toBe(false);
    const overlay = document.body.querySelector('.am-confirm-dialog-overlay');
    expect(overlay).toBeNull();
  });

  it('调用 showConfirm 后通过 Teleport 将弹窗挂载至 document.body 且 z-index 为 3000', async () => {
    const confirmPromise = showConfirm({
      title: '批量去重确认',
      message: '测试明细内容',
      confirmText: '立即归一化',
      cancelText: '取消',
      danger: true,
    });

    await nextTick();

    // 验证 Teleport: 弹窗直接作为 document.body 的子节点，脱离局部容器
    const overlay = document.body.querySelector('.am-confirm-dialog-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.parentElement).toBe(document.body);

    // 验证 z-index 设置为 3000（高于图片编辑器 1000、去重比对 1050 与重命名 1100）
    expect(overlay.style.zIndex).toBe('3000');

    // 验证标题与提示信息
    const titleEl = overlay.querySelector('.am-dialog__header h3');
    expect(titleEl?.textContent).toContain('批量去重确认');
    const bodyEl = overlay.querySelector('.am-dialog__body');
    expect(bodyEl?.textContent).toContain('测试明细内容');

    // 验证确定按钮
    const confirmBtn = overlay.querySelector('.am-btn--danger') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn.textContent?.trim()).toBe('立即归一化');

    // 点击确定
    confirmBtn.click();
    const result = await confirmPromise;
    expect(result).toBe(true);

    await nextTick();
    // 关闭后 DOM 自动销毁
    expect(document.body.querySelector('.am-confirm-dialog-overlay')).toBeNull();
  });

  it('点击取消按钮正常 resolve(false) 并销毁 DOM', async () => {
    const confirmPromise = showConfirm({
      title: '操作确认',
      message: '是否取消？',
    });

    await nextTick();

    const overlay = document.body.querySelector('.am-confirm-dialog-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();

    const cancelBtn = overlay.querySelector('.am-btn--ghost') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();

    cancelBtn.click();
    const result = await confirmPromise;
    expect(result).toBe(false);

    await nextTick();
    expect(document.body.querySelector('.am-confirm-dialog-overlay')).toBeNull();
  });

  it('按 Esc 快捷键自动取消弹窗', async () => {
    const confirmPromise = showConfirm({
      title: '批量去重',
      message: '按 Esc 测试取消',
    });

    await nextTick();
    expect(document.body.querySelector('.am-confirm-dialog-overlay')).not.toBeNull();

    // 触发 Esc 按键事件
    const escEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    window.dispatchEvent(escEvent);

    const result = await confirmPromise;
    expect(result).toBe(false);

    await nextTick();
    expect(document.body.querySelector('.am-confirm-dialog-overlay')).toBeNull();
  });

  it('点击遮罩背景空白处自动取消弹窗', async () => {
    const confirmPromise = showConfirm({
      title: '点击遮罩测试',
      message: '测试内容',
    });

    await nextTick();
    const overlay = document.body.querySelector('.am-confirm-dialog-overlay') as HTMLElement;
    expect(overlay).not.toBeNull();

    // 模拟点击遮罩自身（click.self）
    overlay.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const result = await confirmPromise;
    expect(result).toBe(false);

    await nextTick();
    expect(document.body.querySelector('.am-confirm-dialog-overlay')).toBeNull();
  });
});
