import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import type { AssetInfo, BlockRef } from '../src/utils/siyuan-db';

const hoisted = vi.hoisted(() => ({
  assets: [] as AssetInfo[],
  pending: [] as Array<() => void>,
}));

vi.mock('../src/utils/siyuan-db', () => ({
  getAllAssetsInfo: vi.fn(
    () =>
      new Promise<AssetInfo[]>((resolve) => {
        hoisted.pending.push(() => {
          resolve(hoisted.assets);
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

import AssetsManager from '../src/components/AssetsManager.vue';

function makeVideoAsset(name: string, size: number): AssetInfo {
  return {
    name,
    size,
    updated: 1700000000000,
    isDir: false,
    references: [],
    refCount: 0,
    docCount: 0,
    isReEditable: false,
    isOriginal: false,
  };
}

const VIDEO_FIXTURE: AssetInfo[] = [
  makeVideoAsset('demo.mp4', 5000000),
];

describe('AssetsManager 视频预览控制栏与默认静音测试', () => {
  let app: App | null = null;
  let mountContainer: HTMLDivElement;

  beforeEach(() => {
    hoisted.assets = VIDEO_FIXTURE.map((a) => ({ ...a }));
    hoisted.pending = [];
    mountContainer = document.createElement('div');
    document.body.appendChild(mountContainer);

    // Mock HTMLMediaElement.prototype.play and pause in jsdom
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
    window.HTMLMediaElement.prototype.load = vi.fn();
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
    await flushLoad();
    return mountContainer;
  }

  it('视频预览界面初始化时默认静音，包含半透明控制栏与播放、进度、静音控件', async () => {
    await mountManager();

    // 获取 VirtualAssetList
    const virtualList = mountContainer.querySelector('.virtual-list-wrapper');
    expect(virtualList).not.toBeNull();

    // 通过触发列表项的 asset-name 区域 mouseenter 模拟触发悬浮预览
    const assetNameEl = mountContainer.querySelector('.asset-name');
    expect(assetNameEl).not.toBeNull();

    // 触发鼠标移入事件
    assetNameEl?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));

    // 等待 250ms 防抖定时器执行
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    const hoverPreview = mountContainer.querySelector('.asset-hover-preview');
    expect(hoverPreview).not.toBeNull();
    expect(hoverPreview?.classList.contains('is-interactive')).toBe(true);
    expect(hoverPreview?.classList.contains('is-video')).toBe(true);

    const videoEl = hoverPreview?.querySelector('video') as HTMLVideoElement | null;
    expect(videoEl).not.toBeNull();
    // 默认始终静音播放
    expect(videoEl?.muted).toBe(true);

    // 包含底部控制栏
    const controlsOverlay = hoverPreview?.querySelector('.video-controls-overlay');
    expect(controlsOverlay).not.toBeNull();

    // 包含播放/暂停按钮
    const playBtn = controlsOverlay?.querySelector('.play-pause-btn') as HTMLButtonElement | null;
    expect(playBtn).not.toBeNull();

    // 包含进度条
    const progressContainer = controlsOverlay?.querySelector('.video-progress-container');
    expect(progressContainer).not.toBeNull();

    // 包含时间显示
    const timeDisplay = controlsOverlay?.querySelector('.video-time-display');
    expect(timeDisplay).not.toBeNull();

    // 包含静音切换按钮且处于静音状态
    const muteBtn = controlsOverlay?.querySelector('.mute-btn') as HTMLButtonElement | null;
    expect(muteBtn).not.toBeNull();
    expect(muteBtn?.classList.contains('is-muted')).toBe(true);
  });

  it('点击静音按钮可切换声音状态，且点击播放按钮可切换播放/暂停', async () => {
    await mountManager();

    const assetNameEl = mountContainer.querySelector('.asset-name');
    assetNameEl?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    const hoverPreview = mountContainer.querySelector('.asset-hover-preview');
    const videoEl = hoverPreview?.querySelector('video') as HTMLVideoElement;
    const muteBtn = hoverPreview?.querySelector('.mute-btn') as HTMLButtonElement;
    const playBtn = hoverPreview?.querySelector('.play-pause-btn') as HTMLButtonElement;

    expect(videoEl.muted).toBe(true);
    expect(muteBtn.classList.contains('is-muted')).toBe(true);

    // 点击取消静音
    muteBtn.click();
    await settle();
    expect(videoEl.muted).toBe(false);
    expect(muteBtn.classList.contains('is-muted')).toBe(false);

    // 再次点击恢复静音
    muteBtn.click();
    await settle();
    expect(videoEl.muted).toBe(true);
    expect(muteBtn.classList.contains('is-muted')).toBe(true);

    // 点击暂停
    playBtn.click();
    await settle();
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('关闭并重新打开资源管家后，视频预览始终恢复默认静音', async () => {
    // 第一次打开
    await mountManager();
    const assetNameEl = mountContainer.querySelector('.asset-name');
    assetNameEl?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    let hoverPreview = mountContainer.querySelector('.asset-hover-preview');
    let muteBtn = hoverPreview?.querySelector('.mute-btn') as HTMLButtonElement;
    expect(muteBtn.classList.contains('is-muted')).toBe(true);

    // 用户在当前会话期间取消了静音
    muteBtn.click();
    await settle();
    expect(muteBtn.classList.contains('is-muted')).toBe(false);

    // 模拟关闭资源管家（销毁卸载组件）
    app?.unmount();
    app = null;
    mountContainer.innerHTML = '';
    await settle();

    // 模拟再次新打开资源管家（重新挂载组件）
    await mountManager();
    const assetNameEl2 = mountContainer.querySelector('.asset-name');
    assetNameEl2?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: 100, clientY: 100 }));
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();

    hoverPreview = mountContainer.querySelector('.asset-hover-preview');
    muteBtn = hoverPreview?.querySelector('.mute-btn') as HTMLButtonElement;
    const videoEl2 = hoverPreview?.querySelector('video') as HTMLVideoElement;

    // 验证新打开后恢复为默认静音
    expect(videoEl2.muted).toBe(true);
    expect(muteBtn.classList.contains('is-muted')).toBe(true);
  });
});
